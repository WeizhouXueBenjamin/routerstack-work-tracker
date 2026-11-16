import test from 'node:test';
import assert from 'node:assert/strict';
import {M,C,job,fixture,saved} from './fixtures.mjs';
test('atomic commands reject invalid input and unknown fields without changing their source',()=>{
 const state=M.addRecord(M.create(),job()),before=M.canonical(state);
 for(const operation of [()=>M.addRecord(state,job({lunch:99})),()=>M.updateRecord(state,state.records[0].id,{rate:0}),()=>M.saveIssue(state,{recordId:'missing',description:'Synthetic'}),()=>M.saveBalance(state,{description:'Synthetic',amountCents:null},null,'Basis'),()=>M.saveBank(state,{date:'invalid',amountCents:100}),()=>M.saveIssue(state,{description:'Synthetic',surprise:1})])assert.throws(operation);
 assert.equal(M.canonical(state),before);
 const extra=M.clone(state);extra.payments=[];assert.throws(()=>M.validate(extra),/字段/);
});
test('independent issues and balances have their own IDs, nullable references and provenance',()=>{
 let state=M.create();state=M.saveIssue(state,{description:'Unknown reference',amountCents:null});state=M.saveIssue(state,{description:'Zero reference',amountCents:0});state=M.saveIssue(state,{description:'Credit reference',amountCents:-123});
 state=M.saveBalance(state,{description:'Zero confirmed',amountCents:0},null,'Explicitly confirmed zero');state=M.saveBalance(state,{description:'Another balance',amountCents:100},null,'Independent confirmation');
 assert.equal(state.records.length,0);assert.equal(new Set(state.issues.map(row=>row.id)).size,3);assert.deepEqual(state.issues.map(row=>row.amountCents),[null,0,-123]);assert.equal(state.balances[0].status,'Open');assert.equal(state.balanceHistory.length,2);
});
test('late linking, replacing and unlinking retain identity, amount, status and historical references',()=>{
 let state=fixture(2);state=M.saveIssue(state,{description:'Standalone',amountCents:0});state=M.saveBalance(state,{description:'Standalone balance',amountCents:200},null,'Verified');
 const originalIssue=state.issues[0],originalBalance=state.balances[0];
 for(const recordId of [state.records[0].id,state.records[1].id,null]) {
  state=M.saveIssue(state,{recordId},originalIssue.id,'Association reviewed');state=M.saveBalance(state,{recordId},originalBalance.id,'Association reviewed');
 }
 assert.equal(state.issues[0].id,originalIssue.id);assert.equal(state.issues[0].amountCents,0);assert.equal(state.balances[0].amountCents,200);assert.equal(state.balances[0].status,'Open');assert.equal(state.issues[0].periodId,originalIssue.periodId);assert.deepEqual(state.issueHistory.map(row=>row.recordId),[null,state.records[0].id,state.records[1].id,null]);
 assert.throws(()=>M.deleteRecord(state,state.records[0].id),/引用/);
});
test('multiple balances on the same real work remain independent',()=>{
 let state=fixture();for(const amountCents of [100,200])state=M.saveBalance(state,{recordId:state.records[0].id,description:'Independent',amountCents},null,'Verified independently');
 assert.equal(state.balances.length,2);assert.notEqual(state.balances[0].id,state.balances[1].id);
});
test('issue and balance edit, close and reopen append dedicated snapshots with reasons',()=>{
 let state=M.saveIssue(M.create(),{description:'Unknown',amountCents:null});state=M.saveBalance(state,{description:'Confirmed',amountCents:200},null,'Known basis');
 state=M.saveIssue(state,{amountCents:0},state.issues[0].id,'Known zero');state=M.saveIssue(state,{status:'Closed'},state.issues[0].id,'Checked');state=M.saveIssue(state,{status:'Open'},state.issues[0].id,'New information');
 state=M.saveBalance(state,{amountCents:0},state.balances[0].id,'Explicit correction');assert.equal(state.balances[0].status,'Open');state=M.saveBalance(state,{status:'Closed'},state.balances[0].id,'Confirmed settled');state=M.saveBalance(state,{status:'Open'},state.balances[0].id,'Reopened with basis');
 assert.deepEqual(state.issueHistory.map(row=>row.action),['Create','Edit','Close','Reopen']);assert.deepEqual(state.balanceHistory.map(row=>row.sequence),[1,2,3,4]);
 assert.throws(()=>M.saveBalance(state,{amountCents:1},state.balances[0].id,''),/依据/);
 const bad=M.clone(state);bad.balanceHistory.pop();assert.throws(()=>M.validate(bad),/历史/);
});
test('bank CRUD has no status, allocation or audit and never adjusts manual balances',()=>{
 let state=M.saveBalance(M.create(),{description:'Confirmed',amountCents:999},null,'Verified');state=M.saveBank(state,{date:'2026-01-11',amountCents:200,note:'Synthetic'});state=M.saveBank(state,{date:'2026-01-11',amountCents:200});
 const original=state.bankReceived[0];state=M.saveBank(state,{date:'2026-01-12',amountCents:300,note:'Corrected'},original.id);assert.equal(state.bankReceived[0].createdAt,original.createdAt);
 state=M.deleteBank(state,original.id);assert.equal(state.bankReceived.length,1);assert.equal(state.bankReceived[0].amountCents,200);assert.equal(state.balances[0].amountCents,999);assert.equal(state.balanceHistory.length,1);assert.equal(Object.hasOwn(state.bankReceived[0],'status'),false);
 for(const amountCents of [0,-1,0.1,NaN,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>M.saveBank(state,{date:'2026-01-11',amountCents}));
});
test('App history only records actual changes, preserving old null and explicit zero',()=>{
 let state=M.addRecord(M.create(),job());assert.equal(state.appChanges.length,0);const recordId=state.records[0].id;
 state=M.updateRecord(state,recordId,{app:0},{observedAt:'2026-01-10T20:00:00+13:00',note:'Observed'});state=M.updateRecord(state,recordId,{app:0,note:'Normal edit'});assert.equal(state.appChanges.length,1);
 const snap=M.clone(state.appChanges[0]);state=M.applyConfig(state,M.previewConfig(state,{minHours:3},1),1);assert.deepEqual(state.appChanges[0],snap);
 state=M.updateRecord(state,recordId,{app:null});assert.equal(state.appChanges.length,2);assert.equal(state.appChanges[1].oldApp,0);assert.equal(state.appChanges[1].newApp,null);assert.equal(state.appChanges[1].differenceCents,null);
 assert.throws(()=>M.updateRecord(state,recordId,{app:null},{note:'Unsubmitted observation'}),/未变化/);assert.equal(state.appChanges.length,2);
});
test('configuration preview rejects stale revisions and applies only Current rules',()=>{
 let prior=saved(M.addRecord(M.create(),job({start:'19:00',end:'20:00'})));
 let state=M.carryForward(prior,{name:'Next'});state=M.addRecord(state,job({start:'09:00',end:'10:00'}));
 const historical=state.records[0],old=M.calculate(state,historical).total,preview=M.previewConfig(state,{minHours:3},4);
 assert.equal(preview.affected.length,1);assert.equal(preview.affected[0].before,120);assert.equal(preview.affected[0].after,180);
 assert.throws(()=>M.applyConfig(state,preview,5),/过期/);assert.throws(()=>M.applyConfig(M.addRecord(state,job()),preview,4),/过期/);
 const next=M.applyConfig(state,preview,4);assert.equal(next.config.minHours,3);assert.equal(state.config.minHours,2);assert.equal(M.calculate(next,next.records[0]).total,old);assert.deepEqual(next.records[0],historical);assert.equal(next.appChanges.length,state.appChanges.length);
 const withRate=M.setDefaultRate(next,72);assert.equal(withRate.records[1].rate,60);assert.equal(withRate.config.defaultRate,72);
});
test('deletion protects references; unreferenced Current deletion removes its App history',()=>{
 let state=M.addRecord(M.create(),job({app:100}));state=M.deleteRecord(state,state.records[0].id);assert.equal(state.records.length,0);assert.equal(state.appChanges.length,0);
 state=fixture();state=M.saveIssue(state,{recordId:state.records[0].id,description:'Keep source'});assert.throws(()=>M.deleteRecord(state,state.records[0].id),/引用/);
});
test('strict validation rejects duplicate IDs, dangling references, unsafe cents and long Excel text',()=>{
 const state=fixture(2);
 for(const mutate of [s=>s.records[1].id=s.records[0].id,s=>s.records[1].invoice=s.records[0].invoice,s=>s.records[0].periodId='absent',s=>s.records[0].note='x'.repeat(32768),s=>s.records[0].note='\u0001',s=>s.records[0].rate=Number.MAX_VALUE,s=>s.records[0].updatedAt='2026-02-30T10:00:00Z']){const bad=M.clone(state);mutate(bad);assert.throws(()=>M.validate(bad))}
});
