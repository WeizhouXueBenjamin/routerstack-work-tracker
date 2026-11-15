import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),R=require('../src/reconciliation.js');
const job=changes=>({date:'2026-01-10',invoice:'INV-9001',start:'19:00',end:'20:00',rate:60,app:180,...changes});
const proof={reason:'Synthetic confirmation',evidence:{summary:'Synthetic statement',source:'Synthetic Tim',reference:'synthetic-message-01',confirmedAt:'2026-01-12'}};
const last=(bundle,table)=>bundle.tables[table].at(-1).id;
function fixture(){let b=R.addRecord(R.create(),job());const recordId=last(b,'records');b=R.addBatch(b,{name:'Synthetic settlement'});return {b,recordId,batchId:last(b,'batches')}}
function receipt(b,batchId,amount,date='2026-01-12'){b=R.addPayment(b,{date,amount});const id=last(b,'payments');return {b:R.attachPayment(b,id,batchId,proof),id}}

test('bank receipt registration requires no Invoice, batch or invented allocation',()=>{
  const b=R.addPayment(R.create(),{date:'2026-01-12',amount:'100.01'}),payment=b.tables.payments[0];
  assert.equal(payment.cents,10001);assert.equal(payment.batchId,'');assert.deepEqual(b.tables.allocations,[]);
  assert.equal(R.unallocatedPayments(b)[0].unallocatedCents,10001);
  assert.throws(()=>R.addPayment(b,{date:'2026-01-12',amount:'100.01'}),/同日期同金额/);
  const two=R.addPayment(b,{date:'2026-01-12',amount:'100.01',duplicateConfirmed:true});assert.equal(two.tables.payments.length,2);
});

test('settlement comparison stays unknown until scope and monetary basis are confirmed',()=>{
  let {b,recordId,batchId}=fixture();b=receipt(b,batchId,100).b;
  assert.equal(R.batchSummary(b,batchId).differenceCents,null);
  b=R.setBatchScope(b,batchId,[{recordId,kind:'Theory'}],{...proof,scopeConfirmed:true,basisConfirmed:false});
  assert.equal(R.batchSummary(b,batchId).label,'Basis Unverified');assert.equal(R.batchSummary(b,batchId).expectedCents,null);
  b=R.setBatchScope(b,batchId,[{recordId,kind:'Theory'}],{...proof,scopeConfirmed:true,basisConfirmed:true,actualConfirmed:true});
  assert.equal(R.batchSummary(b,batchId).expectedCents,18000);assert.equal(R.batchSummary(b,batchId).actualCents,10000);assert.equal(R.batchSummary(b,batchId).differenceCents,8000);
  assert.throws(()=>R.closeBatch(b,batchId,proof),/尚未匹配/);assert.equal(b.tables.batches[0].status,'Open');
  assert.deepEqual(b.tables.allocations,[]);
});

test('partial allocations are evidence-backed and bank amounts remain a hard bound',()=>{
  let {b,recordId,batchId}=fixture();let payment;({b,id:payment}=receipt(b,batchId,100));
  assert.throws(()=>R.allocatePayment(b,{paymentId:payment,recordId,amount:60}),/原因或证据/);
  b=R.allocatePayment(b,{paymentId:payment,recordId,amount:60,...proof});const snapshot=JSON.stringify(b);
  assert.equal(R.invoiceSummary(b,recordId).paidCents,6000);assert.equal(R.invoiceSummary(b,recordId).confirmedRemainingCents,null);
  assert.equal(R.invoiceSummary(b,recordId).estimateRemainingCents,12000);
  assert.throws(()=>R.allocatePayment(b,{paymentId:payment,recordId,amount:50,...proof}),/不能超过/);assert.equal(JSON.stringify(b),snapshot);
  assert.throws(()=>R.correctPayment(b,payment,{amount:50,...proof}),/超额分配/);
  assert.throws(()=>R.detachPayment(b,payment,proof),/先撤销/);
  const allocation=last(b,'allocations');b=R.reverseAllocation(b,allocation,proof);
  assert.equal(R.paid(b,recordId),0);assert.equal(b.tables.allocations[0].status,'Reversed');
  assert.ok(b.audit.some(event=>event.type==='ReverseAllocation'));R.validate(b);
});

test('payments exceeding estimate are retained; later confirmed caps surface anomalies',()=>{
  let {b,recordId,batchId}=fixture();let payment;({b,id:payment}=receipt(b,batchId,210));
  b=R.allocatePayment(b,{paymentId:payment,recordId,amount:210,...proof});
  assert.equal(R.paid(b,recordId),21000);assert.ok(R.invoiceSummary(b,recordId).flags.includes('Amount Exceeds Estimate'));
  b=R.confirmAmount(b,{recordId,amount:180,...proof});assert.ok(R.invoiceSummary(b,recordId).flags.includes('Amount Exceeds Confirmed'));
  let extra;({b,id:extra}=receipt(b,batchId,5,'2026-01-13'));
  assert.throws(()=>R.allocatePayment(b,{paymentId:extra,recordId,amount:5,...proof}),/已确认应结金额/);
  assert.equal(b.tables.allocations[0].cents,21000);assert.equal(b.tables.payments[0].cents,21000);
});

test('batch reconciliation is sufficient without per-Invoice payment claims',()=>{
  let {b,recordId,batchId}=fixture();b=R.addRecord(b,job({invoice:'INV-9002',start:'09:00',end:'11:00',app:120}));const second=last(b,'records');
  let payment;({b,id:payment}=receipt(b,batchId,300));
  b=R.addIssue(b,{recordId,...proof});const independent=b.tables.issues.find(row=>row.kind==='Invoice').id;
  b=R.setBatchScope(b,batchId,[{recordId,kind:'Theory'},{recordId:second,kind:'Theory'}],{...proof,scopeConfirmed:true,basisConfirmed:true,actualConfirmed:true});
  b=R.closeBatch(b,batchId,proof);assert.equal(R.batchSummary(b,batchId).label,'Batch Reconciled');
  assert.deepEqual(b.tables.allocations,[]);assert.deepEqual(R.unallocatedPayments(b),[]);
  assert.equal(b.tables.issues.find(row=>row.id===independent).status,'Open');
  assert.equal(R.invoiceSummary(b,recordId).paidCents,0);assert.equal(R.invoiceSummary(b,recordId).confirmedRemainingCents,null);
  b=R.allocatePayment(b,{paymentId:payment,recordId,amount:180,...proof});
  assert.equal(R.batchSummary(b,batchId).actualCents,30000);assert.equal(b.tables.batches[0].status,'Reconciled');
  assert.equal(b.tables.issues.find(row=>row.id===independent).status,'Open');
  b=R.reopenBatch(b,batchId,proof);assert.equal(b.tables.batches[0].status,'ReviewRequired');assert.equal(b.tables.payments.length,1);
});

test('working facts corrected after reconciliation invalidate the comparison, not the payment',()=>{
  let {b,recordId,batchId}=fixture();let payment;({b,id:payment}=receipt(b,batchId,180));
  b=R.setBatchScope(b,batchId,[{recordId,kind:'Theory'}],{...proof,scopeConfirmed:true,basisConfirmed:true,actualConfirmed:true});b=R.closeBatch(b,batchId,proof);
  b=R.allocatePayment(b,{paymentId:payment,recordId,amount:180,...proof});
  b=R.updateRecord(b,recordId,{rate:70});assert.equal(b.tables.batches[0].status,'ReviewRequired');
  assert.equal(R.batchSummary(b,batchId).differenceCents,null);assert.equal(b.tables.scope[0].cents,18000);
  assert.equal(b.tables.allocations[0].cents,18000);assert.equal(b.tables.payments[0].cents,18000);
  assert.equal(R.calculate(b,b.tables.records[0]).diff,30);assert.equal(b.tables.observations.length,1);
});

test('confirmed carry balances only subtract payments after their saved calculation basis',()=>{
  let {b,recordId,batchId}=fixture();let payment;({b,id:payment}=receipt(b,batchId,100));
  b=R.allocatePayment(b,{paymentId:payment,recordId,amount:100,...proof});
  b=R.confirmAmount(b,{recordId,kind:'CarryBalance',amount:80,...proof});assert.equal(R.carryRemaining(b,recordId),8000);
  assert.equal(b.tables.balanceReferences.length,1);assert.equal(b.tables.confirmations[0].paidAtConfirmationCents,10000);
  let later;({b,id:later}=receipt(b,batchId,30,'2026-01-13'));b=R.allocatePayment(b,{paymentId:later,recordId,amount:30,...proof});
  assert.equal(R.carryRemaining(b,recordId),5000);
  b=R.setBatchScope(b,batchId,[{recordId,kind:'Balance'}],{...proof,scopeConfirmed:true,basisConfirmed:true});
  assert.equal(R.batchSummary(b,batchId).referenceCents,8000);
  assert.throws(()=>R.setBatchScope(b,batchId,[{recordId,kind:'Theory'},{recordId,kind:'Balance'}],proof),/重复纳入/);
  R.validate(b);
});

test('scope overlap, repeat batch use and empty-batch disposal cannot invent financial outcomes',()=>{
  let {b,recordId,batchId}=fixture();b=receipt(b,batchId,180).b;
  b=R.setBatchScope(b,batchId,[{recordId,kind:'Theory'}],{...proof,scopeConfirmed:true,basisConfirmed:true});
  b=R.addBatch(b,{name:'Synthetic other'});const other=last(b,'batches');
  assert.throws(()=>R.setBatchScope(b,other,[{recordId,kind:'Theory'}],proof),/另一活动批次/);
  assert.throws(()=>R.closeEmptyBatch(b,batchId,proof),/实际到账/);
  b=R.closeEmptyBatch(b,other,proof);assert.equal(b.tables.batches[1].status,'ClosedExplained');
  assert.equal(b.tables.batches[1].scopeConfirmed,false);assert.equal(R.coveredAtBatchLevel(b,recordId),false);
});

test('confirmed residual continuation links back to the closed comparison without duplicating full theory',()=>{
  let {b,recordId,batchId}=fixture();b=receipt(b,batchId,100).b;
  b=R.setBatchScope(b,batchId,[{recordId,kind:'Theory'}],{...proof,scopeConfirmed:true,basisConfirmed:true,actualConfirmed:true});const originalScope=last(b,'scope');
  b=R.confirmAmount(b,{recordId,kind:'CarryBalance',amount:80,...proof});
  b=R.closeBatch(b,batchId,{...proof,explained:true,reason:'Synthetic residual agreed for next batch; original difference stays in history'});
  assert.equal(R.batchSummary(b,batchId).differenceCents,8000);
  b=R.addBatch(b,{name:'Synthetic continuation'});const next=last(b,'batches');
  assert.throws(()=>R.setBatchScope(b,next,[{recordId,kind:'Theory'}],proof),/重复纳入全额/);
  b=R.setBatchScope(b,next,[{recordId,kind:'Balance'}],{...proof,scopeConfirmed:true,basisConfirmed:true});assert.equal(b.tables.scope.at(-1).sourceScopeId,originalScope);assert.equal(R.batchSummary(b,next).expectedCents,8000);
  const paidNext=receipt(b,next,80,'2026-01-14');b=paidNext.b;
  b=R.setBatchScope(b,next,[{recordId,kind:'Balance'}],{...proof,scopeConfirmed:true,basisConfirmed:true,actualConfirmed:true});b=R.closeBatch(b,next,proof);
  assert.equal(R.carryRemaining(b,recordId),0);assert.equal(R.paid(b,recordId),0);assert.equal(b.tables.confirmations.filter(row=>row.active).length,1);assert.deepEqual(R.unallocatedPayments(b),[]);
});

test('App manual closure is stable until new financial facts; observation metadata edits add no amount rows',()=>{
  let b=R.addRecord(R.create(),job({app:150})),id=last(b,'records'),issue=last(b,'issues');
  b=R.setIssueStatus(b,issue,'Closed',proof);b=R.updateRecord(b,id,{note:'Synthetic note only'});assert.equal(R.get(b,'issues',issue).status,'Closed');
  b=R.updateRecord(b,id,{app:160});assert.equal(R.get(b,'issues',issue).status,'Open');assert.equal(b.tables.issues.filter(row=>row.kind==='App').length,1);
  const observation=b.tables.observations.at(-1),snapshot=R.clone(observation);b=R.reviseObservation(b,observation.id,{source:'Synthetic source',observedAt:'2026-01-12T14:00:00Z',note:'Synthetic correction'});
  assert.equal(b.tables.observations.length,2);assert.equal(b.tables.observations.at(-1).newAmount,snapshot.newAmount);assert.equal(b.tables.observations.at(-1).recordedAt,snapshot.recordedAt);
  assert.throws(()=>R.reviseObservation(b,observation.id,{observedAt:'2026-02-30T14:00:00Z'}),/类型/);
  assert.throws(()=>R.addPayment(b,{date:'2026-01-12',amount:true}),/有限数字/);
});

test('legacy opening and confirmed residuals constrain new allocation without inventing original Invoice totals',()=>{
  let b=R.migrate({version:'3.0',config:{minHours:2,ahStart:18,ahEnd:6,mult:1.5,tolerance:.01,allocation:'Standard first'},records:[{kind:'Carryover',date:'',invoice:'INV-9999',balance:80}]});const recordId=last(b,'records');
  assert.equal(R.invoiceSummary(b,recordId).confirmedPayableCents,null);assert.equal(R.carryRemaining(b,recordId),8000);
  b=R.addBatch(b,{name:'Synthetic opening payment'});const batchId=last(b,'batches');let p;({b,id:p}=receipt(b,batchId,100));
  assert.throws(()=>R.allocatePayment(b,{paymentId:p,recordId,amount:90,...proof}),/已确认历史剩余/);
  b=R.allocatePayment(b,{paymentId:p,recordId,amount:60,...proof});assert.equal(R.carryRemaining(b,recordId),2000);assert.equal(R.invoiceSummary(b,recordId).confirmedPayableCents,null);
  b=R.confirmAmount(b,{recordId,kind:'CarryBalance',amount:10,...proof});assert.throws(()=>R.allocatePayment(b,{paymentId:p,recordId,amount:20,...proof}),/已确认历史剩余/);
});
