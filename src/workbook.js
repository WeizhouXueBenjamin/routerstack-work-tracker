(function (root) {
  'use strict';
  const C = root.TrackerCore;
  const M = root.TrackerModel;
  const SHEETS=Object.freeze(['Work Log','Config','Follow-up','History']);
  const FILE_LIMIT=32*1024*1024, XML_LIMIT=16*1024*1024, TOTAL_XML_LIMIT=64*1024*1024, EXCEL_ROWS=1048576;
  const budgets=new WeakMap(),exports=new WeakMap();
  function budget(zip,path,length) {
    let entry=budgets.get(zip);if(!entry){entry={parts:new Set(),total:0};budgets.set(zip,entry)}
    if(entry.parts.has(path))return;
    if(length>XML_LIMIT || entry.total+length>TOTAL_XML_LIMIT)throw Error(path+': XML 超出本工具支持范围');
    entry.parts.add(path);entry.total+=length;
  }
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
    if(doc.documentElement.localName!=='worksheet' || doc.documentElement.namespaceURI!==NS)throw Error(name+': 工作表 XML 类型无效');
    const data = doc.getElementsByTagNameNS(NS,'sheetData')[0];
    if (!data) throw Error(name+': 缺少 sheetData');
    const rows = new Map(), cells = new Map();
    for (const row of children(data,'row')) {
      const n = Number(row.getAttribute('r'));
      if (!Number.isInteger(n) || n<1 || n>1048576 || rows.has(n)) throw Error(name+': 重复或无效行号');
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
    if(file._data?.uncompressedSize>XML_LIMIT*4)throw Error(path+': XML 超出本工具支持范围');
    const text=await file.async('string');
    budget(zip,path,text.length);
    return parse(text,path);
  }
  async function locate(zip,names=SHEETS) {
    const [book,rels] = await Promise.all([xml(zip,'xl/workbook.xml'),xml(zip,'xl/_rels/workbook.xml.rels')]);
    if(book.documentElement.localName!=='workbook' || book.documentElement.namespaceURI!==NS || rels.documentElement.localName!=='Relationships' || rels.documentElement.namespaceURI!==PKG)throw Error('XLSX 工作簿或关系 XML 类型无效');
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
    if(sheets.length!==names.length)throw Error('仅支持 schema 5.0（四张 Sheet）；旧 2.0–4.1 不提供迁移。工作簿必须包含 '+names.join('、'));
    for(const sheet of sheets) {
      const name=sheet.getAttribute('name'), r=relationships.get(sheet.getAttributeNS(REL,'id'));
      if(!names.includes(name) || paths[name] || !r || r.getAttribute('TargetMode')==='External' || !r.getAttribute('Type')?.endsWith('/worksheet'))throw Error('工作簿 Sheet 名称或 relationship 无效：'+name);
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
  const WORK_HEADERS=Object.freeze([...C.HEADERS,'invoice','lunch','extra','difference','id','type','minHours','ahStart','ahEnd','mult','tolerance','allocation','rawHours','billableHours','ahHours','rawAHHours','baseEstimated','periodId','createdAt','updatedAt','reminderKinds']);
  const TABLES=Object.freeze({
    WorkLog:{sheet:'Work Log',key:'records',left:1,headers:WORK_HEADERS},
    Periods:{sheet:'Config',key:'periods',left:1,top:28},
    BankReceived:{sheet:'Follow-up',key:'bankReceived',left:1,top:3},
    Issues:{sheet:'Follow-up',key:'issues',left:8,top:3},
    Balances:{sheet:'Follow-up',key:'balances',left:19,top:3},
    AppChanges:{sheet:'History',key:'appChanges',left:1,top:3},
    IssueHistory:{sheet:'History',key:'issueHistory',left:13,top:3},
    BalanceHistory:{sheet:'History',key:'balanceHistory',left:26,top:3}
  });
  const column=value=>{let result='';while(value>0){result=String.fromCharCode(65+(value-1)%26)+result;value=Math.floor((value-1)/26)}return result};
  const colNumber=value=>[...value].reduce((n,char)=>n*26+char.charCodeAt(0)-64,0);
  const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[char]));
  const PKG='http://schemas.openxmlformats.org/package/2006/relationships';
  const TYPES='http://schemas.openxmlformats.org/package/2006/content-types';
  const declaration='<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const doc=(tag,body,attrs='')=>declaration+`<${tag} xmlns="${NS}" ${attrs}>${body}</${tag}>`;
  function cell(ref,data,{formula=null,style=0}={}) {
    const attrs=`r="${ref}" s="${style}"`;
    if(formula!==null)return `<c ${attrs}${data===null || typeof data==='string'?' t="str"':''}><f>${esc(formula)}</f><v>${data===null?'':esc(data)}</v></c>`;
    if(data===null || data===undefined)return `<c ${attrs}/>`;
    if(typeof data==='boolean')return `<c ${attrs} t="b"><v>${data?1:0}</v></c>`;
    if(typeof data==='number')return `<c ${attrs}><v>${data}</v></c>`;
    return `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${esc(data)}</t></is></c>`;
  }
  function rowXml(n,cells) {return `<row r="${n}">${cells.join('')}</row>`}
  const configCells=Object.fromEntries(M.CONFIG_FIELDS.map((key,index)=>[key,'B'+(index+5)]));
  const metadataCells=Object.fromEntries(M.META_FIELDS.map((key,index)=>[key,'B'+(index+14)]));
  const currentRuleFormulas=Object.freeze({O:'Config!$B$5',P:'Config!$B$6',Q:'Config!$B$7',R:'Config!$B$8',S:'Config!$B$9',T:'Config!$B$10'});
  function payload(state) {
    const result=M.clone(state);result.metadata.integrityDigest=null;
    for(const key of M.ROOT_FIELDS.filter(key=>Array.isArray(result[key])))result[key].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
    return result;
  }
  async function hashBytes(bytes) {
    const hash=await root.crypto.subtle.digest('SHA-256',bytes);
    return [...new Uint8Array(hash)].map(value=>value.toString(16).padStart(2,'0')).join('');
  }
  const digest=state=>hashBytes(new TextEncoder().encode(M.canonical(payload(state))));
  function summaries(state) {
    const months=[...new Set(state.records.filter(row=>row.type==='Current').map(row=>row.date.slice(0,7)))].sort();
    return [{label:'Historical',kind:'Historical'},...months.map(month=>({label:new Date(month+'-01T00:00Z').toLocaleDateString('en-NZ',{month:'short',year:'numeric',timeZone:'UTC'}),month})),{label:'Total',kind:'Total'}];
  }
  function summaryFormulas(group) {
    const c=header=>'RS_WorkLog['+header+']';
    let criteria=[c('id'),'"<>"'];
    if(group.kind==='Historical')criteria.push(c('type'),'"Historical"');
    if(group.month) {
      const [year,month]=group.month.split('-').map(Number),endSerial=(Date.UTC(year,month,1)-Date.UTC(1899,11,30))/86400000;
      criteria.push(c('type'),'"Current"',c('Date'),'">="&'+C.toSerial(group.month+'-01'),c('Date'),'"<"&'+endSerial);
    }
    const args=criteria.join(','),count=`COUNTIFS(${args})`,known=`COUNTIFS(${args},${c('Displayed Revenue')},"<>")`;
    return {B:`IF(${count}=0,"",SUMIFS(${c('Estimated Revenue')},${args}))`,C:`IF(${known}=0,"",SUMIFS(${c('Displayed Revenue')},${args}))`,D:`IF(${known}=0,"",SUMIFS(${c('difference')},${args}))`};
  }
  function groupTotals(state,group) {
    const records=state.records.filter(row=>group.kind==='Total' || group.kind==='Historical' && row.type==='Historical' || group.month && row.type==='Current' && row.date.startsWith(group.month));
    let estimated=0,app=0,difference=0,known=0;
    for(const row of records) {
      const calc=M.calculate(state,row);estimated+=Math.round(calc.total*100);
      if(row.app!==null){app+=row.app;difference+=Math.round(calc.diff*100);known++}
    }
    return {estimated:records.length?estimated/100:null,app:known?C.round(app):null,difference:known?difference/100:null,partial:known<records.length,count:records.length,known};
  }
  function workValues(row) {
    const rule=row?.ruleSnapshot;
    return row?[C.toSerial(row.date),C.minutes(row.start)/1440,C.minutes(row.end)/1440,null,row.rate,null,row.app,row.note,row.invoice,row.lunch,row.extra,null,row.id,row.type,...['minHours','ahStart','ahEnd','mult','tolerance','allocation'].map(key=>rule?.[key] ?? null),null,null,null,null,null,row.periodId,row.createdAt,row.updatedAt,row.reminderKinds.join(',')]:Array(WORK_HEADERS.length).fill(null);
  }
  function workCache(state,row) {
    if(!row)return Object.fromEntries(C.FORMULA_COLUMNS.map(key=>[key,null]));
    const calc=M.calculate(state,row);
    return {D:calc.lengthHours,F:calc.total,L:calc.diff,U:calc.raw,V:calc.bill,W:calc.ah,X:calc.rawAH,Y:calc.base};
  }
  function tableLayout(state) {
    return Object.entries(TABLES).map(([name,spec],index)=>{
      const headers=spec.headers || M.TABLE_FIELDS[spec.key],top=spec.top || summaries(state).length+5;
      const bottom=top+Math.max(1,state[spec.key].length),right=spec.left+headers.length-1;
      if(bottom>EXCEL_ROWS)throw Error('RS_'+name+': 超出 Excel 行数上限');
      return {name,...spec,headers,top,bottom,right,index:index+1,ref:column(spec.left)+top+':'+column(right)+bottom};
    });
  }
  const styles=()=>doc('styleSheet',
    '<numFmts count="4"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="hh:mm"/><numFmt numFmtId="166" formatCode="0.00"/><numFmt numFmtId="167" formatCode="0.00&amp;quot;*&amp;quot;"/></numFmts>'+ // partial cells use a conditional number format below
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'+
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE7EEF6"/><bgColor indexed="64"/></patternFill></fill></fills>'+
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'+
    '<cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="right"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment wrapText="1" vertical="top"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"><alignment horizontal="right"/></xf></cellXfs>'+
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="1"><dxf><fill><patternFill patternType="solid"><fgColor rgb="FFF0F0F0"/><bgColor rgb="FFF0F0F0"/></patternFill></fill></dxf></dxfs><tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>');
  function tableXml(table) {
    const formulas=table.name==='WorkLog'?C.formulas(table.top+1):{};
    return doc('table',`<autoFilter ref="${table.ref}"/><tableColumns count="${table.headers.length}">${table.headers.map((header,i)=>`<tableColumn id="${i+1}" name="${esc(header)}">${formulas[column(table.left+i)]?'<calculatedColumnFormula>'+esc(formulas[column(table.left+i)])+'</calculatedColumnFormula>':''}</tableColumn>`).join('')}</tableColumns><tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="0" showColumnStripes="0"/>`,`id="${table.index}" name="RS_${table.name}" displayName="RS_${table.name}" ref="${table.ref}" totalsRowShown="0"`);
  }
  async function write(input,{fileName='',template=false}={}) {
    let state;
    if(template) {
      state=M.create();state.periods=[];for(const key of ['currentPeriodId','fileId','fileVersionId'])state.metadata[key]=null;
    } else {
      M.validate(input);state=M.clone(input);state.metadata.previousFileVersionId=state.metadata.fileVersionId;state.metadata.fileVersionId=root.crypto.randomUUID();state.metadata.fileName=fileName || state.metadata.fileName;
    }
    state.metadata.integrityDigest=await digest(state);
    const zip=new JSZip(),tables=tableLayout(state),paths={};
    for(const [sheetIndex,name] of SHEETS.entries()) {
      const path=paths[name]='xl/worksheets/sheet'+(sheetIndex+1)+'.xml',local=tables.filter(table=>table.sheet===name),rows=new Map();
      const add=(r,c,data,options)=>{if(!rows.has(r))rows.set(r,new Map());rows.get(r).set(c,cell(column(c)+r,data,options))};
      add(1,1,name==='Work Log'?'Revenue Summary · NZD':name,{style:6});
      if(name==='Config') {
        for(const [key,ref] of Object.entries(configCells)){const r=Number(ref.slice(1));add(r,1,key);add(r,2,state.config[key])}
        for(const [key,ref] of Object.entries(metadataCells)){const r=Number(ref.slice(1));add(r,1,key);add(r,2,state.metadata[key])}
      }
      if(name==='Work Log') {
        ['Period','Estimated','App','Difference'].forEach((value,i)=>add(2,i+1,value,{style:5}));
        summaries(state).forEach((group,i)=>{
          const r=i+3,total=groupTotals(state,group);add(r,1,group.label,{style:6});
          for(const [j,[col,formula]] of Object.entries(summaryFormulas(group)).entries())add(r,j+2,[total.estimated,total.app,total.difference][j],{formula,style:col==='D' && total.partial && total.known?7:3});
        });
        add(summaries(state).length+3,1,'* Partial：差额仅合计 Estimated 和 App 均已知的记录；无可比项留空。');
      }
      for(const table of local) {
        table.headers.forEach((header,index)=>add(table.top,table.left+index,header,{style:5}));
        const data=state[table.key];
        for(let i=0;i<Math.max(1,data.length);i++) {
          const r=table.top+1+i,item=data[i];
          if(table.name==='WorkLog') {
            const values=workValues(item),cache=workCache(state,item),formulas={...C.formulas(r),...(item?.type==='Current'?currentRuleFormulas:{})};
            if(item?.type==='Current')for(const [i,key] of ['minHours','ahStart','ahEnd','mult','tolerance','allocation'].entries())cache[column(15+i)]=state.config[key];
            values.forEach((value,index)=>{
              const col=column(index+1),formula=formulas[col] ?? null;
              add(r,index+1,formula?cache[col]:value,{formula,style:index===0?1:index===1 || index===2?2:index===7?4:[3,4,5,6,11,20,21,22,23,24].includes(index)?3:0});
            });
          } else table.headers.forEach((key,index)=>add(r,table.left+index,item?.[key] ?? null));
        }
        zip.file('xl/tables/table'+table.index+'.xml',tableXml(table));
      }
      const logTable=local.find(table=>table.name==='WorkLog');
      const views=logTable?`<sheetViews><sheetView workbookViewId="0"><pane ySplit="${logTable.top}" topLeftCell="A${logTable.top+1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`:'';
      const cols=logTable?'<cols><col min="1" max="1" width="13" customWidth="1"/><col min="2" max="3" width="12" customWidth="1"/><col min="4" max="7" width="20" customWidth="1"/><col min="8" max="8" width="45" customWidth="1"/><col min="9" max="29" hidden="1" width="16" customWidth="1"/></cols>':'<cols><col min="1" max="40" width="22" customWidth="1"/></cols>';
      const format=logTable?`<conditionalFormatting sqref="A${logTable.top+1}:H${logTable.bottom}"><cfRule type="expression" dxfId="0" priority="1"><formula>$N${logTable.top+1}="Historical"</formula></cfRule></conditionalFormatting>`:'';
      const parts=`<tableParts count="${local.length}">${local.map(table=>`<tablePart r:id="Table${table.index}"/>`).join('')}</tableParts>`;
      zip.file(path,doc('worksheet',views+cols+'<sheetData>'+[...rows].sort((a,b)=>a[0]-b[0]).map(([r,cells])=>rowXml(r,[...cells].sort((a,b)=>a[0]-b[0]).map(([,value])=>value))).join('')+'</sheetData>'+format+parts,`xmlns:r="${REL}"`));
      zip.file(relationshipsPath(path),declaration+`<Relationships xmlns="${PKG}">${local.map(table=>`<Relationship Id="Table${table.index}" Type="${REL}/table" Target="../tables/table${table.index}.xml"/>`).join('')}</Relationships>`);
    }
    zip.file('xl/styles.xml',styles().replace('0.00&amp;quot;*&amp;quot;','0.00&quot;*&quot;'));
    zip.file('xl/workbook.xml',doc('workbook','<bookViews><workbookView/></bookViews><sheets>'+SHEETS.map((name,i)=>`<sheet name="${name}" sheetId="${i+1}" r:id="Sheet${i+1}"/>`).join('')+'</sheets><calcPr calcId="191029" fullCalcOnLoad="1" forceFullCalc="1" calcMode="auto"/>',`xmlns:r="${REL}"`));
    zip.file('xl/_rels/workbook.xml.rels',declaration+`<Relationships xmlns="${PKG}">${SHEETS.map((name,i)=>`<Relationship Id="Sheet${i+1}" Type="${REL}/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="Styles" Type="${REL}/styles" Target="styles.xml"/></Relationships>`);
    zip.file('_rels/.rels',declaration+`<Relationships xmlns="${PKG}"><Relationship Id="Workbook" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
    zip.file('[Content_Types].xml',declaration+`<Types xmlns="${TYPES}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${SHEETS.map((name,i)=>`<Override PartName="/${paths[name]}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}${tables.map(table=>`<Override PartName="/xl/tables/table${table.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`).join('')}</Types>`);
    // The same XML budget applies on both sides of the file boundary.
    for(const file of zip.file(/\.(?:xml|rels)$/))budget(zip,file.name,(await file.async('string')).length);
    const bytes=await zip.generateAsync({type:'uint8array',compression:'DEFLATE',compressionOptions:{level:5}});
    if(bytes.byteLength>FILE_LIMIT)throw Error('XLSX 超过 32MiB，全部内存修改仍保留');
    const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    exports.set(blob,M.clone(state.metadata));return blob;
  }
  function relationshipsPath(path) {const parts=path.split('/');return parts.slice(0,-1).join('/')+'/_rels/'+parts.at(-1)+'.rels'}
  function part(source,target) {
    if(!target || /[\\:?#]/.test(target))throw Error('relationship 目标无效');
    const out=[];
    for(const value of (target.startsWith('/')?target.slice(1):source.slice(0,source.lastIndexOf('/')+1)+target).split('/')) {
      if(value==='..'){if(!out.length)throw Error('relationship 路径越界');out.pop()}else if(value && value!=='.')out.push(value);
    }
    const result=out.join('/');if(!result.startsWith('xl/') || !result.endsWith('.xml'))throw Error('relationship 路径无效');return result;
  }
  function rectangle(ref) {
    const match=/^([A-Z]+)([1-9]\d*):([A-Z]+)([1-9]\d*)$/.exec(ref || '');
    if(!match)throw Error('无效 Table 范围');
    const [left,top,right,bottom]=[colNumber(match[1]),+match[2],colNumber(match[3]),+match[4]];
    if(left>right || top>=bottom || right>16384 || bottom>EXCEL_ROWS)throw Error('Table 范围越界');return {left,top,right,bottom};
  }
  const inside=(ref,range)=>{const [,c,r]=/^([A-Z]+)(\d+)$/.exec(ref);return colNumber(c)>=range.left && colNumber(c)<=range.right && +r>=range.top && +r<=range.bottom};
  const numericFields=new Set(['lunch','rate','extra','app','amountCents','sequence','oldApp','newApp','estimatedCents','differenceCents']);
  const nullableFields=new Set(['recordId','invoice','start','end','amountCents','oldApp','newApp','differenceCents']);
  function scalar(sheet,ref,strings,key) {
    const raw=rawValue(sheet,ref,strings);
    if(raw==='' && nullableFields.has(key))return null;
    if(key==='followUp') {
      if(sheet.cells.get(ref)?.getAttribute('t')!=='b' || !['0','1'].includes(raw))throw Error(ref+': 需要布尔值');return raw==='1';
    }
    if(numericFields.has(key))return Number(numeric(sheet,ref,strings));
    return text(sheet,ref,strings);
  }
  function readWorkRow(sheet,r,strings,reader) {
    const str=col=>text(sheet,col+r,strings),num=(col,optional=false)=>{const raw=numeric(sheet,col+r,strings,optional);return raw===''?null:Number(raw)};
    const row={id:str('M'),type:str('N'),periodId:str('Z'),date:C.fromSerial(num('A')),invoice:nullableText(str('I')),start:readTime(num('B')),end:readTime(num('C')),lunch:num('J',true),rate:num('E'),extra:num('K',true),app:num('G',true),note:str('H'),createdAt:str('AA'),updatedAt:str('AB'),reminderKinds:str('AC')?str('AC').split(','):[],ruleSnapshot:null};
    if(row.type==='Historical')row.ruleSnapshot={minHours:num('O'),ahStart:num('P'),ahEnd:num('Q'),mult:num('R'),tolerance:num('S'),allocation:str('T')};
    else for(const [col,formula] of Object.entries(currentRuleFormulas))checkFormula(reader,sheet,col+r,formula);
    for(const [col,formula] of Object.entries(C.formulas(r)))checkFormula(reader,sheet,col+r,formula);
    return row;
  }
  const nullableText=value=>value===''?null:value;
  function readTime(value) {
    const minute=value*1440;
    if(minute<0 || minute>=1440 || Math.abs(minute-Math.round(minute))>1e-6)throw Error('时间必须为 00:00–23:59 整分钟');return C.timeText(Math.round(minute)/60);
  }
  async function read(input) {
    const size=input?.size ?? input?.byteLength;
    if(!Number.isFinite(size) || size>FILE_LIMIT)throw Error('XLSX 输入必须不超过 32MiB');
    const bytes=input instanceof Blob?await input.arrayBuffer():input;
    const zip=await JSZip.loadAsync(bytes);
    for(const path of ['[Content_Types].xml','_rels/.rels','xl/styles.xml'])if(!zip.file(path))throw Error('XLSX 容器损坏，缺少 '+path);
    if(zip.file(/^xl\/(?:externalLinks|embeddings|vbaProject)|^customXml\//).length)throw Error('工作簿包含不支持的数据或外部链接');
    const {paths,book}=await locate(zip),shared=zip.file('xl/sharedStrings.xml')?await xml(zip,'xl/sharedStrings.xml'):null;
    for(const name of book.getElementsByTagNameNS(NS,'definedName'))if(!['_xlnm.Print_Area','_xlnm.Print_Titles','_xlnm._FilterDatabase'].includes(name.getAttribute('name')))throw Error('存在额外命名数据区域，拒绝静默丢弃');
    const strings=shared?[...shared.getElementsByTagNameNS(NS,'si')].map(stringText):[];
    const sheets={},found={},parts=new Set(),ids=new Set(),allowed={};
    for(const name of SHEETS) {
      const sheet=sheets[name]=indexSheet(await xml(zip,paths[name]),name),tableParts=first(sheet.doc.documentElement,'tableParts');
      const nodes=children(tableParts,'tablePart');
      if(!tableParts || +tableParts.getAttribute('count')!==nodes.length)throw Error(name+': Table 数量不符');
      const rels=await xml(zip,relationshipsPath(paths[name])),byId=new Map();allowed[name]=new Set();
      for(const rel of rels.documentElement.children){const id=rel.getAttribute('Id');if(byId.has(id))throw Error('重复 relationship');byId.set(id,rel)}
      for(const node of nodes) {
        const rel=byId.get(node.getAttributeNS(REL,'id'));
        if(!rel || rel.getAttribute('TargetMode')==='External' || !rel.getAttribute('Type')?.endsWith('/table'))throw Error('无效 Table relationship');
        const path=part(paths[name],rel.getAttribute('Target'));if(parts.has(path))throw Error('重复 Table part');parts.add(path);
        const doc=await xml(zip,path),table=doc.documentElement,key=table.getAttribute('displayName')?.replace(/^RS_/,'');
        const spec=TABLES[key],headers=spec?.headers || M.TABLE_FIELDS[spec?.key];
        if(!spec || spec.sheet!==name || table.localName!=='table' || table.namespaceURI!==NS || table.getAttribute('name')!=='RS_'+key || found[key] || !/^[1-9]\d*$/.test(table.getAttribute('id') || '') || ids.has(table.getAttribute('id')))throw Error('不支持、重复或放错位置的 Table');
        ids.add(table.getAttribute('id'));
        if(table.getAttribute('totalsRowCount') && table.getAttribute('totalsRowCount')!=='0')throw Error('不支持自定义汇总行');
        const range=rectangle(table.getAttribute('ref')),columns=children(first(table,'tableColumns'),'tableColumn');
        if(range.left!==spec.left || range.right-range.left+1!==headers.length || columns.length!==headers.length || +first(table,'tableColumns')?.getAttribute('count')!==headers.length || spec.top && range.top!==spec.top)throw Error('Table 列数或位置不符');
        for(const previous of Object.values(found).filter(value=>value.sheet===sheet))if(range.left<=previous.range.right && range.right>=previous.range.left && range.top<=previous.range.bottom && range.bottom>=previous.range.top)throw Error('Table 范围重叠');
        for(const [i,header] of headers.entries()) {
          const ref=column(range.left+i)+range.top;
          if(columns[i].getAttribute('name')!==header || columns[i].getAttribute('id')!==String(i+1) || text(sheet,ref,strings)!==header)throw Error('Table 表头不符 '+ref);
          const formula=first(columns[i],'calculatedColumnFormula');
          const expected=key==='WorkLog'?C.formulas(range.top+1)[column(range.left+i)]:null;
          if(formula && (!expected || normalizeFormula(formula.textContent)!==normalizeFormula(expected)))throw Error('Table 计算列公式不符');
          allowed[name].add(ref);
        }
        const reader=formulaReader(sheet),rows=[];
        // Visit actual rows only; a hostile oversized Table ref must not cause a million-row scan.
        const rowNumbers=[...sheet.rows.keys()].filter(r=>r>range.top && r<=range.bottom).sort((a,b)=>a-b);
        for(const r of rowNumbers) {
          const occupied=headers.some((header,i)=>{const ref=column(range.left+i)+r;return key==='WorkLog' && C.FORMULA_COLUMNS.includes(column(range.left+i))?false:value(sheet,ref,strings)!=='' || first(sheet.cells.get(ref),'f')});
          for(let i=range.left;i<=range.right;i++)allowed[name].add(column(i)+r);
          if(!occupied) {
            if(key==='WorkLog')for(const [col,formula] of Object.entries(C.formulas(r)))checkFormula(reader,sheet,col+r,formula);
            continue;
          }
          rows.push(key==='WorkLog'?readWorkRow(sheet,r,strings,reader):Object.fromEntries(headers.map((header,i)=>[header,scalar(sheet,column(range.left+i)+r,strings,header)])));
        }
        found[key]={sheet,range,rows};
      }
    }
    if(Object.keys(found).length!==8 || Object.keys(TABLES).some(key=>!found[key]))throw Error('文件必须包含四张 Sheet 和八个指定 Table');
    for(const file of zip.file(/^xl\/tables\/.*\.xml$/))if(!parts.has(file.name))throw Error('存在未关联数据表');
    for(const file of zip.file(/^xl\/worksheets\/[^/]+\.xml$/))if(!Object.values(paths).includes(file.name))throw Error('存在未关联工作表');
    const cfg=sheets.Config,state={metadata:{},config:{},...Object.fromEntries(Object.values(TABLES).map(spec=>[spec.key,found[Object.keys(TABLES).find(key=>TABLES[key]===spec)].rows]))};
    for(const [key,ref] of Object.entries(configCells)) {
      state.config[key]=key==='allocation'?text(cfg,ref,strings):key==='defaultRate' && rawValue(cfg,ref,strings)===''?null:Number(numeric(cfg,ref,strings));
      allowed.Config.add('A'+ref.slice(1));allowed.Config.add(ref);
      if(text(cfg,'A'+ref.slice(1),strings)!==key)throw Error('Config 标签不符');
    }
    for(const [key,ref] of Object.entries(metadataCells)) {
      const val=text(cfg,ref,strings);state.metadata[key]=['schemaVersion','calculationVersion','fileName','integrityAlgorithm'].includes(key)?val:nullableText(val);
      allowed.Config.add('A'+ref.slice(1));allowed.Config.add(ref);
      if(text(cfg,'A'+ref.slice(1),strings)!==key)throw Error('metadata 标签不符');
    }
    if(state.metadata.schemaVersion!==M.SCHEMA || state.metadata.calculationVersion!==C.VERSION)throw Error('仅支持 schema 5.0 / calculation 3.0；旧 2.0–4.1 文件不提供迁移');
    if(state.metadata.integrityAlgorithm!=='SHA-256' || !/^[a-f0-9]{64}$/.test(state.metadata.integrityDigest || ''))throw Error('完整性算法或摘要无效');
    const isTemplate=state.metadata.fileId===null && state.metadata.currentPeriodId===null && state.metadata.fileVersionId===null;
    if(isTemplate) {
      if(Object.values(TABLES).some(spec=>state[spec.key].length) || state.metadata.previousFileVersionId!==null || state.metadata.sourceFileId!==null || state.metadata.sourceFileVersionId!==null)throw Error('空白模板包含业务身份或数据');
      C.validateConfig(state.config);
    }else M.validate(state);
    if(state.metadata.integrityDigest!==await digest(state))throw Error('受控数据完整性摘要不符；请使用 Tool 编辑业务资料');
    const log=sheets['Work Log'],groups=summaries(state),logTable=found.WorkLog;
    if(logTable.range.top!==groups.length+5)throw Error('Work Log 表头位置不符');
    const reader=formulaReader(log);
    ['Period','Estimated','App','Difference'].forEach((header,i)=>{const ref=column(i+1)+'2';if(text(log,ref,strings)!==header)throw Error('Summary 表头不符');allowed['Work Log'].add(ref)});
    groups.forEach((group,i)=>{
      const r=i+3;if(text(log,'A'+r,strings)!==group.label)throw Error('Summary 分组不符');allowed['Work Log'].add('A'+r);
      for(const [col,formula] of Object.entries(summaryFormulas(group))){checkFormula(reader,log,col+r,formula);allowed['Work Log'].add(col+r)}
    });
    allowed['Work Log'].add('A'+(groups.length+3));
    for(const name of SHEETS) {
      allowed[name].add('A1');
      for(const [ref,node] of sheets[name].cells)if(!allowed[name].has(ref) && (value(sheets[name],ref,strings)!=='' || first(node,'f')))throw Error(name+'!'+ref+': 额外数据区域，拒绝静默丢弃');
    }
    // Count all package XML, including Excel-generated optional parts, once.
    for(const file of zip.file(/\.(?:xml|rels)$/))if(!budgets.get(zip)?.parts.has(file.name))await xml(zip,file.name);
    const supported=new Set(['[Content_Types].xml','_rels/.rels','xl/workbook.xml','xl/_rels/workbook.xml.rels','xl/styles.xml','xl/sharedStrings.xml','xl/calcChain.xml','docProps/app.xml','docProps/core.xml',...Object.values(paths),...Object.values(paths).map(relationshipsPath),...parts]);
    for(const file of Object.values(zip.files))if(!file.dir && !supported.has(file.name) && !/^xl\/theme\/theme[1-9]\d*\.xml$/.test(file.name))throw Error(file.name+': 额外数据部件，拒绝静默丢弃');
    const rootRels=await xml(zip,'_rels/.rels'),types=await xml(zip,'[Content_Types].xml'),styleDoc=await xml(zip,'xl/styles.xml');
    if(styleDoc.documentElement.localName!=='styleSheet' || styleDoc.documentElement.namespaceURI!==NS)throw Error('XLSX 样式部件损坏');
    const office=[...rootRels.documentElement.children].filter(node=>node.getAttribute('Type')===REL+'/officeDocument');
    if(rootRels.documentElement.localName!=='Relationships' || rootRels.documentElement.namespaceURI!==PKG || office.length!==1 || office[0].getAttribute('TargetMode')==='External' || office[0].getAttribute('Target')?.replace(/^\//,'')!=='xl/workbook.xml' || types.documentElement.localName!=='Types' || types.documentElement.namespaceURI!==TYPES)throw Error('XLSX 容器关系或内容类型损坏');
    const overrides=new Map();
    for(const node of types.documentElement.children)if(node.localName==='Override'){const path=node.getAttribute('PartName');if(overrides.has(path))throw Error('重复的 XLSX 内容类型');overrides.set(path,node.getAttribute('ContentType'))}
    const expectedTypes={'xl/workbook.xml':'sheet.main','xl/styles.xml':'styles',...Object.fromEntries(Object.values(paths).map(path=>[path,'worksheet'])),...Object.fromEntries([...parts].map(path=>[path,'table']))};
    for(const [path,type] of Object.entries(expectedTypes))if(overrides.get('/'+path)!=='application/vnd.openxmlformats-officedocument.spreadsheetml.'+type+'+xml')throw Error(path+': XLSX 内容类型不符');
    // Verify CRC only after the XML and package budgets pass, avoiding unbounded
    // eager inflation of arbitrary ZIP entries before the capacity checks.
    await JSZip.loadAsync(bytes,{checkCRC32:true});
    return isTemplate?M.create({config:state.config}):state;
  }
  root.TrackerWorkbook=Object.freeze({SHEETS,TABLES,WORK_HEADERS,FILE_LIMIT,XML_LIMIT,TOTAL_XML_LIMIT,EXCEL_ROWS,read,write,hashBytes,exportInfo:blob=>M.clone(exports.get(blob)),groupTotals,summaries,summaryFormulas,tableLayout});
})(globalThis);
