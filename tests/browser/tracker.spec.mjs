import {test,expect} from '@playwright/test';
import {add,download,open,legacy,mutate,withPhoneticNote,url} from './helpers.mjs';
const observed=new WeakMap();
test.beforeEach(async({page})=>{
  const seen={errors:[],remote:[],dialogs:[]};observed.set(page,seen);
  page.on('dialog',async dialog=>{seen.dialogs.push(dialog.message());await dialog.accept()});
  page.on('pageerror',error=>seen.errors.push(error.message));
  page.on('request',request=>{if(/^https?:/.test(request.url()))seen.remote.push(request.url())});
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;window.showOpenFilePicker=undefined});
  await page.goto(url);await expect(page.locator('#statusBar')).toContainText('3.0');
});
test.afterEach(async({page})=>{
  expect(observed.get(page).errors).toEqual([]);expect(observed.get(page).remote).toEqual([]);
});
test('offline add → save → reopen → partial carryover → second carryover',async({page})=>{
  await add(page,{app:'0',lunch:'1',extra:'25'});await add(page,{invoice:'INV-9002',start:'22:00',end:'02:00'});
  const before=await page.evaluate(()=>state.records.map(({uid,...record})=>record));
  const bytes=await download(page);await open(page,bytes);
  expect(await page.evaluate(()=>state.records.map(({uid,...record})=>record))).toEqual(before);
  await expect(page.locator('#kJobs')).toHaveText('2');
  const source=await page.evaluate(()=>JSON.stringify(state.records));
  await page.locator('#cycleBtn').click();await page.locator('[data-carry-id]').first().check();await page.locator('[data-carry-amount]').first().fill('27.35');
  const carry=await download(page,'#createCycle');expect(await page.evaluate(()=>JSON.stringify(state.records))).toBe(source);
  await open(page,carry,'carry.xlsx');await expect(page.locator('#kJobs')).toHaveText('0');await expect(page.locator('#kExpected')).toHaveText('$0.00');await expect(page.locator('#carrySummary')).toContainText('$27.35');await expect(page.locator('#kApp')).toHaveText('—');await expect(page.locator('#kDiff')).toHaveText('—');
  await page.locator('#cycleBtn').click();await page.locator('[data-carry-id]').check();
  const second=await download(page,'#createCycle');await open(page,second,'carry2.xlsx');
  expect(await page.evaluate(()=>state.records.map(record=>({invoice:record.invoice,balance:record.balance,note:record.note})))).toEqual([{invoice:'INV-9001',balance:'27.35',note:before[0].note}]);
});
test('editing a pending Invoice survives deleting an earlier job and filtering',async({page})=>{
  await add(page);await add(page,{invoice:'',note:'Pending B'});await add(page,{invoice:'INV-9003',note:'C'});
  await page.locator('[data-edit]').nth(1).click();await page.locator('#note').fill('B edited');
  await page.locator('[data-delete]').first().click();await page.locator('#search').fill('C');await page.locator('#submitJob').click();
  expect(await page.evaluate(()=>state.records.map(record=>({invoice:record.invoice,note:record.note})))).toEqual([{invoice:'',note:'B edited'},{invoice:'INV-9003',note:'C'}]);
});
test('drafts are protected on save, switching records, cancel and beforeunload',async({page})=>{
  await add(page);await page.locator('#note').fill('Unsubmitted draft');await page.locator('#saveBtn').click();
  await expect(page.locator('#formError')).toContainText('尚未提交');
  expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})).toBe(true);
  page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.dismiss());
  await page.locator('[data-edit]').click();await expect(page.locator('#note')).toHaveValue('Unsubmitted draft');
  await page.locator('#discardDraft').click();await expect(page.locator('#note')).toHaveValue('Unsubmitted draft');
});
test('download remains unconfirmed; confirmation does not save a newer edit',async({page})=>{
  await add(page);await download(page,'#saveBtn',false);
  await expect(page.locator('#statusBar')).toContainText('已发起下载，待确认保留');
  await add(page,{invoice:'INV-9002'});await page.locator('#confirmDownload').click();
  expect(await page.evaluate(()=>state.dirty)).toBe(true);await expect(page.locator('#statusBar')).toContainText('尚未保存');
  await download(page);expect(await page.evaluate(()=>state.dirty || hasDraft() || Boolean(state.pending))).toBe(false);
});
test('cancel opening a valid file keeps the active file and unsubmitted draft',async({page})=>{
  await add(page);const bytes=await download(page);await page.locator('#note').fill('Keep draft');
  const before=await page.evaluate(()=>({records:state.records,fileName:state.fileName}));
  page.removeAllListeners('dialog');page.on('dialog',dialog=>dialog.dismiss());
  await open(page,bytes,'other.xlsx');
  expect(await page.evaluate(()=>({records:state.records,fileName:state.fileName}))).toEqual(before);await expect(page.locator('#note')).toHaveValue('Keep draft');
});
test('writing a snapshot waits for close and preserves edits made during save',async({page})=>{
  await add(page);
  await page.evaluate(()=>{window.showSaveFilePicker=async()=>({name:'synthetic-new.xlsx',createWritable:async()=>({write:async blob=>{window.savedBytes=[...new Uint8Array(await blob.arrayBuffer())]},close:()=>new Promise(resolve=>{window.finishWrite=resolve;window.closeStarted=true})})})});
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>window.closeStarted);
  expect(await page.evaluate(()=>state.dirty)).toBe(true);await expect(page.locator('#saveBtn')).toBeDisabled();
  await add(page,{invoice:'INV-9002'});await page.evaluate(()=>window.finishWrite());await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(()=>state.dirty)).toBe(true);
  expect(await page.evaluate(async()=>{const out=await TrackerWorkbook.read(new Uint8Array(window.savedBytes));return out.records.length})).toBe(1);
});
for(const failure of ['cancel','write','close','original','original-case'])test('save failure preserves state: '+failure,async({page})=>{
  await add(page);
  await page.evaluate(failure=>{
    window.showSaveFilePicker=async()=>{
      if(failure==='cancel')throw new DOMException('Cancelled','AbortError');
      return {name:failure==='original'?state.fileName:failure==='original-case'?state.fileName.toUpperCase():'synthetic-new.xlsx',createWritable:async()=>({write:async()=>{if(failure==='write')throw Error('Synthetic write failure')},close:async()=>{if(failure==='close')throw Error('Synthetic close failure')},abort:async()=>{}})};
    };
  },failure);
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(()=>({dirty:state.dirty,count:state.records.length,pending:state.pending}))).toEqual({dirty:true,count:1,pending:null});
});
test('source handles cannot be overwritten under a different filename',async({page})=>{
  await add(page);
  await page.evaluate(()=>{state.protectedHandles=[{}];window.writerCalled=false;window.showSaveFilePicker=async()=>({name:'alias.xlsx',isSameEntry:async()=>true,createWritable:async()=>{window.writerCalled=true;throw Error('must not run')}})});
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);expect(await page.evaluate(()=>window.writerCalled)).toBe(false);expect(await page.evaluate(()=>state.dirty)).toBe(true);
});
test('reopening exports retains all source and exported archive handles',async({page})=>{
  await add(page);
  const result=await page.evaluate(async()=>{
    const bytes=await(await TrackerWorkbook.write(state.records,state.config)).arrayBuffer(),files=new Map([['A',bytes]]),writes=[];
    const handle=(id,name)=>({id,name,isSameEntry:async other=>other.id===id,createWritable:async()=>({write:async blob=>{writes.push(id);files.set(id,await blob.arrayBuffer())},close:async()=>{},abort:async()=>{}})});
    const A=handle('A','original-A.xlsx'),B=handle('B','version-B.xlsx');
    await takeFile(new File([bytes],A.name),A);
    state.records.push(...identified([{...state.records[0],invoice:'INV-9002'}]));state.revision++;showRows();
    window.showSaveFilePicker=async()=>B;
    await exportSnapshot(JSON.parse(JSON.stringify(state.records)),{...state.config},state.revision,'same');
    await takeFile(new File([files.get('B')],B.name),B);
    // An input upload without a handle must not forget known archives either.
    await takeFile(new File([files.get('B')],'input-upload.xlsx'));
    window.showSaveFilePicker=async()=>A;
    const allowed=await exportSnapshot(JSON.parse(JSON.stringify(state.records)),{...state.config},state.revision,'same');
    return {allowed,writes,originalCount:(await TrackerWorkbook.read(files.get('A'))).records.length,protected:state.protectedHandles.map(h=>h.id)};
  });
  expect(result).toEqual({allowed:false,writes:['B'],originalCount:1,protected:['A','B']});
});
test('carryover drafts warn before unload and require explicit dismissal',async({page})=>{
  await add(page);await download(page);await page.locator('#cycleBtn').click();
  expect(await page.evaluate(()=>hasCarryDraft())).toBe(false);
  await page.locator('[data-carry-id]').check();await page.locator('[data-carry-amount]').fill('27.35');
  expect(await page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented})).toBe(true);
  page.removeAllListeners('dialog');page.on('dialog',d=>d.dismiss());
  await page.locator('#closeCycle').click();await expect(page.locator('#cycleModal')).toBeVisible();
  await page.keyboard.press('Escape');await expect(page.locator('#cycleModal')).toBeVisible();await expect(page.locator('[data-carry-amount]')).toHaveValue('27.35');
  page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());await page.locator('#closeCycle').click();
  await expect(page.locator('#cycleModal')).not.toBeVisible();expect(await page.evaluate(()=>hasUnsaved())).toBe(false);
  await page.locator('#cycleBtn').click();await page.locator('[data-carry-id]').check();await page.locator('[data-carry-amount]').fill('27.35');
  // A delayed file read may complete while a modal is open. Accepting replacement discards its old candidates.
  await page.evaluate(async()=>{const records=state.records.map(record=>({...record,invoice:'INV-9998'}));const blob=await TrackerWorkbook.write(records,state.config);await takeFile(new File([blob],'replacement.xlsx'))});
  await expect(page.locator('#cycleModal')).not.toBeVisible();expect(await page.evaluate(()=>({candidates:state.carryCandidates.length,unsaved:hasUnsaved(),invoice:state.records[0].invoice}))).toEqual({candidates:0,unsaved:false,invoice:'INV-9998'});
});
test('carryover inputs and dismissal stay locked until snapshot writing closes',async({page})=>{
  await add(page);await download(page);await page.locator('#cycleBtn').click();await page.locator('[data-carry-id]').check();await page.locator('[data-carry-amount]').fill('27.35');
  await page.evaluate(()=>{window.showSaveFilePicker=async()=>({name:'new-cycle.xlsx',createWritable:async()=>({write:async blob=>{window.cycleBytes=[...new Uint8Array(await blob.arrayBuffer())]},close:()=>new Promise(resolve=>{window.finishCycle=resolve;window.cyclePaused=true}),abort:async()=>{}})})});
  await page.locator('#createCycle').click();await page.waitForFunction(()=>window.cyclePaused);
  await expect(page.locator('[data-carry-amount]')).toBeDisabled();await expect(page.locator('[data-carry-id]')).toBeDisabled();await expect(page.locator('#closeCycle')).toBeDisabled();
  await page.keyboard.press('Escape');await expect(page.locator('#cycleModal')).toBeVisible();
  await page.evaluate(()=>window.finishCycle());await page.waitForFunction(()=>!state.busy);await expect(page.locator('#cycleModal')).not.toBeVisible();
  expect(await page.evaluate(async()=>({balance:(await TrackerWorkbook.read(new Uint8Array(window.cycleBytes))).records[0].balance,unsaved:hasUnsaved()}))).toEqual({balance:'27.35',unsaved:false});
});
for(const failure of ['cancel','write','close'])test('carryover draft survives generation failure: '+failure,async({page})=>{
  await add(page);await download(page);await page.locator('#cycleBtn').click();await page.locator('[data-carry-id]').check();await page.locator('[data-carry-amount]').fill('27.35');
  await page.evaluate(failure=>{window.showSaveFilePicker=async()=>{if(failure==='cancel')throw new DOMException('Cancelled','AbortError');return {name:'new-cycle.xlsx',createWritable:async()=>({write:async()=>{if(failure==='write')throw Error('Synthetic write failure')},close:async()=>{if(failure==='close')throw Error('Synthetic close failure')},abort:async()=>{}})}}},failure);
  await page.locator('#createCycle').click();await page.waitForFunction(()=>!state.busy);
  await expect(page.locator('#cycleModal')).toBeVisible();await expect(page.locator('[data-carry-amount]')).toBeEnabled();await expect(page.locator('[data-carry-amount]')).toHaveValue('27.35');expect(await page.evaluate(()=>hasUnsaved())).toBe(true);
});
for(const storage of ['inline','shared'])test('phonetic hints never change original note text: '+storage,async({page})=>{
  await add(page);const bytes=await download(page),annotated=await withPhoneticNote(page,bytes,storage);
  await open(page,annotated);expect(await page.evaluate(()=>state.records[0].note)).toBe('  Synthetic note 中文\n');
  const saved=await download(page);await open(page,saved);expect(await page.evaluate(()=>state.records[0].note)).toBe('  Synthetic note 中文\n');
});
test('legacy is read-only; upgrade cancellation and acceptance preserve raw inputs',async({page})=>{
  const bytes=await legacy();await open(page,bytes,'legacy.xlsx');await expect(page.locator('#saveBtn')).toBeDisabled();await expect(page.locator('#kExpected')).toHaveText('$150.00');
  const before=await page.evaluate(()=>JSON.stringify(state.records));
  await page.locator('#upgradeBtn').click();await expect(page.locator('#reviewRows')).toContainText('$180.00');await page.locator('#reviewCancel').click();expect(await page.evaluate(()=>state.version)).toBe('2.0');
  await page.locator('#upgradeBtn').click();await page.locator('#reviewConfirm').click();expect(await page.evaluate(()=>JSON.stringify(state.records))).toBe(before);await expect(page.locator('#kExpected')).toHaveText('$180.00');
  const exported=await download(page);await open(page,exported);expect(await page.evaluate(()=>state.version)).toBe('3.0');
});
test('Config changes require review; cancelling leaves records and draft intact',async({page})=>{
  await add(page,{start:'17:00',end:'19:00'});const bytes=await download(page);
  const changed=await mutate(page,bytes,[{path:'xl/worksheets/sheet3.xml',ref:'B6',value:18.5/24}]);
  await page.locator('#note').fill('Keep this draft');const before=await page.evaluate(()=>JSON.stringify(state.records));
  await open(page,changed,'config-change.xlsx');await expect(page.locator('#reviewRules')).toContainText('18:30');await page.locator('#reviewCancel').click();
  expect(await page.evaluate(()=>JSON.stringify(state.records))).toBe(before);await expect(page.locator('#note')).toHaveValue('Keep this draft');
  await open(page,changed,'config-change.xlsx');await page.locator('#reviewConfirm').click();
  expect(await page.evaluate(()=>state.config.ahStart)).toBe(18.5);expect(await page.evaluate(()=>state.dirty)).toBe(true);await expect(page.locator('#rulesBox')).toContainText('18:30');
  const exported=await download(page);await open(page,exported);await expect(page.locator('#reviewModal')).not.toBeVisible();expect(await page.evaluate(()=>state.dirty)).toBe(false);
});
test('relationship paths, sheet reordering, sparse blank rows and shared formulas are supported',async({page})=>{
  await add(page);const bytes=await download(page);
  for(const mode of ['relationships','shared']) {
    const edited=await mutate(page,bytes,[{removeRow:100}],mode);await open(page,edited,mode+'.xlsx');expect(await page.evaluate(()=>state.records.length)).toBe(1);
    await download(page);
  }
});
test('capacity blocks the 301st add while retaining its form',async({page})=>{
  await page.evaluate(()=>{const record={kind:'Job',date:'2026-01-10',invoice:'',start:'09:00',end:'10:00',lunch:'',rate:'60',app:'',extra:'',note:'Synthetic',balance:''};state.records=identified(Array.from({length:300},()=>({...record})));state.revision++;showRows()});
  await add(page,{invoice:'INV-9999',note:'Not lost'});await expect(page.locator('#formError')).toContainText('300');await expect(page.locator('#note')).toHaveValue('Not lost');expect(await page.evaluate(()=>state.records.length)).toBe(300);
});
test('empty new cycle is explicitly confirmed',async({page})=>{
  await add(page);await download(page);await page.locator('#cycleBtn').click();const bytes=await download(page,'#createCycle');await open(page,bytes);expect(await page.evaluate(()=>state.records)).toEqual([]);
});
const invalidCases=[
  ['wrong header',[{ref:'E5',value:'App Shown (NZD)'}],'E5'],
  ['empty config',[{path:'xl/worksheets/sheet3.xml',ref:'B5',value:''}],'B5'],
  ['future version',[{path:'xl/worksheets/sheet3.xml',ref:'B10',value:'2.99'}],'B10'],
  ['unknown record kind',[{ref:'M6',value:'Unknown'}],'M'],
  ['negative rate',[{ref:'E6',value:-1}],'E'],
  ['text rate',[{ref:'E6',value:'60'}],'E6'],
  ['invalid App',[{ref:'H6',value:'not-number'}],'H6'],
  ['negative App',[{ref:'H6',value:-1}],'H'],
  ['infinite Extra',[{ref:'N6',value:'1e309',type:'n'}],'N6'],
  ['date text',[{ref:'A6',value:'2026-01-10'}],'A6'],
  ['fractional date',[{ref:'A6',value:46032.5}],'A6'],
  ['invalid time',[{ref:'K6',value:1}],'K6'],
  ['negative Lunch',[{ref:'D6',value:-1}],'D'],
  ['invalid Invoice',[{ref:'B6',value:'bad-id'}],'B'],
  ['duplicate Invoice',[{ref:'B7',value:'INV-9001'}],'B7'],
  ['overflow row',[{ref:'B306',value:'INV-9999'}],'306'],
  ['extra column',[{ref:'AA6',value:'Unrecognised data'}],'AA6'],
  ['extra single-letter column',[{ref:'U6',value:'Unrecognised data'}],'U6'],
  ['missing formula',[{ref:'G6',removeFormula:true}],'G6'],
  ['custom formula',[{ref:'G6',value:100,formula:'100'}],'G6'],
  ['invalid snapshot',[{path:'xl/worksheets/sheet3.xml',ref:'B17',value:'{}'}],'B17']
];
for(const [name,operations,location]of invalidCases)test('invalid import is atomic: '+name,async({page})=>{
  await add(page);await add(page,{invoice:'INV-9002'});const bytes=await download(page);
  const invalid=await mutate(page,bytes,operations);await page.locator('#note').fill('Draft retained');
  const before=await page.evaluate(()=>JSON.stringify(state.records));await open(page,invalid,'invalid.xlsx');
  expect(await page.evaluate(()=>JSON.stringify(state.records))).toBe(before);await expect(page.locator('#note')).toHaveValue('Draft retained');expect(observed.get(page).dialogs.at(-1)).toContain(location);
});
test('broken ZIP and shared-formula anchors are rejected atomically',async({page})=>{
  await add(page);const bytes=await download(page), before=await page.evaluate(()=>JSON.stringify(state.records));
  await open(page,Buffer.from('not a ZIP'));expect(await page.evaluate(()=>JSON.stringify(state.records))).toBe(before);
  await open(page,await mutate(page,bytes,[],'broken-shared'));expect(observed.get(page).dialogs.at(-1)).toContain('shared formula');expect(await page.evaluate(()=>JSON.stringify(state.records))).toBe(before);
});
async function loadReportFixture(page,onlyOne=false) {
  await page.evaluate(async onlyOne=>{
    const job=changes=>({kind:'Job',date:'2026-01-10',invoice:'INV-9001',start:'09:00',end:'10:00',lunch:'',rate:'60',app:'',extra:'',note:'Synthetic report',balance:'',...changes});
    const carry=changes=>({kind:'Carryover',date:'2026-01-02',invoice:'INV-9991',start:'',end:'',lunch:'',rate:'',app:'',extra:'',note:'Synthetic carry',balance:'27.35',...changes});
    const records=onlyOne?[job({date:'2026-05-01'})]:[job({invoice:''}),job({invoice:'INV-9002',start:'19:00',end:'20:00',extra:'10',app:'150'}),job({invoice:'INV-9003',app:'0'}),job({invoice:'INV-9004',date:'2026-02-01',app:'120'}),job({invoice:'INV-9005',date:'2026-02-02',app:'120.01'}),carry(),carry({invoice:'INV-9992',date:'2025-12-01',balance:'10'})];
    const blob=await TrackerWorkbook.write(records,{...TrackerCore.DEFAULT_CONFIG});await takeFile(new File([blob],'synthetic-report.xlsx'));
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedReport=text}}});
  },onlyOne);
}
test('monthly view separates new work from all confirmed carryovers',async({page})=>{
  await loadReportFixture(page);const before=await page.evaluate(()=>({records:JSON.stringify(state.records),revision:state.revision}));
  await page.locator('#monthFilter').selectOption('2026-01');
  await expect(page.locator('#mJobs')).toHaveText('3');await expect(page.locator('#mExpected')).toHaveText('$430.00');await expect(page.locator('#mApp')).toHaveText('$150.00');await expect(page.locator('#mDiff')).toHaveText('$160.00');
  await expect(page.locator('#carrySummary')).toContainText('$37.35');await expect(page.locator('#carryoverRows tr')).toHaveCount(2);await expect(page.locator('#kExpected')).toHaveText('$670.00');await expect(page.locator('#kApp')).toHaveText('$390.01');await expect(page.locator('#kDiff')).toHaveText('$159.99');
  await expect(page.locator('#monthFilter')).not.toContainText('2025-12');
  await page.locator('#monthFilter').selectOption('2026-02');await page.locator('#issueFilter').selectOption('difference');
  await expect(page.locator('#mJobs')).toHaveText('2');await expect(page.locator('#mExpected')).toHaveText('$240.00');await expect(page.locator('#rows [data-edit]')).toHaveCount(0);await expect(page.locator('#carryoverRows tr')).toHaveCount(2);
  expect(await page.evaluate(()=>({records:JSON.stringify(state.records),revision:state.revision}))).toEqual(before);
});
test('work issues distinguish pending App from zero and compose with text search',async({page})=>{
  await loadReportFixture(page);await page.locator('#monthFilter').selectOption('2026-01');
  await page.locator('#issueFilter').selectOption('missing_app');await expect(page.locator('#rows [data-edit]')).toHaveCount(1);await expect(page.locator('#rows')).toContainText('App 待填');
  await page.locator('#search').fill('INV-9003');await expect(page.locator('#rows [data-edit]')).toHaveCount(0);
  await page.locator('#issueFilter').selectOption('difference');await expect(page.locator('#rows [data-edit]')).toHaveCount(1);await expect(page.locator('#rows')).toContainText('$120.00');
  await page.locator('#resetFilters').click();await expect(page.locator('#rows [data-edit]')).toHaveCount(5);await expect(page.locator('#mJobs')).toHaveText('5');
});
test('Tim default, visible and all-work scopes match their stated boundaries',async({page})=>{
  await loadReportFixture(page);await page.locator('#monthFilter').selectOption('2026-01');await page.locator('#search').fill('no-match');await page.locator('#issueFilter').selectOption('missing_app');
  await page.locator('#copyBtn').click();let text=await page.evaluate(()=>window.copiedReport);
  expect(text).toContain('Listed jobs: 3 | Expected incl. Extra: 430.00');expect(text).toContain('Pending');expect(text).toContain('Confirmed carryover total: 37.35');expect(text).not.toContain('INV-9004');
  expect(text.split('CONFIRMED CARRYOVERS')[0]).not.toContain('INV-9991');
  await page.locator('#copyScope').selectOption('visible');await page.locator('#issueFilter').selectOption('all');await page.locator('#search').fill('INV-9002');await page.locator('#copyBtn').click();text=await page.evaluate(()=>window.copiedReport);expect(text).toContain('Listed jobs: 1');expect(text).not.toContain('INV-9003');expect(text).not.toContain('INV-9991');
  await page.locator('#copyScope').selectOption('all');await page.locator('#copyBtn').click();expect(await page.evaluate(()=>window.copiedReport)).toContain('Listed jobs: 3');
  await page.locator('#copyScope').selectOption('visible');await page.locator('#search').fill('INV-9991');await page.locator('#copyBtn').click();text=await page.evaluate(()=>window.copiedReport);expect(text).toContain('Listed jobs: 0');expect(text).toContain('Confirmed carryover total: 27.35');
});
test('filtering never drops records from saved XLSX and imports reset view scope',async({page})=>{
  await loadReportFixture(page);const before=await page.evaluate(()=>state.records.map(({uid,...record})=>record));
  await page.locator('#monthFilter').selectOption('2026-01');await page.locator('#issueFilter').selectOption('missing_app');
  await expect(page.locator('#rows [data-edit]')).toHaveCount(1);
  const bytes=await download(page);await open(page,bytes);
  expect(await page.evaluate(()=>state.records.map(({uid,...record})=>record))).toEqual(before);await expect(page.locator('#monthFilter')).toHaveValue('');await expect(page.locator('#issueFilter')).toHaveValue('all');await expect(page.locator('#rows [data-edit]')).toHaveCount(5);
});
test('editing the last job out of a selected month keeps that empty month selected',async({page})=>{
  await loadReportFixture(page,true);await page.locator('#monthFilter').selectOption('2026-05');await page.locator('[data-edit]').click();await page.locator('#date').fill('2026-06-01');await page.locator('#submitJob').click();
  await expect(page.locator('#monthFilter')).toHaveValue('2026-05');await expect(page.locator('#monthFilter')).toContainText('无工作');await expect(page.locator('#mJobs')).toHaveText('0');await expect(page.locator('#rows [data-edit]')).toHaveCount(0);
  expect(await page.evaluate(()=>state.records[0].date)).toBe('2026-06-01');await page.locator('#resetFilters').click();await expect(page.locator('#rows [data-edit]')).toHaveCount(1);
});
test('Tim reports identify unsaved data and the first confirmed export source',async({page})=>{
  await add(page);await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedReport=text}}}));
  await page.locator('#copyBtn').click();expect(await page.evaluate(()=>window.copiedReport)).toContain('not yet saved');
  await download(page);await page.locator('#copyBtn').click();let text=await page.evaluate(()=>window.copiedReport);expect(text).toContain('Source: '+await page.evaluate(()=>state.fileName));expect(text).not.toContain('not yet saved');
  await page.locator('[data-edit]').click();await page.locator('#note').fill('Unsubmitted note');await page.locator('#copyBtn').click();await expect(page.locator('#formError')).toContainText('尚未提交');expect(await page.evaluate(()=>window.copiedReport)).toBe(text);
  await page.locator('#submitJob').click();await page.locator('#copyBtn').click();text=await page.evaluate(()=>window.copiedReport);expect(text).toContain('Unsubmitted note');expect(text).toContain('Includes changes not yet saved or confirmed');
});
test('copying falls back locally when clipboard access is unavailable',async({page})=>{
  await add(page);await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});window.prompt=(message,value)=>{window.promptReport=value;return null}});
  await page.locator('#copyBtn').click();expect(await page.evaluate(()=>window.promptReport)).toContain('INV-9001');
});
test('all-pending monthly App stays unavailable rather than zero',async({page})=>{
  await loadReportFixture(page,true);await page.locator('#monthFilter').selectOption('2026-05');await expect(page.locator('#mApp')).toHaveText('—');await expect(page.locator('#mDiff')).toHaveText('—');
  await expect(page.locator('#kExpected')).toHaveText('$120.00');await expect(page.locator('#kApp')).toHaveText('—');await expect(page.locator('#kDiff')).toHaveText('—');
});
