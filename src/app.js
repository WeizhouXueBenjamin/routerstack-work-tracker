'use strict';
const Core=TrackerCore,Model=TrackerModel,Reports=TrackerReports;
const $=id=>document.getElementById(id);
const clone=Model.clone;
const fields=['date','invoice','start','end','lunch','rate','app','extra','note'];
const configInputs=['configMinHours','configAHStart','configAHEnd','configMult','configTolerance'];
const safe=value=>String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const money=value=>value===null || value===undefined?'—':'$'+Number(value).toLocaleString('en-NZ',{minimumFractionDigits:2,maximumFractionDigits:2});
const state={workbook:Model.create(),records:[],config:null,fileName:'RouterStack_Cycle.xlsx',sourceHandle:null,protectedHandles:[],archiveHandles:[],archiveFiles:new Set(),sourceWritable:false,recent:null,opened:false,editing:null,revision:0,persistedRevision:0,pending:null,busy:false,formBaseline:'',configBaseline:'',review:null,carryBaseline:null,carryPlan:null};
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
function noDraft(){
  if(hasDraft()){showError('formError','工作表单尚未提交，请先添加／保存修改或取消输入。');$('submitJob').focus();return false}
  if(settingsDraft() || configDraft()){showError('configError','请先应用或取消 Config 设置草稿。');$('configForm').closest('details').open=true;return false}
  if(reviewDraft()){showError('reviewError','跟进区有未提交输入，请先提交或取消草稿。');$('reviewPanel').scrollIntoView();return false}
  return true;
}
function clearForm(){
  $('jobForm').reset();
  const date=new Date();state.newDate ||= `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  $('date').value=state.newDate;$('rate').value=defaultRate();state.editing=null;state.composing=false;state.formBaseline=formSignature();
  $('formTitle').textContent='新增工作记录';$('submitJob').textContent='添加这项工作';$('cancelEdit').hidden=true;showError('formError','');updatePreview();
}
function resetConfig(){
  const config=state.config;
  for(const [key,value] of Object.entries({configMinHours:config.minHours,configAHStart:Core.timeText(config.ahStart),configAHEnd:Core.timeText(config.ahEnd),configMult:config.mult,configTolerance:config.tolerance}))$(key).value=value;
  state.configBaseline=configSignature();$('defaultRate').value=defaultRate();
  $('rulesBox').textContent=`最低 ${config.minHours} h · AH ${Core.timeText(config.ahStart)}–${Core.timeText(config.ahEnd)} · ${config.mult}× · 阈值 ${money(config.tolerance)}。最低补足按扣 Lunch 后的普通／AH 占比分配。`;
}
function updatePreview(){
  const original=state.records.find(row=>row.id===state.editing),config=original?Model.rulesFor(state.workbook,original):state.config;
  const calc=Core.calculate(formValues(),config);
  $('liveExpected').textContent=calc?money(calc.total):'—';
  $('liveHours').textContent=calc?`Length ${calc.lengthHours.toFixed(2)} h · Billable ${calc.bill.toFixed(2)} (AH ${calc.ah.toFixed(2)}) h`:'—';
  $('liveHint').textContent=original?.type==='Historical'?'使用此 Historical 的原规则快照':'App 不参与估算；填写有效时间和费率以预览';
}
function summary(){
  const messages=[state.opened?'当前文件：'+state.fileName:'新的未保存工作簿','周期：'+Model.get(state.workbook,'periods',state.workbook.metadata.currentPeriodId).name];
  if(hasDraft())messages.push('工作表单尚未提交');
  if(settingsDraft() || configDraft())messages.push('Config 设置尚未应用');
  if(reviewDraft())messages.push('跟进输入尚未提交');
  if(hasCarryDraft())messages.push('新周期资料尚未生成');
  if(state.dirty)messages.push('有尚未保存的修改');
  if(state.pending)messages.push('下载待确认保留：'+state.pending.filename);
  if(state.busy)messages.push('正在处理文件');
  if(!hasUnsaved() && !state.busy)messages.push('已载入／就绪');
  $('statusBar').textContent=messages.join(' · ');$('confirmDownload').hidden=!state.pending;
  for(const key of ['openBtn','recentBtn','saveBtn','saveAsBtn','cycleBtn','confirmDownload','createCycle','closeCycle','previewConfig','reviewConfirm','applyDefaultRate','newIssue','newBalance','applyReview','submitBank'])$(key).disabled=state.busy;
  for(const input of $('cycleModal').querySelectorAll('input'))input.disabled=state.busy;
}
function showRows(){
  const month=$('monthFilter').value,months=[...new Set(state.records.map(row=>row.date.slice(0,7)))].sort();
  $('monthFilter').innerHTML='<option value="">全部月份</option>'+months.map(value=>`<option value="${value}">${value}</option>`).join('');$('monthFilter').value=months.includes(month)?month:'';
  const visible=Reports.view(state.workbook,{type:$('typeFilter').value,month:$('monthFilter').value,query:$('search').value,issue:$('issueFilter').value});
  $('recordCount').textContent=`显示 ${visible.length} / ${state.records.length} 项工作；全部资料均保存在完整导出中。`;
  $('rows').innerHTML=visible.map(row=>{
    const calc=Model.calculate(state.workbook,row);
    return `<tr data-record-id="${safe(row.id)}" class="${row.type==='Historical'?'historical':''}"><td>${row.date}</td><td>${row.start}</td><td>${row.end}</td><td class="num">${calc.lengthHours.toFixed(2)}</td><td class="num">${money(row.rate)}</td><td class="num">${money(calc.total)}</td><td class="num">${money(row.app)}</td><td class="notes"><span>${safe(row.note)}</span><div class="row-actions"><button class="mini" data-edit="${safe(row.id)}" aria-label="编辑 ${safe(row.invoice || row.id)}">${safe(row.invoice || 'Invoice 待补')} · 编辑</button>${row.type==='Current'?`<button class="mini danger" data-delete="${safe(row.id)}" aria-label="删除 ${safe(row.invoice || row.id)}">删除</button>`:''}</div></td></tr>`;
  }).join('') || '<tr><td colspan="8" class="blank">没有匹配的工作记录。</td></tr>';
  $('summaryRows').innerHTML=Reports.summary(state.workbook).map(row=>`<tr><th>${row.period.includes('-')?safe(new Date(row.period+'-01T00:00Z').toLocaleDateString('en-NZ',{month:'short',year:'numeric',timeZone:'UTC'})):row.period}</th><td class="num">${money(row.estimated)}</td><td class="num">${money(row.app)}</td><td class="num">${money(row.difference)}${row.partial && row.known?'*':''}</td></tr>`).join('');
  TrackerReviewUI.render();summary();
}
$('jobForm').addEventListener('submit',event=>{
  event.preventDefault();if(state.composing || state.composedEnter)return;
  if(configDraft() || settingsDraft()){showError('formError','请先应用或取消 Config 草稿；工作输入已保留。');return}
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
function editSource(recordId){
  if(reviewDraft() || settingsDraft() || configDraft()){showError('reviewError','请先提交或取消跟进／Config 草稿，再编辑工作。');return}
  if(!discardDraft())return;
  const row=Model.get(state.workbook,'records',recordId);if(state.editing===null)state.newDate=$('date').value || state.newDate;
  clearForm();state.editing=row.id;for(const field of fields)$(field).value=row[field] ?? '';
  state.formBaseline=formSignature();$('formTitle').textContent=row.type==='Historical'?'编辑 Historical 工作（原规则快照）':'编辑工作记录';$('submitJob').textContent='保存这项修改';$('cancelEdit').hidden=false;updatePreview();summary();$('jobForm').scrollIntoView();
}
$('rows').onclick=event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.edit){editSource(button.dataset.edit);return}
  if(!noDraft())return;
  const row=Model.get(state.workbook,'records',button.dataset.delete),history=state.workbook.appChanges.some(entry=>entry.recordId===row.id);
  if(!confirm('确认删除 '+(row.invoice || row.date)+'？'+(history?'此工作的 App 变化历史也会删除。':'')+'仍需 Save 才持久化。'))return;
  try{useWorkbook(Model.deleteRecord(state.workbook,row.id));state.revision++;if(state.editing===row.id)clearForm();showRows()}catch(error){alert(error.message)}
};
$('search').oninput=showRows;
for(const key of ['typeFilter','monthFilter','issueFilter'])$(key).onchange=showRows;
$('resetFilters').onclick=()=>{$('typeFilter').value='';$('monthFilter').value='';$('issueFilter').value='all';$('search').value='';showRows()};
for(const key of configInputs)$(key).oninput=summary;
$('cancelConfig').onclick=()=>{if(!configDraft() || confirm('确定放弃规则草稿？')){resetConfig();showError('configError','');summary()}};
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
  resetConfig();clearForm();TrackerReviewUI.reset();$('typeFilter').value='';$('monthFilter').value='';$('issueFilter').value='all';$('search').value='';showRows();if(handle)rememberFile(handle,file.name,state.sourceWritable);return true;
}
async function takeFile(file,handle=null,writable=true){
  if(state.busy)return;state.busy=true;summary();
  try{
    if(file.size>TrackerWorkbook.FILE_LIMIT)throw Error('XLSX 输入超过 32MiB');
    const bytes=await file.arrayBuffer(),workbook=await TrackerWorkbook.read(bytes),hash=await TrackerWorkbook.hashBytes(bytes);
    if(commitFile(workbook,file,handle,hash,writable))alert('已加载 schema 5.0；工作、事项与必要历史已校验。');
  }catch(error){alert('无法打开文件：'+error.message)}finally{state.busy=false;summary()}
}
$('openBtn').onclick=async()=>{
  if(state.busy)return;
  if(window.showOpenFilePicker){try{const [handle]=await window.showOpenFilePicker({types:[{description:'Excel',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}],multiple:false});await takeFile(await handle.getFile(),handle)}catch(error){if(error.name!=='AbortError')alert('文件选择失败：'+error.message)}return}
  $('fileInput').click();
};
$('fileInput').onchange=event=>{const file=event.target.files[0];if(file)takeFile(file);event.target.value=''};
async function rememberFile(handle,name,writable){
  state.recent={handle,name,writable};$('recentBtn').hidden=false;$('recentBtn').textContent='重开最近：'+name;
  try{await TrackerRecentFile.write(handle,name,writable);$('recentStatus').textContent='最近文件仅记住引用；重开会重新读取 XLSX。'}catch{$('recentStatus').textContent='浏览器无法记住文件引用；下次请重新选择 XLSX。'}
}
async function loadRecentFile(){try{const recent=await TrackerRecentFile.read();if(state.recent || !recent?.handle)return;state.recent=recent;$('recentBtn').hidden=false;$('recentBtn').textContent='重开最近：'+recent.name}catch{$('recentStatus').textContent='最近文件存储不可用，请重新选择 XLSX。'}}
$('recentBtn').onclick=async()=>{
  if(state.busy || !state.recent)return;
  const {handle,writable}=state.recent;state.busy=true;summary();
  try{if(await handle.queryPermission({mode:'read'})!=='granted' && await handle.requestPermission({mode:'read'})!=='granted')throw Error('未获得读取权限');const file=await handle.getFile();state.busy=false;await takeFile(file,handle,writable)}catch(error){$('recentStatus').textContent='无法重开最近文件：'+error.message+'。当前记录和草稿已保留，请重新选择。'}finally{state.busy=false;summary()}
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
  if(state.busy || !noDraft())return;
  try{Model.validate(state.workbook)}catch(error){alert(error.message);return}
  await exportSnapshot(clone(state.workbook),state.revision,!saveAs && state.sourceHandle && state.sourceWritable?'save':'same');
}
$('saveBtn').onclick=()=>saveFile();
$('saveAsBtn').onclick=()=>saveFile(true);
$('confirmDownload').onclick=()=>{
  if(!state.pending || state.busy)return;
  const pending=state.pending;
  if(pending.kind==='same'){if(state.sourceHandle){state.archiveHandles.push(state.sourceHandle);rememberFile(state.sourceHandle,state.fileName,false)}state.sourceHandle=null;state.sourceWritable=false;state.persistedRevision=pending.revision;state.fileName=pending.filename;state.opened=true;state.sourceHash=pending.sourceHash;if(state.workbook?.metadata.fileId===pending.metadata.fileId)Object.assign(state.workbook.metadata,pending.metadata)}
  if(pending.kind==='cycle'){state.archiveFiles.add(archiveKey(state.workbook.metadata));state.sourceWritable=false;if(state.sourceHandle){state.archiveHandles.push(state.sourceHandle);rememberFile(state.sourceHandle,state.fileName,false)}}
  state.pending=null;summary();
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
TrackerReviewUI.init({getState:()=>state,safe,money,jobHasDraft:()=>hasDraft() || settingsDraft() || configDraft(),onChange:workbook=>{useWorkbook(workbook);state.revision++;showRows()},onDraftChange:summary,editRecord:editSource});
showRows();loadRecentFile();
