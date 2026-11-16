import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const R=createRequire(import.meta.url)('../src/reconciliation.js');
const work={date:'2026-01-10',invoice:'INV-0123',start:'19:00',end:'20:00',rate:60,app:''};
const saved=b=>({...R.clone(b),fileVersionId:R.uuid(),sourceName:'synthetic.xlsx'});
test('schema 4.1 appends exactly two fields; 4.0 needs explicit historical scope decisions',()=>{
  for(const [table,spec]of Object.entries(R.TABLES_V4))assert.deepEqual(Object.keys(R.TABLES[table].fields),[...Object.keys(spec.fields),...(table==='records'?['reminderKinds']:table==='issues'?['amountCents']:[])]);
  let old=R.addRecord(R.create({schemaVersion:'4.0'}),work);const id=old.tables.records[0].id;
  old=R.addIssue(old,{recordId:id,reason:'Synthetic question'});old=R.createCycleDraft(saved(old),{name:'Synthetic historical'});
  const before=R.clone(old);assert.throws(()=>R.upgradeV4(old),/初始提醒范围/);
  const upgraded=R.upgradeV4(old,{legacyScopes:{[id]:R.REMINDER_KINDS}});
  assert.deepEqual(old,before);assert.equal(upgraded.schemaVersion,'4.1');assert.equal(upgraded.calculationVersion,'3.0');
  for(const [table,rows]of Object.entries(old.tables))assert.deepEqual(upgraded.tables[table].map(row=>Object.fromEntries(Object.keys(R.TABLES_V4[table].fields).map(field=>[field,row[field]]))),rows);
  assert.deepEqual(upgraded.audit.slice(0,old.audit.length),old.audit);assert.deepEqual(upgraded.changes.slice(0,old.changes.length),old.changes);
  assert.deepEqual(R.reminderScope(upgraded.tables.records[0]),R.REMINDER_KINDS);assert.equal(upgraded.tables.issues[0].amountCents,'');R.validate(upgraded);
  const background=R.upgradeV4(old,{legacyScopes:{[id]:[]}});assert.deepEqual(R.automaticReminders(background,background.tables.records[0]),[]);
});
test('unknown, zero and signed reference amounts never create confirmed balances',()=>{
  let b=R.addRecord(R.create(),work);const id=b.tables.records[0].id;
  for(const [code,amount]of [['Unknown',''],['Zero',0],['Disputed',-30]])b=R.addIssue(b,{recordId:id,code,amount,reason:'Synthetic unconfirmed question'});
  assert.deepEqual(b.tables.issues.map(row=>row.amountCents),['',0,-3000]);assert.deepEqual(b.tables.confirmations,[]);
  b=R.reviseIssue(b,b.tables.issues[1].id,{amount:'',reason:'Synthetic now unknown'});assert.equal(b.tables.issues[1].amountCents,'');
  b=R.confirmAmount(b,{recordId:id,kind:'CarryBalance',amount:30,reason:'Synthetic explicitly confirmed'});
  const manual=R.clone(b.tables.issues),confirmations=R.clone(b.tables.confirmations);
  b=R.addPayment(b,{date:'2026-01-12',amount:30});b=R.updateRecord(b,id,{app:180});
  assert.deepEqual(b.tables.issues.filter(row=>row.kind==='Invoice'),manual);assert.deepEqual(b.tables.confirmations,confirmations);assert.equal(R.carryRemaining(b,id),3000);
});
test('derived reminders ignore Job scopes and legacy issue Open/Closed states',()=>{
  let b=R.addRecord(R.create(),work);const id=b.tables.records[0].id;
  assert.deepEqual(R.automaticReminders(b,b.tables.records[0]),['missing_app']);
  assert.equal(b.tables.issues.filter(row=>row.kind==='App').length,0);
  b=R.upgradeV4(R.addRecord(R.create({schemaVersion:'4.0'}),{...work,app:150}));const oldId=b.tables.records[0].id,issue=b.tables.issues[0];
  b=R.setIssueStatus(b,issue.id,'Closed',{reason:'Synthetic compatibility history'});assert.deepEqual(R.automaticReminders(b,b.tables.records[0]),['difference']);
  b=R.updateRecord(b,oldId,{app:180});assert.deepEqual(R.automaticReminders(b,b.tables.records[0]),[]);
});

test('historical follow-up detects future categories, corrects App and carries source only once',()=>{
  let b=R.addRecord(R.create(),work);const id=b.tables.records[0].id;
  b=R.addIssue(b,{recordId:id,code:'PaymentQuestion',reason:'Synthetic independent payment question'});b=R.addIssue(b,{recordId:id,code:'InvoiceQuestion',reason:'Synthetic separate question'});
  b=R.confirmAmount(b,{recordId:id,kind:'CarryBalance',amount:30,reason:'Synthetic confirmed'});b=saved(b);const original=R.clone(b);
  let next=R.carryForward(b,{name:'Synthetic next'});assert.deepEqual(b,original);assert.equal(next.tables.records.length,1);assert.deepEqual(R.reminderScope(next.tables.records[0]),R.REMINDER_KINDS);
  const manual=R.clone(next.tables.issues.filter(row=>row.kind==='Invoice')),confirmations=R.clone(next.tables.confirmations);
  for(const [app,kinds] of [[180,[]],[150,['difference']],[180,[]],[140,['difference']],['',['missing_app']]]){
    next=R.updateRecord(next,id,{app});assert.deepEqual(R.automaticReminders(next,next.tables.records[0]),kinds);assert.equal(R.currentRecords(next).length,0);
    assert.deepEqual(next.tables.issues.filter(row=>row.kind==='Invoice'),manual);assert.deepEqual(next.tables.confirmations,confirmations);
  }
  next=R.carryForward(saved(next),{name:'Synthetic third'});assert.deepEqual(next.tables.records.map(row=>row.id),[id]);assert.deepEqual(next.tables.issues.filter(row=>row.kind==='Invoice').map(row=>row.id),manual.map(row=>row.id));assert.equal(R.confirmedCarryTotal(next),3000);
});
test('explicitly excluded difference and empty background scopes survive repeated carry',()=>{
  let b=R.addRecord(R.create(),work);const id=b.tables.records[0].id;
  b=R.addIssue(b,{recordId:id,reason:'Synthetic keep as background'});b=saved(b);
  let next=R.carryForward(b,{name:'Synthetic next',selection:{reminderScopes:{[id]:['missing_invoice','missing_app']}}});
  next=R.updateRecord(next,id,{app:150});assert.deepEqual(R.automaticReminders(next,next.tables.records[0]),[]);assert.equal(R.calculate(next,next.tables.records[0]).diff,30);
  next=R.carryForward(saved(next),{name:'Synthetic third'});assert.deepEqual(R.reminderScope(next.tables.records[0]),['missing_invoice','missing_app']);assert.deepEqual(R.automaticReminders(next,next.tables.records[0]),[]);
  next=R.carryForward(saved(next),{name:'Synthetic background',selection:{reminderScopes:{[id]:[]}}});next=R.updateRecord(next,id,{invoice:'',app:''});
  assert.deepEqual(R.automaticReminders(next,next.tables.records[0]),[]);next=R.carryForward(saved(next),{name:'Synthetic background again'});assert.deepEqual(R.reminderScope(next.tables.records[0]),[]);
  const resumed=R.carryForward(saved(next),{name:'Synthetic explicit follow-up',selection:{reminderScopes:{[id]:['difference']}}});assert.deepEqual(R.reminderScope(resumed.tables.records[0]),['difference']);
});
test('manual exclusion does not resolve the old issue; excluded balances remain historical context',()=>{
  let b=R.addRecord(R.create(),work);const id=b.tables.records[0].id;
  b=R.addIssue(b,{recordId:id,code:'PaymentQuestion',reason:'Synthetic retain'});const retain=b.tables.issues.at(-1).id;b=R.addIssue(b,{recordId:id,code:'OtherQuestion',reason:'Synthetic exclude'});const exclude=b.tables.issues.at(-1).id;
  b=R.confirmAmount(b,{recordId:id,kind:'CarryBalance',amount:30,reason:'Synthetic confirmed'});b=saved(b);
  let next=R.carryForward(b,{name:'Synthetic next',selection:{issueIds:[retain],balanceRecordIds:[]}});
  assert.equal(b.tables.issues.find(row=>row.id===exclude).status,'Open');assert.equal(b.tables.confirmations[0].active,true);
  assert.ok(!next.tables.issues.some(row=>row.id===exclude));assert.equal(next.tables.confirmations[0].cents,3000);assert.equal(next.tables.confirmations[0].active,false);assert.equal(R.carryRemaining(next,id),null);
  next=R.carryForward(saved(next),{name:'Synthetic third'});assert.equal(R.confirmedCarryTotal(next),0);assert.equal(next.tables.records.length,1);assert.equal(R.carryRemaining(next,id),null);
});
test('excluded legacy opening stays known as context without becoming active balance again',()=>{
  let b=R.migrate({version:'3.0',config:createRequire(import.meta.url)('../src/core.js').DEFAULT_CONFIG,records:[{kind:'Carryover',date:'2025-12-01',invoice:'INV-9001',balance:27.35}]});const id=b.tables.records[0].id;
  b=R.addIssue(b,{recordId:id,reason:'Synthetic opening context'});b=saved(b);
  let next=R.carryForward(b,{name:'Synthetic excluded opening',selection:{balanceRecordIds:[]}});assert.equal(next.tables.records[0].openingCents,2735);assert.equal(R.carryRemaining(next,id),null);assert.equal(R.carryRemaining(b,id),2735);
  next=R.carryForward(saved(next),{name:'Synthetic opening again'});assert.equal(R.confirmedCarryTotal(next),0);assert.equal(next.tables.confirmations.length,1);assert.equal(next.tables.confirmations[0].active,false);R.validate(next);
});
