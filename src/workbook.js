(function (root) {
  'use strict';
  const C = root.TrackerCore;
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const children = (node,tag) => node ? [...node.children].filter(n=>n.localName===tag) : [];
  const first = (node,tag) => children(node,tag)[0] || null;
  // rPh contains pronunciation hints, not the cell's original text.
  const stringText = node => node ? [...node.children].map(child=>child.localName==='t'?child.textContent:child.localName==='r'?children(child,'t').map(text=>text.textContent).join(''):'').join('') : '';
  function parse(xml, context) {
    const doc = new DOMParser().parseFromString(xml,'application/xml');
    if (doc.querySelector('parsererror')) throw Error(context+': XML 无法解析');
    return doc;
  }
  const serialize = doc => new XMLSerializer().serializeToString(doc);
  function indexSheet(doc, name) {
    const data = doc.getElementsByTagNameNS(NS,'sheetData')[0];
    if (!data) throw Error(name+': 缺少 sheetData');
    const rows = new Map(), cells = new Map();
    for (const row of children(data,'row')) {
      const n = Number(row.getAttribute('r'));
      if (!Number.isInteger(n) || n<1 || rows.has(n)) throw Error(name+': 重复或无效行号');
      rows.set(n,row);
      for (const cell of children(row,'c')) {
        const ref = cell.getAttribute('r');
        if (!/^[A-Z]+[1-9]\d*$/.test(ref) || Number(ref.match(/\d+$/)[0])!==n || cells.has(ref)) throw Error(name+': 重复或无效单元格 '+ref);
        for(const tag of ['v','is','f'])if(children(cell,tag).length>1)throw Error(name+'!'+ref+': 重复的 '+tag+' 内容');
        cells.set(ref,cell);
      }
    }
    return {doc,name,data,rows,cells};
  }
  function value(sheet, ref, strings = []) {
    const cell = sheet.cells.get(ref);
    if (!cell) return '';
    const type = cell.getAttribute('t');
    if (type==='e') throw Error(sheet.name+'!'+ref+': Excel 错误值');
    if (type==='inlineStr') return stringText(first(cell,'is'));
    const raw = first(cell,'v')?.textContent ?? '';
    if (type==='s') {
      const n = Number(raw);
      if (!/^\d+$/.test(raw) || !Number.isInteger(n) || strings[n]===undefined) throw Error(sheet.name+'!'+ref+': sharedStrings 索引无效');
      return strings[n];
    }
    return raw;
  }
  function rawValue(sheet,ref,strings) {
    if (first(sheet.cells.get(ref),'f')) throw Error(sheet.name+'!'+ref+': 原始输入不能使用公式');
    return value(sheet,ref,strings);
  }
  function numeric(sheet,ref,strings,optional=false) {
    const raw = rawValue(sheet,ref,strings), type = sheet.cells.get(ref)?.getAttribute('t');
    if (raw==='' && optional) return '';
    if (raw==='' || (type && type!=='n') || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/.test(raw) || !Number.isFinite(Number(raw))) throw Error(sheet.name+'!'+ref+': 需要有限数值'+(optional?'或空白':''));
    return raw;
  }
  function text(sheet,ref,strings) {
    const raw = rawValue(sheet,ref,strings), type = sheet.cells.get(ref)?.getAttribute('t');
    if (raw!=='' && !['s','str','inlineStr'].includes(type)) throw Error(sheet.name+'!'+ref+': 需要文本');
    return String(raw);
  }
  function getCell(sheet,ref) {
    if (sheet.cells.has(ref)) return sheet.cells.get(ref);
    const n = Number(ref.match(/\d+$/)[0]);
    let row = sheet.rows.get(n);
    if (!row) {
      row=sheet.doc.createElementNS(NS,'row');row.setAttribute('r',n);
      sheet.data.insertBefore(row,[...sheet.rows.entries()].find(([r])=>r>n)?.[1] || null);
      sheet.rows.set(n,row);
    }
    const cell=sheet.doc.createElementNS(NS,'c');cell.setAttribute('r',ref);
    const col = ref.match(/^[A-Z]+/)[0];
    const colNum = s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
    row.insertBefore(cell,children(row,'c').find(c=>colNum(c.getAttribute('r').match(/^[A-Z]+/)[0])>colNum(col)) || null);
    sheet.cells.set(ref,cell);
    return cell;
  }
  function set(sheet,ref,data,cache=false) {
    const cell = getCell(sheet,ref);
    for (const node of [...cell.children]) if (['v','is',...(cache?[]:['f'])].includes(node.localName)) node.remove();
    cell.removeAttribute('t');
    if (data===null || data===undefined || data==='') {if(cache)cell.setAttribute('t','str');return}
    if (typeof data==='number' && !Number.isFinite(data)) throw Error(sheet.name+'!'+ref+': 拒绝写入非有限数值');
    if(!cache && typeof data!=='number') {
      cell.setAttribute('t','inlineStr');
      const inline=sheet.doc.createElementNS(NS,'is'),text=sheet.doc.createElementNS(NS,'t');
      text.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');text.textContent=String(data);
      inline.appendChild(text);cell.appendChild(inline);return;
    }
    cell.setAttribute('t',typeof data==='number'?'n':'str');
    const v=sheet.doc.createElementNS(NS,'v');v.textContent=String(data);cell.appendChild(v);
  }
  async function xml(zip,path) {
    const file=zip.file(path);
    if (!file) throw Error('工作簿缺少 '+path);
    const text=await file.async('string');
    if(text.length>16*1024*1024)throw Error(path+': XML 超出本工具支持范围');
    return parse(text,path);
  }
  async function locate(zip) {
    const [book,rels] = await Promise.all([xml(zip,'xl/workbook.xml'),xml(zip,'xl/_rels/workbook.xml.rels')]);
    const props=book.getElementsByTagNameNS(NS,'workbookPr')[0];
    if(['1','true'].includes(props?.getAttribute('date1904')))throw Error('workbookPr: 暂不支持 1904 日期系统；原文件未修改');
    const relationships=new Map();
    for(const r of [...rels.documentElement.children]) {
      const id=r.getAttribute('Id');
      if(relationships.has(id))throw Error('workbook relationships: 重复 Id');
      relationships.set(id,r);
    }
    const paths={};
    const sheets=[...book.getElementsByTagNameNS(NS,'sheet')];
    if(sheets.length!==3)throw Error('工作簿必须包含 Tool、Work Log、Config 三张 Sheet');
    for(const sheet of sheets) {
      const name=sheet.getAttribute('name'), r=relationships.get(sheet.getAttributeNS(REL,'id'));
      if(!['Tool','Work Log','Config'].includes(name) || paths[name] || !r || r.getAttribute('TargetMode')==='External' || !r.getAttribute('Type')?.endsWith('/worksheet'))throw Error('工作簿 Sheet 名称或 relationship 无效：'+name);
      const raw=r.getAttribute('Target') || '', parts=(raw.startsWith('/')?raw.slice(1):'xl/'+raw).split('/'), normalized=[];
      for(const part of parts){if(part==='..'){if(!normalized.length)throw Error('Sheet 路径越界');normalized.pop()}else if(part && part!=='.')normalized.push(part)}
      const path=normalized.join('/');
      if(!path.startsWith('xl/worksheets/') || !path.endsWith('.xml') || Object.values(paths).includes(path))throw Error('Sheet 路径无效：'+name);
      paths[name]=path;
    }
    return {book,paths};
  }
  function normalizeFormula(formula) {
    return formula.replace(/^=/,'').split(/("(?:[^"]|"")*")/g).map((part,i)=>i%2?part:part.replace(/'Config'!/gi,'Config!').replace(/\s+/g,'').toUpperCase()).join('');
  }
  function formulaReader(sheet) {
    const masters=new Map();
    for(const [ref,cell] of sheet.cells) {
      const f=first(cell,'f');
      if(f?.getAttribute('t')==='shared' && f.textContent) {
        const si=f.getAttribute('si');
        if(si===null || masters.has(si))throw Error(sheet.name+'!'+ref+': shared formula 主公式无效');
        masters.set(si,{ref,text:f.textContent,range:f.getAttribute('ref')});
      }
    }
    return ref=>{
      const f=first(sheet.cells.get(ref),'f');
      if(!f)throw Error(sheet.name+'!'+ref+': 缺少计算公式；拒绝覆盖');
      if(f.getAttribute('t')==='shared') {
        const master=masters.get(f.getAttribute('si'));
        if(!master)throw Error(sheet.name+'!'+ref+': shared formula 缺少主公式');
        const bounds=/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(master.range || ''), dest=/^([A-Z]+)(\d+)$/.exec(ref);
        const col=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
        if(!bounds || col(dest[1])<col(bounds[1]) || col(dest[1])>col(bounds[3]) || +dest[2]<+bounds[2] || +dest[2]>+bounds[4])throw Error(sheet.name+'!'+ref+': shared formula 范围无效');
        return C.translateFormula(master.text,master.ref,ref);
      }
      if(f.getAttribute('t') && f.getAttribute('t')!=='normal')throw Error(sheet.name+'!'+ref+': 不支持此计算公式类型');
      return f.textContent;
    };
  }
  function checkFormula(reader,sheet,ref,expected) {
    if(normalizeFormula(reader(ref))!==normalizeFormula(expected))throw Error(sheet.name+'!'+ref+': 计算公式与此版本不符；自定义公式不支持写入');
  }
  function readConfig(sheet,strings) {
    const version=text(sheet,'B10',strings);
    if(!['2.0',C.VERSION].includes(version))throw Error('Config!B10: 不支持的版本 '+version+'，仅支持 2.0 / 3.0');
    const config={minHours:Number(numeric(sheet,'B5',strings)),ahStart:Number(numeric(sheet,'B6',strings))*24,mult:Number(numeric(sheet,'B7',strings)),tolerance:Number(numeric(sheet,'B8',strings)),allocation:text(sheet,'B9',strings)};
    // Excel serial fractions can introduce insignificant binary noise.
    config.ahStart=Math.round(config.ahStart*60000000)/60000000;
    if(version===C.VERSION)config.ahEnd=Math.round(Number(numeric(sheet,'B16',strings))*24*60000000)/60000000;
    try{C.validateConfig(config,version)}catch(error){throw Error('Config!B5:B9 / B16: '+error.message)}
    let baseline=null;
    if(version===C.VERSION) {
      try {
        baseline=JSON.parse(text(sheet,'B17',strings));
        if(!baseline || typeof baseline!=='object' || Object.keys(baseline).sort().join(',')!==Object.keys(C.DEFAULT_CONFIG).sort().join(','))throw Error('快照字段不完整');
        C.validateConfig(baseline);
      }catch(error){throw Error('Config!B17: 上次保存的规则快照无效 · '+error.message)}
    }
    return {version,config,baseline,configChanged:baseline!==null && C.configSnapshot(config)!==C.configSnapshot(baseline)};
  }
  async function read(input) {
    const zip=await JSZip.loadAsync(input), {book,paths}=await locate(zip);
    const [logDoc,cfgDoc,toolDoc]=await Promise.all(['Work Log','Config','Tool'].map(name=>xml(zip,paths[name])));
    const shared=zip.file('xl/sharedStrings.xml') ? await xml(zip,'xl/sharedStrings.xml') : null;
    const strings=shared?[...shared.getElementsByTagNameNS(NS,'si')].map(stringText):[];
    const log=indexSheet(logDoc,'Work Log'), cfg=indexSheet(cfgDoc,'Config'), tool=indexSheet(toolDoc,'Tool');
    C.HEADERS.forEach((expected,i)=>{const ref=String.fromCharCode(65+i)+'5';if(text(log,ref,strings)!==expected)throw Error('Work Log!'+ref+': 列头应为 '+expected)});
    const settings=readConfig(cfg,strings), reader=formulaReader(log), records=[], ids=new Set();
    for(const [ref,cell] of log.cells) {
      const [,col,rowText]=/^([A-Z]+)(\d+)$/.exec(ref), row=Number(rowText);
      if(row>=5 && (col.length>1 || col>'T')) {if(value(log,ref,strings)!=='' || first(cell,'f'))throw Error('Work Log!'+ref+': 存在未支持的附加列')}
      if(row>305 && C.RAW_COLUMNS.includes(col) && (value(log,ref,strings)!=='' || first(cell,'f')))throw Error('Work Log!'+ref+': 记录超出 300 条容量，拒绝截断');
    }
    for(let row=6;row<=305;row++) {
      const occupied=C.RAW_COLUMNS.some(col=>value(log,col+row,strings)!=='' || first(log.cells.get(col+row),'f'));
      const hasFormula=C.FORMULA_COLUMNS.some(col=>first(log.cells.get(col+row),'f'));
      if(occupied || hasFormula)for(const col of C.FORMULA_COLUMNS)checkFormula(reader,log,col+row,C.formulas(row,settings.version)[col]);
      if(!occupied)continue;
      const number=col=>numeric(log,col+row,strings,true), str=col=>text(log,col+row,strings);
      let date='', start='',end='';
      const dateRaw=number('A');
      if(dateRaw!==''){try{date=C.fromSerial(dateRaw)}catch(error){throw Error('Work Log!A'+row+': '+error.message)}}
      const time=col=>{const raw=number(col);if(raw==='')return '';const n=Number(raw)*1440;if(n<0 || n>=1440 || Math.abs(n-Math.round(n))>1e-6)throw Error('Work Log!'+col+row+': 时间应为 00:00–23:59 的整分钟');return C.timeText(Math.round(n)/60)};
      start=time('K');end=time('L');
      const record={kind:str('M'),date,invoice:str('B'),start,end,lunch:number('D'),rate:number('E'),app:number('H'),extra:number('N'),note:str('J'),balance:number('O')};
      const error=C.validateRecord(record,settings.config,settings.version);
      if(error)throw Error('Work Log 第 '+row+' 行 · '+error);
      if(record.invoice && ids.has(record.invoice))throw Error('Work Log!B'+row+': 重复 Invoice ID '+record.invoice);
      if(record.invoice)ids.add(record.invoice);
      records.push(record);
    }
    const toolReader=formulaReader(tool);
    for(const [ref,formula] of Object.entries({B6:'COUNTIF(\'Work Log\'!$M$6:$M$305,"Job")',B7:"SUM('Work Log'!$G$6:$G$305)",B8:"SUM('Work Log'!$H$6:$H$305)",B9:"SUM('Work Log'!$I$6:$I$305)",B10:'SUMIF(\'Work Log\'!$M$6:$M$305,"Carryover",\'Work Log\'!$G$6:$G$305)'}))checkFormula(toolReader,tool,ref,formula);
    return {...settings,records,paths,book};
  }
  async function write(records,config) {
    C.validateRecords(records,config);
    const zip=await JSZip.loadAsync(TEMPLATE_BASE64,{base64:true}), {book,paths}=await locate(zip);
    const [logDoc,cfgDoc,toolDoc]=await Promise.all(['Work Log','Config','Tool'].map(name=>xml(zip,paths[name])));
    const log=indexSheet(logDoc,'Work Log'), cfg=indexSheet(cfgDoc,'Config'), tool=indexSheet(toolDoc,'Tool');
    for(let row=6;row<=305;row++) {
      for(const col of C.RAW_COLUMNS)set(log,col+row,'');
      for(const col of C.FORMULA_COLUMNS)set(log,col+row,null,true);
    }
    const calculations=records.map(record=>C.calculate(record,config));
    records.forEach((record,index)=>{
      const row=index+6, c=calculations[index], job=record.kind==='Job';
      const num=value=>C.blank(value)?'':Number(value);
      const raw={A:record.date?C.toSerial(record.date):'',B:record.invoice,D:job?num(record.lunch):'',E:job?num(record.rate):'',H:job?num(record.app):'',J:record.note,K:job?C.minutes(record.start)/1440:'',L:job?C.minutes(record.end)/1440:'',M:record.kind,N:job?num(record.extra):'',O:job?'':Number(record.balance)};
      for(const [col,data] of Object.entries(raw))set(log,col+row,data);
      const cache={C:job?record.start+' - '+record.end:'',F:job?c.bill.toFixed(2)+' ('+c.ah.toFixed(2)+')':'—',G:c.total,I:c.diff,P:c.raw,Q:c.bill,R:c.ah,S:c.rawAH,T:job?c.base:null};
      for(const [col,data] of Object.entries(cache))set(log,col+row,data,true);
    });
    for(const [ref,data] of Object.entries({B5:Number(config.minHours),B6:config.ahStart/24,B7:Number(config.mult),B8:Number(config.tolerance),B9:config.allocation,B10:C.VERSION,B16:config.ahEnd/24,B17:C.configSnapshot(config)}))set(cfg,ref,data);
    const sum=fn=>C.round(records.reduce((total,r,i)=>total+fn(r,calculations[i]),0));
    for(const [ref,data] of Object.entries({B6:records.filter(r=>r.kind==='Job').length,B7:sum((r,c)=>c.total),B8:sum(r=>Number(r.app || 0)),B9:sum((r,c)=>c.diff || 0),B10:sum((r,c)=>r.kind==='Carryover'?c.total:0)}))set(tool,ref,data,true);
    for(const [name,sheet] of [['Work Log',log],['Config',cfg],['Tool',tool]])zip.file(paths[name],serialize(sheet.doc));
    let calc=first(book.documentElement,'calcPr');
    if(!calc){calc=book.createElementNS(NS,'calcPr');book.documentElement.appendChild(calc)}
    calc.setAttribute('fullCalcOnLoad','1');calc.setAttribute('forceFullCalc','1');calc.setAttribute('calcMode','auto');
    zip.file('xl/workbook.xml',serialize(book));
    return zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:5}});
  }
  root.TrackerWorkbook=Object.freeze({read,write});
})(globalThis);
