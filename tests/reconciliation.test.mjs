import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),R=require('../src/reconciliation.js'),C=require('../src/core.js');
const at='2026-01-10T09:00:00.000Z';
const job=changes=>({date:'2026-01-10',invoice:'INV-9001',start:'19:00',end:'20:00',lunch:'',rate:'60',app:'150',extra:'',note:'Synthetic 中文',site:'Synthetic site',...changes});

test('schema 4 business state is immutable, replayable and keeps actual rate per work',()=>{
  const blank=R.create({at}),before=JSON.stringify(blank);
  const one=R.addRecord(blank,job(),{at}),record=one.tables.records[0];
  assert.equal(JSON.stringify(blank),before);assert.match(record.id,/^[a-f0-9-]{36}$/);
  assert.equal(record.rate,60);assert.equal(record.app,150);assert.equal(R.calculate(one,record).total,180);
  assert.deepEqual(R.replay(one),one.tables);R.validate(one);
  assert.throws(()=>R.addRecord(one,job(),{at}),/重复 Invoice/);
  assert.equal(one.tables.records.length,1);
});

test('App 150 to 180 preserves the original 30 and never creates bank payments',()=>{
  const one=R.addRecord(R.create({at,schemaVersion:'4.0'}),job(),{at}),id=one.tables.records[0].id;
  const fixed=R.updateRecord(one,id,{app:'180'},{at:'2026-01-11T09:00:00.000Z'});
  assert.equal(fixed.tables.observations.length,2);
  assert.equal(fixed.tables.observations[0].differenceCents,3000);
  assert.equal(fixed.tables.observations[1].oldAmount,150);
  assert.equal(fixed.tables.observations[1].newAmount,180);
  assert.equal(fixed.tables.observations[1].differenceCents,0);
  assert.equal(fixed.tables.issues[0].status,'Resolved');
  assert.deepEqual(fixed.tables.payments,[]);assert.deepEqual(fixed.tables.allocations,[]);
  const same=R.updateRecord(fixed,id,{app:'180'},{at:'2026-01-12T09:00:00.000Z'});
  assert.equal(same.audit.length,fixed.audit.length);assert.equal(same.tables.observations.length,2);
  const unknown=R.updateRecord(fixed,id,{app:''},{at:'2026-01-12T09:00:00.000Z'});
  assert.equal(R.calculate(unknown,unknown.tables.records[0]).diff,null);
  assert.equal(unknown.tables.observations.at(-1).kind,'Clear');assert.equal(unknown.tables.issues[0].status,'Open');
  const zero=R.updateRecord(unknown,id,{app:0});assert.equal(R.calculate(zero,zero.tables.records[0]).diff,180);
});

test('incomplete records survive as unknown and promote using the same identity',()=>{
  const draft=R.addRecord(R.create({at}),job({start:'',end:'',app:''}),{pending:true,at});
  const original=draft.tables.records[0];assert.equal(R.calculate(draft,original),null);
  assert.equal(R.currentRecords(draft).length,0);assert.equal(draft.tables.observations.length,0);
  assert.throws(()=>R.addRecord(draft,job(),{at}),/重复 Invoice/);
  const done=R.updateRecord(draft,original.id,{start:'19:00',end:'20:00'},{promote:true,at:'2026-01-12T09:00:00.000Z'});
  assert.equal(done.tables.records.length,1);assert.equal(done.tables.records[0].id,original.id);
  assert.equal(done.tables.records[0].createdAt,at);assert.equal(done.tables.records[0].state,'Job');
  assert.equal(R.calculate(done,done.tables.records[0]).total,180);
});

test('historical pending completion stays outside new-work totals and preserves old rules',()=>{
  let bundle=R.addRecord(R.create({at}),job({start:'',end:''}),{pending:true,at});
  const original=bundle.tables.records[0],nextCycle=R.uuid();
  bundle=R.transact(bundle,'FixtureCycle',next=>{
    next.tables.cycles.push({id:nextCycle,name:'Synthetic next',start:'',end:'',createdAt:at,parentId:next.cycleId,sourceFileId:next.fileId});next.cycleId=nextCycle;
    next.tables.rules[0].mult=2;
  },{at});
  bundle=R.updateRecord(bundle,original.id,{start:'19:00',end:'20:00'},{promote:true,at});
  assert.equal(bundle.tables.records[0].state,'Historical');assert.equal(R.currentRecords(bundle).length,0);
  assert.equal(R.calculate(bundle,bundle.tables.records[0]).total,180);
});

test('direct edits, lost events, duplicate IDs and orphan relationships are rejected',()=>{
  const bundle=R.addRecord(R.create({at}),job(),{at});
  const edited=R.clone(bundle);edited.tables.records[0].rate=70;assert.throws(()=>R.validate(edited),/审计回放/);
  const lost=R.clone(bundle);lost.audit.pop();assert.throws(()=>R.validate(lost),/失联/);
  const duplicate=R.clone(bundle);duplicate.tables.records.push({...duplicate.tables.records[0]});assert.throws(()=>R.validate(duplicate),/重复 ID/);
  const orphan=R.clone(bundle);orphan.tables.records[0].originCycleId=R.uuid();assert.throws(()=>R.validate(orphan),/关联/);
  const sequence=R.clone(bundle);sequence.audit[0].sequence=2;assert.throws(()=>R.validate(sequence),/顺序/);
});

test('legacy migration keeps balances and unknown history without inventing payments',()=>{
  const raw={version:'3.0',config:{...C.DEFAULT_CONFIG},records:[{kind:'Job',balance:'',...job()},{kind:'Carryover',date:'',invoice:'INV-9999',start:'',end:'',lunch:'',rate:'',app:'',extra:'',note:'Synthetic opening',balance:'27.35'}]};
  const before=JSON.stringify(raw),bundle=R.migrate(raw,{sourceName:'synthetic-v3.xlsx',at});
  assert.equal(JSON.stringify(raw),before);assert.equal(bundle.schemaVersion,'4.1');assert.equal(R.currentRecords(bundle).length,1);
  assert.equal(R.calculate(bundle,bundle.tables.records[0]).total,180);
  const opening=bundle.tables.records[1];assert.equal(opening.state,'Opening');assert.equal(opening.openingCents,2735);
  assert.equal(opening.originCycleId,'');assert.equal(opening.originRecordId,'');assert.equal(opening.start,'');assert.equal(opening.rate,'');
  assert.equal(bundle.tables.observations[0].observedAt,'');assert.equal(bundle.tables.observations[0].kind,'Imported');
  assert.deepEqual(bundle.tables.payments,[]);assert.deepEqual(bundle.tables.allocations,[]);
  const old=R.migrate({...raw,version:'2.0',config:{minHours:2,ahStart:18,mult:1.5,tolerance:.01,allocation:'Standard first'}},{at});
  assert.equal(R.calculate(old,old.tables.records[0]).total,180);assert.equal(C.calculate(raw.records[0],raw.config,'2.0').total,150);
});

test('reconciliation money uses exact cents and does not silently round invalid input',()=>{
  assert.equal(R.cents('27.35'),2735);assert.equal(R.cents('0'),0);assert.equal(R.cents('-1.25'),-125);
  for(const value of ['','not-number','Infinity','0.001','900719925474099'])assert.throws(()=>R.cents(value));
  assert.throws(()=>R.cents(0,{positive:true}));assert.throws(()=>R.cents(-1,{positive:true}));
});

test('a new cycle data draft preserves identities and history without counting old work again',()=>{
  let original=R.addRecord(R.create({at}),job(),{at});assert.equal(original.fileVersionId,'');
  assert.throws(()=>R.createCycleDraft(original,{name:'next'}),/保存/);
  // The IO gate supplies an actual export version; this unit fixture models that checkpoint.
  original.fileVersionId=R.uuid();original.sourceName='synthetic-saved.xlsx';
  const previous=JSON.stringify(original),next=R.createCycleDraft(original,{name:'Synthetic next',at});
  assert.equal(JSON.stringify(original),previous);assert.notEqual(next.cycleId,original.cycleId);
  assert.equal(next.tables.records[0].id,original.tables.records[0].id);assert.equal(next.tables.records[0].originCycleId,original.cycleId);
  assert.equal(next.tables.records[0].state,'Historical');assert.equal(R.currentRecords(next).length,0);
  assert.equal(R.calculate(next,next.tables.records[0]).total,180);assert.equal(next.tables.observations[0].differenceCents,3000);R.validate(next);
});
