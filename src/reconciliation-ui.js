(function(root){
  'use strict';
  const R=root.TrackerReconciliation,C=root.TrackerCore,$=id=>document.getElementById(id);
  const esc=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const cash=value=>value===null?'待核实':'$'+(value/100).toLocaleString('en-NZ',{minimumFractionDigits:2,maximumFractionDigits:2});
  const day=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
  const localDay=value=>value.includes('T')?(()=>{const d=new Date(value);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`})():value;
  const localMinute=value=>{if(!value)return '';const d=new Date(value);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16)};
  const actions={batch:'创建核对批次',attach:'关联到账与批次',detach:'解除到账批次归属',scope:'选择并确认结算范围',allocate:'凭依据关联 Invoice 付款',reverse:'撤销付款关联',payable:'确认该项应结金额',carry:'确认需结转的历史余额',close:'批次金额匹配，确认核对完成',explain:'凭处理结论关闭非零差额',reopen:'重新打开批次',empty:'关闭尚无到账的空批次',issue:'登记独立 Invoice / 付款问题',closeIssue:'人工关闭独立问题',openIssue:'重新打开独立问题',correct:'更正到账资料',void:'作废错误登记的到账',evidence:'修订证据说明',edit:'查看／补齐工作原始资料'};
  actions.observation='修订既有 App 观察资料';
  actions.clearScope='凭依据撤销暂定结算范围';
  let ctx,bankBaseline='',opBaseline='',evidenceBaseline='',proofReasonBaseline='',observationBaseline='',lastRevision=0,stale=false,allAudit=false,selectedEvidence='',selectedBatch='',selectedObservation='';
  const bankSignature=()=>JSON.stringify(['rDate','rAmount','rNote'].map(id=>$(id).value));
  function opSignature(){const action=$('rAction').value,ids=['rPayment','rRecord','rAllocation','rIssue','rValue','rName','rEvidence','rReason','rEvidenceSummary','rEvidenceSource','rEvidenceRef','rCorrectDate','rCorrectNote','rObservation','rObservedAt','rObservationSource','rObservationNote'];if(!action && !ids.some(id=>$(id).value))return '';return JSON.stringify({action,fields:['rBatch','rEvidenceDate',...ids].map(id=>$(id).value),scope:action==='scope'?[...$('rScopeRows').querySelectorAll('[data-scope-record]:checked')].map(input=>[input.dataset.scopeRecord,$('rScopeRows').querySelector(`[data-scope-kind="${input.dataset.scopeRecord}"]`).value]):[],flags:['rScopeConfirmed','rBasisConfirmed','rActualConfirmed'].map(id=>$(id).checked)})}
  const observationSignature=()=>JSON.stringify(['rObservedAt','rObservationSource','rObservationNote'].map(id=>$(id).value));
  const evidenceSignature=()=>JSON.stringify(['rEvidenceDate','rEvidenceSummary','rEvidenceSource','rEvidenceRef'].map(id=>$(id).value));
  const hasDraft=()=>!!ctx && (bankSignature()!==bankBaseline || opSignature()!==opBaseline);
  const error=message=>{$('rError').textContent=message;$('rError').style.display=message?'block':'none'};
  function options(id,rows,label,empty){const selected=$(id).value;$(id).innerHTML=`<option value="">${esc(empty)}</option>`+rows.map(row=>`<option value="${esc(row.id)}">${esc(label(row))}</option>`).join('');$(id).value=rows.some(row=>row.id===selected)?selected:''}
  function selectedProof(){
    const evidenceId=$('rEvidence').value;
    if(evidenceId && evidenceSignature()!==evidenceBaseline && $('rAction').value!=='evidence')throw Error('证据说明尚未提交修改。请先修订所选证据，或选择“新依据”保存本次说明。');
    return {reason:$('rReason').value,evidenceId,evidence:{confirmedAt:$('rEvidenceDate').value || undefined,summary:$('rEvidenceSummary').value,source:$('rEvidenceSource').value,reference:$('rEvidenceRef').value}};
  }
  function proofSelected(){
    const bundle=ctx.getState().bundle,row=bundle?.tables.evidence.find(row=>row.id===$('rEvidence').value);
    $('rReason').value=row?.reason || row?.summary || '';$('rEvidenceDate').value=row?localDay(row.confirmedAt):day();
    $('rEvidenceSummary').value=row?.summary || '';$('rEvidenceSource').value=row?.source || '';$('rEvidenceRef').value=row?.reference || '';
    evidenceBaseline=evidenceSignature();proofReasonBaseline=$('rReason').value;selectedEvidence=$('rEvidence').value;
  }
  function bankReset(){$('rBankForm').reset();$('rDate').value=day();bankBaseline=bankSignature()}
  function opReset(){
    const selected=$('rBatch').value;$('rOpsForm').reset();$('rBatch').value=selected;$('rAction').value='';proofSelected();selectedObservation='';observationBaseline=observationSignature();showAction();opBaseline=opSignature();stale=false;
  }
  function showAction(){
    const action=$('rAction').value;
    const groups={rNameGroup:['batch'],rPaymentGroup:['attach','detach','allocate','correct','void'],rRecordGroup:['allocate','payable','carry','issue','edit'],rAllocationGroup:['reverse'],rIssueGroup:['closeIssue','openIssue'],rValueGroup:['allocate','payable','carry','correct'],rCorrectionGroup:['correct'],rScopeGroup:['scope']};
    for(const [id,active] of Object.entries(groups))$(id).hidden=!active.includes(action);
    $('rProofGroup').hidden=!action || ['batch','edit','observation'].includes(action);
    $('rObservationGroup').hidden=action!=='observation';
    $('rApply').disabled=!ctx.editable() || !action;
    if(action==='scope')renderScope();
  }
  function renderScope(){
    const bundle=ctx.getState().bundle;if(!bundle)return;
    const chosen=new Map([...$('rScopeRows').querySelectorAll('[data-scope-record]:checked')].map(input=>[input.dataset.scopeRecord,$('rScopeRows').querySelector(`[data-scope-kind="${input.dataset.scopeRecord}"]`).value]));
    const persisted=bundle.tables.scope.filter(row=>row.batchId===$('rBatch').value && row.active);
    if(!chosen.size)for(const row of persisted)chosen.set(row.recordId,row.kind);
    $('rScopeRows').innerHTML=bundle.tables.records.map(record=>{
      const estimate=R.calculate(bundle,record),balance=R.carryRemaining(bundle,record.id),kind=chosen.get(record.id) || (record.state==='Opening'?'Balance':'Theory');
      return `<label class="scope-line"><input type="checkbox" data-scope-record="${record.id}" ${chosen.has(record.id)?'checked':''}/><span>${esc(record.invoice || 'Invoice 待补')} · ${esc(record.date || '日期待补')} · ${esc(record.site)}<br/><small>参考理论 ${estimate?cash(R.cents(estimate.total)):'待核算'}；确认历史余额 ${cash(balance)}</small></span><select data-scope-kind="${record.id}" aria-label="${esc(record.invoice || record.id)} 比较金额类型"><option value="Theory" ${kind==='Theory'?'selected':''}>理论金额</option><option value="Balance" ${kind==='Balance'?'selected':''}>确认历史余额</option></select></label>`;
    }).join('') || '<p>没有可选来源。待补记录的未知收入不能作为零金额纳入比较。</p>';
  }
  function apply(next){
    const previous=ctx.getState().bundle;
    if(next.audit.length===previous.audit.length){error('没有需要保存的变化');return}
    ctx.onChange(next);
    error('');
  }
  function submitOperation(event){
    event.preventDefault();if(!ctx.editable())return;
    try {
      if(ctx.jobHasDraft())throw Error('工作表单有尚未提交的内容，请先提交或取消；本区输入已保留。');
      if(stale){stale=false;error('资料已变化，选择和金额已保留。请核对当前来源及到账总额，再次提交；范围与口径须重新确认。');return}
      const state=ctx.getState(),bundle=state.bundle,action=$('rAction').value,batchId=$('rBatch').value,paymentId=$('rPayment').value,recordId=$('rRecord').value,amount=$('rValue').value;
      if(action==='edit'){if(bankSignature()!==bankBaseline)throw Error('请先登记或取消银行到账输入');if(!recordId)throw Error('请选择工作来源');if(ctx.editRecord(recordId)!==false){opReset();ctx.onDraftChange()}return}
      const p=['batch','observation'].includes(action)?{}:selectedProof();let next;
      switch(action){
        case 'batch':next=R.addBatch(bundle,{name:$('rName').value});break;
        case 'attach':next=R.attachPayment(bundle,paymentId,batchId,p);break;
        case 'detach':next=R.detachPayment(bundle,paymentId,p);break;
        case 'allocate':next=R.allocatePayment(bundle,{paymentId,recordId,amount,...p});break;
        case 'reverse':next=R.reverseAllocation(bundle,$('rAllocation').value,p);break;
        case 'payable':next=R.confirmAmount(bundle,{recordId,amount,kind:'Payable',...p});break;
        case 'carry':next=R.confirmAmount(bundle,{recordId,amount,kind:'CarryBalance',...p});break;
        case 'scope':next=R.setBatchScope(bundle,batchId,[...$('rScopeRows').querySelectorAll('[data-scope-record]:checked')].map(input=>({recordId:input.dataset.scopeRecord,kind:$('rScopeRows').querySelector(`[data-scope-kind="${input.dataset.scopeRecord}"]`).value})),{...p,scopeConfirmed:$('rScopeConfirmed').checked,basisConfirmed:$('rBasisConfirmed').checked,actualConfirmed:$('rActualConfirmed').checked});break;
        case 'clearScope':next=R.clearBatchScope(bundle,batchId,p);break;
        case 'close':next=R.closeBatch(bundle,batchId,p);break;
        case 'explain':next=R.closeBatch(bundle,batchId,{...p,explained:true});break;
        case 'reopen':next=R.reopenBatch(bundle,batchId,p);break;
        case 'empty':next=R.closeEmptyBatch(bundle,batchId,p);break;
        case 'issue':next=R.addIssue(bundle,{recordId,batchId:'',...p});break;
        case 'closeIssue':next=R.setIssueStatus(bundle,$('rIssue').value,'Closed',p);break;
        case 'openIssue':next=R.setIssueStatus(bundle,$('rIssue').value,'Open',p);break;
        case 'correct':next=R.correctPayment(bundle,paymentId,{amount:amount || undefined,date:$('rCorrectDate').value || undefined,note:$('rCorrectNote').value || undefined,...p});break;
        case 'void':next=R.correctPayment(bundle,paymentId,{void:true,...p});break;
        case 'evidence':{const row=R.get(bundle,'evidence',$('rEvidence').value),date=$('rEvidenceDate').value;next=R.updateEvidence(bundle,row.id,{reason:$('rReason').value,summary:$('rEvidenceSummary').value,source:$('rEvidenceSource').value,reference:$('rEvidenceRef').value,confirmedAt:date===localDay(row.confirmedAt)?row.confirmedAt:date});break}
        case 'observation':{const row=R.get(bundle,'observations',$('rObservation').value),value=$('rObservedAt').value;next=R.reviseObservation(bundle,row.id,{observedAt:value===localMinute(row.observedAt)?row.observedAt:value?new Date(value).toISOString():'',source:$('rObservationSource').value,note:$('rObservationNote').value});break}
        default:throw Error('请选择要执行的核对操作');
      }
      if(action==='batch'){$('rBatch').value='';apply(next);$('rBatch').value=next.tables.batches.at(-1).id}else apply(next);
      opReset();render();ctx.onDraftChange();
    } catch(e){error(e.message)}
  }
  function render(){
    if(!ctx)return;const state=ctx.getState(),bundle=state.bundle;
    $('rReadOnly').hidden=!!bundle;
    if(!bundle){for(const id of ['rPayments','rSources','rIssues','rObservations','rAuditRows'])$(id).replaceChildren();$('rBatchSummary').textContent='请先显式升级旧版本';$('rUnallocated').textContent='';syncControls();return}
    const dirty=opSignature()!==opBaseline;
    if(dirty && lastRevision!==state.revision){stale=true;for(const id of ['rScopeConfirmed','rBasisConfirmed','rActualConfirmed'])$(id).checked=false}
    options('rBatch',bundle.tables.batches,row=>`${row.name} · ${R.batchSummary(bundle,row.id).label}`,'选择核对批次（仅查看不改变范围）');
    options('rPayment',bundle.tables.payments.filter(row=>row.status==='Active'),row=>`${row.date} · ${cash(row.cents)} · ${row.note}`,'选择银行到账');
    options('rRecord',bundle.tables.records,row=>`${row.invoice || 'Invoice 待补'} · ${row.date || '日期待补'} · ${row.site} · ${row.state}`,'选择工作／历史来源');
    options('rAllocation',bundle.tables.allocations,row=>`${row.invoice} · ${cash(row.cents)} · ${row.status}`,'选择付款关联');
    options('rIssue',bundle.tables.issues.filter(row=>!['Settlement','App'].includes(row.kind)),row=>`${bundle.tables.records.find(record=>record.id===row.recordId)?.invoice || ''} · ${row.code} · ${row.status}`,'选择独立问题');
    options('rEvidence',bundle.tables.evidence,row=>`${localDay(row.confirmedAt)} · ${row.source} · ${(row.summary || row.reason).slice(0,65)}`,'新依据（或复用已记录证据）');
    options('rObservation',bundle.tables.observations,row=>`${row.invoice || '待补'} · ${row.oldAmount} → ${row.newAmount} · ${row.recordedAt}`,'选择既有观察');
    const batchId=$('rBatch').value;
    if(batchId){const view=R.batchSummary(bundle,batchId);$('rBatchSummary').textContent=`${view.label} · 来源 ${view.scopeCount} 项 · 银行到账 ${view.paymentCount} 笔 ${cash(view.actualCents)} · Expected Settlement ${cash(view.expectedCents)} · Pending Difference ${cash(view.differenceCents)}。差额不是已确认欠款。`}
    else $('rBatchSummary').textContent='先登记实际到账，稍后选择核对批次。未确认范围及金额口径时，不计算本次结算差额。';
    const unallocated=R.unallocatedPayments(bundle);$('rUnallocated').textContent=`待核对／未分配款 ${cash(unallocated.reduce((sum,row)=>sum+row.unallocatedCents,0))}（${unallocated.length} 笔）；已确认批次级核对的付款不因缺逐笔明细重复待处理。`;
    $('rPayments').innerHTML=bundle.tables.payments.map(row=>`<tr><td>${esc(row.date)}</td><td>${cash(row.cents)}</td><td>${esc(bundle.tables.batches.find(batch=>batch.id===row.batchId)?.name || 'Unallocated Payment')}</td><td>${cash(R.paymentAllocated(bundle,row.id))}</td><td>${esc(row.status)}</td><td class="notes">${esc(row.note)}</td></tr>`).join('') || '<tr><td colspan="6">尚未登记银行到账</td></tr>';
    $('rSources').innerHTML=bundle.tables.records.map(row=>{const v=R.invoiceSummary(bundle,row.id),out=R.calculate(bundle,row),checks=R.automaticReminders(bundle,row).map(kind=>TrackerReports.ISSUE_LABELS[kind]);return `<tr><td>${esc(row.invoice || '待补')}</td><td>${esc(row.state)} · ${esc(row.date)}</td><td>${esc(row.site)}</td><td>${cash(v.estimateCents)}<br/><small>App ${row.app===''?'未知':'$'+Number(row.app).toFixed(2)} · 差额 ${out?.diff==null?'未知':cash(R.cents(out.diff))}<br/>${esc(checks.join(' · ') || '无自动提醒')}</small></td><td>${cash(v.paidCents)}</td><td>${cash(v.confirmedPayableCents)}</td><td>${cash(v.carryRemainingCents)}</td><td>${esc(v.flags.join(' · ') || (R.coveredAtBatchLevel(bundle,row.id)?'批次级已核对，非逐笔付款证明':'结算待核实'))}</td></tr>`}).join('') || '<tr><td colspan="8">无工作来源</td></tr>';
    $('rIssues').innerHTML=bundle.tables.issues.filter(row=>row.kind!=='App').map(row=>`<tr><td>${esc(row.kind)} / ${esc(row.code)}</td><td>${esc(bundle.tables.records.find(record=>record.id===row.recordId)?.invoice || bundle.tables.batches.find(batch=>batch.id===row.batchId)?.name || '待补来源')}</td><td>${esc(row.status)}</td><td class="notes">${esc(row.reason)}</td></tr>`).join('') || '<tr><td colspan="4">尚无争议记录；完整工作未纳入已核对范围时仍需保留。</td></tr>';
    $('rObservations').innerHTML=bundle.tables.observations.map(row=>`<tr><td>${esc(row.invoice || 'Invoice 待补')}</td><td>${row.oldAmount===''?'未知':esc(row.oldAmount)} → ${row.newAmount===''?'未知':esc(row.newAmount)}</td><td>${row.differenceCents===''?'待核算':cash(row.differenceCents)}</td><td>${esc(row.observedAt || '历史观察时间未知')}</td><td>${esc(row.source)}</td><td>${esc(row.note)}</td></tr>`).join('') || '<tr><td colspan="6">App 金额实际变化时才追加观察历史</td></tr>';
    const events=[...bundle.audit].sort((a,b)=>b.sequence-a.sequence);$('rAuditCount').textContent=String(events.length);
    $('rAuditRows').innerHTML=(allAudit?events:events.slice(0,50)).map(event=>{
      const evidence=bundle.tables.evidence.find(row=>row.id===event.evidenceId),changes=bundle.changes.filter(row=>row.eventId===event.id).sort((a,b)=>a.ordinal-b.ordinal);
      return `<tr><td>${event.sequence}</td><td>${esc(event.at)}</td><td>${esc(event.type)}</td><td>${esc(event.reason)}<br/>${esc(evidence?[evidence.summary,evidence.source,evidence.reference].filter(Boolean).join(' · '):'')}<details><summary>查看字段前后值（${changes.length}）</summary><pre>${esc(changes.map(row=>`${row.table} / ${row.recordId} / ${row.field}: ${row.oldType==='absent'?'不存在':row.oldValue} → ${row.newType==='absent'?'移除':row.newValue}`).join('\n'))}</pre></details></td></tr>`;
    }).join('');
    if($('rAction').value==='scope' && !dirty)renderScope();
    lastRevision=state.revision;selectedBatch=$('rBatch').value;if(!dirty)opBaseline=opSignature();syncControls();
  }
  function syncControls(){if(!ctx)return;for(const input of $('reconciliationPanel').querySelectorAll('input,select,textarea,button'))if(input.id!=='rAllAudit')input.disabled=!ctx.editable();if(!$('rAction').value)$('rApply').disabled=true}
  function reset(){if(!ctx)return;bankReset();opReset();lastRevision=ctx.getState().revision;render();opBaseline=opSignature()}
  function init(context){
    ctx=context;$('rAction').innerHTML='<option value="">选择操作</option>'+Object.entries(actions).map(([value,label])=>`<option value="${value}">${label}</option>`).join('');
    $('rBankForm').addEventListener('submit',event=>{event.preventDefault();if(!ctx.editable())return;try{if(ctx.jobHasDraft())throw Error('工作表单有未提交修改，请先提交或取消');const input={date:$('rDate').value,amount:$('rAmount').value,note:$('rNote').value};let next;try{next=R.addPayment(ctx.getState().bundle,input)}catch(e){if(!e.message.includes('同日期同金额') || !confirm(e.message+'。确认是另一笔独立到账吗？'))throw e;next=R.addPayment(ctx.getState().bundle,{...input,duplicateConfirmed:true})}apply(next);bankReset();ctx.onDraftChange()}catch(e){error(e.message)}});
    $('rOpsForm').addEventListener('submit',submitOperation);
    $('rAction').addEventListener('change',()=>{showAction();ctx.onDraftChange()});
    $('rBatch').addEventListener('change',()=>{if($('rAction').value==='scope'){if(!confirm('切换批次会重新加载范围选择并清除本次确认标记，是否继续？')){$('rBatch').value=selectedBatch;return}$('rScopeRows').replaceChildren();renderScope();for(const id of ['rScopeConfirmed','rBasisConfirmed','rActualConfirmed'])$(id).checked=false}render();ctx.onDraftChange()});
    $('rEvidence').addEventListener('change',()=>{if((evidenceSignature()!==evidenceBaseline || $('rReason').value!==proofReasonBaseline) && !confirm('切换依据会替换尚未提交的证据说明，是否继续？')){$('rEvidence').value=selectedEvidence;return}proofSelected();ctx.onDraftChange()});
    $('rObservation').addEventListener('change',()=>{if(observationSignature()!==observationBaseline && !confirm('切换观察会替换尚未提交的观察说明，是否继续？')){$('rObservation').value=selectedObservation;return}const row=ctx.getState().bundle?.tables.observations.find(row=>row.id===$('rObservation').value);selectedObservation=$('rObservation').value;$('rObservedAt').value=localMinute(row?.observedAt);$('rObservationSource').value=row?.source || '';$('rObservationNote').value=row?.note || '';observationBaseline=observationSignature();ctx.onDraftChange()});
    for(const form of ['rBankForm','rOpsForm'])for(const type of ['input','change'])$(form).addEventListener(type,()=>ctx.onDraftChange());
    $('rClearBank').onclick=()=>{if(bankSignature()!==bankBaseline && !confirm('确定清空尚未登记的到账输入？'))return;bankReset();error('');ctx.onDraftChange()};
    $('rClearOp').onclick=()=>{if(opSignature()!==opBaseline && !confirm('确定放弃尚未提交的核对操作？'))return;opReset();error('');ctx.onDraftChange()};
    $('rAllAudit').onclick=()=>{allAudit=!allAudit;$('rAllAudit').textContent=allAudit?'只显示最近 50 次':'显示全部审计';render()};
    reset();
  }
  root.TrackerReconciliationUI=Object.freeze({init,render,reset,syncControls,hasDraft});
})(globalThis);
