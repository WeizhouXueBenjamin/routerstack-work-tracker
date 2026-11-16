'use strict';
const Core=TrackerCore;
const Reconcile=TrackerReconciliation;
const Reports=TrackerReports;
const $=id=>document.getElementById(id);
const fields=['date','invoice','start','end','lunch','rate','app','extra','note'];
const money=value=>'$'+Number(value || 0).toLocaleString('en-NZ',{minimumFractionDigits:2,maximumFractionDigits:2});
const safe=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let uid=0;
const state={bundle:Reconcile.create(),records:[],config:{...Core.DEFAULT_CONFIG},version:'4.1',fileName:'RouterStack_Cycle.xlsx',sourceHandle:null,protectedHandles:[],archiveHandles:[],archiveFiles:new Set(),sourceWritable:false,recent:null,opened:false,editing:null,revision:0,persistedRevision:0,pending:null,busy:false,formBaseline:'',review:null,carryCandidates:[],carryBaseline:null};
Object.defineProperty(state,'dirty',{get:()=>state.revision!==state.persistedRevision});
const editable=()=>state.version==='4.1';
const calculationVersion=()=>state.version==='2.0'?'2.0':'3.0';
const calculate=record=>Core.calculate(record,state.config,calculationVersion());
const openZip=input=>TrackerWorkbook.read(input);
const buildExport=(bundle,config,filename)=>TrackerWorkbook.write(bundle,{fileName:filename});
const clone=value=>JSON.parse(JSON.stringify(value));
const identified=records=>records.map(record=>({...record,uid:'record-'+(++uid)}));
const changed=()=>{state.revision++;summary()};
function useBundle(bundle){state.bundle=bundle;state.records=Reconcile.viewRecords(bundle);state.config=Reconcile.config(bundle);state.version=bundle.schemaVersion}
function formValues() {
  const values=Object.fromEntries(fields.map(id=>[id,$(id).value]));
  values.invoice=values.invoice.trim().toUpperCase();
  return {...values,kind:'Job',balance:''};
}
const formSignature=()=>JSON.stringify([formValues(),...['observedAt','observationSource','observationNote'].map(id=>$(id).value)]);
const hasDraft=()=>formSignature()!==state.formBaseline;
const defaultRate=()=>state.bundle?.tables.entrySettings[0].defaultRate ?? '';
const settingsDraft=()=>$('defaultRate').value!==String(defaultRate());
const reconDraft=()=>TrackerReconciliationUI.hasDraft() || TrackerReviewUI.hasDraft();
const carrySignature=()=>JSON.stringify([['cycleName','cycleStart','cycleEnd'].map(id=>$(id).value),carrySelectionInput()]);
const hasCarryDraft=()=>$('cycleModal').open && state.carryBaseline!==null && carrySignature()!==state.carryBaseline;
const hasUnsaved=()=>state.dirty || state.pending!==null || hasDraft() || settingsDraft() || reconDraft() || hasCarryDraft();
function showError(id,message){$(id).textContent=message;$(id).style.display=message?'block':'none'}
function noDraft() {
  if(settingsDraft()){showError('defaultRateError','默认费率尚未应用，请先应用或取消设置草稿。');$('defaultRate').focus();return false}
  if(reconDraft()){showError('rError','对账区有未提交的输入，请先登记／提交或明确取消，再保存、切换或复制。');$('reconciliationPanel').scrollIntoView();return false}
  if(!hasDraft())return true;
  showError('formError','表单有尚未提交的内容。请先添加／保存这项修改，或明确取消，再执行此操作。');
  $('submitJob').focus();return false;
}
function discardDraft(){return !hasDraft() || confirm('表单中有尚未提交的内容。确定放弃这部分修改吗？')}
function clearForm() {
  $('jobForm').reset();
  const today=new Date();
  state.newDate ||= `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  $('date').value=state.newDate;$('rate').value=defaultRate();
  state.editing=null;state.composing=false;state.formBaseline=formSignature();
  $('formTitle').textContent='新增工作记录';$('submitJob').textContent='添加这项工作';$('cancelEdit').style.display='none';
  showError('formError','');updatePreview();
}
function renderRules() {
  const config=state.config;
  const period=state.version==='2.0'?`${Core.timeText(config.ahStart)}–24:00（旧规则）`:`${Core.timeText(config.ahStart)}–${Core.timeText(config.ahEnd)}`;
  $('rulesBox').textContent=`Config · 最低 ${config.minHours} h · AH ${period} · ${config.mult}× · 差额提醒阈值 ${money(config.tolerance)}。Lunch 先扣普通时段。`+(state.version==='2.0'?'当前为 2.0 只读模式；升级前会逐笔预览金额变化。':'不足最低工时按扣休息后的普通／AH 占比分配。规则适用于当前周期；在 Excel 修改 Config 后重开并确认差异。');
}
function updatePreview() {
  const original=state.bundle?.tables.records.find(row=>row.id===state.editing);
  const out=original && original.state!=='Job'?Core.calculate(formValues(),Reconcile.rulesFor(state.bundle,original),original.calculationVersion):calculate(formValues());
  $('liveExpected').textContent=out?money(out.total):'—';
  $('liveHours').textContent=out?`${out.bill.toFixed(2)} (${out.ah.toFixed(2)})`:'—';
  $('liveHint').textContent=out?'括号内为 AH Paid Hours；App 金额不参与估算':'填写有效时间和费率以预览估算';
}
function summary() {
  const total=Reports.totals(state.records,state.config,calculationVersion());
  $('kJobs').textContent=total.count;
  $('kExpected').textContent=money(total.expected);
  $('kApp').textContent=total.comparableCount?money(total.app):'—';
  $('kDiff').textContent=total.comparableCount?money(total.difference):'—';
  const messages=[state.opened?'当前文件：'+state.fileName:'使用内置空白 4.1 数据包'];
  if(state.bundle){const cycle=Reconcile.get(state.bundle,'cycles',state.bundle.cycleId);messages.push('工作周期：'+cycle.name+(cycle.start || cycle.end?' · '+(cycle.start || '未指定')+'–'+(cycle.end || '未指定'):''))}
  if(!editable())messages.push(state.version+' 旧版本只读；需显式升级后另存');
  if(hasDraft())messages.push('表单内容尚未提交');
  if(settingsDraft())messages.push('默认费率设置尚未应用');
  if(reconDraft())messages.push('对账输入尚未提交');
  if(hasCarryDraft())messages.push('有尚未生成文件的新周期资料');
  if(state.dirty)messages.push('有尚未保存的记录修改');
  if(state.pending)messages.push('已发起下载，待确认保留：'+state.pending.filename);
  if(state.busy)messages.push('正在处理文件');
  if(!hasUnsaved() && !state.busy)messages.push('已载入／就绪');
  $('statusBar').textContent=messages.join(' · ');
  $('confirmDownload').hidden=!state.pending;
  $('confirmDownload').disabled=state.busy;
  $('upgradeBtn').hidden=editable();
  $('upgradeBtn').textContent='预览升级为 4.1';
  $('upgradeBtn').disabled=state.busy;
  $('saveBtn').disabled=state.busy || !editable();
  $('saveAsBtn').disabled=state.busy || !editable();
  $('recentBtn').disabled=state.busy;
  $('cycleBtn').disabled=state.busy || !editable() || !Reconcile.buildCarryForwardPlan;
  $('openBtn').disabled=state.busy;
  $('copyBtn').disabled=state.busy;
  $('createCycle').disabled=state.busy;
  $('closeCycle').disabled=state.busy;
  for(const input of $('cycleModal').querySelectorAll('input'))input.disabled=state.busy;
  for(const follow of $('carryRows').querySelectorAll('[data-carry-follow]'))for(const input of $('carryRows').querySelectorAll(`[data-carry-record="${follow.dataset.carryFollow}"]`))input.disabled=state.busy || !follow.checked;
  for(const input of $('jobForm').querySelectorAll('input,textarea,button'))input.disabled=!editable();
  for(const input of $('defaultRateForm').querySelectorAll('input,button'))input.disabled=!editable() || state.busy;
  TrackerReconciliationUI.syncControls();
  TrackerReviewUI.syncControls();
  renderRules();
}
const viewOptions=()=>({month:$('monthFilter').value,query:$('search').value,issue:$('issueFilter').value,version:calculationVersion()});
function syncMonths() {
  const selected=$('monthFilter').value,available=Reports.months(state.records);
  const options=selected && !available.includes(selected)?[...available,selected].sort().reverse():available;
  $('monthFilter').innerHTML='<option value="">全部月份（当前文件）</option>'+options.map(month=>`<option value="${month}"${month===selected?' selected':''}>${month}${available.includes(month)?'':'（无工作）'}</option>`).join('');
}
function renderCopyHint() {
  const scope=$('copyScope').value;
  $('copyScopeHint').textContent=scope==='visible'?'复制当前可见工作与可见结转；结转仅受文本搜索影响。':'按所选月份'+(scope==='all'?'复制全部工作':'复制差额、Invoice 待补或 App 待填的工作')+'，不受文本搜索／提醒筛选影响；附本文件全部确认结转，单独列示。';
}
function showRows() {
  syncMonths();
  const options=viewOptions(),view=Reports.view(state.records,state.config,options),total=view.totals;
  $('viewScope').textContent=(options.month || '全部月份')+' · 当前文件的新工作，按原工作日期统计；下方搜索／提醒筛选不改变月度合计。';
  $('mJobs').textContent=total.count;$('mExpected').textContent=money(total.expected);
  $('mApp').textContent=total.comparableCount?money(total.app):'—';$('mDiff').textContent=total.comparableCount?money(total.difference):'—';
  $('comparisonSummary').textContent=`已填 App 的 ${total.comparableCount} 项工作预计合计 ${money(total.comparableExpected)}；Billable (AH) 合计 ${total.billable.toFixed(2)} (${total.ah.toFixed(2)}) h。空白 App 不参与金额比较。`;
  $('missingSummary').textContent=`所选月份：Invoice 待补 ${total.missingInvoice} 项；App 待填 ${total.missingApp} 项。差额超过 ${money(state.config.tolerance)} 才提醒，差额不表示已确认欠款。`;
  $('rowCount').textContent=`显示工作 ${view.jobs.length}/${view.allJobs.length} · 结转 ${view.carryovers.length}/${view.allCarryovers.length}（本期工作 ${view.allJobs.length}/300 条）`;
  $('rows').innerHTML=view.jobs.length?view.jobs.map(record=>{
    const out=calculate(record),flags=Reports.issues(record,state.config,calculationVersion());
    return `<tr><td>${safe(record.date)}</td><td class="${!record.invoice?'missing':''}">${safe(record.invoice || '待补')}</td><td>${safe(record.start+'–'+record.end)}</td><td>${out.bill.toFixed(2)} (${out.ah.toFixed(2)})</td><td class="num">${money(out.total)}</td><td class="num">${Core.blank(record.app)?'—':money(record.app)}</td><td class="num ${flags.includes('difference')?'diff':''}">${out.diff===null?'—':money(out.diff)}</td><td class="notes" title="${safe(record.note)}">${safe(record.note || '—')}</td><td class="checks">${flags.map(flag=>safe(Reports.ISSUE_LABELS[flag])).join(' · ') || '—'}</td><td>${!editable()?'只读':`<button class="mini" data-edit="${record.uid}">编辑</button> <button class="mini danger" data-delete="${record.uid}">删除</button>`}</td></tr>`;
  }).join(''):'<tr><td colspan="10" class="blank">没有匹配的工作；可以清除筛选查看其他记录。</td></tr>';
  $('carryoverSection').hidden=!view.allCarryovers.length;
  $('carrySummary').textContent=`本文件确认结转共 ${view.allCarryovers.length} 条，余额合计 ${money(view.carryTotal)}；当前搜索显示 ${view.carryovers.length} 条。不计入所选月份的新工作预计。`;
  $('carryoverRows').innerHTML=view.carryovers.length?view.carryovers.map(record=>`<tr class="trcarry"><td>${safe(record.invoice)}</td><td>${safe(record.date || '未记录')}</td><td class="num">${money(record.balance)}</td><td class="notes" title="${safe(record.note)}">${safe(record.note || '—')}</td></tr>`).join(''):'<tr><td colspan="4" class="blank">没有匹配此搜索的结转；文件中的余额保持不变。</td></tr>';
  renderCopyHint();TrackerReconciliationUI.render();TrackerReviewUI.render();summary();
}
$('jobForm').addEventListener('submit',event=>{
  event.preventDefault();
  if(!editable() || state.composing || state.composedEnter)return;
  if(settingsDraft()){showError('formError','请先应用或取消默认费率设置；工作输入已保留。');return}
  const record=formValues(), original=state.bundle.tables.records.find(row=>row.id===state.editing);
  let error=Core.validateRecord(record,original?Reconcile.rulesFor(state.bundle,original):state.config);
  if(!error && state.editing!==null && !original)error='正在编辑的记录已不存在，请重新选择。';
  if(!error && record.invoice && state.bundle.tables.records.some(row=>row.id!==state.editing && row.invoice===record.invoice))error='Invoice ID 重复：'+record.invoice;
  if(!error && !original && Reconcile.currentRecords(state.bundle).length>=Core.MAX_RECORDS)error='本周期已达 300 条，请先保存并创建新周期。表单内容已保留。';
  showError('formError',error);if(error)return;
  const changedBasis=original && ['date','invoice','start','end','lunch','rate','extra'].some(key=>String(original[key])!==String(record[key]));
  if(changedBasis){
    const linked=state.bundle.tables.allocations.some(row=>row.recordId===original.id) || state.bundle.tables.scope.some(row=>row.recordId===original.id);
    if(linked){const before=Reconcile.calculate(state.bundle,original),after=Core.calculate(record,Reconcile.rulesFor(state.bundle,original));if(!confirm(`原始依据更正预览：${original.invoice || 'Invoice 待补'} → ${record.invoice || 'Invoice 待补'}；理论 ${before?money(before.total):'未知'} → ${after?money(after.total):'未知'}。已有付款和比较快照保留；相关批次将标记需重新核对。确认提交？`))return}
  }
  if(original && Number(original.app)===Number(record.app) && Core.blank(original.app)===Core.blank(record.app) && ['observedAt','observationSource','observationNote'].some(id=>$(id).value)){showError('formError','App 金额没有变化。请在对账区“修订既有 App 观察资料”中调整观察说明；当前输入已保留。');return}
  const observation={source:$('observationSource').value || 'RouterStack App',observedAt:$('observedAt').value?new Date($('observedAt').value).toISOString():undefined,note:$('observationNote').value};
  try{useBundle(original?Reconcile.updateRecord(state.bundle,state.editing,record,{...observation,promote:original.state==='Pending'}):Reconcile.addRecord(state.bundle,record,observation))}
  catch(error){showError('formError',error.message);return}
  if(!original)state.newDate=record.date;
  state.revision++;clearForm();showRows();$('start').focus();
});
$('jobForm').addEventListener('compositionstart',()=>{state.composing=true});
$('jobForm').addEventListener('compositionend',()=>{state.composing=false});
$('jobForm').addEventListener('keydown',event=>{if(event.key==='Enter' && (event.isComposing || event.keyCode===229)){state.composedEnter=true;setTimeout(()=>{state.composedEnter=false},0)}});
$('defaultRateForm').addEventListener('submit',event=>{
  event.preventDefault();if(!editable() || state.busy)return;
  if(hasDraft() || reconDraft()){showError('defaultRateError','请先提交或取消工作／核对输入；设置草稿已保留。');return}
  try{useBundle(Reconcile.setDefaultRate(state.bundle,$('defaultRate').value));state.revision++;$('defaultRate').value=defaultRate();clearForm();showError('defaultRateError','');showRows()}
  catch(error){showError('defaultRateError',error.message)}
});
$('defaultRate').addEventListener('input',summary);
$('cancelDefaultRate').onclick=()=>{if(settingsDraft() && !confirm('确定放弃默认费率设置草稿？'))return;$('defaultRate').value=defaultRate();showError('defaultRateError','');summary()};
$('cancelEdit').onclick=()=>{if(discardDraft()){clearForm();summary()}};
$('discardDraft').onclick=()=>{if(discardDraft()){clearForm();summary()}};
for(const id of [...fields,'observedAt','observationSource','observationNote'])$(id).addEventListener('input',()=>{updatePreview();summary()});
$('search').addEventListener('input',showRows);
for(const id of ['monthFilter','issueFilter'])$(id).addEventListener('change',showRows);
$('copyScope').addEventListener('change',renderCopyHint);
$('resetFilters').onclick=()=>{$('search').value='';$('monthFilter').value='';$('issueFilter').value='all';showRows()};
function editSource(id,fromReconciliation=false){
  if(reconDraft() && !fromReconciliation){showError('rError','请先取消或提交对账输入，再切换工作编辑。');return false}
  const record=state.bundle?.tables.records.find(row=>row.id===id);if(!record || record.state==='Opening'){alert('确认期初余额请通过历史余额确认操作处理。');return false}
  if(!discardDraft())return false;
  if(state.editing===null)state.newDate=$('date').value || state.newDate;
  clearForm();state.editing=id;for(const field of fields)$(field).value=record[field] ?? '';
  state.formBaseline=formSignature();
  $('formTitle').textContent=record.state==='Job'?'编辑工作记录':record.state==='Pending'?'补齐待补记录（保留原周期）':'编辑历史工作（不计入本期收入）';$('submitJob').textContent='保存这项修改';$('cancelEdit').style.display='';
  showError('formError','');updatePreview();summary();window.scrollTo({top:0,behavior:'smooth'});return true;
}
$('rows').addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button || !editable())return;
  const id=button.dataset.edit ?? button.dataset.delete, index=state.records.findIndex(record=>record.uid===id);
  if(index<0)return;
  const record=state.records[index];
  if(button.dataset.edit!==undefined) {
    editSource(id);
  } else {
    if(id===state.editing && !discardDraft())return;
    if(!confirm('确认删除 '+(record.invoice || record.date)+'？删除后仍需另存 Excel。'))return;
    try{useBundle(Reconcile.removeRecord(state.bundle,id))}catch(error){alert(error.message);return}state.revision++;
    if(id===state.editing)clearForm();showRows();
  }
});
function commitFile(out,file,handle,needsSave=false,writable=true) {
  if(hasUnsaved() && !confirm('当前有尚未保存或确认的内容。确定放弃这些内容并打开选定文件吗？'))return false;
  if($('cycleModal').open)$('cycleModal').close();
  state.carryCandidates=[];state.carryBaseline=null;$('carryRows').replaceChildren();
  if(out.bundle)useBundle(out.bundle);else{state.bundle=null;state.records=identified(out.records);state.config={...out.config};state.version=out.version}
  state.sourceHandle=handle;
  state.sourceWritable=!!handle && writable && !needsSave && out.bundle?.schemaVersion===Reconcile.SCHEMA_VERSION && !state.archiveFiles.has(out.bundle.fileId);
  if(handle && !state.protectedHandles.includes(handle))state.protectedHandles.push(handle);
  state.fileName=file.name;
  state.sourceHash=out.sourceHash || '';
  state.opened=true;state.revision=needsSave?1:0;state.persistedRevision=0;state.pending=null;
  state.newDate=null;$('defaultRate').value=defaultRate();showError('defaultRateError','');
  $('search').value='';$('monthFilter').value='';$('issueFilter').value='all';$('copyScope').value='issues';clearForm();TrackerReconciliationUI.reset();TrackerReviewUI.reset();showRows();if(handle)rememberFile(handle,file.name,state.sourceWritable);return true;
}
async function rememberFile(handle,name,writable){
  const recent={handle,name,writable};state.recent=recent;$('recentBtn').hidden=false;$('recentBtn').textContent='重开最近：'+name;
  try{await TrackerRecentFile.write(handle,name,writable);$('recentStatus').textContent='最近文件仅记住引用；重开会重新读取 XLSX。'}
  catch{$('recentStatus').textContent='浏览器无法记住文件引用；本次仍可操作，下次请重新选择 XLSX。'}
}
async function loadRecentFile(){
  try{const recent=await TrackerRecentFile.read();if(state.recent || !recent?.handle)return;state.recent=recent;$('recentBtn').hidden=false;$('recentBtn').textContent='重开最近：'+recent.name}
  catch{$('recentStatus').textContent='最近文件存储不可用，请使用“打开现有 Excel”。'}
}
$('recentBtn').onclick=async()=>{
  if(state.busy || !state.recent)return;
  const {handle,writable}=state.recent;
  state.busy=true;summary();
  try{
    if(await handle.queryPermission({mode:'read'})!=='granted' && await handle.requestPermission({mode:'read'})!=='granted')throw Error('未获得读取权限，请授权或重新选择文件');
    const file=await handle.getFile();state.busy=false;await takeFile(file,handle,writable);
  }catch(error){$('recentStatus').textContent='无法重开最近文件：'+error.message+'。当前记录和草稿已保留，请使用“打开现有 Excel”重选。'}
  finally{state.busy=false;summary()}
};
function reviewChanges({title,records,before,after,beforeVersion,accept}) {
  $('upgradeScopeReview').hidden=true;showError('reviewError','');
  const changes=records.map(record=>({record,old:Core.calculate(record,before,beforeVersion),next:Core.calculate(record,after)}));
  $('reviewTitle').textContent=title;
  const describe=(config,version)=>`最低 ${config.minHours}h；AH ${Core.timeText(config.ahStart)}–${version==='2.0'?'24:00':Core.timeText(config.ahEnd)}；${config.mult}×；阈值 ${money(config.tolerance)}`;
  $('reviewRules').textContent='原规则：'+describe(before,beforeVersion)+'。新规则：'+describe(after,'3.0')+'。以下对比使用同一组当前原始记录；原文件保持不变，确认后仍须另存。'+(beforeVersion==='2.0'?'旧文件没有历史规则快照，此处只比较 2.0 与 3.0 算法，不推测更早的规则。':'');
  $('reviewRows').innerHTML=changes.length?changes.map(({record,old,next})=>`<tr><td>${safe(record.invoice || 'Invoice 待补')}</td><td>${safe(record.date)}</td><td>${money(old.total)}</td><td>${money(next.total)}</td><td>${money(Core.round(next.total-old.total))}</td></tr>`).join(''):'<tr><td colspan="5">无工作记录，仅更新规则。</td></tr>';
  state.review={accept};$('reviewModal').showModal();
}
function reviewBundleImport(out,file,handle) {
  $('upgradeScopeReview').hidden=true;showError('reviewError','');
  const accepted=Reconcile.acceptExternalChanges(out.bundle,out.changes,{source:'Excel / '+file.name,sourceName:file.name,sourceHash:out.sourceHash});
  const before=new Map(Reconcile.currentRecords(out.bundle).map(record=>[record.id,record]));
  const rulesChanged=out.changes.some(change=>change.kind==='Rules'),changedIds=new Set(out.changes.map(change=>change.id));
  const rows=Reconcile.currentRecords(accepted).filter(record=>rulesChanged || changedIds.has(record.id) || !before.has(record.id));
  $('reviewTitle').textContent='确认导入的工作与 Config 变更';
  const rules=Reconcile.config(accepted);
  $('reviewRules').textContent=`AH ${Core.timeText(rules.ahStart)}–${Core.timeText(rules.ahEnd)}；${out.changes.length} 项变更。确认后记录原值、新值和来源，并须另存。已有付款与比较快照保持原样，受影响的结算须重新核对。`;
  const labels={date:'Date',invoice:'Invoice',start:'Start',end:'End',lunch:'Lunch',rate:'Rate',app:'App',extra:'Extra',note:'Notes',site:'Site'};
  const display=value=>Core.blank(value)?'（空白 / 未知）':String(value);
  $('reviewRows').innerHTML=rows.map(record=>{
    const original=before.get(record.id),old=original?Reconcile.calculate(out.bundle,original):null,next=Reconcile.calculate(accepted,record);
    const details=Object.entries(labels).filter(([key])=>!original || original[key]!==record[key]).map(([key,label])=>`${label}: ${display(original?.[key])} → ${display(record[key])}`).join('\n');
    return `<tr><td>${safe(record.invoice || 'Invoice 待补')}</td><td>${safe(record.date)}</td><td>${old?money(old.total):'—'}</td><td>${money(next.total)}</td><td>${old?money(Core.round(next.total-old.total)):'新工作'}</td></tr>`+(details?`<tr><td colspan="5" style="white-space:pre-wrap">${safe(details)}</td></tr>`:'');
  }).join('') || '<tr><td colspan="5">确认规则及文件内容变更</td></tr>';
  state.review={accept:()=>commitFile({...out,bundle:accepted,changes:[]},file,handle,true)};$('reviewModal').showModal();
}
$('reviewCancel').onclick=()=>{$('reviewModal').close();state.review=null};
$('reviewModal').addEventListener('cancel',()=>{state.review=null});
$('reviewConfirm').onclick=()=>{
  const review=state.review;if(!review)return;
  if(review.accept()!==false){state.review=null;$('reviewModal').close()}
};
async function takeFile(file,handle=null,writable=true) {
  if(state.busy)return;
  state.busy=true;summary();
  try {
    const bytes=await file.arrayBuffer(),out=await openZip(bytes);out.sourceHash=await TrackerWorkbookV4.hashBytes(bytes);
    if(out.bundle && out.changes.length)reviewBundleImport(out,file,handle);
    else if(out.bundle) {if(commitFile(out,file,handle,out.isTemplate,writable))alert('已加载 '+out.bundle.schemaVersion+' 数据包；工作、对账及历史均已校验。')}
    else if(out.configChanged)reviewChanges({title:'Config 已变化：确认整个周期的规则差异',records:out.records,before:out.baseline,after:out.config,beforeVersion:'3.0',accept:()=>commitFile(out,file,handle,true)});
    else if(commitFile(out,file,handle))alert('已加载 '+out.records.length+' 条记录。'+(out.version==='2.0'?'当前为旧版本只读模式。':''));
  } catch(error){alert('无法打开文件：'+error.message)}
  finally{state.busy=false;summary()}
}
$('openBtn').onclick=async()=>{
  if(state.busy)return;
  if(window.showOpenFilePicker) {
    try {const [handle]=await window.showOpenFilePicker({types:[{description:'Excel',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}],multiple:false});await takeFile(await handle.getFile(),handle);return}
    catch(error){if(error.name==='AbortError')return;alert('文件选择失败：'+error.message);return}
  }
  $('fileInput').click();
};
$('fileInput').addEventListener('change',event=>{const file=event.target.files[0];if(file)takeFile(file);event.target.value=''});
$('upgradeBtn').onclick=()=>{
  if(editable() || state.busy)return;
  if(state.version==='4.0'){
    const records=state.bundle.tables.records.filter(row=>row.state==='Historical');
    $('reviewTitle').textContent='明确升级为 4.1 并另存；原文件保持不变';
    $('reviewRules').textContent='仅追加人工事项可空参考金额和历史提醒范围。六张 Sheet、全部原始字段、关系、历史及 calculation 3.0 保留；旧人工参考金额保持未知，不推断为零。';
    $('reviewRows').replaceChildren();$('upgradeScopeConfirm').checked=false;showError('reviewError','');
    $('upgradeScopeReview').hidden=!records.length;
    $('upgradeScopeRows').innerHTML=records.map(row=>`<fieldset><legend>${safe(row.invoice || 'Invoice 待补')} · ${safe(row.date)} · ${safe(row.id)}</legend>${Reconcile.REMINDER_KINDS.map(kind=>`<label><input type="checkbox" data-upgrade-record="${row.id}" value="${kind}" checked>${safe(Reports.ISSUE_LABELS[kind])}</label>`).join('')}</fieldset>`).join('');
    state.review={accept:()=>{
      if(records.length && !$('upgradeScopeConfirm').checked){showError('reviewError','请明确确认旧历史来源的初始提醒范围。');return false}
      const legacyScopes=Object.fromEntries(records.map(row=>[row.id,[...$('upgradeScopeRows').querySelectorAll(`[data-upgrade-record="${row.id}"]:checked`)].map(input=>input.value)]));
      try{useBundle(Reconcile.upgradeV4(state.bundle,{legacyScopes}));state.sourceWritable=false;state.revision++;$('defaultRate').value=defaultRate();clearForm();showRows();return true}catch(error){showError('reviewError',error.message);return false}
    }};$('reviewModal').showModal();return;
  }
  const config={...state.config,ahEnd:6};
  if(state.version==='3.0')config.ahEnd=state.config.ahEnd;
  try{Core.validateConfig(config)}catch(error){alert('无法升级：'+error.message);return}
  const migrated=Reconcile.migrate({version:state.version,config,records:state.records},{sourceName:state.fileName,sourceHash:state.sourceHash || ''});
  reviewChanges({title:'升级为 4.1：预览计费变化并保存可追溯数据',records:state.records,before:state.config,after:config,beforeVersion:state.version,accept:()=>{useBundle(migrated);state.sourceWritable=false;changed();clearForm();showRows()}});
};
function versionedFilename(newCycle=false) {
  const date=new Date(), pad=(n,w=2)=>String(n).padStart(w,'0');
  const stamp=`${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${pad(date.getMilliseconds(),3)}`;
  const stem=newCycle?'RouterStack_New_Cycle':String(state.fileName).replace(/\.xlsx$/i,'').replace(/_V[34]_\d{8}_\d{6}_\d{3}$/,'').replace(/[\\/:*?"<>|]/g,'_').slice(0,120);
  return stem+'_V4_'+stamp+'.xlsx';
}
function downloadBlob(blob,filename) {
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function exportSnapshot(records,config,revision,kind) {
  const filename=versionedFilename(kind==='cycle');
  state.busy=true;summary();
  try {
    let handle=kind==='save'?state.sourceHandle:null;
    const previousHandle=state.sourceHandle,previousHash=state.sourceHash;
    if(kind==='save'){
      if(!handle || !state.sourceWritable || state.archiveFiles.has(state.bundle.fileId))throw Error('当前来源受归档或升级保护，请使用 Save As');
      for(const archive of state.archiveHandles)if(handle===archive || await handle.isSameEntry(archive))throw Error('不能写回归档，请使用 Save As');
      if(handle.queryPermission && await handle.queryPermission({mode:'readwrite'})!=='granted' && await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('未获得写入权限，请授权或使用 Save As');
    }else if(window.showSaveFilePicker) {
      handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'Excel',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}]});
      if(handle.name.toLowerCase()===state.fileName.toLowerCase())throw Error('请选择新的版本文件名；原文件保持不变。');
      for(const protectedHandle of state.protectedHandles)if(await handle.isSameEntry(protectedHandle))throw Error('不能写回已打开或已导出的文件，请选择新文件。');
    }
    const blob=await buildExport(records,config,handle?.name || filename),metadata=TrackerWorkbookV4.exportInfo(blob),sourceHash=await TrackerWorkbookV4.hashBytes(await blob.arrayBuffer());
    if(handle) {
      const checkSource=async()=>{if(kind==='save' && (!previousHash || await TrackerWorkbookV4.hashBytes(await(await handle.getFile()).arrayBuffer())!==previousHash))throw Error('文件已被 Excel 或其他程序修改。已阻止覆盖；请另存副本，或保留当前输入后重新打开核对。')};
      let writer;
      try{await checkSource();writer=await handle.createWritable();await checkSource();await writer.write(blob);await checkSource();await writer.close()}
      catch(error){try{await writer?.abort()}catch{/* Preserve the original write error. */}throw error}
      state.protectedHandles.push(handle);
      if(kind==='same' || kind==='save'){
        if(kind==='same' && previousHandle){state.archiveHandles.push(previousHandle)}
        state.sourceHandle=handle;state.sourceWritable=true;state.persistedRevision=revision;state.fileName=handle.name;state.opened=true;state.pending=null;state.sourceHash=sourceHash;if(state.bundle?.fileId===metadata.fileId)Object.assign(state.bundle,metadata,{sourceName:handle.name});
        rememberFile(handle,handle.name,true);
      }else if(kind==='cycle'){state.archiveFiles.add(state.bundle.fileId);state.sourceWritable=false;if(previousHandle){state.archiveHandles.push(previousHandle);rememberFile(previousHandle,state.fileName,false)}}
      alert((kind==='save'?'已保存当前文件：':'已另存新文件：')+handle.name+(kind==='cycle'?'。原周期仍保持打开；请打开新文件继续录入。':''));
    } else {
      downloadBlob(blob,filename);
      state.pending={revision,filename,kind,metadata,sourceHash};
      alert('已发起下载，待确认保留：'+filename+'。浏览器无法确认你是否已保留文件；确认后请点击“我已保留下载文件”。'+(kind==='cycle'?'原周期保持打开，请打开新周期文件继续。':''));
    }
    return true;
  } catch(error){if(error.name!=='AbortError')alert('保存失败：'+error.message);return false}
  finally{state.busy=false;summary()}
}
async function saveFile(saveAs=false){
  if(state.busy || !editable() || !noDraft())return;
  try{Reconcile.validate(state.bundle)}catch(error){alert(error.message);return}
  await exportSnapshot(clone(state.bundle),{...state.config},state.revision,!saveAs && state.sourceHandle && state.sourceWritable?'save':'same');
}
$('saveBtn').onclick=()=>saveFile();
$('saveAsBtn').onclick=()=>saveFile(true);
$('confirmDownload').onclick=()=>{
  if(!state.pending || state.busy)return;
  const pending=state.pending;
  if(pending.kind==='same'){if(state.sourceHandle){state.archiveHandles.push(state.sourceHandle);rememberFile(state.sourceHandle,state.fileName,false)}state.sourceHandle=null;state.sourceWritable=false;state.persistedRevision=pending.revision;state.fileName=pending.filename;state.opened=true;state.sourceHash=pending.sourceHash;if(state.bundle?.fileId===pending.metadata.fileId)Object.assign(state.bundle,pending.metadata)}
  if(pending.kind==='cycle'){state.archiveFiles.add(state.bundle.fileId);state.sourceWritable=false;if(state.sourceHandle){state.archiveHandles.push(state.sourceHandle);rememberFile(state.sourceHandle,state.fileName,false)}}
  state.pending=null;summary();
};
$('copyBtn').onclick=async()=>{
  if(state.busy || !noDraft())return;
  const report=Reports.timReport(state.records,state.config,{...viewOptions(),scope:$('copyScope').value,fileName:state.opened?state.fileName:'',unsaved:hasUnsaved()});
  if(!report.jobCount && !report.carryCount){alert('当前清单范围没有记录，未复制内容。');return}
  try{await navigator.clipboard.writeText(report.text);alert(`已复制 ${report.jobCount} 项工作与 ${report.carryCount} 条确认结转；二者分开列示。`)}catch{window.prompt('复制以下核对清单',report.text)}
};
$('cycleBtn').onclick=()=>{
  if(state.busy || !editable() || !noDraft())return;
  if(state.dirty || state.pending){alert('请先保存并确认保留当前周期文件，再创建新周期。');return}
  let plan;try{plan=Reconcile.buildCarryForwardPlan(state.bundle)}catch(error){alert(error.message);return}
  $('cycleName').value='';$('cycleStart').value='';$('cycleEnd').value='';
  state.carryPlan=plan;
  const label=row=>safe((row.invoice || 'Invoice 待补')+' · '+(row.date || '日期未知')+' · '+row.id);
  $('carryRows').innerHTML='<h3>允许继续检测的类别</h3>'+plan.scopeCandidates.map(item=>{const row=Reconcile.get(state.bundle,'records',item.recordId);return `<fieldset><legend>${label(row)}</legend><div class="helper">当前实际提醒：${safe(item.detected.map(kind=>Reports.ISSUE_LABELS[kind]).join(' · ') || '无')}；未出现的允许类别也会保留。</div><label class="check-list"><input type="checkbox" data-carry-follow="${row.id}" ${item.allowed.length?'checked':''}>在新周期继续检测下面勾选的类别（新启用时默认全部）</label><div class="check-list">${Reconcile.REMINDER_KINDS.map(kind=>`<label><input type="checkbox" data-carry-record="${row.id}" value="${kind}" ${!item.allowed.length || item.allowed.includes(kind)?'checked':''}>${safe(Reports.ISSUE_LABELS[kind])}</label>`).join('')}</div></fieldset>`}).join('')+'<h3>人工事项（独立选择）</h3>'+plan.manualCandidates.map(row=>`<label class="check-list"><input type="checkbox" data-carry-issue="${row.id}" checked>${safe(row.code+' · '+row.reason)} · ${(row.recordId?label(Reconcile.get(state.bundle,'records',row.recordId)):safe('Batch '+row.batchId))}</label>`).join('')+'<h3>确认余额（默认带入）</h3>'+plan.balanceCandidates.map(row=>`<label class="check-list"><input type="checkbox" data-carry-balance="${row.id}" checked>${label(row)} · ${money(Reconcile.carryRemaining(state.bundle,row.id)/100)}</label>`).join('')+'<h3>来源与兼容资料预览</h3>';
  state.carryBaseline=carrySignature();
  renderCarryPreview();showError('cycleError','');$('cycleModal').showModal();summary();
};
function carrySelectionInput(){
  if(!state.carryPlan?.scopeCandidates)return {};
  const reminderScopes={};
  for(const item of state.carryPlan.scopeCandidates){
    const follow=$('carryRows').querySelector(`[data-carry-follow="${item.recordId}"]`);
    const allowed=follow?.checked?[...$('carryRows').querySelectorAll(`[data-carry-record="${item.recordId}"]:checked`)].map(input=>input.value):[];
    if(JSON.stringify(allowed)!==JSON.stringify(item.allowed))reminderScopes[item.recordId]=allowed;
  }
  return {reminderScopes,issueIds:[...$('carryRows').querySelectorAll('[data-carry-issue]:checked')].map(input=>input.dataset.carryIssue),balanceRecordIds:[...$('carryRows').querySelectorAll('[data-carry-balance]:checked')].map(input=>input.dataset.carryBalance)};
}
function renderCarryPreview(){
  try{
    const plan=Reconcile.buildCarryForwardPlan(state.bundle,{selection:carrySelectionInput()});
    $('selectedCount').textContent=`保留来源 ${plan.recordCount} 项、到账 ${plan.paymentCount} 笔、兼容批次 ${plan.batchCount} 个；本次选定确认余额 ${money(plan.confirmedCarryCents/100)}。来源按 RecordID、人工事项按 IssueID 去重。`;
    $('carrySummaryRows').innerHTML=plan.entries.map(row=>`<p>${safe(row.label)} · ${safe(row.reasons.map(reason=>Reports.ISSUE_LABELS[reason] || reason).join('；'))}</p>`).join('') || '<p>没有选定的未解决事项。</p>';
    showError('cycleError',plan.excludedBalanceIds.length?'已排除 '+plan.excludedBalanceIds.length+' 项确认余额；这只排除新周期跟进，不代表已付款或已解决。':'');
  }catch(error){showError('cycleError',error.message)}summary();
}
$('carryRows').addEventListener('change',renderCarryPreview);
function discardCarryDraft(){return !hasCarryDraft() || confirm('确定放弃尚未生成文件的新周期名称和日期吗？')}
$('closeCycle').onclick=()=>{if(!state.busy && discardCarryDraft())$('cycleModal').close()};
$('cycleModal').addEventListener('cancel',event=>{if(state.busy || !discardCarryDraft())event.preventDefault()});
$('cycleModal').addEventListener('close',()=>{state.carryBaseline=null;state.carryPlan=null;summary()});
for(const id of ['cycleName','cycleStart','cycleEnd'])$(id).addEventListener('input',summary);
$('createCycle').onclick=async()=>{
  if(state.busy)return;
  try {
    const selection=carrySelectionInput(),plan=Reconcile.buildCarryForwardPlan(state.bundle,{selection});
    if(plan.excludedBalanceIds.length && !confirm('本次明确排除 '+plan.excludedBalanceIds.length+' 项确认余额。新周期不继续跟进这些余额；旧周期仍未解决。确认继续？'))return;
    const next=Reconcile.carryForward(state.bundle,{name:$('cycleName').value,start:$('cycleStart').value,end:$('cycleEnd').value,sourceHash:state.sourceHash,selection});
    if(!plan.unresolvedCount && !confirm('没有未解决事项。确定建立空白新周期吗？'))return;
    if(await exportSnapshot(next,{...state.config},state.revision,'cycle'))$('cycleModal').close();
  }catch(error){showError('cycleError',error.message)}
};
window.addEventListener('beforeunload',event=>{if(hasUnsaved() || state.busy){event.preventDefault();event.returnValue=''}});
useBundle(state.bundle);clearForm();
TrackerReconciliationUI.init({getState:()=>state,editable:()=>editable() && !state.busy,jobHasDraft:()=>hasDraft() || settingsDraft() || TrackerReviewUI.hasDraft(),onChange:bundle=>{useBundle(bundle);state.revision++;showRows()},onDraftChange:summary,editRecord:id=>editSource(id,true)});
TrackerReviewUI.init({getState:()=>state,editable:()=>editable() && !state.busy,jobHasDraft:()=>hasDraft() || settingsDraft(),otherDraft:()=>TrackerReconciliationUI.hasDraft(),onChange:bundle=>{useBundle(bundle);state.revision++;showRows()},onDraftChange:summary,editRecord:id=>editSource(id,true)});
showRows();
loadRecentFile();
