import test from 'node:test';
import assert from 'node:assert/strict';
import {M,job,fixture,saved} from './fixtures.mjs';
test('standalone issues and balances survive two cycles without invented work or bank records',()=>{
 let state=M.saveIssue(M.create(),{description:'No source known',amountCents:null});state=M.saveIssue(state,{description:'Another independent issue',amountCents:0});state=M.saveBalance(state,{description:'Independent confirmed zero',amountCents:0},null,'Known zero');state=M.saveBank(state,{date:'2026-01-11',amountCents:200});state=saved(state);
 const original=M.canonical(state),first=M.carryForward(state,{name:'Next'}),second=M.carryForward(saved(first),{name:'Third'});
 assert.equal(first.records.length,0);assert.equal(second.records.length,0);assert.equal(second.issues.length,2);assert.equal(second.balances.length,1);assert.equal(second.bankReceived.length,0);assert.deepEqual(second.issues,state.issues);assert.deepEqual(second.balanceHistory,state.balanceHistory);assert.equal(M.canonical(state),original);
 assert.equal(first.metadata.sourceFileId,state.metadata.fileId);assert.equal(first.metadata.sourceFileVersionId,state.metadata.fileVersionId);assert.notEqual(second.metadata.fileId,first.metadata.fileId);assert.equal(second.metadata.sourceFileId,first.metadata.fileId);
});
test('carry roots are reminders and entity IDs, not just work rows; background refs are deduplicated',()=>{
 let state=fixture(2);state=M.saveIssue(state,{recordId:state.records[0].id,description:'Linked'});state=M.saveIssue(state,{recordId:state.records[1].id},state.issues[0].id,'Changed association');state=M.saveIssue(state,{recordId:null},state.issues[0].id,'No current association');
 state=M.saveBalance(state,{recordId:state.records[0].id,description:'Confirmed',amountCents:100},null,'Verified');state=saved(state);
 const selection={reminderScopes:Object.fromEntries(state.records.map(row=>[row.id,[]])),issueIds:state.issues.map(row=>row.id),balanceIds:state.balances.map(row=>row.id)},next=M.carryForward(state,{name:'Next',selection});
 assert.equal(next.records.length,2);assert.equal(new Set(next.records.map(row=>row.id)).size,2);assert.deepEqual(next.records.map(row=>row.reminderKinds),[[],[]]);assert.equal(next.issueHistory.length,3);assert.equal(next.records.every(row=>row.type==='Historical'),true);
 assert.equal(M.carryForward(saved(next),{name:'Third'}).records.length,2);
});
test('excluded categories persist when correcting historical App reveals a new difference',()=>{
 let state=saved(M.addRecord(M.create(),job()));const recordId=state.records[0].id;
 state=M.carryForward(state,{name:'Next',selection:{reminderScopes:{[recordId]:['missing_app','difference']}}});
 assert.deepEqual(M.reminders(state,state.records[0]),['missing_app']);
 state=M.updateRecord(state,recordId,{app:100});assert.deepEqual(M.reminders(state,state.records[0]),['difference']);
 state=M.updateRecord(state,recordId,{app:480});assert.deepEqual(M.reminders(state,state.records[0]),[]);
 state=M.updateRecord(state,recordId,{app:null});assert.deepEqual(M.reminders(state,state.records[0]),['missing_app']);
 const next=M.carryForward(saved(state),{name:'Third'});assert.deepEqual(next.records[0].reminderKinds,['missing_app','difference']);assert.equal(next.records[0].id,recordId);assert.equal(next.appChanges.length,3);
});
test('excluding a balance or issue changes the new file only and never resurrects it',()=>{
 let state=M.addRecord(M.create(),job());state=M.saveIssue(state,{description:'Exclude this'});state=M.saveBalance(state,{recordId:state.records[0].id,description:'Exclude this balance',amountCents:500},null,'Verified');state=saved(state);
 const before=M.canonical(state),next=M.carryForward(state,{name:'Next',selection:{issueIds:[],balanceIds:[]}});assert.equal(next.issues.length,0);assert.equal(next.balances.length,0);assert.equal(next.records.length,1);assert.equal(M.carryForward(saved(next),{name:'Third'}).balances.length,0);assert.equal(M.canonical(state),before);
});
test('Historical rules stay frozen across reconfiguration and repeated rollover',()=>{
 let state=saved(M.addRecord(M.create(),job({start:'19:00',end:'20:00'})));const old=M.calculate(state,state.records[0]).total;
 state=M.carryForward(state,{name:'Next'});state=M.applyConfig(state,M.previewConfig(state,{mult:2,minHours:4},0),0);const next=M.carryForward(saved(state),{name:'Third'});
 assert.equal(M.calculate(next,next.records[0]).total,old);assert.equal(next.records[0].ruleSnapshot.mult,1.5);assert.equal(next.config.mult,2);assert.equal(next.records[0].type,'Historical');
});
test('unsupported selections and unsaved sources are rejected atomically',()=>{
 const state=fixture();assert.throws(()=>M.carryForward(state,{name:'Next'}),/保存/);
 const source=saved(state);for(const selection of [{issueIds:['absent']},{balanceIds:['absent']},{reminderScopes:{absent:['difference']}},{reminderScopes:{[source.records[0].id]:['invalid']}}])assert.throws(()=>M.carryForward(source,{name:'Next',selection}));
 assert.throws(()=>M.carryForward(source,{name:''}));assert.throws(()=>M.carryForward(source,{name:'Next',start:'2026-03-01',end:'2026-01-01'}));
});
