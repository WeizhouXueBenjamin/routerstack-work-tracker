import test from 'node:test';
import assert from 'node:assert/strict';
import {M,R,job,saved} from './fixtures.mjs';
test('Historical, actual Current months and Total include all work; filters do not affect summary',()=>{
 let state=M.carryForward(saved(M.addRecord(M.create(),job({start:'19:00',end:'20:00',app:100}))),{name:'Next'});
 state=M.addRecord(state,job({date:'2026-10-01',app:null}));state=M.addRecord(state,job({date:'2026-11-01',app:0}));
 state=M.saveBank(state,{date:'2026-11-02',amountCents:99999});state=M.saveIssue(state,{description:'Reference',amountCents:-5000});state=M.saveBalance(state,{description:'Confirmed',amountCents:12345},null,'Known');
 const before=R.summary(state),total=before.at(-1);assert.deepEqual(before.map(row=>row.period),['Historical','2026-10','2026-11','Total']);assert.equal(total.estimated,1140);assert.equal(total.app,100);assert.equal(total.difference,560);assert.equal(total.partial,true);assert.equal(total.known,2);
 assert.equal(R.view(state,{type:'Historical'}).length,1);assert.equal(R.view(state,{month:'2026-11'}).length,1);assert.equal(R.view(state,{query:'not present'}).length,0);assert.deepEqual(R.summary(state),before);
});
test('no comparable App stays unknown; explicit zero participates in Difference',()=>{
 let state=M.addRecord(M.create(),job());let total=R.totals(state);assert.equal(total.app,null);assert.equal(total.difference,null);assert.equal(total.partial,true);
 state=M.updateRecord(state,state.records[0].id,{app:0});total=R.totals(state);assert.equal(total.app,0);assert.equal(total.difference,480);assert.equal(total.partial,false);
});
test('Difference is rounded per record rather than subtracting aggregate App',()=>{
 let state=M.addRecord(M.create(),job({start:'09:00',end:'10:00',rate:0.005,app:0.005}));state=M.addRecord(state,job({start:'09:00',end:'10:00',rate:0.005,app:0.005}));
 const total=R.totals(state);assert.equal(total.estimated,0.02);assert.equal(total.app,0.01);assert.equal(total.difference,0.02);
});

test('Work Log orders mixed records by date and start, keeps ties stable and preserves source data and totals',()=>{
 let state=M.carryForward(saved(M.addRecord(M.create(),job({date:'2026-01-15',start:'12:00',note:'Historical'}))),{name:'Next'});
 for(const input of [
  {date:'2026-02-01',start:'09:00',note:'Later month'},
  {date:'2026-01-10',start:'14:00',note:'Afternoon'},
  {date:'2026-01-10',start:'08:00',note:'Morning first'},
  {date:'2026-01-10',start:'08:00',note:'Morning second'},
 ])state=M.addRecord(state,job(input));
 const before=M.clone(state),totals=R.summary(state);
 assert.deepEqual(R.view(state).map(row=>row.note),['Morning first','Morning second','Afternoon','Historical','Later month']);
 assert.deepEqual(R.view(state,{type:'Current',month:'2026-01',query:'morning'}).map(row=>row.note),['Morning first','Morning second']);
 assert.deepEqual(state,before);assert.deepEqual(R.summary(state),totals);
});
