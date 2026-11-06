import {test,expect} from '@playwright/test';
import {add,download,open,legacy,mutate,url} from './helpers.mjs';
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
  await open(page,carry,'carry.xlsx');await expect(page.locator('#kJobs')).toHaveText('0');await expect(page.locator('#kExpected')).toHaveText('$27.35');
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
for(const failure of ['cancel','write','close','original'])test('save failure preserves state: '+failure,async({page})=>{
  await add(page);
  await page.evaluate(failure=>{
    window.showSaveFilePicker=async()=>{
      if(failure==='cancel')throw new DOMException('Cancelled','AbortError');
      return {name:failure==='original'?state.fileName:'synthetic-new.xlsx',createWritable:async()=>({write:async()=>{if(failure==='write')throw Error('Synthetic write failure')},close:async()=>{if(failure==='close')throw Error('Synthetic close failure')},abort:async()=>{}})};
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
