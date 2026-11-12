import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Core=require('../src/core.js'),Reports=require('../src/reports.js');
const config=Core.DEFAULT_CONFIG;
const job=changes=>({kind:'Job',date:'2026-01-10',invoice:'INV-9001',start:'09:00',end:'10:00',lunch:'',rate:'60',app:'',extra:'',note:'Synthetic',balance:'',...changes});
const carry=changes=>({kind:'Carryover',date:'2026-01-02',invoice:'INV-9991',start:'',end:'',lunch:'',rate:'',app:'',extra:'',note:'Synthetic carry',balance:'27.35',...changes});
const records=[job({invoice:''}),job({invoice:'INV-9002',start:'19:00',end:'20:00',extra:'10',app:'150'}),job({invoice:'INV-9003',app:'0'}),job({invoice:'INV-9004',date:'2026-02-01',app:'120'}),job({invoice:'INV-9005',date:'2026-02-02',app:'120.01'}),carry(),carry({invoice:'INV-9992',date:'2025-12-01',balance:'10'})];
test('months come only from Job dates; carryovers never create work months',()=>{
  assert.deepEqual(Reports.months(records),['2026-02','2026-01']);assert.deepEqual(Reports.months([carry()]),[]);
});
test('monthly totals separate new work, known App comparisons and carryovers',()=>{
  const view=Reports.view(records,config,{month:'2026-01'});
  assert.deepEqual(view.totals,{count:3,expected:430,app:150,comparableExpected:310,difference:160,comparableCount:2,missingInvoice:1,missingApp:1,billable:6,ah:2});
  assert.equal(view.carryTotal,37.35);assert.equal(view.carryovers.length,2);
  const empty=Reports.view(records,config,{month:'2026-03'});assert.equal(empty.totals.expected,0);assert.equal(empty.carryTotal,37.35);
  const overnight=[job({date:'2026-01-31',start:'22:00',end:'02:00'})];
  assert.equal(Reports.view(overnight,config,{month:'2026-01'}).totals.expected,360);
  assert.equal(Reports.view(overnight,config,{month:'2026-02'}).totals.count,0);
});
test('missing App differs from zero and both signs use the configured tolerance',()=>{
  assert.deepEqual(Reports.issues(records[0],config),['missing_invoice','missing_app']);
  assert.deepEqual(Reports.issues(records[2],config),['difference']);
  assert.deepEqual(Reports.issues(records[4],config),[]);
  assert.deepEqual(Reports.issues(job({app:'120.02'}),config),['difference']);
  assert.deepEqual(Reports.issues(carry(),config),[]);
});
test('search and issue filters intersect; monthly totals retain their stated scope',()=>{
  const result=Reports.view(records,config,{month:'2026-01',query:' inv-9002 ',issue:'difference'});
  assert.deepEqual(result.jobs.map(row=>row.invoice),['INV-9002']);assert.equal(result.totals.expected,430);assert.equal(result.carryovers.length,0);
  assert.equal(Reports.view(records,config,{month:'2026-01',query:'inv-9002',issue:'missing_app'}).jobs.length,0);
  assert.equal(Reports.view(records,config,{month:'2026-02',issue:'needs_review'}).jobs.length,0);
});
test('default Tim list includes pending and discrepant jobs, with carryovers separate',()=>{
  const report=Reports.timReport(records,config,{month:'2026-01',query:'does-not-match',issue:'missing_app',fileName:'synthetic.xlsx'});
  assert.equal(report.jobCount,3);assert.equal(report.carryCount,2);
  assert.match(report.text,/\[Invoice pending\]/);assert.match(report.text,/Pending/);assert.match(report.text,/Not comparable/);
  assert.match(report.text,/Listed jobs: 3 \| Expected incl. Extra: 430.00/);
  assert.match(report.text,/Comparable jobs \(App supplied\): 2 \| Expected: 310.00 \| App: 150.00 \| Sum of per-job differences: 160.00/);
  const [jobs,balances]=report.text.split('CONFIRMED CARRYOVERS');assert.doesNotMatch(jobs,/INV-9991/);assert.match(balances,/INV-9991/);assert.match(balances,/Confirmed carryover total: 37.35/);
  assert.doesNotMatch(report.text,/INV-9004/);assert.match(report.text,/no bank transfers have been allocated/);
});
test('Tim visible and all-work scopes are explicit and include the right records',()=>{
  const visible=Reports.timReport(records,config,{month:'2026-01',query:'inv-9002',scope:'visible'});assert.equal(visible.jobCount,1);assert.equal(visible.carryCount,0);assert.match(visible.text,/Current visible records/);
  const all=Reports.timReport(records,config,{month:'2026-02',query:'no-match',scope:'all'});assert.equal(all.jobCount,2);assert.equal(all.carryCount,2);assert.match(all.text,/INV-9004/);
});
test('report display protects raw values and records without treating missing data as paid',()=>{
  const data=[job({invoice:'',note:'Line one\nLine two | Synthetic',rate:'60.125',extra:'0',app:''})];
  const before=JSON.stringify(data);data.forEach(Object.freeze);Object.freeze(data);
  const out=Reports.timReport(data,config,{unsaved:true});
  assert.equal(JSON.stringify(data),before);assert.match(out.text,/60.125/);assert.match(out.text,/Line one \/ Line two \/ Synthetic/);assert.match(out.text,/Includes changes not yet saved or confirmed/);
  assert.match(out.text,/Comparable jobs \(App supplied\): 0 \| App and Difference totals are not available/);
});
test('read-only 2.0 reports keep legacy calculation rules',()=>{
  const old=[job({start:'19:00',end:'20:00'})];
  assert.equal(Reports.totals(old,config,'2.0').expected,150);assert.equal(Reports.totals(old,config,'3.0').expected,180);
  assert.match(Reports.timReport(old,config,{version:'2.0'}).text,/18:00–24:00 \(legacy\)/);
  assert.match(Reports.timReport(old,config).text,/18:00–06:00/);
});
