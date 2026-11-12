(function (root) {
  'use strict';
  const C=typeof module==='object' && module.exports?require('./core.js'):root.TrackerCore;
  const ISSUE_LABELS=Object.freeze({missing_invoice:'Invoice 待补',missing_app:'App 待填',difference:'差额待核对'});
  const ENGLISH_LABELS=Object.freeze({missing_invoice:'Invoice pending',missing_app:'App pending',difference:'Amount difference'});
  const clean=value=>String(value ?? '').replace(/\s*[\r\n\t|]+\s*/g,' / ');
  const cash=value=>Number(value).toFixed(2);
  const raw=value=>C.blank(value)?'—':clean(value);
  function result(record,config,version) {
    const out=C.calculate(record,config,version);
    if(!out)throw Error('记录无法计算，不能生成核对结果：'+(record.invoice || record.date));
    return out;
  }
  function months(records) {
    return [...new Set(records.filter(record=>record.kind==='Job').map(record=>record.date.slice(0,7)))].sort().reverse();
  }
  function issues(record,config,version=C.VERSION) {
    if(record.kind!=='Job')return [];
    const found=[];
    if(!record.invoice)found.push('missing_invoice');
    if(C.blank(record.app))found.push('missing_app');
    const out=result(record,config,version);
    if(out.diff!==null && Math.abs(out.diff)>config.tolerance)found.push('difference');
    return found;
  }
  function totals(records,config,version=C.VERSION) {
    const out={count:0,expected:0,app:0,comparableExpected:0,difference:0,comparableCount:0,missingInvoice:0,missingApp:0,billable:0,ah:0};
    for(const record of records) {
      if(record.kind!=='Job')continue;
      const calc=result(record,config,version);out.count++;out.expected+=calc.total;out.billable+=calc.bill;out.ah+=calc.ah;
      if(!record.invoice)out.missingInvoice++;
      if(C.blank(record.app))out.missingApp++;
      else {out.comparableCount++;out.comparableExpected+=calc.total;out.app+=Number(record.app);out.difference+=calc.diff}
    }
    for(const key of ['expected','app','comparableExpected','difference'])out[key]=C.round(out[key]);
    return out;
  }
  function view(records,config,{month='',query='',issue='all',version=C.VERSION}={}) {
    const allJobs=records.filter(record=>record.kind==='Job'),allCarryovers=records.filter(record=>record.kind==='Carryover');
    const monthJobs=allJobs.filter(record=>!month || record.date.slice(0,7)===month);
    const needle=query.toLowerCase().trim();
    const matches=record=>(record.invoice+' '+record.date+' '+record.note).toLowerCase().includes(needle);
    const jobs=monthJobs.filter(record=>{
      if(!matches(record))return false;
      if(issue==='all')return true;
      const flags=issues(record,config,version);
      return issue==='needs_review'?flags.length>0:flags.includes(issue);
    });
    return {allJobs,allCarryovers,monthJobs,jobs,carryovers:allCarryovers.filter(matches),totals:totals(monthJobs,config,version),carryTotal:C.round(allCarryovers.reduce((sum,record)=>sum+Number(record.balance),0))};
  }
  function timReport(records,config,{month='',query='',issue='all',scope='issues',version=C.VERSION,fileName='',unsaved=false}={}) {
    const selected=view(records,config,{month,query,issue,version});
    const jobs=scope==='visible'?selected.jobs:scope==='all'?selected.monthJobs:selected.monthJobs.filter(record=>issues(record,config,version).length>0);
    const carryovers=scope==='visible'?selected.carryovers:selected.allCarryovers;
    const summary=totals(jobs,config,version);
    const scopeText=scope==='visible'?'Current visible records':scope==='all'?'All jobs in the selected work month':'Jobs needing review in the selected work month';
    const lines=[
      'RouterStack reconciliation | NZD',
      'Source: '+clean(fileName || 'Current cycle (not yet saved)'),
      'Work month: '+(month || 'All months')+' | Current workbook only',
      'Estimate basis: minimum '+config.minHours+' h; AH '+C.timeText(config.ahStart)+'–'+(version==='2.0'?'24:00 (legacy)':C.timeText(config.ahEnd))+' at '+config.mult+'x; lunch deducted from regular hours first; '+(version==='2.0'?'AH limited to actual hours before minimum top-up.':'minimum top-up follows regular/AH proportions after lunch.'),
      'Scope: '+scopeText,
      ...(scope==='visible'?['Search: '+clean(query || '(none)')+' | Job filter: '+clean(issue)]:['Search and issue filters do not limit this scope.']),
      ...(unsaved?['Includes changes not yet saved or confirmed.']:[]),
      'Estimated/App differences require review; they do not identify unpaid invoices.',
      '',
      'JOBS',
      'Invoice | Date | Shift | Lunch h | Rate NZD/h | Billable (AH) h | Extra | Expected | App | Difference | Checks | Note'
    ];
    for(const record of jobs) {
      const calc=result(record,config,version),overnight=C.minutes(record.end)<C.minutes(record.start)?' (+1 day)':'';
      lines.push([
        record.invoice || '[Invoice pending]',record.date,record.start+'–'+record.end+overnight,raw(record.lunch),raw(record.rate),
        calc.bill.toFixed(2)+' ('+calc.ah.toFixed(2)+')',raw(record.extra),cash(calc.total),C.blank(record.app)?'Pending':raw(record.app),calc.diff===null?'Not comparable':cash(calc.diff),
        issues(record,config,version).map(flag=>ENGLISH_LABELS[flag]).join('; ') || '—',clean(record.note) || '—'
      ].join(' | '));
    }
    if(!jobs.length)lines.push('(No jobs in this list)');
    lines.push(
      'Listed jobs: '+summary.count+' | Expected incl. Extra: '+cash(summary.expected),
      summary.comparableCount?'Comparable jobs (App supplied): '+summary.comparableCount+' | Expected: '+cash(summary.comparableExpected)+' | App: '+cash(summary.app)+' | Sum of per-job differences: '+cash(summary.difference):'Comparable jobs (App supplied): 0 | App and Difference totals are not available.',
      'Pending Invoice IDs: '+summary.missingInvoice+' | Pending App amounts: '+summary.missingApp,
      'Blank Lunch is calculated as 0; Expected and Difference use the workbook calculation rules.',
      '',
      'CONFIRMED CARRYOVERS — prior invoice balances, excluded from new-work totals',
      'Invoice | Original work date | Confirmed balance NZD | Note'
    );
    for(const record of carryovers)lines.push([record.invoice,record.date || 'Not recorded',cash(record.balance),clean(record.note) || '—'].join(' | '));
    if(!carryovers.length)lines.push('(No confirmed carryovers in this list)');
    lines.push('Confirmed carryover total: '+cash(C.round(carryovers.reduce((sum,record)=>sum+Number(record.balance),0))),
      'Carryovers are not limited by the work-month filter; no bank transfers have been allocated to invoices.');
    return {text:lines.join('\n'),jobCount:jobs.length,carryCount:carryovers.length};
  }
  const api=Object.freeze({ISSUE_LABELS,months,issues,totals,view,timReport});
  if(typeof module==='object' && module.exports)module.exports=api;
  else root.TrackerReports=api;
})(globalThis);
