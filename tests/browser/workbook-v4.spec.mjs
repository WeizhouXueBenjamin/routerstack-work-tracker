import {test,expect} from '@playwright/test';
import {url} from './helpers.mjs';
import {add,download,open,legacy,mutate} from './helpers.mjs';
import {readFile} from 'node:fs/promises';

test('v4 export refuses an oversized audit rather than producing a workbook its reader cannot reopen',async({page})=>{
  test.setTimeout(120000);
  const result=await page.evaluate(async()=>{
    const R=TrackerReconciliation,records=Array.from({length:300},(_,i)=>({kind:'Job',date:'2026-01-10',invoice:'INV-'+(9000+i),start:'19:00',end:'20:00',rate:60,app:150,note:'Synthetic '+ 'x'.repeat(16000)})),b=R.migrate({version:'3.0',config:TrackerCore.DEFAULT_CONFIG,records});
    const audit=b.audit.length,first=b.tables.records[0].note;let error='';try{await TrackerWorkbookV4.write(b)}catch(e){error=e.message}
    return {error,unchanged:audit===b.audit.length && first===b.tables.records[0].note,count:b.tables.records.length};
  });
  expect(result.error).toContain('History:');expect(result.error).toContain('16 MiB');expect(result.unchanged).toBe(true);expect(result.count).toBe(300);
});

test.beforeEach(async({page})=>{
  const errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(/^https?:/.test(request.url()))requests.push(request.url())});
  page.on('dialog',dialog=>dialog.accept());await page.addInitScript(()=>{window.showSaveFilePicker=undefined;window.showOpenFilePicker=undefined});
  await page.goto(url);await page.evaluate(()=>{window.v4Errors=[]});
  page.v4Observed={errors,requests};
});
test.afterEach(async({page})=>{expect(page.v4Observed.errors).toEqual([]);expect(page.v4Observed.requests).toEqual([])});

test('v4 tables preserve identities, pending values and complete App history after two exports',async({page})=>{
  const result=await page.evaluate(async()=>{
    const R=TrackerReconciliation,W=TrackerWorkbookV4;
    const job={date:'2026-01-10',invoice:'INV-9001',start:'19:00',end:'20:00',rate:60,lunch:'',app:150,extra:'',note:'  Synthetic 中文\n',site:'Synthetic site'};
    let bundle=R.addRecord(R.create(),job),id=bundle.tables.records[0].id;
    bundle=R.updateRecord(bundle,id,{app:180});bundle=R.addRecord(bundle,{date:'2026-01-11',invoice:'INV-9002',note:'Synthetic incomplete'},{pending:true});
    const file=await W.write(bundle,{fileName:'synthetic-v4.xlsx'}),parsed=await W.read(await file.arrayBuffer());
    const second=await W.read(await (await W.write(parsed.bundle)).arrayBuffer());
    const zip=await JSZip.loadAsync(await file.arrayBuffer()),book=new DOMParser().parseFromString(await zip.file('xl/workbook.xml').async('string'),'application/xml');
    let oldRejected=false;try{await TrackerLegacyWorkbook.read(await file.arrayBuffer())}catch{oldRejected=true}
    return {id,first:parsed.bundle.tables,second:second.bundle.tables,history:bundle.tables,changes:parsed.changes,sheets:[...book.getElementsByTagNameNS(TrackerWorkbookXml.NS,'sheet')].map(node=>node.getAttribute('name')),tables:zip.file(/^xl\/tables\/.*\.xml$/).length,oldRejected};
  });
  expect(result.first).toEqual(result.history);expect(result.second).toEqual(result.first);expect(result.changes).toEqual([]);
  expect(result.first.records[0].id).toBe(result.id);expect(result.first.records[0].note).toBe('  Synthetic 中文\n');
  expect(result.first.records[1].state).toBe('Pending');expect(result.first.records[1].start).toBe('');expect(result.first.records[1].rate).toBe('');
  expect(result.first.observations.map(row=>row.differenceCents)).toEqual([3000,0]);
  expect(result.sheets).toEqual(['Tool','Work Log','Config','Reconciliation','Entries','History']);expect(result.tables).toBe(20);expect(result.oldRejected).toBe(true);
});

test('v4 blank template has no shared business identity or records',async({page})=>{
  const result=await page.evaluate(async()=>{
    const bytes=await (await TrackerWorkbookV4.write(TrackerReconciliation.create(),{template:true})).arrayBuffer();
    const first=await TrackerWorkbookV4.read(bytes),second=await TrackerWorkbookV4.read(bytes);
    return {template:first.isTemplate,first:first.bundle.cycleId,second:second.bundle.cycleId,records:first.bundle.tables.records};
  });
  expect(result.template).toBe(true);expect(result.first).not.toBe(result.second);expect(result.records).toEqual([]);
});

test('the shipped v4 template matches the reader and starts independent cycles',async({page})=>{
  const bytes=[...await readFile(new URL('../../templates/RouterStack_Tracker_V4_Blank.xlsx',import.meta.url))];
  const result=await page.evaluate(async bytes=>{
    const a=await TrackerWorkbookV4.read(new Uint8Array(bytes)),b=await TrackerWorkbookV4.read(new Uint8Array(bytes));
    return {template:a.isTemplate,a:a.bundle.cycleId,b:b.bundle.cycleId,records:a.bundle.tables.records};
  },bytes);
  expect(result.template).toBe(true);expect(result.a).not.toBe(result.b);expect(result.records).toEqual([]);
});

test('external Work Log and Config edits are proposals and do not rewrite payment history',async({page})=>{
  const result=await page.evaluate(async()=>{
    const R=TrackerReconciliation;
    const original=R.addRecord(R.create(),{date:'2026-01-10',invoice:'INV-9001',start:'19:00',end:'20:00',rate:60,app:150});
    const zip=await JSZip.loadAsync(await (await TrackerWorkbookV4.write(original)).arrayBuffer());
    for(const [path,ref,value] of [['xl/worksheets/sheet2.xml','H6',180],['xl/worksheets/sheet3.xml','B6',18.5/24]]) {
      const I=TrackerWorkbookXml,doc=I.parse(await zip.file(path).async('string'),path),sheet=I.indexSheet(doc,path);I.set(sheet,ref,value);zip.file(path,I.serialize(doc));
    }
    const parsed=await TrackerWorkbookV4.read(await zip.generateAsync({type:'arraybuffer'}));
    let blocked=false;try{await TrackerWorkbookV4.write(parsed.bundle)}catch{blocked=true}
    const accepted=R.acceptExternalChanges(parsed.bundle,parsed.changes,{source:'Synthetic Excel import'});
    const saved=await TrackerWorkbookV4.read(await (await TrackerWorkbookV4.write(accepted)).arrayBuffer());
    return {changes:parsed.changes.map(row=>row.kind),oldApp:parsed.bundle.tables.records[0].app,observations:parsed.bundle.tables.observations.length,oldRules:TrackerReconciliation.config(parsed.bundle),blocked,newApp:saved.bundle.tables.records[0].app,newObservations:saved.bundle.tables.observations.length,newChanges:saved.changes};
  });
  expect(result.changes).toEqual(['Work','Rules']);expect(result.oldApp).toBe(150);expect(result.observations).toBe(1);expect(result.oldRules.ahStart).toBe(18);
  expect(result.blocked).toBe(true);expect(result.newApp).toBe(180);expect(result.newObservations).toBe(2);expect(result.newChanges).toEqual([]);
});

for(const mode of ['managed','audit','identity','header'])test('v4 import rejects corruption: '+mode,async({page})=>{
  const message=await page.evaluate(async mode=>{
    const R=TrackerReconciliation,I=TrackerWorkbookXml;
    const bundle=R.addRecord(R.create(),{date:'2026-01-10',invoice:'INV-9001',start:'19:00',end:'20:00',rate:60,app:150});
    const zip=await JSZip.loadAsync(await (await TrackerWorkbookV4.write(bundle)).arrayBuffer());
    let path='xl/worksheets/sheet2.xml',ref=mode==='identity'?'U6':'E5',value=mode==='identity'?'':'App Shown (NZD)';
    if(mode==='managed' || mode==='audit') {
      const name=mode==='managed'?'records':'Audit';let range,col;
      for(const table of zip.file(/^xl\/tables\/.*\.xml$/)) {const doc=I.parse(await table.async('string'),table.name);if(doc.documentElement.getAttribute('name')==='RS_'+name){range=doc.documentElement.getAttribute('ref');col=[...doc.getElementsByTagNameNS(I.NS,'tableColumn')].findIndex(node=>node.getAttribute('name')===(mode==='managed'?'rate':'reason'))}}
      const start=Number(range.match(/\d+/)[0])+1;path=mode==='managed'?'xl/worksheets/sheet5.xml':'xl/worksheets/sheet6.xml';ref=String.fromCharCode(65+col)+start;value=mode==='managed'?70:'tampered';
    }
    const doc=I.parse(await zip.file(path).async('string'),path),sheet=I.indexSheet(doc,path);I.set(sheet,ref,value);zip.file(path,I.serialize(doc));
    try{await TrackerWorkbookV4.read(await zip.generateAsync({type:'arraybuffer'}));return 'ACCEPTED'}catch(error){return error.message}
  },mode);
  expect(message).not.toBe('ACCEPTED');expect(message).toMatch(mode==='identity'?/Record ID/:mode==='header'?/E5/:/RS_Integrity/);
});

test('v4 relationships, table paths and Sheet reordering do not affect business data',async({page})=>{
  const result=await page.evaluate(async()=>{
    const R=TrackerReconciliation,I=TrackerWorkbookXml,bundle=R.addRecord(R.create(),{date:'2026-01-10',invoice:'INV-9001',start:'19:00',end:'20:00',rate:60,app:0});
    const zip=await JSZip.loadAsync(await (await TrackerWorkbookV4.write(bundle)).arrayBuffer());
    const book=I.parse(await zip.file('xl/workbook.xml').async('string'),'workbook'),sheets=I.first(book.documentElement,'sheets');sheets.insertBefore(sheets.lastElementChild,sheets.firstElementChild);zip.file('xl/workbook.xml',I.serialize(book));
    const old='xl/worksheets/sheet2.xml',next='xl/worksheets/jobs-renamed.xml';zip.file(next,await zip.file(old).async('string'));zip.remove(old);
    zip.file('xl/_rels/workbook.xml.rels',(await zip.file('xl/_rels/workbook.xml.rels').async('string')).replace('/worksheets/sheet2.xml','/worksheets/jobs-renamed.xml'));
    zip.file('xl/worksheets/_rels/jobs-renamed.xml.rels',(await zip.file('xl/worksheets/_rels/sheet2.xml.rels').async('string')).replace('../tables/table1.xml','../tables/log-table-renamed.xml'));zip.remove('xl/worksheets/_rels/sheet2.xml.rels');
    zip.file('xl/tables/log-table-renamed.xml',await zip.file('xl/tables/table1.xml').async('string'));zip.remove('xl/tables/table1.xml');
    const parsed=await TrackerWorkbookV4.read(await zip.generateAsync({type:'arraybuffer'}));return {old:bundle.tables,next:parsed.bundle.tables,changes:parsed.changes};
  });
  expect(result.next).toEqual(result.old);expect(result.changes).toEqual([]);
});

test('main UI saves and reopens the complete v4 bundle with stable records',async({page})=>{
  await add(page,{start:'19:00',end:'20:00',app:'150'});
  const before=await page.evaluate(()=>({id:state.bundle.tables.records[0].id,tables:state.bundle.tables}));
  const bytes=await download(page);await open(page,bytes,'synthetic-v4.xlsx');
  expect(await page.evaluate(()=>state.version)).toBe('4.0');
  expect(await page.evaluate(()=>state.bundle.tables)).toEqual(before.tables);
  expect(await page.evaluate(()=>state.bundle.tables.records[0].id)).toBe(before.id);
  await expect(page.locator('#kExpected')).toHaveText('$180.00');
});

test('v4 browser add/save/reopen supports lossless cycle data drafts without new income',async({page})=>{
  await add(page,{start:'19:00',end:'20:00',app:'150'});const source=await download(page);await open(page,source,'synthetic-source.xlsx');
  const result=await page.evaluate(async()=>{
    const original=Reconcile.clone(state.bundle),draft=Reconcile.createCycleDraft(state.bundle,{name:'Synthetic next',sourceHash:state.sourceHash});
    const parsed=await TrackerWorkbookV4.read(await(await TrackerWorkbookV4.write(draft)).arrayBuffer());
    return {old:original.tables.records[0],next:parsed.bundle.tables.records[0],jobs:Reconcile.currentRecords(parsed.bundle).length,history:parsed.bundle.tables.observations,oldHistory:original.tables.observations};
  });
  expect(result.next.id).toBe(result.old.id);expect(result.next.state).toBe('Historical');expect(result.jobs).toBe(0);expect(result.history).toEqual(result.oldHistory);
});

for(const version of ['2.0','3.0'])test('main UI keeps '+version+' read-only until explicit v4 migration',async({page})=>{
  const bytes=version==='2.0'?await legacy():Buffer.from(await page.evaluate(async()=>[...new Uint8Array(await(await TrackerLegacyWorkbook.write([{kind:'Job',date:'2026-01-10',invoice:'INV-9001',start:'19:00',end:'20:00',lunch:'',rate:60,app:'',extra:'',note:'Synthetic upgrade',balance:''}],{...TrackerCore.DEFAULT_CONFIG})).arrayBuffer())]));
  await open(page,bytes,'synthetic-legacy.xlsx');await expect(page.locator('#saveBtn')).toBeDisabled();
  const before=await page.evaluate(()=>JSON.stringify(state.records));
  await page.locator('#upgradeBtn').click();await page.locator('#reviewCancel').click();expect(await page.evaluate(()=>JSON.stringify(state.records))).toBe(before);
  await page.locator('#upgradeBtn').click();await page.locator('#reviewConfirm').click();
  await expect(page.locator('#saveBtn')).toBeEnabled();expect(await page.evaluate(()=>state.version)).toBe('4.0');
  expect(await page.evaluate(()=>state.bundle.tables.origins[0].sha256)).toMatch(/^[a-f0-9]{64}$/);
  expect(await page.evaluate(()=>state.bundle.tables.payments)).toEqual([]);await expect(page.locator('#kExpected')).toHaveText('$180.00');
  const saved=await download(page);await open(page,saved);expect(await page.evaluate(()=>state.version)).toBe('4.0');
});

test('main UI raw import preview preserves drafts on cancel and App history on acceptance',async({page})=>{
  await add(page,{start:'19:00',end:'20:00',app:'150'});const bytes=await download(page);
  const edited=await mutate(page,bytes,[{ref:'H6',value:180}]);await page.locator('#note').fill('Synthetic unsubmitted draft');
  await open(page,edited,'synthetic-edited.xlsx');await expect(page.locator('#reviewRows')).toContainText('150 → 180');
  await page.locator('#reviewCancel').click();await expect(page.locator('#note')).toHaveValue('Synthetic unsubmitted draft');
  expect(await page.evaluate(()=>state.records[0].app)).toBe(150);
  await open(page,edited,'synthetic-edited.xlsx');await page.locator('#reviewConfirm').click();
  expect(await page.evaluate(()=>state.records[0].app)).toBe(180);expect(await page.evaluate(()=>state.bundle.tables.observations.length)).toBe(2);
  expect(await page.evaluate(()=>state.bundle.tables.issues[0].status)).toBe('Resolved');expect(await page.evaluate(()=>state.dirty)).toBe(true);
  expect(await page.evaluate(()=>state.bundle.tables.payments)).toEqual([]);
});
