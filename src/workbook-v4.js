(function (root) {
  'use strict';
  const C=root.TrackerCore,R=root.TrackerReconciliation,I=root.TrackerWorkbookXml;
  const NS=I.NS,REL=I.REL,PKG='http://schemas.openxmlformats.org/package/2006/relationships',TYPES='http://schemas.openxmlformats.org/package/2006/content-types';
  const SHEETS=Object.freeze(['Tool','Work Log','Config','Reconciliation','Entries','History']);
  const metadataFields={id:'key',schemaVersion:'text',calculationVersion:'text',cycleId:'ref?',fileId:'ref?',fileVersionId:'ref?',parentFileVersionId:'ref?',sourceName:'text',isTemplate:'boolean'};
  const integrityFields={id:'key',algorithm:'text',digest:'text'};
  const pendingReview=new WeakSet();
  const exports=new WeakMap();
  const SPECS=Object.freeze({Workbook:{sheet:'Tool',fields:metadataFields},...R.TABLES,Audit:{sheet:'History',fields:R.auditFields},Changes:{sheet:'History',fields:R.changeFields},Integrity:{sheet:'Tool',fields:integrityFields}});
  const fail=message=>{throw Error(message)};
  const column=value=>{let out='';while(value>0){out=String.fromCharCode(65+(value-1)%26)+out;value=Math.floor((value-1)/26)}return out};
  const colNumber=text=>[...text].reduce((value,char)=>value*26+char.charCodeAt(0)-64,0);
  function rectangle(ref) {
    const match=/^([A-Z]+)([1-9]\d*):([A-Z]+)([1-9]\d*)$/.exec(ref || '');
    if(!match)fail('Excel Table: 无效范围 '+ref);
    const result={left:colNumber(match[1]),top:Number(match[2]),right:colNumber(match[3]),bottom:Number(match[4])};
    if(result.right<result.left || result.bottom<=result.top || result.right>16384 || result.bottom>1048576)fail('Excel Table: 范围越界 '+ref);
    return result;
  }
  function part(source,target) {
    if(!target || /[\\:?#]/.test(target))fail('Table relationship: 无效目标');
    const pieces=(target.startsWith('/')?target.slice(1):source.split('/').slice(0,-1).join('/')+'/'+target).split('/'),out=[];
    for(const piece of pieces){if(piece==='..'){if(!out.length)fail('Table relationship: 路径越界');out.pop()}else if(piece && piece!=='.')out.push(piece)}
    const path=out.join('/');if(!path.startsWith('xl/') || !path.endsWith('.xml'))fail('Table relationship: 路径无效');return path;
  }
  const relationshipsPath=path=>path.split('/').slice(0,-1).join('/')+'/_rels/'+path.split('/').at(-1)+'.rels';
  const sorted=rows=>[...rows].sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const payload=data=>Object.fromEntries(Object.entries(data).filter(([key])=>key!=='Integrity').map(([key,rows])=>[key,sorted(rows)]));
  async function digest(value) {
    const bytes=new TextEncoder().encode(R.canonical(value));
    return hashBytes(bytes);
  }
  async function hashBytes(bytes){const hash=await root.crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(n=>n.toString(16).padStart(2,'0')).join('')}
  function scalar(sheet,ref,strings,type) {
    const raw=I.rawValue(sheet,ref,strings),optional=type.endsWith('?');
    if(raw==='' && optional)return '';
    const base=type.replace(/\?$/,'');
    if(base==='boolean') {
      if(sheet.cells.get(ref)?.getAttribute('t')!=='b' || !['0','1'].includes(raw))fail(sheet.name+'!'+ref+': 需要布尔值');
      return raw==='1';
    }
    if(base==='decimal' || base==='integer' || base.startsWith('cents'))return Number(I.numeric(sheet,ref,strings));
    return I.text(sheet,ref,strings);
  }
  function put(sheet,ref,value,type) {
    I.set(sheet,ref,value);
    if(type==='boolean') {
      const cell=I.getCell(sheet,ref);cell.replaceChildren();cell.setAttribute('t','b');
      const v=sheet.doc.createElementNS(NS,'v');v.textContent=value?'1':'0';cell.appendChild(v);
    }
  }
  async function tables(zip,paths,strings) {
    const found={},ids=new Set(),parts=new Set(),regions=Object.fromEntries(SHEETS.map(name=>[name,[]]));
    const sheets={};
    for(const name of SHEETS) {
      const sheet=sheets[name]=I.indexSheet(await I.xml(zip,paths[name]),name),tableParts=I.first(sheet.doc.documentElement,'tableParts');
      if(!tableParts)fail(name+': 缺少结构化 Excel Tables');
      const nodes=I.children(tableParts,'tablePart');
      if(Number(tableParts.getAttribute('count'))!==nodes.length)fail(name+': Table 数量不一致');
      const rels=await I.xml(zip,relationshipsPath(paths[name])),byId=new Map();
      for(const rel of rels.documentElement.children){const id=rel.getAttribute('Id');if(byId.has(id))fail(name+': 重复 relationship ID');byId.set(id,rel)}
      for(const node of nodes) {
        const rel=byId.get(node.getAttributeNS(REL,'id'));
        if(!rel || !rel.getAttribute('Type')?.endsWith('/table') || rel.getAttribute('TargetMode')==='External')fail(name+': Table relationship 无效');
        const path=part(paths[name],rel.getAttribute('Target'));
        if(parts.has(path))fail(name+': 重复 Table part');parts.add(path);
        const doc=await I.xml(zip,path),table=doc.documentElement,key=(table.getAttribute('displayName') || '').replace(/^RS_/,'');
        if(table.localName!=='table' || !table.getAttribute('displayName')?.startsWith('RS_') || table.getAttribute('name')!==table.getAttribute('displayName') || found[key] || !/^[1-9]\d*$/.test(table.getAttribute('id') || '') || ids.has(table.getAttribute('id')))fail(name+': Table 名称或 ID 无效');
        ids.add(table.getAttribute('id'));
        const spec=key==='WorkLog'?{sheet:'Work Log',fields:Object.fromEntries([...C.HEADERS,'Record ID','Site'].map(header=>[header,'text']))}:SPECS[key];
        if(!spec || spec.sheet!==name)fail(name+': 未支持或放错位置的 Table '+key);
        if(table.getAttribute('totalsRowCount') && table.getAttribute('totalsRowCount')!=='0')fail(name+': 不支持自定义 Table 汇总行');
        const range=rectangle(table.getAttribute('ref')),columns=I.children(I.first(table,'tableColumns'),'tableColumn'),fields=Object.entries(spec.fields);
        if(range.right-range.left+1!==fields.length || columns.length!==fields.length || Number(I.first(table,'tableColumns')?.getAttribute('count'))!==fields.length)fail(name+' / '+key+': Table 列数量不符');
        fields.forEach(([field],i)=>{if(columns[i].getAttribute('id')!==String(i+1) || columns[i].getAttribute('name')!==field || I.text(sheet,column(range.left+i)+range.top,strings)!==field)fail(name+'!'+column(range.left+i)+range.top+' / RS_'+key+': 表头不符 '+field)});
        for(const previous of regions[name])if(range.left<=previous.right && range.right>=previous.left && range.top<=previous.bottom && range.bottom>=previous.top)fail(name+': Table 范围重叠');
        regions[name].push(range);
        const rows=[];
        if(key==='WorkLog') {
          if(range.left!==1 || range.top!==5 || range.right!==22 || range.bottom>305)fail('Work Log: Table 范围必须覆盖 A5:V，最多 300 条');
          for(const [ref,cell] of sheet.cells){const match=/^([A-Z]+)(\d+)$/.exec(ref);if(+match[2]>range.bottom && [...C.RAW_COLUMNS,'U','V'].includes(match[1]) && (I.value(sheet,ref,strings)!=='' || I.first(cell,'f')))fail('Work Log!'+ref+': 工作数据超出 Table 范围')}
        } else {
          for(const row of [...sheet.rows.keys()].filter(row=>row>range.top && row<=range.bottom).sort((a,b)=>a-b)) {
            if(!fields.some((field,i)=>{const ref=column(range.left+i)+row;return I.value(sheet,ref,strings)!=='' || I.first(sheet.cells.get(ref),'f')}))continue;
            const data={};for(const [i,[field,type]] of fields.entries())data[field]=scalar(sheet,column(range.left+i)+row,strings,type);
            rows.push(data);
          }
        }
        found[key]={rows,range,sheet:name};
      }
      if(['Entries','Reconciliation','History'].includes(name)) {
        for(const [ref,cell] of sheet.cells) {
          if(I.value(sheet,ref,strings)==='' && !I.first(cell,'f'))continue;
          const [,c,r]=/^([A-Z]+)(\d+)$/.exec(ref),x=colNumber(c),y=Number(r);
          if(ref==='A1' || regions[name].some(rect=>x>=rect.left && x<=rect.right && y>=rect.top && y<=rect.bottom || x===1 && y===rect.top-1))continue;
          fail(name+'!'+ref+': 受控数据表范围外存在内容，拒绝静默丢弃');
        }
      }
    }
    for(const key of [...Object.keys(SPECS),'WorkLog'])if(!found[key])fail('工作簿缺少 Table RS_'+key);
    for(const file of zip.file(/^xl\/tables\/.*\.xml$/))if(!parts.has(file.name))fail(file.name+': 存在未关联的数据表，拒绝静默丢弃');
    return {data:Object.fromEntries(Object.entries(found).filter(([key])=>key!=='WorkLog').map(([key,item])=>[key,item.rows])),sheets};
  }
  function fromRows(metadata,data) {
    if(!metadata.fileVersionId)fail('Tool / RS_Workbook: 已保存工作簿缺少文件版本 ID');
    const bundle=Object.fromEntries(['schemaVersion','calculationVersion','cycleId','fileId','fileVersionId','parentFileVersionId','sourceName'].map(key=>[key,metadata[key]]));
    bundle.tables=Object.fromEntries(Object.keys(R.TABLES).map(key=>[key,data[key]]));bundle.audit=data.Audit;bundle.changes=data.Changes;
    return R.validate(bundle);
  }
  const sameRaw=(a,b)=>R.canonical(Object.fromEntries(['date','invoice','start','end','lunch','rate','app','extra','note','site'].map(field=>[field,C.blank(a[field])?'':['lunch','rate','app','extra'].includes(field)?Number(a[field]):a[field]])))===R.canonical(Object.fromEntries(['date','invoice','start','end','lunch','rate','app','extra','note','site'].map(field=>[field,C.blank(b[field])?'':['lunch','rate','app','extra'].includes(field)?Number(b[field]):b[field]])));
  function externalChanges(bundle,records,newConfig) {
    const original=new Map(R.currentRecords(bundle).map(record=>[record.id,record])),seen=new Set(),changes=[];
    for(const raw of records) {
      if(raw.kind!=='Job')fail('Work Log: schema 4.0 历史余额须由 Tool 对账区维护');
      if(raw.id && (!original.has(raw.id) || seen.has(raw.id)))fail('Work Log!U'+raw.sourceRow+': Record ID 重复、被修改或不属于本期工作 '+raw.id);
      if(raw.id){seen.add(raw.id);if(!sameRaw(raw,original.get(raw.id)))changes.push({kind:'Work',id:raw.id,invoice:raw.invoice,before:R.rawRecord(original.get(raw.id)),after:raw})}
      else changes.push({kind:'NewWork',id:'',invoice:raw.invoice,before:null,after:raw});
    }
    for(const id of original.keys())if(!seen.has(id))fail('Work Log'+(records.find(raw=>!raw.id)?'!U'+records.find(raw=>!raw.id).sourceRow:'')+': 旧 Record ID 丢失或工作行被移除；请在 Tool 中处理，不能当作新增覆盖 '+id);
    if(C.configSnapshot(R.config(bundle))!==C.configSnapshot(newConfig))changes.push({kind:'Rules',id:'current',before:R.config(bundle),after:newConfig});
    return changes;
  }
  async function read(input) {
    const zip=await JSZip.loadAsync(input);
    if(zip.file(/^xl\/externalLinks\//).length)fail('工作簿不支持外部公式链接');
    const {paths}=await I.locate(zip,SHEETS),shared=zip.file('xl/sharedStrings.xml')?await I.xml(zip,'xl/sharedStrings.xml'):null;
    const strings=shared?[...shared.getElementsByTagNameNS(NS,'si')].map(I.stringText):[];
    const {data,sheets}=await tables(zip,paths,strings);
    if(data.Workbook.length!==1 || data.Integrity.length!==1)fail('Tool: 元数据或完整性记录数量无效');
    const metadata=data.Workbook[0],integrity=data.Integrity[0];
    if(metadata.id!=='document' || metadata.schemaVersion!=='4.0' || metadata.calculationVersion!=='3.0' || integrity.id!=='data' || integrity.algorithm!=='SHA-256' || integrity.digest!==await digest(payload(data)))fail('Tool / RS_Integrity: 数据摘要不一致，对账数据或历史可能被直接修改');
    const settings=I.readConfig(sheets.Config,strings,['4.0']);
    I.checkTool(sheets.Tool,{carryover:false});
    const records=I.readLog(sheets['Work Log'],{version:'3.0',config:settings.config},strings,{extras:{U:'Record ID',V:'Site'},withRowNumbers:true});
    if(metadata.isTemplate) {
      if(records.length || Object.keys(R.TABLES).some(key=>data[key].length) || data.Audit.length || data.Changes.length || metadata.cycleId || metadata.fileId || metadata.fileVersionId || metadata.parentFileVersionId || metadata.sourceName)fail('空白模板含有业务数据或身份，拒绝读取');
      return {bundle:R.create({rules:settings.config}),changes:[],isTemplate:true};
    }
    const bundle=fromRows(metadata,data);
    if(C.configSnapshot(settings.baseline)!==C.configSnapshot(R.config(bundle)))fail('Config!B17: 规则基线与受控记录不一致');
    const changes=externalChanges(bundle,records,settings.config);
    if(changes.length)pendingReview.add(bundle);
    const currentOpening=R.confirmedCarryTotal(bundle)/100;
    if(Number(I.numeric(sheets.Tool,'B10',strings))!==currentOpening)fail('Tool!B10: 历史期初余额快照不一致');
    return {bundle,changes,isTemplate:false};
  }
  function newSheet(name) {
    const doc=I.parse(`<worksheet xmlns="${NS}" xmlns:r="${REL}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="40" width="24" customWidth="1"/></cols><sheetData/></worksheet>`,name);
    const sheet=I.indexSheet(doc,name);I.set(sheet,'A1','Tool 管理的可审查数据表；金额 cents 列为 NZD 分；空白=未知。请勿直接编辑。');return sheet;
  }
  function removeFromRow(sheet,start) {
    for(const [row,node] of sheet.rows)if(row>=start){node.remove();sheet.rows.delete(row)}
    for(const ref of sheet.cells.keys())if(Number(ref.match(/\d+$/)[0])>=start)sheet.cells.delete(ref);
  }
  async function write(bundle,{fileName=bundle?.sourceName || '',template=false}={}) {
    if(pendingReview.has(bundle))fail('请先确认 Excel 原始字段/规则变更，不能另存旧快照而丢弃导入内容');
    R.validate(bundle);
    const exported=R.clone(bundle);
    if(!template){exported.parentFileVersionId=exported.fileVersionId || exported.parentFileVersionId;exported.fileVersionId=R.uuid();exported.sourceName=fileName}
    const base=typeof TEMPLATE_V4_BASE64==='string'?TEMPLATE_V4_BASE64:TEMPLATE_BASE64;
    const zip=await JSZip.loadAsync(base,{base64:true});
    const book=await I.xml(zip,'xl/workbook.xml'),rels=await I.xml(zip,'xl/_rels/workbook.xml.rels'),types=await I.xml(zip,'[Content_Types].xml');
    const count=book.getElementsByTagNameNS(NS,'sheet').length,{paths}=await I.locate(zip,count===3?SHEETS.slice(0,3):SHEETS);
    if(count===3) {
      for(const [index,name] of SHEETS.slice(3).entries()) {
        const number=index+4,id='rIdRSheet'+number;
        const sheet=book.createElementNS(NS,'sheet');sheet.setAttribute('name',name);sheet.setAttribute('sheetId',number);sheet.setAttributeNS(REL,'r:id',id);book.getElementsByTagNameNS(NS,'sheets')[0].appendChild(sheet);
        const rel=rels.createElementNS(PKG,'Relationship');rel.setAttribute('Id',id);rel.setAttribute('Type',REL+'/worksheet');rel.setAttribute('Target','worksheets/sheet'+number+'.xml');rels.documentElement.appendChild(rel);
        paths[name]='xl/worksheets/sheet'+number+'.xml';
        const override=types.createElementNS(TYPES,'Override');override.setAttribute('PartName','/'+paths[name]);override.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml');types.documentElement.appendChild(override);
      }
    }
    await I.populate(zip,book,paths,R.currentRecords(exported).map(R.rawRecord),R.config(exported));
    const sheets={};for(const name of SHEETS)sheets[name]=['Entries','Reconciliation','History'].includes(name)?newSheet(name):I.indexSheet(await I.xml(zip,paths[name]),name);
    removeFromRow(sheets.Tool,25);removeFromRow(sheets.Config,20);
    for(const row of [...types.documentElement.children])if((row.getAttribute('PartName') || '').startsWith('/xl/tables/'))row.remove();
    for(const file of zip.file(/^xl\/tables\//))zip.remove(file.name);
    for(const name of SHEETS)for(const element of [...sheets[name].doc.documentElement.children])if(['tableParts','extLst'].includes(element.localName))element.remove();
    const cfg=sheets.Config,log=sheets['Work Log'],tool=sheets.Tool;
    I.set(cfg,'B10','4.0');I.set(cfg,'A1','CONFIG / Rules and Entry Settings v4.0');
    I.set(tool,'A1','ROUTERSTACK / WORK TOOL V4');I.set(tool,'A4','离线打开 index.html；对账由 Tool 操作，后续 Sheets 为透明数据表，原文件另存归档。');
    I.set(tool,'A10','确认历史剩余（Tool 保存快照）');
    I.set(tool,'B10',R.confirmedCarryTotal(exported)/100);
    I.set(log,'U5','Record ID');I.set(log,'V5','Site');
    for(let row=6;row<=305;row++){I.set(log,'U'+row,'');I.set(log,'V'+row,'')}
    R.currentRecords(exported).forEach((record,index)=>{I.set(log,'U'+(index+6),record.id);I.set(log,'V'+(index+6),record.site)});
    const cols=I.first(log.doc.documentElement,'cols');
    for(const col of I.children(cols,'col'))if(Number(col.getAttribute('min'))>=21)col.remove();
    for(const [min,max,width] of [[21,21,40],[22,22,24]]){const col=log.doc.createElementNS(NS,'col');for(const [key,value] of Object.entries({min,max,width,hidden:1,customWidth:1}))col.setAttribute(key,value);cols.appendChild(col)}
    const meta={id:'document',...Object.fromEntries(['schemaVersion','calculationVersion','cycleId','fileId','fileVersionId','parentFileVersionId','sourceName'].map(key=>[key,template && !['schemaVersion','calculationVersion'].includes(key)?'':exported[key]])),isTemplate:template};
    const data={Workbook:[meta],...Object.fromEntries(Object.keys(R.TABLES).map(key=>[key,template?[]:exported.tables[key]])),Audit:template?[]:exported.audit,Changes:template?[]:exported.changes};
    data.Integrity=[{id:'data',algorithm:'SHA-256',digest:await digest(payload(data))}];
    const cursors={Tool:25,Config:20,Entries:3,Reconciliation:3,History:3},sheetRels={},tableNodes={};let tableId=0;
    for(const name of SHEETS) {
      const path=relationshipsPath(paths[name]),doc=zip.file(path)?await I.xml(zip,path):I.parse(`<Relationships xmlns="${PKG}"/>`,path);
      for(const rel of [...doc.documentElement.children])if(rel.getAttribute('Type')?.endsWith('/table'))rel.remove();
      sheetRels[name]=doc;tableNodes[name]=[];
    }
    function addTable(name,sheet,fields,rows,top,left=1) {
      const entries=Object.entries(fields),last=top+Math.max(1,rows.length),ref=column(left)+top+':'+column(left+entries.length-1)+last;
      if(last>1048576)fail(sheet.name+': Excel Table 超出工作表容量，拒绝截断');
      entries.forEach(([field],i)=>I.set(sheet,column(left+i)+top,field));
      rows.forEach((row,i)=>entries.forEach(([field,type],j)=>put(sheet,column(left+j)+(top+i+1),row[field],type)));
      const id=++tableId,path='xl/tables/table'+id+'.xml',doc=I.parse(`<table xmlns="${NS}" id="${id}" name="RS_${name}" displayName="RS_${name}" ref="${ref}" totalsRowShown="0"><autoFilter ref="${ref}"/><tableColumns count="${entries.length}"/><tableStyleInfo name="TableStyleLight9" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/></table>`,path);
      for(const [i,[field]] of entries.entries()){const col=doc.createElementNS(NS,'tableColumn');col.setAttribute('id',i+1);col.setAttribute('name',field);I.first(doc.documentElement,'tableColumns').appendChild(col)}
      zip.file(path,I.serialize(doc));
      const override=types.createElementNS(TYPES,'Override');override.setAttribute('PartName','/'+path);override.setAttribute('ContentType','application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml');types.documentElement.appendChild(override);
      const rel=sheetRels[sheet.name].createElementNS(PKG,'Relationship'),relId='rIdRSTable'+id;
      rel.setAttribute('Id',relId);rel.setAttribute('Type',REL+'/table');rel.setAttribute('Target','../tables/table'+id+'.xml');sheetRels[sheet.name].documentElement.appendChild(rel);
      tableNodes[sheet.name].push(relId);return last;
    }
    addTable('WorkLog',log,Object.fromEntries([...C.HEADERS,'Record ID','Site'].map(field=>[field,'text'])),[],5);
    // Include the existing 300 formula/input rows when Excel sorts the Work Log table.
    const workTable=I.parse(await zip.file('xl/tables/table1.xml').async('string'),'Work Log table');workTable.documentElement.setAttribute('ref','A5:V305');I.first(workTable.documentElement,'autoFilter').setAttribute('ref','A5:V305');zip.file('xl/tables/table1.xml',I.serialize(workTable));
    for(const [key,spec] of Object.entries(SPECS)) {
      const sheet=sheets[spec.sheet],title=cursors[spec.sheet];I.set(sheet,'A'+title,'RS_'+key);
      cursors[spec.sheet]=addTable(key,sheet,spec.fields,data[key],title+1)+4;
    }
    for(const name of SHEETS) {
      const sheet=sheets[name],parts=sheet.doc.createElementNS(NS,'tableParts');parts.setAttribute('count',tableNodes[name].length);
      for(const id of tableNodes[name]){const node=sheet.doc.createElementNS(NS,'tablePart');node.setAttributeNS(REL,'r:id',id);parts.appendChild(node)}
      sheet.doc.documentElement.appendChild(parts);
      I.first(sheet.doc.documentElement,'dimension')?.remove();
      const serialized=I.serialize(sheet.doc);
      if(serialized.length>16*1024*1024)fail(name+': 数据及审计超过本工具可重开的 XML 容量（16 MiB），未生成文件；当前资料保留。');
      zip.file(paths[name],serialized);zip.file(relationshipsPath(paths[name]),I.serialize(sheetRels[name]));
    }
    zip.file('xl/workbook.xml',I.serialize(book));zip.file('xl/_rels/workbook.xml.rels',I.serialize(rels));zip.file('[Content_Types].xml',I.serialize(types));
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:5}});
    exports.set(blob,Object.fromEntries(['fileId','fileVersionId','parentFileVersionId','sourceName'].map(key=>[key,exported[key]])));
    return blob;
  }
  root.TrackerWorkbookV4=Object.freeze({read,write,digest,hashBytes,exportInfo:blob=>exports.get(blob),SHEETS,SPECS});
  async function readAny(input) {
    const zip=await JSZip.loadAsync(input),book=await I.xml(zip,'xl/workbook.xml');
    if(book.getElementsByTagNameNS(NS,'sheet').length===3)return {...await root.TrackerLegacyWorkbook.read(input),readOnly:true};
    const result=await read(input);
    return {...result,version:'4.0',config:R.config(result.bundle),records:R.viewRecords(result.bundle),readOnly:false};
  }
  root.TrackerWorkbook=Object.freeze({read:readAny,write});
})(globalThis);
