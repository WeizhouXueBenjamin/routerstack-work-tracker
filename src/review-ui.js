(function(root){
  'use strict';
  const R=root.TrackerReconciliation,C=root.TrackerCore,$=id=>document.getElementById(id);
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const cash=value=>value===null || value===undefined || value===''?'未知':'$'+Number(value).toFixed(2);
  const labels=root.TrackerReports.ISSUE_LABELS;
  let ctx,baseline='',editing=null;
  const signature=()=>JSON.stringify(['lRecord','lKind','lAmount','lReason'].map(id=>$(id).value).concat($('lConfirmBalance').checked));
  const hasDraft=()=>!!ctx && signature()!==baseline;
  const error=message=>{$('lError').textContent=message;$('lError').style.display=message?'block':'none'};
  const source=(bundle,id)=>{const row=bundle.tables.records.find(row=>row.id===id);return row?(row.invoice || 'Invoice 待补')+' · '+(row.date || '日期未知')+' · '+row.id:'无工作来源'};
  function reset(){if(!ctx)return;editing=null;$('lManualForm').reset();baseline=signature();error('');syncControls()}
  function blocked(){if(ctx.jobHasDraft() || ctx.otherDraft() || hasDraft()){error('请先提交或取消工作、人工事项或核对输入；当前草稿已保留。');return true}return false}
  function update(next){ctx.onChange(next);error('')}
  function render(){
    if(!ctx)return;const {bundle}=ctx.getState();
    if(!bundle){for(const id of ['lReminders','lHistorical','lIssues','lBalances','lRecord'])$(id).replaceChildren();$('bankReceivedTotal').textContent='旧格式的银行明细未知；显式升级后可登记实际到账。';syncControls();return}
    const selected=$('lRecord').value;
    $('lRecord').innerHTML='<option value="">选择工作／历史来源</option>'+bundle.tables.records.map(row=>`<option value="${row.id}">${esc(source(bundle,row.id))}</option>`).join('');$('lRecord').value=selected;
    const rows=bundle.tables.records.filter(row=>R.automaticReminders(bundle,row).length);
    $('lReminders').innerHTML=rows.map(row=>{const out=R.calculate(bundle,row);return `<tr><td>${row.state==='Job'?'本期':'历史'} · ${esc(row.invoice || 'Invoice 待补')}<br/>${esc(row.date)}</td><td>${cash(out?.total)}</td><td>${cash(row.app)}</td><td>${cash(out?.diff)}</td><td>${esc(R.automaticReminders(bundle,row).map(kind=>labels[kind]).join(' · '))}</td><td><button type="button" data-review-edit="${row.id}">查看／修正来源</button></td></tr>`}).join('') || '<tr><td colspan="6">当前没有适用的自动提醒</td></tr>';
    $('lHistorical').innerHTML=bundle.tables.records.filter(row=>row.state==='Historical').map(row=>{const out=R.calculate(bundle,row),scope=R.reminderScope(row);return `<tr><td>${esc(bundle.tables.cycles.find(c=>c.id===row.originCycleId)?.name || '来源周期未知')}<br/>${esc(row.invoice || 'Invoice 待补')}</td><td>${esc(row.date)}<br/>${esc(row.id)}</td><td>${cash(out?.total)}</td><td>${cash(row.app)} / ${cash(out?.diff)}</td><td>${esc(scope===null?'旧格式未确认，请明确升级':scope.length?scope.map(kind=>labels[kind]).join(' · '):'仅作背景（不生成自动提醒）')}</td><td><button type="button" data-review-edit="${row.id}">修正来源 App／资料</button></td></tr>`}).join('') || '<tr><td colspan="6">没有历史工作来源</td></tr>';
    $('lIssues').innerHTML=bundle.tables.issues.filter(row=>row.kind==='Invoice').map(row=>`<tr><td>${esc(source(bundle,row.recordId))}</td><td>${esc(row.code)}</td><td>${cash(row.amountCents==='' || row.amountCents===undefined?null:row.amountCents/100)}</td><td>${esc(row.status)}</td><td class="notes" title="${esc(row.reason)}">${esc(row.reason)}</td><td><button type="button" data-issue-edit="${row.id}">修改参考金额／说明</button><button type="button" data-issue-status="${row.id}">${row.status==='Open'?'明确解决':'重新打开'}</button></td></tr>`).join('') || '<tr><td colspan="6">尚无人工事项</td></tr>';
    $('lBalances').innerHTML=bundle.tables.records.filter(row=>R.carryRemaining(bundle,row.id)!==null).map(row=>`<tr><td>${esc(source(bundle,row.id))}</td><td>${cash(R.carryRemaining(bundle,row.id)/100)}</td><td>${esc(bundle.tables.confirmations.find(c=>c.active && c.kind==='CarryBalance' && c.recordId===row.id)?.reason || '原文件确认期初余额')}</td><td><button type="button" data-balance-edit="${row.id}">明确修改余额</button></td></tr>`).join('') || '<tr><td colspan="4">没有人工确认余额</td></tr>';
    $('bankReceivedTotal').textContent='Bank Received · 本文件有效到账合计 '+cash(bundle.tables.payments.filter(row=>row.status==='Active').reduce((sum,row)=>sum+row.cents,0)/100)+'；单独列示，不推断单项付款，不扣减人工余额。';
    syncControls();
  }
  function syncControls(){if(!ctx)return;for(const element of $('lightReviewPanel').querySelectorAll('input,select,textarea,button'))element.disabled=!ctx.editable();if(editing){$('lRecord').disabled=true;$('lKind').disabled=true}$('lApply').textContent=editing?'保存人工事项修改':'登记人工事项／明确余额'}
  function init(context){
    ctx=context;reset();
    for(const type of ['input','change'])$('lManualForm').addEventListener(type,()=>ctx.onDraftChange());
    $('lCancel').onclick=()=>{if(hasDraft() && !confirm('确定放弃尚未提交的人工输入？'))return;reset();ctx.onDraftChange()};
    $('lManualForm').addEventListener('submit',event=>{
      event.preventDefault();if(!ctx.editable())return;
      try{
        if(ctx.jobHasDraft() || ctx.otherDraft())throw Error('请先提交或取消其他输入；人工草稿已保留。');
        const bundle=ctx.getState().bundle,recordId=$('lRecord').value,kind=$('lKind').value,amount=$('lAmount').value,reason=$('lReason').value;
        if(!recordId)throw Error('请选择事项来源');let next;
        if(kind==='ConfirmedBalance'){
          if(!$('lConfirmBalance').checked || C.blank(amount))throw Error('确认余额须填写明确金额，并主动勾选已核实确认。');
          next=R.confirmAmount(bundle,{recordId,kind:'CarryBalance',amount,reason});
        }else if(editing)next=R.reviseIssue(bundle,editing,{amount,reason});
        else next=R.addIssue(bundle,{recordId,code:kind,amount,reason});
        update(next);reset();render();ctx.onDraftChange();
      }catch(e){error(e.message)}
    });
    $('lightReviewPanel').addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button || !ctx.editable())return;
      if(!['reviewEdit','issueEdit','issueStatus','balanceEdit'].some(key=>button.dataset[key]))return;
      if(blocked())return;
      const bundle=ctx.getState().bundle;
      try{
        if(button.dataset.reviewEdit){ctx.editRecord(button.dataset.reviewEdit);return}
        if(button.dataset.issueStatus){const row=R.get(bundle,'issues',button.dataset.issueStatus),reason=prompt('请填写人工处理依据；此操作不修改 App、银行或确认余额。',row.reason);if(reason===null)return;update(R.setIssueStatus(bundle,row.id,row.status==='Open'?'Closed':'Open',{reason}));return}
        if(button.dataset.issueEdit){const row=R.get(bundle,'issues',button.dataset.issueEdit);editing=row.id;$('lRecord').value=row.recordId;$('lKind').value=['PaymentQuestion','InvoiceQuestion','OtherQuestion'].includes(row.code)?row.code:'OtherQuestion';$('lAmount').value=row.amountCents==='' || row.amountCents===undefined?'':row.amountCents/100;$('lReason').value=row.reason}
        else{$('lRecord').value=button.dataset.balanceEdit;$('lKind').value='ConfirmedBalance';$('lAmount').value=R.carryRemaining(bundle,button.dataset.balanceEdit)/100;$('lConfirmBalance').checked=false}
        syncControls();$('lReason').focus();ctx.onDraftChange();
      }catch(e){error(e.message)}
    });render();
  }
  root.TrackerReviewUI=Object.freeze({init,render,reset,syncControls,hasDraft});
})(globalThis);
