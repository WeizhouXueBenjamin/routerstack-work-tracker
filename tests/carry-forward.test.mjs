import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const R=createRequire(import.meta.url)('../src/reconciliation.js');
const proof={reason:'Synthetic verified evidence'};
const job=invoice=>({date:'2026-01-10',invoice,start:'19:00',end:'20:00',rate:60,app:180});
const last=(b,t)=>b.tables[t].at(-1).id;
function saved(b){b=R.clone(b);b.fileVersionId=R.uuid();b.sourceName='synthetic.xlsx';return b}
function settled(b,recordId){b=R.addBatch(b,{name:'Synthetic verified batch'});const batch=last(b,'batches');b=R.addPayment(b,{date:'2026-01-12',amount:180,duplicateConfirmed:true});b=R.attachPayment(b,last(b,'payments'),batch,proof);b=R.setBatchScope(b,batch,[{recordId,kind:'Theory'}],{...proof,scopeConfirmed:true,basisConfirmed:true,actualConfirmed:true});return R.closeBatch(b,batch,proof)}

test('schema 4.0 compatibility retains the original unresolved graph',()=>{
  let b=R.addRecord(R.create({schemaVersion:'4.0'}),job('INV-9001'));const done=last(b,'records');b=settled(b,done);
  b=R.addRecord(b,job('INV-9002'));const unpaid=last(b,'records');
  b=R.addRecord(b,{invoice:'INV-9003',note:'Synthetic unknown hours'},{pending:true});const pending=last(b,'records');
  b=R.addPayment(b,{date:'2026-01-15',amount:12});const bank=last(b,'payments');b=saved(b);
  const original=JSON.stringify(b),plan=R.buildCarryForwardPlan(b),next=R.carryForward(b,{name:'Synthetic next'});
  assert.equal(JSON.stringify(b),original);assert.equal(plan.excludedRecords,1);assert.equal(plan.recordCount,2);
  assert.equal(next.fileVersionId,'');assert.equal(next.parentFileVersionId,b.fileVersionId);assert.throws(()=>R.carryForward(next,{name:'Not actually saved'}),/保存/);
  assert.deepEqual(next.tables.records.map(row=>row.id),[unpaid,pending]);assert.equal(next.tables.records[0].state,'Historical');assert.equal(next.tables.records[1].state,'Pending');
  assert.equal(R.currentRecords(next).length,0);assert.deepEqual(next.tables.payments.map(row=>row.id),[bank]);assert.deepEqual(next.tables.batches,[]);
  assert.ok(!next.changes.some(row=>row.recordId===done));R.validate(next);
  const twice=R.carryForward(saved(next),{name:'Synthetic third'});assert.deepEqual(twice.tables.records,next.tables.records);assert.equal(twice.tables.payments.length,1);R.validate(twice);
});

test('independent disputes retain aggregate reconciled context without creating unallocated bank or Paid',()=>{
  let b=R.addRecord(R.create(),job('INV-9010'));const id=last(b,'records');b=settled(b,id);b=R.addIssue(b,{recordId:id,...proof});const issue=last(b,'issues');
  const next=R.carryForward(saved(b),{name:'Synthetic next'});
  assert.equal(next.tables.records[0].id,id);assert.ok(next.tables.issues.some(row=>row.id===issue && row.status==='Open'));
  assert.equal(next.tables.batches[0].status,'Reconciled');assert.equal(next.tables.payments[0].cents,18000);assert.deepEqual(R.unallocatedPayments(next),[]);assert.equal(R.paid(next,id),0);R.validate(next);
});

test('partial payment balance and its original evidence survive two cycles without repeated subtraction',()=>{
  let b=R.addRecord(R.create(),job('INV-9020'));const id=last(b,'records');b=R.addBatch(b,{name:'Synthetic partial'});const batch=last(b,'batches');
  b=R.addPayment(b,{date:'2026-01-12',amount:100});const payment=last(b,'payments');b=R.attachPayment(b,payment,batch,proof);b=R.allocatePayment(b,{paymentId:payment,recordId:id,amount:100,...proof});
  b=R.confirmAmount(b,{recordId:id,kind:'CarryBalance',amount:80,...proof});
  const original=JSON.stringify(b);let next=R.carryForward(saved(b),{name:'Synthetic next'});next=R.carryForward(saved(next),{name:'Synthetic third'});
  assert.equal(JSON.stringify(b),original);assert.equal(R.carryRemaining(next,id),8000);assert.equal(R.paid(next,id),10000);assert.equal(next.tables.balanceReferences.length,1);assert.equal(next.tables.payments.length,1);assert.equal(next.tables.allocations.length,1);
  assert.deepEqual(next.audit.slice(0,b.audit.length).map(row=>[row.id,row.originFileId,row.originSequence]),b.audit.map(row=>[row.id,row.originFileId,row.originSequence]));R.validate(next);
});

test('aggregate verified balance closure stops repeat carry but does not create Invoice allocations',()=>{
  let b=R.addRecord(R.create(),job('INV-9030'));const id=last(b,'records');b=R.confirmAmount(b,{recordId:id,kind:'CarryBalance',amount:80,...proof});b=R.addBatch(b,{name:'Synthetic balance'});const batch=last(b,'batches');
  b=R.addPayment(b,{date:'2026-01-12',amount:80});b=R.attachPayment(b,last(b,'payments'),batch,proof);
  b=R.setBatchScope(b,batch,[{recordId:id,kind:'Balance'}],{...proof,scopeConfirmed:true,basisConfirmed:true,actualConfirmed:true});b=R.closeBatch(b,batch,proof);
  assert.equal(R.carryRemaining(b,id),0);assert.equal(R.confirmedCarryTotal(b),0);assert.equal(R.paid(b,id),0);assert.equal(R.buildCarryForwardPlan(b).recordCount,0);
  const reopened=R.reopenBatch(b,batch,proof);assert.equal(R.carryRemaining(reopened,id),8000);assert.equal(R.buildCarryForwardPlan(reopened).recordCount,1);
});

test('invalid structures block carry while real business uncertainty and negative residuals are retained',()=>{
  let b=R.addRecord(R.create(),job('INV-9040'));const id=last(b,'records');b=R.addBatch(b,{name:'Synthetic unknown scope'});const batch=last(b,'batches');b=R.addPayment(b,{date:'2026-01-12',amount:200});const p=last(b,'payments');b=R.attachPayment(b,p,batch,proof);b=R.allocatePayment(b,{paymentId:p,recordId:id,amount:200,...proof});b=R.confirmAmount(b,{recordId:id,amount:180,...proof});
  const next=R.carryForward(saved(b),{name:'Synthetic next'});assert.equal(R.invoiceSummary(next,id).paidCents,20000);assert.ok(R.invoiceSummary(next,id).flags.includes('Amount Exceeds Confirmed'));assert.equal(R.batchSummary(next,batch).expectedCents,null);
  const bad=R.clone(b);bad.tables.allocations[0].paymentId=R.uuid();assert.throws(()=>R.carryForward(saved(bad),{name:'Synthetic bad'}),/缺少.*关联/);
});

test('current pending completion uses the confirmed current rules and freezes them when becoming historical',()=>{
  let b=R.addRecord(R.create(),{date:'2026-01-10',invoice:'INV-9050'},{pending:true});const id=last(b,'records'),before=R.config(b);
  b=R.acceptExternalChanges(b,[{kind:'Rules',before,after:{...before,ahEnd:7}}]);
  b=R.updateRecord(b,id,{start:'06:00',end:'07:00',rate:60,app:180},{promote:true});assert.equal(R.get(b,'records',id).ahEnd,7);assert.equal(R.calculate(b,R.get(b,'records',id)).total,180);
  const next=R.carryForward(saved(b),{name:'Synthetic historical',selection:{reminderScopes:{[id]:R.REMINDER_KINDS}}});assert.equal(R.get(next,'records',id).ahEnd,7);assert.equal(R.calculate(next,R.get(next,'records',id)).total,180);
});
