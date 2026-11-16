(function(root){
  'use strict';
  const M=root.TrackerModel,$=id=>document.getElementById(id);
  let api,kind=null,entityId=null,bankId=null;
  const values=ids=>ids.map(id=>$(id).type==='checkbox'?$(id).checked:$(id).value);
  const bankFields=['bankDate','bankAmount','bankNote'];
  const reviewFields=['reviewRecord','reviewCategory','reviewAmount','reviewDescription','reviewStatus','reviewFollow','reviewReason'];
  let bankBaseline='',reviewBaseline='';
  const bankSignature=()=>JSON.stringify(values(bankFields));
  const reviewSignature=()=>JSON.stringify(values(reviewFields));
  const bankDraft=()=>bankSignature()!==bankBaseline;
  const entityDraft=()=>kind!==null && reviewSignature()!==reviewBaseline;
  const hasDraft=()=>bankDraft() || entityDraft();
  function error(message){$('reviewError').textContent=message;$('reviewError').style.display=message?'block':'none'}
  function parseCents(value,{optional=false,signed=false}={}){
    if(value==='' && optional)return null;
    if(!new RegExp(signed?'^-?\\d+(?:\\.\\d{1,2})?$':'^\\d+(?:\\.\\d{1,2})?$').test(value))throw Error('金额必须是最多两位小数的'+(signed?'有符号':'非负')+'数值');
    const result=Math.round(Number(value)*100);if(!Number.isSafeInteger(result))throw Error('金额超过安全精度');return result;
  }
  function resetBank(){
    $('bankForm').reset();bankId=null;bankBaseline=bankSignature();$('submitBank').textContent='登记到账';
  }
  function resetEntity(){
    $('reviewForm').reset();kind=null;entityId=null;reviewBaseline=reviewSignature();$('reviewForm').hidden=true;
  }
  function reset(){resetBank();resetEntity();error('')}
  function sourceLabel(recordId){
    if(recordId===null)return '未关联工作';
    const row=M.get(api.getState().workbook,'records',recordId);return (row.invoice || 'Invoice 待补')+' · '+row.date+' · '+row.id;
  }
  function openEntity(nextKind,nextId=null){
    if(api.getState().busy)return;
    if(api.jobHasDraft() || bankDraft()){error('请先提交或取消工作／Config／银行草稿。');return}
    if(entityDraft() && !confirm('确定放弃尚未提交的事项草稿？'))return;
    resetEntity();kind=nextKind;entityId=nextId;
    const state=api.getState().workbook,row=nextId?M.get(state,kind,nextId):null;
    $('reviewRecord').innerHTML='<option value="">未关联工作</option>'+state.records.map(record=>`<option value="${api.safe(record.id)}">${api.safe(sourceLabel(record.id))}</option>`).join('');
    $('reviewRecord').value=row?.recordId || '';$('reviewCategory').value=row?.category || 'Manual';$('reviewAmount').value=row?.amountCents===null || !row?'':(row.amountCents/100).toFixed(2);$('reviewDescription').value=row?.description || '';$('reviewStatus').value=row?.status || 'Open';$('reviewFollow').checked=row?.followUp ?? true;
    $('reviewFormTitle').textContent=(row?'编辑':'登记')+(kind==='issues'?'人工事项':'人工确认余额');$('reviewCategoryGroup').hidden=kind!=='issues';$('reviewFollowGroup').hidden=kind!=='balances';$('reviewAmountHint').textContent=kind==='issues'?'参考金额可未知、0 或正负；不会变成确认余额。':'余额必须明确非负。0 不自动关闭；改额、关闭或重开须说明依据。';
    $('reviewForm').hidden=false;reviewBaseline=reviewSignature();error('');api.onDraftChange();
  }
  function render(){
    if(!api)return;
    const state=api.getState(),workbook=state.workbook,{safe,money}=api;
    $('automaticRows').innerHTML=workbook.records.map(row=>({row,kinds:M.reminders(workbook,row)})).filter(item=>item.kinds.length).map(({row,kinds})=>`<p><button class="mini" data-source="${safe(row.id)}">${safe(row.invoice || row.id)} · ${row.date}</button> ${safe(kinds.map(key=>root.TrackerReports.ISSUE_LABELS[key]).join(' · '))} · 差额 ${money(M.calculate(workbook,row).diff)}</p>`).join('') || '<p class="helper">当前没有自动提醒。</p>';
    $('manualRows').innerHTML=['issues','balances'].flatMap(table=>workbook[table].map(row=>`<tr><td>${table==='issues'?'人工事项':'确认余额'}<div class="helper">${safe(row.id)}</div></td><td class="notes">${safe(sourceLabel(row.recordId))}</td><td class="notes">${safe(row.description)}</td><td class="num">${money(row.amountCents===null?null:row.amountCents/100)}</td><td>${row.status}${table==='balances' && !row.followUp?' · 本文件不跟进':''}</td><td><button class="mini" data-entity="${table}" data-id="${safe(row.id)}">编辑／关联／状态</button></td></tr>`)).join('') || '<tr><td colspan="6" class="blank">尚无人工事项或余额。</td></tr>';
    $('bankTotal').textContent=`现存银行记录 ${workbook.bankReceived.length} 笔 · 总额 ${money(workbook.bankReceived.reduce((total,row)=>total+row.amountCents,0)/100)}`;
    $('bankRows').innerHTML=workbook.bankReceived.map(row=>`<tr><td>${row.date}</td><td class="num">${money(row.amountCents/100)}</td><td class="notes">${safe(row.note)}</td><td><button class="mini" data-bank="${safe(row.id)}">编辑</button> <button class="mini danger" data-delete-bank="${safe(row.id)}">删除</button></td></tr>`).join('') || '<tr><td colspan="4" class="blank">尚无银行到账。</td></tr>';
    $('historyRows').innerHTML=workbook.appChanges.map(row=>`<p>App · ${safe(row.invoice || row.recordId)} · ${money(row.oldApp)} → ${money(row.newApp)} · 当时 Estimated ${money(row.estimatedCents/100)}／Difference ${money(row.differenceCents===null?null:row.differenceCents/100)} · 观察 ${safe(row.observedAt)} · 记录 ${safe(row.recordedAt)} · ${safe(row.note)}</p>`).concat(...['issueHistory','balanceHistory'].map(table=>workbook[table].map(row=>`<p>${table==='issueHistory'?'事项':'余额'} · ${safe(row.issueId || row.balanceId)} #${row.sequence} ${row.action} · ${safe(row.timestamp)} · ${safe(sourceLabel(row.recordId))} · ${money(row.amountCents===null?null:row.amountCents/100)} · ${row.status} · ${safe(row.description)} · 依据：${safe(row.reason)}</p>`))).join('') || '<p class="helper">尚无专用历史。</p>';
    for(const key of ['newIssue','newBalance','applyReview','submitBank'])$(key).disabled=state.busy;
  }
  function init(options){
    api=options;reset();
    $('newIssue').onclick=()=>openEntity('issues');$('newBalance').onclick=()=>openEntity('balances');
    $('cancelReview').onclick=()=>{if(!entityDraft() || confirm('确定放弃事项草稿？')){resetEntity();error('');api.onDraftChange()}};
    $('cancelBank').onclick=()=>{if(!bankDraft() || confirm('确定放弃银行草稿？')){resetBank();error('');api.onDraftChange()}};
    for(const key of [...bankFields,...reviewFields])$(key).addEventListener('input',()=>api.onDraftChange());
    $('reviewForm').onsubmit=event=>{
      event.preventDefault();if(api.getState().busy)return;
      if(api.jobHasDraft() || bankDraft()){error('请先提交或取消工作／Config／银行草稿。');return}
      try{
        const input={recordId:$('reviewRecord').value || null,amountCents:parseCents($('reviewAmount').value,{optional:kind==='issues',signed:kind==='issues'}),description:$('reviewDescription').value,status:$('reviewStatus').value};
        if(kind==='issues')input.category=$('reviewCategory').value;else input.followUp=$('reviewFollow').checked;
        const next=(kind==='issues'?M.saveIssue:M.saveBalance)(api.getState().workbook,input,entityId,$('reviewReason').value);
        resetEntity();error('');api.onChange(next);
      }catch(caught){error(caught.message)}
    };
    $('bankForm').onsubmit=event=>{
      event.preventDefault();if(api.getState().busy)return;
      if(api.jobHasDraft() || entityDraft()){error('请先提交或取消工作／Config／事项草稿。');return}
      try{
        const input={date:$('bankDate').value,amountCents:parseCents($('bankAmount').value),note:$('bankNote').value},state=api.getState().workbook;
        if(state.bankReceived.some(row=>row.id!==bankId && row.date===input.date && row.amountCents===input.amountCents) && !confirm('已有同日同额到账。确认这是另一笔独立到账？'))return;
        const next=M.saveBank(state,input,bankId);resetBank();error('');api.onChange(next);
      }catch(caught){error(caught.message)}
    };
    $('reviewPanel').addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button || api.getState().busy)return;
      if(button.dataset.source){api.editRecord(button.dataset.source);return}
      if(button.dataset.entity){openEntity(button.dataset.entity,button.dataset.id);return}
      if(!button.dataset.bank && !button.dataset.deleteBank)return;
      if(api.jobHasDraft() || entityDraft() || bankDraft()){error('请先提交或取消现有草稿。');return}
      const state=api.getState().workbook,row=M.get(state,'bankReceived',button.dataset.bank || button.dataset.deleteBank);
      if(button.dataset.bank){bankId=row.id;$('bankDate').value=row.date;$('bankAmount').value=(row.amountCents/100).toFixed(2);$('bankNote').value=row.note;$('submitBank').textContent='保存到账修改';bankBaseline=bankSignature();api.onDraftChange()}
      else if(confirm(`确认删除到账 ${row.date} · ${api.money(row.amountCents/100)}？仍需 Save 才持久化。`)){try{api.onChange(M.deleteBank(state,row.id));error('')}catch(caught){error(caught.message)}}
    });
  }
  root.TrackerReviewUI=Object.freeze({init,render,reset,hasDraft});
})(globalThis);
