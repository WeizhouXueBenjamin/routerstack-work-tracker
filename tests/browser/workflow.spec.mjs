import {test,expect} from '@playwright/test';
import {add,download,open,url} from './helpers.mjs';
test.beforeEach(async({page})=>{
  page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;window.showOpenFilePicker=undefined});
  await page.goto(url);
});
async function workingFile(page){
  await add(page);
  await page.evaluate(async()=>{
    window.disk=await (await TrackerWorkbook.write(state.bundle)).arrayBuffer();window.writes=0;
    const handle={name:'working.xlsx',id:'working',isSameEntry:async other=>other.id==='working',queryPermission:async()=> 'granted',getFile:async()=>new File([window.disk],'working.xlsx'),createWritable:async()=>({write:async blob=>{window.nextDisk=await blob.arrayBuffer();window.writes++},close:async()=>{window.disk=window.nextDisk},abort:async()=>{}})};
    await takeFile(await handle.getFile(),handle);window.working=handle;
  });
}
test('Save writes current file, Save As moves to a new working file and protects the archive',async({page})=>{
  await workingFile(page);await add(page,{invoice:'INV-9002'});
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(async()=>({writes:window.writes,dirty:state.dirty,count:(await TrackerWorkbook.read(window.disk)).records.length}))).toEqual({writes:1,dirty:false,count:2});
  await page.evaluate(()=>{window.showSaveFilePicker=async()=>({name:'copy.xlsx',id:'copy',isSameEntry:async other=>other.id==='copy',createWritable:async()=>({write:async()=>{},close:async()=>{}})})});
  await page.locator('#saveAsBtn').click();await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(()=>({name:state.fileName,archive:state.archiveHandles.map(h=>h.id)}))).toEqual({name:'copy.xlsx',archive:['working']});
  await page.evaluate(async()=>{await takeFile(await window.working.getFile(),window.working)});
  await add(page,{invoice:'INV-9003'});await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(()=>({writes:window.writes,dirty:state.dirty}))).toEqual({writes:1,dirty:true});
});
test('external Excel modification blocks Save and retains records and form input',async({page})=>{
  await workingFile(page);await add(page,{invoice:'INV-9002'});
  await page.evaluate(()=>{window.disk=new TextEncoder().encode('external change').buffer});
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(()=>({writes:window.writes,dirty:state.dirty,count:state.records.length}))).toEqual({writes:0,dirty:true,count:2});
});
for(const failure of ['permission','missing','write','close'])test('current-file failure preserves data: '+failure,async({page})=>{
  await workingFile(page);await add(page,{invoice:'INV-9002'});
  await page.evaluate(failure=>{
    if(failure==='permission'){window.working.queryPermission=async()=> 'prompt';window.working.requestPermission=async()=> 'denied'}
    if(failure==='missing')window.working.getFile=async()=>{throw Error('file moved')};
    if(['write','close'].includes(failure))window.working.createWritable=async()=>({write:async()=>{if(failure==='write')throw Error('write failed')},close:async()=>{throw Error('close failed')},abort:async()=>{}});
  },failure);
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(()=>({dirty:state.dirty,count:state.records.length,pending:state.pending}))).toEqual({dirty:true,count:2,pending:null});
});
for(const failure of ['denied','missing','storage','cancel'])test('recent file recovery and failure retain drafts: '+failure,async({page})=>{
  await workingFile(page);await page.locator('#note').fill('Keep draft');
  if(failure==='cancel'){page.removeAllListeners('dialog');page.on('dialog',d=>d.dismiss())}
  await page.evaluate(failure=>{
    if(failure==='denied'){window.working.queryPermission=async()=> 'prompt';window.working.requestPermission=async()=> 'denied'}
    if(failure==='missing')window.working.getFile=async()=>{throw Error('moved')};
    if(failure==='storage')window.TrackerRecentFile={read:async()=>{throw Error('storage disabled')},write:async()=>{throw Error('storage disabled')}};
  },failure);
  if(failure==='storage'){await page.evaluate(()=>loadRecentFile());await expect(page.locator('#recentStatus')).toContainText('不可用')}
  else {await page.locator('#recentBtn').click();await page.waitForFunction(()=>!state.busy);await expect(page.locator('#note')).toHaveValue('Keep draft')}
  expect(await page.evaluate(()=>state.records.length)).toBe(1);
});
test('recent reads the actual file and requests permission only after click',async({page})=>{
  await workingFile(page);
  await page.evaluate(async()=>{
    const next=TrackerReconciliation.addRecord(state.bundle,{...state.records[0],invoice:'INV-9002'});window.disk=await(await TrackerWorkbook.write(next)).arrayBuffer();window.requests=0;
    window.working.queryPermission=async()=> 'prompt';window.working.requestPermission=async()=>{window.requests++;return 'granted'};
  });
  expect(await page.evaluate(()=>window.requests)).toBe(0);await page.locator('#recentBtn').click();await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(()=>({requests:window.requests,count:state.records.length}))).toEqual({requests:1,count:2});
});

test('continuous entry retains date and configured rate without leaking job or observation fields',async({page})=>{
  await page.locator('#defaultRateForm').locator('..').locator('summary').click();
  await page.locator('#defaultRate').fill('60');await page.locator('#applyDefaultRate').click();
  await page.locator('#observedAt').locator('..').locator('..').locator('..').locator('summary').click();
  await page.locator('#observedAt').fill('2026-01-11T10:00');await page.locator('#observationSource').fill('Synthetic app');await page.locator('#observationNote').fill('One job only');
  await add(page,{date:'2025-12-03',invoice:'',rate:'70',app:'150',extra:'20',lunch:'0.5'});
  await expect(page.locator('#date')).toHaveValue('2025-12-03');await expect(page.locator('#rate')).toHaveValue('60');await expect(page.locator('#start')).toBeFocused();
  for(const id of ['invoice','start','end','lunch','app','extra','note','observedAt','observationSource','observationNote'])await expect(page.locator('#'+id)).toHaveValue('');
  await page.locator('#start').fill('19:00');await page.locator('#end').fill('20:00');await page.locator('#end').press('Enter');
  expect(await page.evaluate(()=>({count:state.records.length,rates:state.records.map(r=>r.rate),ids:new Set(state.records.map(r=>r.uid)).size,dates:state.records.map(r=>r.date),version:state.bundle.schemaVersion}))).toEqual({count:2,rates:[70,60],ids:2,dates:['2025-12-03','2025-12-03'],version:'4.1'});
  const saved=await download(page);await open(page,saved);await expect(page.locator('#rate')).toHaveValue('60');
});
test('unset rate stays blank; editing returns to the new-entry date and validation retains inputs',async({page})=>{
  await add(page,{date:'2025-12-01',invoice:''});await expect(page.locator('#rate')).toHaveValue('');
  await add(page,{date:'2025-12-02',invoice:''});
  await page.locator('[data-edit]').first().click();await page.locator('#note').fill('Edited first only');await page.locator('#submitJob').click();
  await expect(page.locator('#date')).toHaveValue('2025-12-02');
  expect(await page.evaluate(()=>state.records.map(r=>r.note))).toEqual(['Edited first only','Synthetic 中文 & <test>']);
  await add(page,{invoice:'bad-id',note:'Keep invalid input'});await expect(page.locator('#formError')).toContainText('INV');await expect(page.locator('#note')).toHaveValue('Keep invalid input');
});
test('default updates do not rewrite old work and settings drafts block saving',async({page})=>{
  await add(page);await page.locator('#defaultRateForm').locator('..').locator('summary').click();await page.locator('#defaultRate').fill('72.50');
  await page.locator('#saveBtn').click();await expect(page.locator('#defaultRateError')).toContainText('尚未应用');
  await page.locator('#applyDefaultRate').click();await expect(page.locator('#rate')).toHaveValue('72.5');expect(await page.evaluate(()=>state.records[0].rate)).toBe(60);
  await page.locator('#defaultRate').fill('');await page.locator('#applyDefaultRate').click();await expect(page.locator('#rate')).toHaveValue('');
});
test('Notes newline, IME Enter, repeated Enter and Tab preserve normal keyboard entry',async({page})=>{
  for(const [id,value]of Object.entries({date:'2026-01-10',start:'09:00',end:'10:00',rate:'60'}))await page.locator('#'+id).fill(value);
  await page.locator('#note').fill('First');await page.locator('#note').press('Enter');await page.locator('#note').press('A');await expect(page.locator('#note')).toHaveValue('First\nA');
  await page.locator('#note').dispatchEvent('compositionstart');await page.locator('#invoice').dispatchEvent('keydown',{key:'Enter',isComposing:true});
  await page.evaluate(()=>$('jobForm').dispatchEvent(new Event('submit',{cancelable:true})));expect(await page.evaluate(()=>state.records.length)).toBe(0);
  await page.locator('#note').dispatchEvent('compositionend');await page.locator('#invoice').press('Enter');await page.locator('#start').press('Enter');expect(await page.evaluate(()=>state.records.length)).toBe(1);
  await page.locator('#invoice').focus();await page.keyboard.press('Tab');await expect(page.locator('#start')).toBeFocused();
});

test('historical App corrections keep identity, manual matters, balances and new income independent',async({page})=>{
  await add(page,{invoice:'INV-0123',start:'19:00',end:'20:00'});
  await page.evaluate(()=>{const R=TrackerReconciliation,id=state.bundle.tables.records[0].id;useBundle(R.addIssue(state.bundle,{recordId:id,reason:'Synthetic independent payment issue'}));useBundle(R.confirmAmount(state.bundle,{recordId:id,kind:'CarryBalance',amount:30,reason:'Synthetic explicitly confirmed balance'}));state.revision++;showRows()});
  const old=await download(page);await page.locator('#cycleBtn').click();await page.locator('#cycleName').fill('Synthetic next');const carried=await download(page,'#createCycle');await open(page,carried);
  const before=await page.evaluate(()=>({id:state.bundle.tables.records[0].id,cycle:state.bundle.tables.records[0].originCycleId,confirmations:state.bundle.tables.confirmations,manual:state.bundle.tables.issues.filter(r=>r.kind==='Invoice')}));
  for(const [app,kinds,diff] of [['150',['difference'],30],['180',[],0],['140',['difference'],40],['',['missing_app'],null]]){
    await page.locator('#rAction').selectOption('edit');await page.locator('#rRecord').selectOption(before.id);await page.locator('#rApply').click();await page.locator('#app').fill(app);await page.locator('#submitJob').click();
    expect(await page.evaluate(()=>{const R=TrackerReconciliation,row=state.bundle.tables.records[0];return {kinds:R.detectedReminders(state.bundle,row),diff:R.calculate(state.bundle,row).diff}})).toEqual({kinds,diff});
    expect(await page.evaluate(()=>({id:state.bundle.tables.records[0].id,cycle:state.bundle.tables.records[0].originCycleId,confirmations:state.bundle.tables.confirmations,manual:state.bundle.tables.issues.filter(r=>r.kind==='Invoice')}))).toEqual(before);
    await expect(page.locator('#kJobs')).toHaveText('0');await expect(page.locator('#kExpected')).toHaveText('$0.00');await expect(page.locator('#kApp')).toHaveText('—');
  }
  expect(await page.evaluate(()=>state.bundle.tables.observations.map(o=>[o.oldAmount,o.newAmount]))).toEqual([['',150],[150,180],[180,140],[140,'']]);
  const saved=await download(page);await open(page,saved);expect(await page.evaluate(()=>state.bundle.tables.records[0].id)).toBe(before.id);
  await open(page,old);expect(await page.evaluate(()=>({state:state.bundle.tables.records[0].state,app:state.bundle.tables.records[0].app}))).toEqual({state:'Job',app:''});
});

test('4.0 upgrade requires explicit scope confirmation and preserves every old table and history',async({page})=>{
  const fixture=await page.evaluate(async()=>{const R=TrackerReconciliation;let b=R.addRecord(R.create({schemaVersion:'4.0'}),{date:'2026-01-10',invoice:'INV-0123',start:'19:00',end:'20:00',rate:60,app:150});const id=b.tables.records[0].id;b=R.addIssue(b,{recordId:id,reason:'Synthetic legacy question'});b=R.confirmAmount(b,{recordId:id,kind:'CarryBalance',amount:30,reason:'Synthetic legacy confirmation'});b=R.addPayment(b,{date:'2026-01-12',amount:20});const first=await TrackerWorkbook.write(b);b=(await TrackerWorkbook.read(await first.arrayBuffer())).bundle;b=R.createCycleDraft(b,{name:'Synthetic legacy historical'});const blob=await TrackerWorkbook.write(b);return {bytes:[...new Uint8Array(await blob.arrayBuffer())],tables:b.tables,audit:b.audit,changes:b.changes,id}});
  await open(page,Buffer.from(fixture.bytes),'legacy-v4.xlsx');await expect(page.locator('#saveBtn')).toBeDisabled();await page.locator('#upgradeBtn').click();await page.locator('#reviewConfirm').click();await expect(page.locator('#reviewError')).toContainText('明确确认');
  await page.locator(`[data-upgrade-record="${fixture.id}"][value=difference]`).uncheck();await page.locator('#upgradeScopeConfirm').check();await page.locator('#reviewConfirm').click();
  expect(await page.evaluate(()=>({tables:Object.fromEntries(Object.entries(state.bundle.tables).map(([table,rows])=>[table,rows.map(row=>Object.fromEntries(Object.keys(TrackerReconciliation.TABLES_V4[table].fields).map(key=>[key,row[key]])))])),audit:state.bundle.audit.slice(0,-1),changes:state.bundle.changes.filter(c=>c.eventId!==state.bundle.audit.at(-1).id)}))).toEqual({tables:fixture.tables,audit:fixture.audit,changes:fixture.changes});
  const bytes=await download(page);await open(page,bytes);expect(await page.evaluate(()=>TrackerReconciliation.reminderScope(state.bundle.tables.records[0]))).toEqual(['missing_invoice','missing_app']);
});
test('lightweight reference unknown and zero, confirmed balance and bank receipt stay separate through XLSX',async({page})=>{
  await add(page,{app:'150',start:'19:00',end:'20:00'});const id=await page.evaluate(()=>state.bundle.tables.records[0].id);
  for(const [kind,amount]of [['PaymentQuestion',''],['InvoiceQuestion','0']]){await page.locator('#lRecord').selectOption(id);await page.locator('#lKind').selectOption(kind);await page.locator('#lAmount').fill(amount);await page.locator('#lReason').fill('Synthetic reference only');await page.locator('#lApply').click();await expect(page.locator('#lError')).not.toBeVisible()}
  await expect(page.locator('#lIssues')).toContainText('未知');await expect(page.locator('#lIssues')).toContainText('$0.00');expect(await page.evaluate(()=>state.bundle.tables.confirmations)).toEqual([]);
  await page.locator('#lRecord').selectOption(id);await page.locator('#lKind').selectOption('ConfirmedBalance');await page.locator('#lAmount').fill('30');await page.locator('#lReason').fill('Synthetic manually verified');await page.locator('#lApply').click();await expect(page.locator('#lError')).toContainText('主动勾选');await page.locator('#lConfirmBalance').check();await page.locator('#lApply').click();
  const before=await page.evaluate(()=>({issues:state.bundle.tables.issues.filter(i=>i.kind==='Invoice'),confirmations:state.bundle.tables.confirmations}));
  await page.locator('#rAmount').fill('30');await page.locator('#rBankForm button').first().click();await expect(page.locator('#bankReceivedTotal')).toContainText('$30.00');
  await page.locator('[data-review-edit]').first().click();await page.locator('#app').fill('180');await page.locator('#submitJob').click();await expect(page.locator('#lReminders')).toContainText('没有适用');
  expect(await page.evaluate(()=>({issues:state.bundle.tables.issues.filter(i=>i.kind==='Invoice'),confirmations:state.bundle.tables.confirmations}))).toEqual(before);
  const bytes=await download(page);await open(page,bytes);expect(await page.evaluate(()=>state.bundle.tables.issues.filter(i=>i.kind==='Invoice').map(i=>i.amountCents))).toEqual(['',0]);
});

test('explicit difference exclusion persists through save, reopen and a second selective carry',async({page})=>{
  await add(page,{invoice:'INV-0123',start:'19:00',end:'20:00'});const id=await page.evaluate(()=>state.bundle.tables.records[0].id);
  await page.locator('#lRecord').selectOption(id);await page.locator('#lReason').fill('Synthetic source retained for independent question');await page.locator('#lApply').click();const original=await download(page);
  await page.locator('#cycleBtn').click();for(const kind of ['missing_invoice','missing_app','difference'])await expect(page.locator(`[data-carry-record="${id}"][value="${kind}"]`)).toBeChecked();
  await page.locator(`[data-carry-record="${id}"][value=difference]`).uncheck();await page.locator('#cycleName').fill('Synthetic exclude difference');const carried=await download(page,'#createCycle');
  expect(await page.evaluate(()=>TrackerReconciliation.automaticReminders(state.bundle,state.bundle.tables.records[0]))).toEqual(['missing_app']);await open(page,carried);
  await page.locator('[data-review-edit]').first().click();await page.locator('#app').fill('150');await page.locator('#submitJob').click();await expect(page.locator('#lReminders')).toContainText('没有适用');
  await page.locator('#lightReviewPanel details summary').click();await expect(page.locator('#lHistorical')).toContainText('$30.00');await download(page);await page.locator('#cycleBtn').click();await expect(page.locator(`[data-carry-record="${id}"][value=difference]`)).not.toBeChecked();await page.locator('#cycleName').fill('Synthetic inherited scope');await open(page,await download(page,'#createCycle'));
  expect(await page.evaluate(()=>({ids:state.bundle.tables.records.map(r=>r.id),scope:TrackerReconciliation.reminderScope(state.bundle.tables.records[0])}))).toEqual({ids:[id],scope:['missing_invoice','missing_app']});
  await open(page,original);expect(await page.evaluate(()=>state.bundle.tables.records[0].app)).toBe('');
});
test('background-only source suppresses reminders and balance exclusion needs separate confirmation',async({page})=>{
  await add(page,{invoice:'',app:'150',start:'19:00',end:'20:00'});const id=await page.evaluate(()=>state.bundle.tables.records[0].id);
  await page.evaluate(()=>{const R=TrackerReconciliation,id=state.bundle.tables.records[0].id;useBundle(R.addIssue(state.bundle,{recordId:id,reason:'Synthetic keep source context'}));useBundle(R.confirmAmount(state.bundle,{recordId:id,kind:'CarryBalance',amount:30,reason:'Synthetic confirmed balance'}));state.revision++;showRows()});await download(page);
  await page.locator('#cycleBtn').click();await page.locator(`[data-carry-follow="${id}"]`).uncheck();await page.locator(`[data-carry-balance="${id}"]`).uncheck();await expect(page.locator('#cycleError')).toContainText('不代表已付款或已解决');await page.locator('#cycleName').fill('Synthetic background only');
  page.removeAllListeners('dialog');page.on('dialog',d=>d.dismiss());await page.locator('#createCycle').click();await expect(page.locator('#cycleModal')).toBeVisible();expect(await page.evaluate(()=>state.bundle.tables.confirmations[0].active)).toBe(true);
  page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());const file=await download(page,'#createCycle');await open(page,file);await expect(page.locator('#lReminders')).toContainText('没有适用');await expect(page.locator('#kJobs')).toHaveText('0');
  expect(await page.evaluate(()=>({scope:TrackerReconciliation.reminderScope(state.bundle.tables.records[0]),carry:TrackerReconciliation.confirmedCarryTotal(state.bundle),cents:state.bundle.tables.confirmations[0].cents}))).toEqual({scope:[],carry:0,cents:3000});
  await page.locator('#cycleBtn').click();await expect(page.locator(`[data-carry-follow="${id}"]`)).not.toBeChecked();await page.locator('#cycleName').fill('Synthetic background again');await open(page,await download(page,'#createCycle'));expect(await page.evaluate(()=>TrackerReconciliation.reminderScope(state.bundle.tables.records[0]))).toEqual([]);
});
test('duplicate Invoice across current and historical work is refused without losing inputs',async({page})=>{
  await add(page,{invoice:'INV-0123'});await download(page);await page.locator('#cycleBtn').click();await page.locator('#cycleName').fill('Synthetic historical source');await open(page,await download(page,'#createCycle'));
  await add(page,{invoice:'INV-0123',note:'Keep duplicate input'});await expect(page.locator('#formError')).toContainText('重复');await expect(page.locator('#note')).toHaveValue('Keep duplicate input');expect(await page.evaluate(()=>state.bundle.tables.records.length)).toBe(1);
});

test('schema 4.0 complex tables and relationships survive explicit upgrade and XLSX roundtrip',async({page})=>{
  const result=await page.evaluate(async()=>{
    const R=TrackerReconciliation,W=TrackerWorkbook,proof={reason:'Synthetic verified compatibility source'};
    let b=R.addRecord(R.create({schemaVersion:'4.0'}),{date:'2026-01-10',invoice:'INV-9001',start:'19:00',end:'20:00',rate:60,app:150});const id=b.tables.records[0].id;
    b=R.addRecord(b,{date:'2026-01-11',invoice:'INV-9002',site:'Synthetic pending site'},{pending:true});b=R.addBatch(b,{name:'Synthetic compatibility batch'});const batchId=b.tables.batches[0].id;
    b=R.addPayment(b,{date:'2026-01-12',amount:100});const paymentId=b.tables.payments[0].id;b=R.attachPayment(b,paymentId,batchId,proof);b=R.allocatePayment(b,{paymentId,recordId:id,amount:100,...proof});b=R.confirmAmount(b,{recordId:id,kind:'CarryBalance',amount:80,...proof});
    b=R.setBatchScope(b,batchId,[{recordId:id,kind:'Balance'}],{...proof,scopeConfirmed:true,basisConfirmed:true});b=R.addIssue(b,{recordId:id,...proof});
    b=R.transact(b,'SyntheticLegacyPreset',next=>next.tables.ratePresets.push({id:R.uuid(),name:'Synthetic stored preset',rate:62.5}));
    b=(await W.read(await(await W.write(b)).arrayBuffer())).bundle;b=R.createCycleDraft(b,{name:'Synthetic old historical cycle'});const old=(await W.read(await(await W.write(b)).arrayBuffer())).bundle;
    const legacyScopes=Object.fromEntries(old.tables.records.filter(r=>r.state==='Historical').map(r=>[r.id,R.REMINDER_KINDS]));const upgraded=R.upgradeV4(old,{legacyScopes}),parsed=(await W.read(await(await W.write(upgraded)).arrayBuffer())).bundle;
    const oldFields=Object.fromEntries(Object.entries(parsed.tables).map(([table,rows])=>[table,rows.map(row=>Object.fromEntries(Object.keys(R.TABLES_V4[table].fields).map(field=>[field,row[field]])))]));
    return {expected:old.tables,actual:oldFields,oldAudit:old.audit,newAudit:parsed.audit.slice(0,old.audit.length),oldChanges:old.changes,newChanges:parsed.changes.slice(0,old.changes.length),oldSchema:old.schemaVersion,newSchema:parsed.schemaVersion};
  });
  expect(result.actual).toEqual(result.expected);expect(result.newAudit).toEqual(result.oldAudit);expect(result.newChanges).toEqual(result.oldChanges);expect(result.oldSchema).toBe('4.0');expect(result.newSchema).toBe('4.1');
});

test('external changes during write abort before close and retain a concurrent form draft',async({page})=>{
  await workingFile(page);await add(page,{invoice:'INV-9002'});
  const hash=await page.evaluate(()=>state.sourceHash);
  await page.evaluate(()=>{window.closedWriter=false;window.abortedWriter=false;window.working.createWritable=async()=>({write:async()=>{window.disk=new TextEncoder().encode('Synthetic external edit during write').buffer;document.getElementById('note').value='Keep concurrent unsubmitted draft'},close:async()=>{window.closedWriter=true},abort:async()=>{window.abortedWriter=true}})});
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);
  await expect(page.locator('#note')).toHaveValue('Keep concurrent unsubmitted draft');
  expect(await page.evaluate(()=>({closed:window.closedWriter,aborted:window.abortedWriter,count:state.records.length,dirty:state.dirty,hash:state.sourceHash}))).toEqual({closed:false,aborted:true,count:2,dirty:true,hash});
});
