'use strict';
const Core=TrackerCore,Model=TrackerModel,Reports=TrackerReports;
const $=id=>document.getElementById(id);
const clone=Model.clone;
const fields=['date','invoice','start','end','lunch','rate','app','extra','note'];
const configInputs=['configMinHours','configAHStart','configAHEnd','configMult','configTolerance'];
const safe=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>value===null || value===undefined?'—':'$'+Number(value).toLocaleString('en-NZ',{minimumFractionDigits:2,maximumFractionDigits:2});
const state={workbook:Model.create(),records:[],config:null,fileName:'RouterStack_Cycle.xlsx',sourceHandle:null,protectedHandles:[],archiveHandles:[],archiveFiles:new Set(),sourceWritable:false,recent:null,opened:false,editing:null,revision:0,persistedRevision:0,pending:null,busy:false,formBaseline:'',configBaseline:'',review:null,carryBaseline:null,carryPlan:null};
// Presentation state only; never included in WorkbookState or persisted.
const ui={mode:'compact',drawer:null,drawerFocus:null,newDetailsOpen:false,summaryExpanded:false,fileError:'',accessRequired:false,saved:false};
Object.defineProperty(state,'dirty',{get:()=>state.revision!==state.persistedRevision});
const archiveKey=metadata=>metadata.fileId+':'+metadata.fileVersionId;
function useWorkbook(workbook){state.workbook=workbook;state.records=workbook.records;state.config=workbook.config}
function formValues(){const input=Object.fromEntries(fields.map(key=>[key,$(key).value]));input.invoice=input.invoice.trim().toUpperCase();return input}
const formSignature=()=>JSON.stringify([formValues(),$('observedAt').value,$('observationNote').value]);
const hasDraft=()=>formSignature()!==state.formBaseline;
const defaultRate=()=>state.config.defaultRate ?? '';
const settingsDraft=()=>$('defaultRate').value!==String(defaultRate());
const configSignature=()=>JSON.stringify(configInputs.map(key=>$(key).value));
const configDraft=()=>configSignature()!==state.configBaseline;
const reviewDraft=()=>TrackerReviewUI.hasDraft();
const carrySignature=()=>JSON.stringify([['cycleName','cycleStart','cycleEnd'].map(key=>$(key).value),carrySelectionInput()]);
const hasCarryDraft=()=>$('cycleModal').open && state.carryBaseline!==null && carrySignature()!==state.carryBaseline;
const hasUnsaved=()=>state.dirty || state.pending!==null || hasDraft() || settingsDraft() || configDraft() || reviewDraft() || hasCarryDraft();
function showError(id,message){$(id).textContent=message;$(id).style.display=message?'block':'none'}
function uiNotice(message){$('uiNotice').textContent=message;$('uiNotice').hidden=!message}
function fileFailure(message){ui.fileError=message;ui.accessRequired=/权限|NotAllowed|permission/i.test(message);$('fileError').textContent=message;$('fileNotice').hidden=false;summary()}
function clearFileFailure(){ui.fileError='';ui.accessRequired=false;$('fileNotice').hidden=true}
$('dismissFileError').onclick=()=>{clearFileFailure();summary()};
const drawerDraft=()=>settingsDraft() || configDraft()?'config':TrackerReviewUI.draftPanel?.() || null;
function openDrawer(panel){
  const pending=drawerDraft();
  if(pending && pending!==panel){uiNotice('请先提交或取消 '+({config:'Config',bank:'Bank Received',unresolved:'Unresolved'}[pending])+' 草稿，再切换功能。输入已保留。');panel=pending}
  if(ui.mode==='expanded')setDisplayMode('compact');
  const changed=ui.drawer!==panel;if(changed)ui.drawerFocus=document.activeElement;
  ui.drawer=panel;$('businessDrawer').hidden=false;
  for(const [name,id,title] of [['config','configPanel','Config'],['bank','bankPanel','Bank Received'],['unresolved','reviewPanel','Unresolved']]){
    $(id).hidden=name!==panel;$(name==='unresolved'?'unresolvedBtn':name+'Btn').setAttribute('aria-expanded',String(name===panel));
    if(name===panel)$('drawerTitle').textContent=title;
  }
  summary();if(changed)$('closeDrawer').focus({preventScroll:true});
}
function closeDrawer({restoreFocus=true}={}){
  const pending=drawerDraft();
  $('businessDrawer').hidden=true;ui.drawer=null;
  for(const id of ['configBtn','bankBtn','unresolvedBtn'])$(id).setAttribute('aria-expanded','false');
  if(pending)uiNotice('抽屉草稿已保留，尚未提交。重新打开对应抽屉可继续编辑。');
  if(restoreFocus && ui.drawerFocus?.isConnected)ui.drawerFocus.focus({preventScroll:true});
  summary();
}
for(const panel of ['config','bank','unresolved'])$(panel+'Btn').onclick=()=>openDrawer(panel);
$('closeDrawer').onclick=()=>closeDrawer();
document.addEventListener('keydown',event=>{if(event.key==='Escape' && ui.drawer && !document.querySelector('dialog[open]')){event.preventDefault();closeDrawer()}});
function setDisplayMode(mode){
  if(mode===ui.mode)return true;
  if(mode==='expanded' && (hasDraft() || drawerDraft())){
    uiNotice('请先提交或取消未提交草稿，再切换 Expanded。当前输入和显示模式已保留。');
    if(drawerDraft())openDrawer(drawerDraft());
    return false;
  }
  const scroll=$('workScroll'),top=scroll.getBoundingClientRect().top+34;
  const anchor=[...$('rows').children].find(row=>row.getBoundingClientRect().bottom>top);
  const offset=anchor?anchor.getBoundingClientRect().top-top:0,left=scroll.scrollLeft;
  if(mode==='expanded' && ui.drawer)closeDrawer({restoreFocus:false});
  ui.mode=mode;document.body.dataset.mode=mode;
  $('compactBtn').setAttribute('aria-pressed',String(mode==='compact'));$('expandedBtn').setAttribute('aria-pressed',String(mode==='expanded'));
  if(anchor)scroll.scrollTop+=anchor.getBoundingClientRect().top-(scroll.getBoundingClientRect().top+34)-offset;
  scroll.scrollLeft=left;uiNotice('');return true;
}
$('compactBtn').onclick=()=>setDisplayMode('compact');$('expandedBtn').onclick=()=>setDisplayMode('expanded');
function noDraft(){
  if(hasDraft()){setDisplayMode('compact');showError('formError','工作表单尚未提交，请先添加／保存修改或取消输入。');$('submitJob').focus();return false}
  if(settingsDraft() || configDraft()){openDrawer('config');showError('configError','请先应用或取消 Config 设置草稿。');return false}
  if(reviewDraft()){openDrawer(drawerDraft());showError('reviewError','跟进区有未提交输入，请先提交或取消草稿。');return false}
  return true;
}
function clearForm(){
  $('jobForm').reset();
  const date=new Date();state.newDate ||= `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  $('date').value=state.newDate;$('rate').value=defaultRate();state.editing=null;state.composing=false;state.formBaseline=formSignature();
  $('formTitle').textContent='New Entry';$('submitJob').textContent='Add Entry';$('cancelEdit').hidden=true;$('deleteRecord').hidden=true;$('discardDraft').hidden=false;
  $('recordIdentity').hidden=true;$('additionalDetails').open=ui.newDetailsOpen;$('observationDetails').open=false;
  showError('formError','');updatePreview();markSelection();
}
$('additionalDetails').addEventListener('toggle',()=>{if(state.editing===null)ui.newDetailsOpen=$('additionalDetails').open});
$('additionalDetails').querySelector('summary').onclick=event=>{if(state.editing!==null)event.preventDefault()};
function resetConfig({preserveDefault=false}={}){
  const config=state.config;
  for(const [key,value] of Object.entries({configMinHours:config.minHours,configAHStart:Core.timeText(config.ahStart),configAHEnd:Core.timeText(config.ahEnd),configMult:config.mult,configTolerance:config.tolerance}))$(key).value=value;
  state.configBaseline=configSignature();if(!preserveDefault)$('defaultRate').value=defaultRate();
  $('rulesBox').textContent=`最低 ${config.minHours} h · AH ${Core.timeText(config.ahStart)}–${Core.timeText(config.ahEnd)} · ${config.mult}× · 阈值 ${money(config.tolerance)}。最低补足按扣 Lunch 后的普通／AH 占比分配。`;
}
function updatePreview(){
  const original=state.records.find(row=>row.id===state.editing),config=original?Model.rulesFor(state.workbook,original):state.config;
  const calc=Core.calculate(formValues(),config);
  $('liveExpected').textContent=calc?money(calc.total):'—';
  $('liveHours').textContent=calc?`Length ${calc.lengthHours.toFixed(2)} h · Billable ${calc.bill.toFixed(2)} (AH ${calc.ah.toFixed(2)}) h`:'';
  $('liveHint').textContent=original?.type==='Historical'?'使用此 Historical 的原规则快照':'App 不参与估算；填写有效时间和费率以预览';
}
function summary(){
  const period=Model.get(state.workbook,'periods',state.workbook.metadata.currentPeriodId);
  $('periodName').textContent=period.name;
  $('periodName').title=period.name;
  $('currentFileName').textContent=state.opened?state.fileName:'尚未保存的工作簿';
  $('currentFileName').title=state.opened?state.fileName:'';
  const messages=[];
  if(hasDraft())messages.push('工作表单尚未提交');
  if(settingsDraft() || configDraft())messages.push('Config 设置尚未应用');
  if(reviewDraft())messages.push('跟进输入尚未提交');
  if(hasCarryDraft())messages.push('新周期资料尚未生成');
  if(state.dirty)messages.push('有尚未保存的修改');
  if(state.pending)messages.push('下载待确认保留：'+state.pending.filename);
  if(state.busy)messages.push('正在处理文件');
  if(!hasUnsaved() && !state.busy)messages.push(state.opened?'文件已载入，可以继续添加或核对工作。':'打开现有周期，或在下方添加第一项工作。');
  $('statusBar').textContent=messages.join(' · ');$('confirmDownload').hidden=!state.pending;
  const status=state.busy?'busy':ui.fileError?(ui.accessRequired?'access':'error'):state.pending?'pending':hasDraft() || settingsDraft() || configDraft() || reviewDraft() || hasCarryDraft()?'draft':state.dirty?'dirty':ui.saved?'saved':state.opened?'ready':'new';
  $('saveState').dataset.state=status;
  $('saveState').textContent={busy:'正在处理',access:'File Access Required',error:'文件操作失败',pending:'下载待确认',draft:'输入未提交',dirty:'尚未保存',saved:'Saved',ready:'已载入',new:'新工作簿'}[status];
  $('drawerDraftNotice').hidden=!drawerDraft();
  if(!hasDraft() && !drawerDraft())uiNotice('');
  for(const key of ['openBtn','recentBtn','saveBtn','saveAsBtn','cycleBtn','confirmDownload','createCycle','closeCycle','previewConfig','reviewConfirm','applyDefaultRate','newIssue','newBalance','newBank','applyReview','submitBank'])$(key).disabled=state.busy;
  for(const input of $('cycleModal').querySelectorAll('input'))input.disabled=state.busy;
}
function showRows(){
  const month=$('monthFilter').value,months=[...new Set(state.records.map(row=>row.date.slice(0,7)))].sort();
  $('monthFilter').innerHTML='<option value="">全部月份</option>'+months.map(value=>`<option value="${value}">${value}</option>`).join('');$('monthFilter').value=months.includes(month)?month:'';
  const visible=Reports.view(state.workbook,{type:$('typeFilter').value,month:$('monthFilter').value,query:$('search').value,issue:$('issueFilter').value});
  $('recordCount').textContent=`显示 ${visible.length} / ${state.records.length} 项工作 · 筛选不影响完整导出`;
  $('rows').innerHTML=visible.map(row=>{
    const calc=Model.calculate(state.workbook,row);
    return `<tr data-record-id="${safe(row.id)}" class="${row.type==='Historical'?'historical':''}" aria-selected="${row.id===state.editing}" tabindex="-1" aria-label="${safe((row.invoice || 'Invoice 待补')+' · '+row.date+' '+row.start)}"><td>${row.date}</td><td>${row.start}</td><td>${row.end}</td><td class="num">${calc.lengthHours.toFixed(2)}</td><td class="num">${money(row.rate)}</td><td class="num">${money(calc.total)}</td><td class="num ${Model.reminders(state.workbook,row).includes('difference')?'difference':''}">${money(row.app)}</td><td class="notes"><span>${safe(row.note)}</span></td></tr>`;
  }).join('') || '<tr><td colspan="8" class="blank">没有匹配的工作记录。</td></tr>';
  markSelection();renderSummary();
  TrackerReviewUI.render();summary();
}
function markSelection(){
  const rows=[...$('rows').querySelectorAll('[data-record-id]')],selected=rows.find(row=>row.dataset.recordId===state.editing);
  for(const row of rows){row.setAttribute('aria-selected',String(row===selected));row.tabIndex=row===(selected || rows[0])?0:-1}
}
function renderSummary(){
  const rows=Reports.summary(state.workbook),months=rows.filter(row=>!['Historical','Total'].includes(row.period)),hidden=new Set(months.slice(0,-2).map(row=>row.period));
  $('toggleSummary').hidden=hidden.size===0;$('toggleSummary').textContent=ui.summaryExpanded?'收起较早月份':`显示较早 ${hidden.size} 个月`;$('toggleSummary').setAttribute('aria-expanded',String(ui.summaryExpanded));
  $('summaryRows').innerHTML=rows.filter(row=>ui.summaryExpanded || !hidden.has(row.period)).map(row=>`<tr class="${row.period==='Historical'?'historical':row.period==='Total'?'total':''}"><th scope="row">${row.period.includes('-')?safe(new Date(row.period+'-01T00:00Z').toLocaleDateString('en-NZ',{month:'short',year:'numeric',timeZone:'UTC'})):row.period}</th><td class="num">${money(row.estimated)}</td><td class="num">${money(row.app)}</td><td class="num">${money(row.difference)}${row.partial && row.known?'*':''}</td></tr>`).join('');
}
$('toggleSummary').onclick=()=>{ui.summaryExpanded=!ui.summaryExpanded;renderSummary()};
$('jobForm').addEventListener('submit',event=>{
  event.preventDefault();if(state.composing || state.composedEnter)return;
  if(configDraft() || settingsDraft() || reviewDraft()){showError('formError','请先提交或取消 Config／跟进草稿；工作输入已保留。');return}
  const input=formValues();
  try{
    const observation={observedAt:$('observedAt').value?new Date($('observedAt').value).toISOString():undefined,note:$('observationNote').value};
    useWorkbook(state.editing?Model.updateRecord(state.workbook,state.editing,input,observation):Model.addRecord(state.workbook,input,observation));
    if(!state.editing)state.newDate=input.date;
    state.revision++;clearForm();showRows();$('start').focus();
  }catch(error){showError('formError',error.message)}
});
$('jobForm').addEventListener('compositionstart',()=>{state.composing=true});
$('jobForm').addEventListener('compositionend',()=>{state.composing=false});
$('jobForm').addEventListener('keydown',event=>{
  if(event.key!=='Enter')return;
  if(event.isComposing || event.keyCode===229 || event.repeat){event.preventDefault();state.composedEnter=true;setTimeout(()=>{state.composedEnter=false},0)}
});
for(const key of [...fields,'observedAt','observationNote'])$(key).addEventListener('input',()=>{updatePreview();summary()});
function discardDraft(){return !hasDraft() || confirm('确定放弃尚未提交的工作输入？')}
for(const key of ['cancelEdit','discardDraft'])$(key).onclick=()=>{if(discardDraft()){clearForm();summary()}};
function editSource(recordId,{reveal=false}={}){
  if(state.editing===recordId){if(reveal)setDisplayMode('compact');return true}
  if(reviewDraft() || settingsDraft() || configDraft()){openDrawer(drawerDraft());showError('reviewError','请先提交或取消跟进／Config 草稿，再编辑工作。');return false}
  if(!discardDraft())return false;
  const row=Model.get(state.workbook,'records',recordId);if(state.editing===null)state.newDate=$('date').value || state.newDate;
  clearForm();state.editing=row.id;for(const field of fields)$(field).value=row[field] ?? '';
  state.formBaseline=formSignature();$('formTitle').textContent='Editing Record';$('submitJob').textContent='Save Changes';$('cancelEdit').hidden=false;$('deleteRecord').hidden=row.type!=='Current';$('discardDraft').hidden=true;
  $('recordIdentity').textContent=`${row.type} · ${row.invoice || 'Invoice 待补'} · ${row.date} ${row.start}–${row.end}`;$('recordIdentity').title=row.id;$('recordIdentity').hidden=false;
  $('additionalDetails').open=true;uiNotice('');markSelection();updatePreview();summary();
  if(reveal){setDisplayMode('compact');closeDrawer({restoreFocus:false});$('note').focus({preventScroll:true})}
  return true;
}
$('rows').onclick=event=>{
  const row=event.target.closest('[data-record-id]');if(row && editSource(row.dataset.recordId))row.focus({preventScroll:true});
};
$('workScroll').onkeydown=event=>{
  if(!['ArrowDown','ArrowUp','Home','End','Enter'].includes(event.key) || event.isComposing)return;
  const rows=[...$('rows').querySelectorAll('[data-record-id]')];if(!rows.length)return;
  event.preventDefault();const index=rows.findIndex(row=>row.dataset.recordId===state.editing);
  const next=event.key==='Home'?0:event.key==='End'?rows.length-1:event.key==='ArrowDown'?Math.min(index+1,rows.length-1):event.key==='ArrowUp'?Math.max(index-1,0):Math.max(index,0);
  if(editSource(rows[next].dataset.recordId,{reveal:event.key==='Enter'})){rows[next].focus({preventScroll:true});rows[next].scrollIntoView({block:'nearest'});if(event.key==='Enter')$('start').focus()}
};
$('deleteRecord').onclick=()=>{
  if(!state.editing)return;
  if(!noDraft())return;
  const row=Model.get(state.workbook,'records',state.editing),history=state.workbook.appChanges.some(entry=>entry.recordId===row.id);
  if(!confirm('确认删除 '+(row.invoice || row.date)+'？'+(history?'此工作的 App 变化历史也会删除。':'')+'仍需 Save 才持久化。'))return;
  try{useWorkbook(Model.deleteRecord(state.workbook,row.id));state.revision++;clearForm();showRows()}catch(error){showError('formError',error.message)}
};
$('search').oninput=showRows;
for(const key of ['typeFilter','monthFilter','issueFilter'])$(key).onchange=showRows;
$('resetFilters').onclick=()=>{$('typeFilter').value='';$('monthFilter').value='';$('issueFilter').value='all';$('search').value='';showRows()};
for(const key of configInputs)$(key).oninput=summary;
$('cancelConfig').onclick=()=>{if(!configDraft() || confirm('确定放弃规则草稿？')){resetConfig({preserveDefault:true});showError('configError','');summary()}};
$('configForm').onsubmit=event=>{
  event.preventDefault();if(state.busy)return;
  if(hasDraft() || settingsDraft() || reviewDraft()){showError('configError','请先提交或取消工作、默认费率或跟进草稿。');return}
  try{
    const config={...state.config,minHours:Number($('configMinHours').value),ahStart:Core.minutes($('configAHStart').value)===null?NaN:Core.minutes($('configAHStart').value)/60,ahEnd:Core.minutes($('configAHEnd').value)===null?NaN:Core.minutes($('configAHEnd').value)/60,mult:Number($('configMult').value),tolerance:$('configTolerance').value===''?NaN:Number($('configTolerance').value)};
    state.review=Model.previewConfig(state.workbook,config,state.revision);
    $('reviewRows').innerHTML=state.review.affected.map(row=>`<tr><td>${safe(row.invoice || row.id)}</td><td>${money(row.before)}</td><td>${money(row.after)}</td><td>${money(row.difference)}</td></tr>`).join('') || '<tr><td colspan="4">没有工作金额变化；新规则仍将适用于 Current。</td></tr>';
    showError('configPreviewError','');$('reviewModal').showModal();showError('configError','');
  }catch(error){showError('configError',error.message)}
};
$('reviewConfirm').onclick=()=>{
  try{useWorkbook(Model.applyConfig(state.workbook,state.review,state.revision));state.revision++;state.review=null;resetConfig();$('reviewModal').close();updatePreview();showRows()}catch(error){showError('configPreviewError',error.message)}
};
$('reviewCancel').onclick=()=>{state.review=null;$('reviewModal').close();resetConfig();summary()};
$('reviewModal').addEventListener('cancel',()=>{state.review=null;resetConfig();summary()});
$('defaultRateForm').onsubmit=event=>{
  event.preventDefault();if(state.busy)return;
  if(hasDraft() || reviewDraft() || configDraft()){showError('defaultRateError','请先提交或取消工作、跟进或规则草稿。');return}
  try{useWorkbook(Model.setDefaultRate(state.workbook,$('defaultRate').value));state.revision++;resetConfig();clearForm();showError('defaultRateError','');showRows()}catch(error){showError('defaultRateError',error.message)}
};
$('defaultRate').oninput=summary;
$('cancelDefaultRate').onclick=()=>{if(!settingsDraft() || confirm('确定放弃默认费率草稿？')){$('defaultRate').value=defaultRate();showError('defaultRateError','');summary()}};
function commitFile(workbook,file,handle,sourceHash,writable){
  if(hasUnsaved() && !confirm('当前有尚未保存或确认的内容。确定放弃这些内容并打开选定文件吗？'))return false;
  if($('cycleModal').open)$('cycleModal').close();
  state.carryBaseline=null;state.carryPlan=null;$('carryRows').replaceChildren();
  useWorkbook(workbook);state.sourceHandle=handle;state.sourceWritable=!!handle && writable && !!workbook.metadata.fileVersionId && !state.archiveFiles.has(archiveKey(workbook.metadata));
  if(handle && !state.protectedHandles.includes(handle))state.protectedHandles.push(handle);
  state.fileName=file.name;state.sourceHash=sourceHash;state.opened=true;state.revision=workbook.metadata.fileVersionId?0:1;state.persistedRevision=0;state.pending=null;state.newDate=null;
  resetConfig();clearForm();TrackerReviewUI.reset();clearFileFailure();ui.saved=false;closeDrawer({restoreFocus:false});setDisplayMode('compact');$('workScroll').scrollTop=0;$('typeFilter').value='';$('monthFilter').value='';$('issueFilter').value='all';$('search').value='';showRows();if(handle)rememberFile(handle,file.name,state.sourceWritable);return true;
}
async function readFileData(file){
  if(file.size>TrackerWorkbook.FILE_LIMIT)throw Error('XLSX 输入超过 32MiB');
  const bytes=await file.arrayBuffer(),workbook=await TrackerWorkbook.read(bytes),hash=await TrackerWorkbook.hashBytes(bytes);
  return {workbook,hash};
}
async function takeFile(file,handle=null,writable=true){
  if(state.busy)return;state.busy=true;summary();
  try{
    const {workbook,hash}=await readFileData(file);
    if(commitFile(workbook,file,handle,hash,writable))alert('已加载 schema 5.0；工作、事项与必要历史已校验。');
  }catch(error){fileFailure('无法打开文件：'+error.message);alert('无法打开文件：'+error.message)}finally{state.busy=false;summary()}
}
$('openBtn').onclick=async()=>{
  if(state.busy)return;
  if(window.showOpenFilePicker){try{const [handle]=await window.showOpenFilePicker({types:[{description:'Excel',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}],multiple:false});await takeFile(await handle.getFile(),handle)}catch(error){if(error.name!=='AbortError'){fileFailure('文件选择失败：'+error.message);alert('文件选择失败：'+error.message)}}return}
  $('fileInput').click();
};
$('fileInput').onchange=event=>{const file=event.target.files[0];if(file)takeFile(file);event.target.value=''};
async function rememberFile(handle,name,writable){
  state.recent={handle,name,writable};$('recentBtn').hidden=false;$('recentBtn').textContent='重开最近：'+name;
  try{await TrackerRecentFile.write(handle,name,writable);$('recentStatus').textContent='最近文件仅记住引用；重开会重新读取 XLSX。'}catch{$('recentStatus').textContent='浏览器无法记住文件引用；下次请重新选择 XLSX。'}
}
async function loadRecentFile(){try{const recent=await TrackerRecentFile.read();if(state.recent || !recent?.handle)return;state.recent=recent;$('recentBtn').hidden=false;$('recentBtn').textContent='重开最近：'+recent.name}catch{$('recentStatus').textContent='最近文件存储不可用，请重新选择 XLSX。'}}
async function readRecentFile(handle){
  let timer;
  try{
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('重开超时，浏览器未完成文件访问')),30000)});
    // 在本次点击中直接请求权限，避免旧句柄的权限查询无响应时阻断授权。
    const reading=(async()=>{
      if(await handle.requestPermission({mode:'read'})!=='granted')throw Error('未获得读取权限');
      const file=await handle.getFile();
      return {file,...await readFileData(file)};
    })();
    // 完成竞速后才接纳数据，超时后返回的旧结果不能覆盖新工作。
    return await Promise.race([reading,timeout]);
  }finally{clearTimeout(timer)}
}
$('recentBtn').onclick=async()=>{
  if(state.busy || !state.recent)return;
  const {handle,writable}=state.recent;state.busy=true;summary();
  try{
    const {file,workbook,hash}=await readRecentFile(handle);
    if(commitFile(workbook,file,handle,hash,writable))alert('已加载 schema 5.0；工作、事项与必要历史已校验。');
  }catch(error){const message='无法重开最近文件：'+error.message+'。当前记录和草稿已保留，请点击“Open / Switch File”重新选择 XLSX。';$('recentStatus').textContent=message;fileFailure(message)}finally{state.busy=false;summary()}
};
function versionedFilename(newCycle=false) {
  const date=new Date(), pad=(n,w=2)=>String(n).padStart(w,'0');
  const stamp=`${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${pad(date.getMilliseconds(),3)}`;
  const stem=newCycle?'RouterStack_New_Cycle':String(state.fileName).replace(/\.xlsx$/i,'').replace(/_V[345]_\d{8}_\d{6}_\d{3}$/,'').replace(/[\\/:*?"<>|]/g,'_').slice(0,120);
  return stem+'_V5_'+stamp+'.xlsx';
}
function downloadBlob(blob,filename) {
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url;link.download=filename;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function exportSnapshot(workbook,revision,kind) {
  const filename=versionedFilename(kind==='cycle');
  state.busy=true;summary();
  try {
    let handle=kind==='save'?state.sourceHandle:null;
    const previousHandle=state.sourceHandle,previousHash=state.sourceHash;
    if(kind==='save'){
      if(!handle || !state.sourceWritable || state.archiveFiles.has(archiveKey(state.workbook.metadata)))throw Error('当前来源受归档保护，请使用 Save As');
      for(const archive of state.archiveHandles)if(handle===archive || await handle.isSameEntry(archive))throw Error('不能写回归档，请使用 Save As');
      if(handle.queryPermission && await handle.queryPermission({mode:'readwrite'})!=='granted' && await handle.requestPermission({mode:'readwrite'})!=='granted')throw Error('未获得写入权限，请授权或使用 Save As');
    }else if(window.showSaveFilePicker) {
      handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'Excel',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}]});
      if(handle.name.toLowerCase()===state.fileName.toLowerCase())throw Error('请选择新的版本文件名；原文件保持不变。');
      for(const protectedHandle of state.protectedHandles)if(await handle.isSameEntry(protectedHandle))throw Error('不能写回已打开或已导出的文件，请选择新文件。');
    }
    const blob=await TrackerWorkbook.write(workbook,{fileName:handle?.name || filename}),metadata=TrackerWorkbook.exportInfo(blob),sourceHash=await TrackerWorkbook.hashBytes(await blob.arrayBuffer());
    if(handle) {
      const checkSource=async()=>{if(kind==='save' && (!previousHash || await TrackerWorkbook.hashBytes(await(await handle.getFile()).arrayBuffer())!==previousHash))throw Error('文件已被 Excel 或其他程序修改。已阻止覆盖；请另存副本，或保留当前输入后重新打开核对。')};
      let writer;
      try{await checkSource();writer=await handle.createWritable();await checkSource();await writer.write(blob);await checkSource();await writer.close()}
      catch(error){try{await writer?.abort()}catch{/* Preserve the original write error. */}throw error}
      state.protectedHandles.push(handle);
      if(kind==='same' || kind==='save'){
        if(kind==='same' && previousHandle){state.archiveHandles.push(previousHandle)}
        state.sourceHandle=handle;state.sourceWritable=true;state.persistedRevision=revision;state.fileName=handle.name;state.opened=true;state.pending=null;state.sourceHash=sourceHash;if(state.workbook?.metadata.fileId===metadata.fileId)Object.assign(state.workbook.metadata,metadata);
        rememberFile(handle,handle.name,true);
      }else if(kind==='cycle'){state.archiveFiles.add(archiveKey(state.workbook.metadata));state.sourceWritable=false;if(previousHandle){state.archiveHandles.push(previousHandle);rememberFile(previousHandle,state.fileName,false)}}
      clearFileFailure();if(kind!=='cycle')ui.saved=true;
      alert((kind==='save'?'已保存当前文件：':'已另存新文件：')+handle.name+(kind==='cycle'?'。原周期仍保持打开；请打开新文件继续录入。':''));
    } else {
      downloadBlob(blob,filename);
      state.pending={revision,filename,kind,metadata,sourceHash};clearFileFailure();
      alert('已发起下载，待确认保留：'+filename+'。浏览器无法确认你是否已保留文件；确认后请点击“我已保留下载文件”。'+(kind==='cycle'?'原周期保持打开，请打开新周期文件继续。':''));
    }
    return true;
  } catch(error){if(error.name!=='AbortError'){fileFailure('保存失败：'+error.message);alert('保存失败：'+error.message)}return false}
  finally{state.busy=false;summary()}
}
async function saveFile(saveAs=false){
  if(state.busy || !noDraft())return;
  try{Model.validate(state.workbook)}catch(error){fileFailure(error.message);alert(error.message);return}
  await exportSnapshot(clone(state.workbook),state.revision,!saveAs && state.sourceHandle && state.sourceWritable?'save':'same');
}
$('saveBtn').onclick=()=>saveFile();
$('saveAsBtn').onclick=()=>saveFile(true);
$('confirmDownload').onclick=()=>{
  if(!state.pending || state.busy)return;
  const pending=state.pending;
  if(pending.kind==='same'){if(state.sourceHandle){state.archiveHandles.push(state.sourceHandle);rememberFile(state.sourceHandle,state.fileName,false)}state.sourceHandle=null;state.sourceWritable=false;state.persistedRevision=pending.revision;state.fileName=pending.filename;state.opened=true;state.sourceHash=pending.sourceHash;if(state.workbook?.metadata.fileId===pending.metadata.fileId)Object.assign(state.workbook.metadata,pending.metadata)}
  if(pending.kind==='cycle'){state.archiveFiles.add(archiveKey(state.workbook.metadata));state.sourceWritable=false;if(state.sourceHandle){state.archiveHandles.push(state.sourceHandle);rememberFile(state.sourceHandle,state.fileName,false)}}
  state.pending=null;if(pending.kind!=='cycle')ui.saved=true;clearFileFailure();summary();
};
$('cycleBtn').onclick=()=>{
  if(state.busy || !noDraft())return;
  if(state.dirty || state.pending || !state.workbook.metadata.fileVersionId){alert('请先保存并确认保留当前周期文件，再创建新周期。');return}
  state.carryPlan=Model.buildCarryForwardPlan(state.workbook);
  $('cycleName').value='';$('cycleStart').value='';$('cycleEnd').value='';
  const plan=state.carryPlan;
  $('carryRows').innerHTML='<h3>自动跟进</h3>'+plan.scopeCandidates.map(item=>{
    const row=Model.get(state.workbook,'records',item.recordId);
    return `<fieldset><legend>${safe(row.invoice || row.id)} · ${row.date}</legend><p class="helper">当前提醒：${safe(item.detected.map(kind=>Reports.ISSUE_LABELS[kind]).join(' · ') || '无')}。勾选的是未来允许检测的类别。</p><div class="check-list">${Model.REMINDER_KINDS.map(kind=>`<label><input type="checkbox" data-carry-record="${safe(row.id)}" value="${kind}" ${item.allowed.includes(kind)?'checked':''}>${Reports.ISSUE_LABELS[kind]}</label>`).join('')}</div></fieldset>`;
  }).join('')+'<h3>开放人工事项</h3>'+plan.issueCandidates.map(row=>`<label class="check-list"><input type="checkbox" data-carry-issue="${safe(row.id)}" checked>${safe(row.category+' · '+row.description)} · ${row.recordId?'关联真实工作':'未关联工作'}</label>`).join('')+'<h3>开放确认余额</h3>'+plan.balanceCandidates.map(row=>`<label class="check-list"><input type="checkbox" data-carry-balance="${safe(row.id)}" checked>${safe(row.description)} · ${money(row.amountCents/100)} · ${row.recordId?'关联真实工作':'未关联工作'}</label>`).join('');
  $('cycleModal').showModal();state.carryBaseline=carrySignature();renderCarryPreview();
};
function carrySelectionInput(){
  if(!state.carryPlan)return {};
  return {reminderScopes:Object.fromEntries(state.carryPlan.scopeCandidates.map(item=>[item.recordId,[...$('carryRows').querySelectorAll(`[data-carry-record="${item.recordId}"]:checked`)].map(input=>input.value)])),issueIds:[...$('carryRows').querySelectorAll('[data-carry-issue]:checked')].map(input=>input.dataset.carryIssue),balanceIds:[...$('carryRows').querySelectorAll('[data-carry-balance]:checked')].map(input=>input.dataset.carryBalance)};
}
function renderCarryPreview(){
  try{const plan=Model.buildCarryForwardPlan(state.workbook,{selection:carrySelectionInput()});$('selectedCount').textContent=`保留真实工作 ${plan.recordIds.length} 项、人工事项 ${plan.issueIds.length} 项、余额 ${plan.balanceIds.length} 项；银行到账 0 笔。`;showError('cycleError',plan.excludedBalanceIds.length?'排除的余额不在新文件继续跟进，旧文件仍保持未解决。':'')}catch(error){showError('cycleError',error.message)}summary();
}
$('carryRows').onchange=renderCarryPreview;
for(const key of ['cycleName','cycleStart','cycleEnd'])$(key).oninput=summary;
const discardCarryDraft=()=>!hasCarryDraft() || confirm('确定放弃尚未生成文件的新周期资料？');
$('closeCycle').onclick=()=>{if(!state.busy && discardCarryDraft())$('cycleModal').close()};
$('cycleModal').addEventListener('cancel',event=>{if(state.busy || !discardCarryDraft())event.preventDefault()});
$('cycleModal').addEventListener('close',()=>{state.carryBaseline=null;state.carryPlan=null;summary()});
$('createCycle').onclick=async()=>{
  if(state.busy)return;
  try{
    if(state.dirty || state.pending || !noDraft())throw Error('当前文件或输入已变化，请先保存并重新预览结转');
    const selection=carrySelectionInput(),plan=Model.buildCarryForwardPlan(state.workbook,{selection});
    if(plan.excludedBalanceIds.length && !confirm(`明确排除 ${plan.excludedBalanceIds.length} 项确认余额？旧文件的状态和金额保持不变。`))return;
    const next=Model.carryForward(state.workbook,{name:$('cycleName').value,start:$('cycleStart').value,end:$('cycleEnd').value,selection});
    if(await exportSnapshot(next,state.revision,'cycle'))$('cycleModal').close();
  }catch(error){showError('cycleError',error.message)}
};
window.addEventListener('beforeunload',event=>{if(hasUnsaved() || state.busy){event.preventDefault();event.returnValue=''}});
useWorkbook(state.workbook);resetConfig();clearForm();
TrackerReviewUI.init({getState:()=>state,safe,money,jobHasDraft:()=>hasDraft() || settingsDraft() || configDraft(),onChange:workbook=>{useWorkbook(workbook);state.revision++;showRows()},onDraftChange:summary,editRecord:id=>editSource(id,{reveal:true})});
showRows();loadRecentFile();
