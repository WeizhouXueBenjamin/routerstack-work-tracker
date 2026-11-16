import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {boot,add,open,makeBytes,mutate,download} from './helpers.mjs';
test.beforeEach(async({page})=>boot(page));
async function readResult(page,bytes){return page.evaluate(async bytes=>{try{return {ok:true,value:await TrackerWorkbook.read(new Uint8Array(bytes))}}catch(error){return {ok:false,error:error.message}}},[...bytes])}
test('four sheets, eight tables and a single copy of work values roundtrip unknown, zero, rich text and identities',async({page})=>{
 const bytes=await makeBytes(page,{count:3,standalone:true}),result=await readResult(page,bytes);expect(result.ok).toBe(true);expect(result.value.records).toHaveLength(3);expect(result.value.records[0].note).toBe('  Synthetic 中文\n=SUM(1,2) ');expect(result.value.issues.map(row=>row.amountCents)).toEqual([null,0]);expect(result.value.balances[0].amountCents).toBe(0);
 const detail=await page.evaluate(async bytes=>{const zip=await JSZip.loadAsync(new Uint8Array(bytes));return {sheets:zip.file(/^xl\/worksheets\/[^/]+\.xml$/).length,tables:zip.file(/^xl\/tables\/.*\.xml$/).length,recordTables:await zip.file('xl/tables/table1.xml').async('string'),log:await zip.file('xl/worksheets/sheet1.xml').async('string')}},[...bytes]);
 expect(detail.sheets).toBe(4);expect(detail.tables).toBe(8);expect(detail.recordTables).toContain('RS_WorkLog');expect(detail.log).toContain('hidden="1"');expect(detail.log).toContain('conditionalFormatting');
});
test('identity-free template instantiates fresh FileID and PeriodID every time',async({page})=>{
 const bytes=await readFile(new URL('../../templates/RouterStack_Tracker_V5_Blank.xlsx',import.meta.url));const first=await readResult(page,bytes),second=await readResult(page,bytes);expect(first.ok).toBe(true);expect(second.ok).toBe(true);expect(first.value.metadata.fileVersionId).toBeNull();expect(first.value.metadata.fileId).not.toBe(second.value.metadata.fileId);expect(first.value.metadata.currentPeriodId).not.toBe(second.value.metadata.currentPeriodId);
});
for(const mode of ['sort','shared','cache'])test('normal '+mode+' retains controlled values and row-relative formulas',async({page})=>{
 const bytes=await makeBytes(page,{count:3}),modified=await mutate(page,bytes,[],mode),first=await readResult(page,bytes),second=await readResult(page,modified);expect(second.ok,second.error).toBe(true);expect(second.value.records.map(row=>row.id).sort()).toEqual(first.value.records.map(row=>row.id).sort());
});
for(const [label,operations,mode] of [
 ['raw business value',[{ref:'E10',value:61}]],['Config',[{path:'xl/worksheets/sheet2.xml',ref:'B5',value:3}]],['identity',[{ref:'M10',value:'changed-id'}]],['missing formula',[{ref:'F10',removeFormula:true}]],['wrong formula',[{ref:'F10',formula:'1+1',value:2}]],['broken shared',[],'broken-shared'],['unknown data',[{ref:'A1000',value:'Extra uncontrolled data'}]],['formula in raw field',[{ref:'E10',formula:'60',value:60}]],['duplicate ID',[{ref:'M11',value:'__duplicate__'},{ref:'M10',value:'__duplicate__'}]],['history reference',[{path:'xl/worksheets/sheet4.xml',ref:'AE4',value:'missing-record'}]]
])test('reject '+label+' without replacing current memory or draft',async({page})=>{
 await add(page,{note:'Original work'});await page.locator('#note').fill('Keep draft');
 const modified=await mutate(page,await makeBytes(page,{count:2,standalone:true}),operations,mode);const result=await readResult(page,modified);expect(result.ok).toBe(false);await open(page,modified);expect(await page.evaluate(()=>state.records[0].note)).toBe('Original work');await expect(page.locator('#note')).toHaveValue('Keep draft');
});
test('old schema is explicitly rejected and no upgrade or readonly adapter exists',async({page})=>{
 const bytes=await makeBytes(page),modified=await mutate(page,bytes,[{path:'xl/worksheets/sheet2.xml',ref:'B14',value:'4.1'}]);const result=await readResult(page,modified);expect(result.ok).toBe(false);expect(result.error).toContain('5.0');await expect(page.locator('#upgradeBtn')).toHaveCount(0);
});
test('standalone-only XLSX preserves null and zero across two saved carry-forward files',async({page})=>{
 const result=await page.evaluate(async()=>{
  const M=TrackerModel,W=TrackerWorkbook;let state=M.saveIssue(M.create(),{description:'Unknown',amountCents:null});state=M.saveIssue(state,{description:'Zero',amountCents:0});state=M.saveBalance(state,{description:'Confirmed zero',amountCents:0},null,'Explicit');
  const first=await W.write(state),before=await W.hashBytes(await first.arrayBuffer());state=await W.read(await first.arrayBuffer());const original=M.clone(state);
  for(let i=0;i<2;i++)state=await W.read(await(await W.write(M.carryForward(state,{name:'Next '+i}))).arrayBuffer());
  return {records:state.records.length,issues:state.issues,originalIssues:original.issues,balance:state.balances[0],history:state.balanceHistory.length,before,after:await W.hashBytes(await first.arrayBuffer())};
 });
 expect(result.records).toBe(0);expect(result.issues).toEqual(result.originalIssues);expect(result.balance.amountCents).toBe(0);expect(result.history).toBe(1);expect(result.before).toBe(result.after);
});
for(const count of [301,1000,5000])test('dynamic capacity '+count+' survives add/save/reopen/carry and measures actual operations',async({page})=>{
 test.setTimeout(120000);
 const result=await page.evaluate(async count=>{
  const M=TrackerModel,W=TrackerWorkbook,start=performance.now();let data=M.addRecord(M.create(),{date:'2026-01-10',start:'09:00',end:'10:00',rate:60});const base=data.records[0];data.records=Array.from({length:count-1},()=>({...base,id:crypto.randomUUID()}));data=M.addRecord(data,{date:'2026-02-10',start:'19:00',end:'20:00',rate:60});const built=performance.now();
  const blob=await W.write(data),written=performance.now(),parsed=await W.read(await blob.arrayBuffer()),read=performance.now(),next=M.carryForward(parsed,{name:'Next synthetic'}),carried=performance.now();const nextBlob=await W.write(next),nextParsed=await W.read(await nextBlob.arrayBuffer()),roundtrip=performance.now();
  useWorkbook(parsed);state.revision++;showRows();const rendered=performance.now();$('search').value='2026-02-10';showRows();const filtered=performance.now();
  return {count:parsed.records.length,unique:new Set(parsed.records.map(row=>row.id)).size,carried:nextParsed.records.length,historical:nextParsed.records.every(row=>row.type==='Historical'),visible:$('rows').querySelectorAll('[data-record-id]').length,bytes:blob.size,buildMs:built-start,writeMs:written-built,readMs:read-written,carryMs:carried-read,nextRoundtripMs:roundtrip-carried,renderMs:rendered-roundtrip,filterMs:filtered-rendered};
 },count);
 expect(result.count).toBe(count);expect(result.unique).toBe(count);expect(result.carried).toBe(count);expect(result.historical).toBe(true);expect(result.visible).toBe(1);await test.info().attach('capacity-'+count,{body:JSON.stringify(result,null,2),contentType:'application/json'});console.log('CAPACITY '+JSON.stringify(result));
 if(count===5000){await page.locator('#rows [data-edit]').click();await page.locator('#note').fill('Edited after 5000-row filter');await page.locator('#submitJob').click();expect(await page.evaluate(()=>state.records.at(-1).note)).toBe('Edited after 5000-row filter')}
});
test('301st record through the actual form is accepted and full download ignores active filters',async({page})=>{
 await open(page,await makeBytes(page,{count:300}));await add(page,{invoice:'INV-9900'});await page.locator('#search').fill('INV-9900');await expect(page.locator('#rows tr[data-record-id]')).toHaveCount(1);const bytes=await download(page);expect((await readResult(page,bytes)).value.records.length).toBe(301);
});
test('input bytes reject the 32MiB boundary before ZIP parsing',async({page})=>{
 const result=await page.evaluate(async()=>{try{await TrackerWorkbook.read(new Uint8Array(TrackerWorkbook.FILE_LIMIT+1));return ''}catch(error){return error.message}});expect(result).toContain('32MiB');
});
test('single XML and cumulative XML limits reject oversized content without truncating memory',async({page})=>{
 test.setTimeout(120000);
 const result=await page.evaluate(async()=>{
  const W=TrackerWorkbook,M=TrackerModel;let data=M.addRecord(M.create(),{date:'2026-01-10',start:'09:00',end:'10:00',rate:60,note:'x'.repeat(32767)});const base=data.records[0];data.records=Array.from({length:520},()=>({...base,id:crypto.randomUUID()}));const before=M.canonical(data);let output='';try{await W.write(data)}catch(error){output=error.message}
  const good=await W.write(M.create());let errors=[];
  for(const lengths of [[W.XML_LIMIT+1],Array(5).fill(14*1024*1024)]){
   const zip=await JSZip.loadAsync(await good.arrayBuffer());lengths.forEach((length,i)=>zip.file('xl/extra-'+i+'.xml','<extra>'+ 'x'.repeat(length)+'</extra>'));
   try{await W.read(await zip.generateAsync({type:'arraybuffer',compression:'DEFLATE'}));errors.push('accepted')}catch(error){errors.push(error.message)}
  }
  return {output,errors,unchanged:before===M.canonical(data),count:data.records.length};
 });
 expect(result.output).toContain('XML');expect(result.errors).toHaveLength(2);for(const error of result.errors)expect(error).toContain('XML');expect(result.unchanged).toBe(true);expect(result.count).toBe(520);
});
test('export versions identify actual snapshots and their immediate previous version',async({page})=>{
 const result=await page.evaluate(async()=>{const W=TrackerWorkbook,M=TrackerModel,source=M.addRecord(M.create(),{date:'2026-01-10',start:'09:00',end:'10:00',rate:60}),firstBlob=await W.write(source),first=await W.read(await firstBlob.arrayBuffer()),second=await W.read(await(await W.write(M.updateRecord(first,first.records[0].id,{note:'Updated'}))).arrayBuffer());const next=await W.read(await(await W.write(M.carryForward(second,{name:'Next'}))).arrayBuffer());return {original:source.metadata,first:first.metadata,second:second.metadata,next:next.metadata}});
 expect(result.original.fileVersionId).toBeNull();expect(result.first.fileId).toBe(result.second.fileId);expect(result.second.previousFileVersionId).toBe(result.first.fileVersionId);expect(result.second.fileVersionId).not.toBe(result.first.fileVersionId);expect(result.next.sourceFileVersionId).toBe(result.second.fileVersionId);expect(result.next.sourceFileId).toBe(result.second.fileId);expect(result.next.fileId).not.toBe(result.second.fileId);
});
for(const storage of ['inline','shared'])test('rich text and phonetic hints preserve the actual Notes text: '+storage,async({page})=>{
 const bytes=await makeBytes(page),modified=await page.evaluate(async({bytes,storage})=>{
  const zip=await JSZip.loadAsync(new Uint8Array(bytes)),NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main',doc=new DOMParser().parseFromString(await zip.file('xl/worksheets/sheet1.xml').async('string'),'application/xml'),cell=[...doc.getElementsByTagNameNS(NS,'c')].find(node=>node.getAttribute('r')==='H9');
  const owner=storage==='inline'?doc:new DOMParser().parseFromString(`<sst xmlns="${NS}" count="1" uniqueCount="1"/>`,'application/xml'),body=owner.createElementNS(NS,storage==='inline'?'is':'si');
  for(const value of ['  Synthetic 中文\n','=SUM(1,2) ']){const run=owner.createElementNS(NS,'r'),t=owner.createElementNS(NS,'t');t.setAttributeNS('http://www.w3.org/XML/1998/namespace','xml:space','preserve');t.textContent=value;run.appendChild(t);body.appendChild(run)}
  const hint=owner.createElementNS(NS,'rPh'),t=owner.createElementNS(NS,'t');hint.setAttribute('sb','2');hint.setAttribute('eb','11');t.textContent='phonetic hint is not original text';hint.appendChild(t);body.appendChild(hint);cell.replaceChildren();
  if(storage==='inline'){cell.setAttribute('t','inlineStr');cell.appendChild(body)}else{owner.documentElement.appendChild(body);zip.file('xl/sharedStrings.xml',new XMLSerializer().serializeToString(owner));cell.setAttribute('t','s');const v=doc.createElementNS(NS,'v');v.textContent='0';cell.appendChild(v)}
  zip.file('xl/worksheets/sheet1.xml',new XMLSerializer().serializeToString(doc));return [...new Uint8Array(await zip.generateAsync({type:'arraybuffer'}))];
 },{bytes:[...bytes],storage});
 const result=await readResult(page,Buffer.from(modified));expect(result.ok,result.error).toBe(true);expect(result.value.records[0].note).toBe('  Synthetic 中文\n=SUM(1,2) ');
});
test('Excel row ceiling includes dynamic Summary and table headers',async({page})=>{
 const result=await page.evaluate(()=>{
  const state=TrackerModel.create(),top=TrackerWorkbook.tableLayout(state)[0].top;state.records=Array(TrackerWorkbook.EXCEL_ROWS-top);const bottom=TrackerWorkbook.tableLayout(state)[0].bottom;state.records.length++;let error='';try{TrackerWorkbook.tableLayout(state)}catch(caught){error=caught.message}return {bottom,error};
 });expect(result.bottom).toBe(1048576);expect(result.error).toContain('Excel');
});
test('32MiB compressed output limit rejects before any download and preserves concurrent draft',async({page})=>{
 test.setTimeout(120000);
 const result=await page.evaluate(async()=>{
  const M=TrackerModel;let data=M.addRecord(M.create(),{date:'2026-01-10',start:'09:00',end:'10:00',rate:60}),base=data.records[0];
  const randomText=()=>{const bytes=crypto.getRandomValues(new Uint8Array(24525));return btoa(String.fromCharCode(...bytes))};
  data.records=Array.from({length:440},()=>({...base,id:crypto.randomUUID(),note:randomText()}));
  data=M.saveIssue(data,{description:'Seed',amountCents:null});const issue=data.issues[0],history=data.issueHistory[0];data.issues=[];data.issueHistory=[];
  for(let i=0;i<480;i++){const description=randomText(),id=crypto.randomUUID();data.issues.push({...issue,id,description});data.issueHistory.push({...history,id:crypto.randomUUID(),issueId:id,description})}
  M.validate(data);useWorkbook(data);state.revision++;clearForm();let message='';window.alert=value=>{message=value};let downloads=0;document.addEventListener('click',event=>{if(event.target.closest('a[download]'))downloads++});
  const task=exportSnapshot(clone(state.workbook),state.revision,'same');$('note').value='Keep concurrent draft';const success=await task;
  return {success,message,downloads,count:state.records.length,issues:state.workbook.issues.length,note:$('note').value,dirty:state.dirty,pending:state.pending};
 });
 expect(result.success).toBe(false);expect(result.message).toContain('32MiB');expect(result.downloads).toBe(0);expect(result.count).toBe(440);expect(result.issues).toBe(480);expect(result.note).toBe('Keep concurrent draft');expect(result.dirty).toBe(true);expect(result.pending).toBeNull();
});
test('unrecognized package data and named ranges are rejected rather than discarded',async({page})=>{
 const bytes=await makeBytes(page);
 for(const mode of ['part','name']){
  const result=await page.evaluate(async({bytes,mode})=>{
   const zip=await JSZip.loadAsync(new Uint8Array(bytes));
   if(mode==='part')zip.file('xl/additional-data.xml','<extra>Known work data outside the supported format</extra>');
   else{const path='xl/workbook.xml',doc=new DOMParser().parseFromString(await zip.file(path).async('string'),'application/xml'),NS=doc.documentElement.namespaceURI,list=doc.createElementNS(NS,'definedNames'),name=doc.createElementNS(NS,'definedName');name.setAttribute('name','ExtraWorkData');name.textContent='42';list.appendChild(name);doc.documentElement.appendChild(list);zip.file(path,new XMLSerializer().serializeToString(doc))}
   try{await TrackerWorkbook.read(await zip.generateAsync({type:'arraybuffer'}));return ''}catch(error){return error.message}
  },{bytes:[...bytes],mode});expect(result).toContain('额外');
 }
});
test('the last valid Excel year and two-place amount edges export and reopen',async({page})=>{
 const result=await page.evaluate(async()=>{let data=TrackerModel.addRecord(TrackerModel.create(),{date:'9999-12-31',start:'23:30',end:'00:00',rate:0.005,app:0.005});data=await TrackerWorkbook.read(await(await TrackerWorkbook.write(data)).arrayBuffer());return data.records[0].date});expect(result).toBe('9999-12-31');
});
test('missing required package parts and a corrupt ZIP CRC are rejected',async({page})=>{
 const original=await makeBytes(page);
 for(const path of ['[Content_Types].xml','_rels/.rels','xl/styles.xml']){
  const result=await page.evaluate(async({bytes,path})=>{const zip=await JSZip.loadAsync(new Uint8Array(bytes));zip.remove(path);try{await TrackerWorkbook.read(await zip.generateAsync({type:'arraybuffer'}));return ''}catch(error){return error.message}},{bytes:[...original],path});expect(result).toContain('损坏');
 }
 const bytes=Buffer.from(original);let changed=false;
 for(let offset=0;offset<bytes.length-46;offset++)if(bytes.readUInt32LE(offset)===0x02014b50){const length=bytes.readUInt16LE(offset+28);if(bytes.subarray(offset+46,offset+46+length).toString()==='xl/styles.xml'){bytes[offset+16]^=1;changed=true;break}}
 expect(changed).toBe(true);const result=await readResult(page,bytes);expect(result.ok).toBe(false);expect(result.error).toMatch(/CRC/);
});
