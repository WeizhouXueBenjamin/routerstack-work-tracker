(function(root){
  'use strict';
  const M=typeof module==='object' && module.exports?require('./model.js'):root.TrackerModel;
  const C=typeof module==='object' && module.exports?require('./core.js'):root.TrackerCore;
  const ISSUE_LABELS=Object.freeze({missing_invoice:'Invoice 待补',missing_app:'App 待填',difference:'差额待核对'});
  function months(state){return [...new Set(state.records.filter(row=>row.type==='Current').map(row=>row.date.slice(0,7)))].sort()}
  function totals(state,records=state.records) {
    let estimated=0,app=0,difference=0,known=0;
    for(const row of records){const calc=M.calculate(state,row);estimated+=Math.round(calc.total*100);if(row.app!==null){app+=row.app;difference+=Math.round(calc.diff*100);known++}}
    return {estimated:records.length?estimated/100:null,app:known?C.round(app):null,difference:known?difference/100:null,partial:known<records.length,count:records.length,known};
  }
  function summary(state) {
    const groups=new Map([['Historical',[]]]);
    for(const row of state.records){const key=row.type==='Historical'?'Historical':row.date.slice(0,7);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
    return [...groups].sort(([a],[b])=>a==='Historical'?-1:b==='Historical'?1:a.localeCompare(b)).map(([period,rows])=>({period,...totals(state,rows)})).concat({period:'Total',...totals(state)});
  }
  function view(state,{type='',month='',query='',issue='all'}={}) {
    const needle=query.trim().toLowerCase();
    return state.records.filter(row=>(!type || row.type===type) && (!month || row.date.slice(0,7)===month) && (!needle || [row.invoice,row.date,row.note,row.id].join(' ').toLowerCase().includes(needle)) && (issue==='all' || (issue==='needs_review'?M.reminders(state,row).length:M.reminders(state,row).includes(issue))));
  }
  const api=Object.freeze({ISSUE_LABELS,months,totals,summary,view});
  if(typeof module==='object' && module.exports)module.exports=api;else root.TrackerReports=api;
})(globalThis);
