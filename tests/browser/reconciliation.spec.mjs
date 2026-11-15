import {test,expect} from '@playwright/test';
import {add,download,open,url} from './helpers.mjs';
const seen=new WeakMap();
test.beforeEach(async({page})=>{const observed={errors:[],remote:[]};seen.set(page,observed);page.on('pageerror',e=>observed.errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))observed.remote.push(r.url())});page.on('dialog',d=>d.accept());await page.addInitScript(()=>{window.showSaveFilePicker=undefined;window.showOpenFilePicker=undefined});await page.goto(url)});
test.afterEach(async({page})=>{expect(seen.get(page)).toEqual({errors:[],remote:[]})});
async function operation(page,action,values={}){await page.locator('#rAction').selectOption(action);for(const [id,value] of Object.entries(values))await page.locator('#'+id)[id==='rBatch'||id==='rPayment'||id==='rRecord'||id==='rIssue'||id==='rAllocation'||id==='rObservation'?'selectOption':'fill'](value);if(await page.locator('#rProofGroup').isVisible())await page.locator('#rReason').fill('Synthetic verified statement');await page.locator('#rApply').click();await expect(page.locator('#rError')).not.toBeVisible()}
async function bank(page,amount,date='2026-01-12'){await page.locator('#rDate').fill(date);await page.locator('#rAmount').fill(amount);await page.locator('#rBankForm button').first().click();await expect(page.locator('#rError')).not.toBeVisible();return page.evaluate(()=>state.bundle.tables.payments.at(-1).id)}
async function batch(page){await operation(page,'batch',{rName:'Synthetic batch'});return page.evaluate(()=>state.bundle.tables.batches.at(-1).id)}
async function scope(page,batchId,recordId,kind='Theory'){await page.locator('#rBatch').selectOption(batchId);await page.locator('#rAction').selectOption('scope');await page.locator(`[data-scope-record="${recordId}"]`).check();await page.locator(`[data-scope-kind="${recordId}"]`).selectOption(kind);for(const id of ['rScopeConfirmed','rBasisConfirmed','rActualConfirmed'])await page.locator('#'+id).check();await page.locator('#rReason').fill('Synthetic scope, basis and bank verified');await page.locator('#rApply').click();await expect(page.locator('#rError')).not.toBeVisible()}

test('bank-only evidence, unknown basis and partial payments persist through two real UI cycles',async({page})=>{
  await add(page,{start:'19:00',end:'20:00',app:'150'});const record=await page.evaluate(()=>state.bundle.tables.records[0].id);
  const payment=await bank(page,'100');expect(await page.evaluate(()=>state.bundle.tables.payments[0].batchId)).toBe('');await expect(page.locator('#rBatchSummary')).toContainText('不计算');
  const group=await batch(page);await operation(page,'attach',{rPayment:payment,rBatch:group});await operation(page,'allocate',{rPayment:payment,rRecord:record,rValue:'100'});
  await expect(page.locator('#rBatchSummary')).toContainText('Scope Unverified');expect(await page.evaluate(()=>TrackerReconciliation.batchSummary(state.bundle,state.bundle.tables.batches[0].id).differenceCents)).toBe(null);
  await operation(page,'carry',{rRecord:record,rValue:'80'});const saved=await download(page);await open(page,saved);
  for(const name of ['Synthetic next','Synthetic third']){const original=await page.evaluate(()=>JSON.stringify(state.bundle.tables));await page.locator('#cycleBtn').click();await expect(page.locator('#carryRows input[type=checkbox]')).toHaveCount(0);await page.locator('#cycleName').fill(name);const bytes=await download(page,'#createCycle');expect(await page.evaluate(()=>JSON.stringify(state.bundle.tables))).toBe(original);await open(page,bytes);await expect(page.locator('#kJobs')).toHaveText('0');await expect(page.locator('#kExpected')).toHaveText('$0.00');await expect(page.locator('#carrySummary')).toContainText('$80.00')}
  expect(await page.evaluate(()=>({record:state.bundle.tables.records[0].id,bank:state.bundle.tables.payments.length,paid:TrackerReconciliation.paid(state.bundle,state.bundle.tables.records[0].id),allocations:state.bundle.tables.allocations.length,observations:state.bundle.tables.observations.length}))).toEqual({record,bank:1,paid:10000,allocations:1,observations:1});
});

test('aggregate reconciliation needs no Invoice allocation and preserves independent disputes',async({page})=>{
  await add(page,{start:'19:00',end:'20:00',app:'180'});const id=await page.evaluate(()=>state.bundle.tables.records[0].id),p=await bank(page,'180'),b=await batch(page);
  await operation(page,'attach',{rPayment:p,rBatch:b});await operation(page,'issue',{rRecord:id});await scope(page,b,id);await operation(page,'close');await expect(page.locator('#rBatchSummary')).toContainText('Batch Reconciled');
  expect(await page.evaluate(()=>({paid:TrackerReconciliation.paid(state.bundle,state.bundle.tables.records[0].id),unallocated:TrackerReconciliation.unallocatedPayments(state.bundle).length,issues:state.bundle.tables.issues.filter(row=>row.kind==='Invoice'&&row.status==='Open').length}))).toEqual({paid:0,unallocated:0,issues:1});
  await download(page);await page.locator('#cycleBtn').click();await page.locator('#cycleName').fill('Synthetic unresolved dispute');const bytes=await download(page,'#createCycle');await open(page,bytes);
  expect(await page.evaluate(()=>TrackerReconciliation.unallocatedPayments(state.bundle))).toEqual([]);expect(await page.evaluate(()=>state.bundle.tables.payments.length)).toBe(1);
  await operation(page,'allocate',{rPayment:p,rRecord:id,rValue:'180'});expect(await page.evaluate(()=>TrackerReconciliation.batchSummary(state.bundle,state.bundle.tables.batches[0].id).actualCents)).toBe(18000);
  await operation(page,'reopen',{rBatch:b});await expect(page.locator('#rBatchSummary')).toContainText('Scope Unverified');
});

test('App correction resolves only its own issue, observation revisions preserve original snapshots',async({page})=>{
  await add(page,{start:'19:00',end:'20:00',app:'150'});const id=await page.evaluate(()=>state.bundle.tables.records[0].id);await operation(page,'issue',{rRecord:id});
  await page.locator('[data-edit]').click();await page.locator('#app').fill('180');await page.locator('#jobForm details summary').click();await page.locator('#observedAt').fill('2026-01-12T14:30');await page.locator('#observationSource').fill('Synthetic App check');await page.locator('#submitJob').click();
  await page.evaluate(()=>{const R=TrackerReconciliation;useBundle(R.reviseObservation(state.bundle,state.bundle.tables.observations.at(-1).id,{observedAt:'2026-01-12T01:30:42.123Z'}));state.revision++;showRows()});
  const before=await page.evaluate(()=>state.bundle.tables.observations.at(-1));expect(before.differenceCents).toBe(0);expect(before.source).toBe('Synthetic App check');
  expect(await page.evaluate(()=>state.bundle.tables.issues.filter(row=>row.kind==='App')[0].status)).toBe('Resolved');expect(await page.evaluate(()=>state.bundle.tables.issues.filter(row=>row.kind==='Invoice')[0].status)).toBe('Open');
  await operation(page,'observation',{rObservation:before.id,rObservationSource:'Synthetic revised source',rObservationNote:'Synthetic clarification'});
  const after=await page.evaluate(()=>state.bundle.tables.observations.at(-1));expect(after.recordedAt).toBe(before.recordedAt);expect(after.observedAt).toBe(before.observedAt);expect(after.newAmount).toBe(180);expect(after.expectedCents).toBe(18000);expect(after.source).toBe('Synthetic revised source');expect(await page.evaluate(()=>state.bundle.tables.observations.length)).toBe(2);
  await open(page,await download(page));expect(await page.evaluate(()=>state.bundle.tables.observations.at(-1))).toEqual(after);
});

test('reconciliation drafts protect save, file replacement and beforeunload',async({page})=>{
  const bytes=await download(page);await page.locator('#rAmount').fill('25');await page.locator('#saveBtn').click();await expect(page.locator('#rError')).toContainText('未提交');
  expect(await page.evaluate(()=>{const e=new Event('beforeunload',{cancelable:true});window.dispatchEvent(e);return e.defaultPrevented})).toBe(true);
  page.removeAllListeners('dialog');page.on('dialog',d=>d.dismiss());await open(page,bytes,'other.xlsx');await expect(page.locator('#rAmount')).toHaveValue('25');await page.locator('#rClearBank').click();await expect(page.locator('#rAmount')).toHaveValue('25');
  page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());await page.locator('#rClearBank').click();await expect(page.locator('#rAmount')).toHaveValue('');
});

test('over allocation is rejected atomically and the operation draft stays available',async({page})=>{
  await add(page);const id=await page.evaluate(()=>state.bundle.tables.records[0].id),p=await bank(page,'100'),b=await batch(page);await operation(page,'attach',{rPayment:p,rBatch:b});
  await page.locator('#rAction').selectOption('allocate');await page.locator('#rPayment').selectOption(p);await page.locator('#rRecord').selectOption(id);await page.locator('#rValue').fill('101');await page.locator('#rReason').fill('Synthetic');const before=await page.evaluate(()=>JSON.stringify(state.bundle));await page.locator('#rApply').click();await expect(page.locator('#rError')).toContainText('不能超过');await expect(page.locator('#rValue')).toHaveValue('101');expect(await page.evaluate(()=>JSON.stringify(state.bundle))).toBe(before);
});

test('linked raw corrections preview impact and cancellation preserves the edit draft',async({page})=>{
  await add(page,{start:'19:00',end:'20:00',app:'180'});const id=await page.evaluate(()=>state.bundle.tables.records[0].id),p=await bank(page,'180'),b=await batch(page);await operation(page,'attach',{rPayment:p,rBatch:b});await scope(page,b,id);await operation(page,'close');await page.locator('[data-edit]').click();await page.locator('#rate').fill('70');
  page.removeAllListeners('dialog');page.on('dialog',d=>d.dismiss());await page.locator('#submitJob').click();expect(await page.evaluate(()=>state.bundle.tables.records[0].rate)).toBe(60);await expect(page.locator('#rate')).toHaveValue('70');
  page.removeAllListeners('dialog');page.on('dialog',d=>d.accept());await page.locator('#submitJob').click();expect(await page.evaluate(()=>state.bundle.tables.batches[0].status)).toBe('ReviewRequired');expect(await page.evaluate(()=>state.bundle.tables.scope[0].cents)).toBe(18000);expect(await page.evaluate(()=>state.bundle.tables.payments[0].cents)).toBe(18000);
});

test('history and old-cycle pending completion stay outside new-cycle income',async({page})=>{
  await page.evaluate(()=>{useBundle(TrackerReconciliation.addRecord(state.bundle,{date:'2026-01-10',invoice:'INV-9050',note:'Synthetic pending'},{pending:true}));state.revision++;showRows()});await download(page);await page.locator('#cycleBtn').click();await page.locator('#cycleName').fill('Synthetic next');await open(page,await download(page,'#createCycle'));const id=await page.evaluate(()=>state.bundle.tables.records[0].id);
  await operation(page,'edit',{rRecord:id});await page.locator('#start').fill('19:00');await page.locator('#end').fill('20:00');await page.locator('#rate').fill('60');await page.locator('#submitJob').click();expect(await page.evaluate(()=>state.bundle.tables.records[0].state)).toBe('Historical');expect(await page.evaluate(()=>state.bundle.tables.records[0].id)).toBe(id);await expect(page.locator('#kExpected')).toHaveText('$0.00');
});

test('mobile reconciliation keeps document width within viewport',async({page})=>{await page.setViewportSize({width:390,height:844});await add(page);await bank(page,'123.45');await batch(page);await page.locator('#rAction').selectOption('scope');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)});

test('clearing the action selection cannot hide entered financial drafts',async({page})=>{
  await page.locator('#rAction').selectOption('batch');await page.locator('#rName').fill('Synthetic unsubmitted batch');await page.locator('#rAction').selectOption('');await page.locator('#saveBtn').click();await expect(page.locator('#rError')).toContainText('未提交');expect(await page.evaluate(()=>hasUnsaved())).toBe(true);await page.locator('#rAction').selectOption('batch');await expect(page.locator('#rName')).toHaveValue('Synthetic unsubmitted batch');
});

test('evidence revision and cancelled evidence switching preserve audit and unsubmitted text',async({page})=>{
  await add(page);const id=await page.evaluate(()=>state.bundle.tables.records[0].id);await operation(page,'issue',{rRecord:id});const evidence=await page.evaluate(()=>state.bundle.tables.evidence[0].id);
  await page.locator('#rAction').selectOption('evidence');await page.locator('#rEvidence').selectOption(evidence);await page.locator('#rEvidenceSummary').fill('Synthetic revised evidence');await page.locator('#rEvidenceSource').fill('Synthetic confirmed source');await page.locator('#rApply').click();await expect(page.locator('#rError')).not.toBeVisible();expect(await page.evaluate(()=>state.bundle.tables.evidence.length)).toBe(1);expect(await page.evaluate(()=>state.bundle.audit.at(-1).type)).toBe('ReviseEvidence');
  await page.locator('#rAction').selectOption('evidence');await page.locator('#rEvidence').selectOption(evidence);await page.locator('#rReason').fill('Synthetic unsubmitted reason');page.removeAllListeners('dialog');page.on('dialog',d=>d.dismiss());await page.locator('#rEvidence').selectOption('');await expect(page.locator('#rEvidence')).toHaveValue(evidence);await expect(page.locator('#rReason')).toHaveValue('Synthetic unsubmitted reason');
});
