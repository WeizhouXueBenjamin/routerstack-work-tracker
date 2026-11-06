'use strict';
const Core=TrackerCore;
const $=id=>document.getElementById(id);
const fields=['date','invoice','start','end','lunch','rate','app','extra','note'];
const money=value=>'$'+Number(value || 0).toLocaleString('en-NZ',{minimumFractionDigits:2,maximumFractionDigits:2});
const safe=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let uid=0;
const state={records:[],config:{...Core.DEFAULT_CONFIG},version:Core.VERSION,fileName:'RouterStack_Cycle.xlsx',sourceHandle:null,protectedHandles:[],opened:false,editing:null,revision:0,persistedRevision:0,pending:null,busy:false,formBaseline:'',review:null,carryCandidates:[]};
Object.defineProperty(state,'dirty',{get:()=>state.revision!==state.persistedRevision});
const calculate=record=>Core.calculate(record,state.config,state.version);
const openZip=input=>TrackerWorkbook.read(input);
const buildExport=(records,config)=>TrackerWorkbook.write(records,config);
const clone=value=>JSON.parse(JSON.stringify(value));
const identified=records=>records.map(record=>({...record,uid:'record-'+(++uid)}));
const changed=()=>{state.revision++;summary()};
function formValues() {
  const values=Object.fromEntries(fields.map(id=>[id,$(id).value]));
  values.invoice=values.invoice.trim().toUpperCase();
  return {...values,kind:'Job',balance:''};
}
const hasDraft=()=>JSON.stringify(formValues())!==state.formBaseline;
const hasUnsaved=()=>state.dirty || state.pending!==null || hasDraft();
function showError(id,message){$(id).textContent=message;$(id).style.display=message?'block':'none'}
function noDraft() {
  if(!hasDraft())return true;
  showError('formError','表单有尚未提交的内容。请先添加／保存这项修改，或明确取消，再执行此操作。');
  $('submitJob').focus();return false;
}
function discardDraft(){return !hasDraft() || confirm('表单中有尚未提交的内容。确定放弃这部分修改吗？')}
function clearForm() {
  $('jobForm').reset();
  const today=new Date();
  $('date').value=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  state.editing=null;state.formBaseline=JSON.stringify(formValues());
  $('formTitle').textContent='新增工作记录';$('submitJob').textContent='添加这项工作';$('cancelEdit').style.display='none';
  showError('formError','');updatePreview();
}
function renderRules() {
  const config=state.config;
  const period=state.version==='2.0'?`${Core.timeText(config.ahStart)}–24:00（旧规则）`:`${Core.timeText(config.ahStart)}–${Core.timeText(config.ahEnd)}`;
  $('rulesBox').textContent=`Config · 最低 ${config.minHours} h · AH ${period} · ${config.mult}× · 差额提醒阈值 ${money(config.tolerance)}。Lunch 先扣普通时段。`+(state.version==='2.0'?'当前为 2.0 只读模式；升级前会逐笔预览金额变化。':'不足最低工时按扣休息后的普通／AH 占比分配。规则适用于当前周期；在 Excel 修改 Config 后重开并确认差异。');
}
function updatePreview() {
  const out=calculate(formValues());
  $('liveExpected').textContent=out?money(out.total):'—';
  $('liveHours').textContent=out?`${out.bill.toFixed(2)} (${out.ah.toFixed(2)})`:'—';
  $('liveHint').textContent=out?'括号内为 AH Paid Hours；App 金额不参与估算':'填写有效时间和费率以预览估算';
}
function summary() {
  const values=state.records.map(calculate);
  $('kJobs').textContent=state.records.filter(record=>record.kind==='Job').length;
  $('kExpected').textContent=money(Core.round(values.reduce((sum,out)=>sum+(out?.total || 0),0)));
  $('kApp').textContent=money(Core.round(state.records.reduce((sum,record)=>sum+Number(record.app || 0),0)));
  $('kDiff').textContent=money(Core.round(values.reduce((sum,out)=>sum+(out?.diff || 0),0)));
  $('rowCount').textContent=state.records.length+' / 300 条';
  const messages=[state.opened?'当前文件：'+state.fileName:'使用内置空白 3.0 模板'];
  if(state.version==='2.0')messages.push('旧版本只读');
  if(hasDraft())messages.push('表单内容尚未提交');
  if(state.dirty)messages.push('有尚未保存的记录修改');
  if(state.pending)messages.push('已发起下载，待确认保留：'+state.pending.filename);
  if(state.busy)messages.push('正在处理文件');
  if(!hasUnsaved() && !state.busy)messages.push('已载入／就绪');
  $('statusBar').textContent=messages.join(' · ');
  $('confirmDownload').hidden=!state.pending;
  $('confirmDownload').disabled=state.busy;
  $('upgradeBtn').hidden=state.version!=='2.0';
  $('upgradeBtn').disabled=state.busy;
  for(const id of ['saveBtn','cycleBtn'])$(id).disabled=state.busy || state.version==='2.0';
  $('openBtn').disabled=state.busy;
  $('createCycle').disabled=state.busy;
  for(const input of $('jobForm').querySelectorAll('input,textarea,button'))input.disabled=state.version==='2.0';
  renderRules();
}
function showRows() {
  const query=$('search').value.toLowerCase();
  const records=state.records.filter(record=>(record.invoice+' '+record.date+' '+record.note).toLowerCase().includes(query));
  $('rows').innerHTML=records.length?records.map(record=>{
    const out=calculate(record), carry=record.kind==='Carryover';
    return `<tr class="${carry?'trcarry':''}"><td>${safe(record.date)}</td><td class="${!record.invoice?'missing':''}">${safe(record.invoice || '待补')}</td><td>${carry?'结转':safe(record.start+'–'+record.end)}</td><td>${carry?'—':out?`${out.bill.toFixed(2)} (${out.ah.toFixed(2)})`:'检查输入'}</td><td class="num">${money(out?.total)}</td><td class="num">${record.app===''?'—':money(record.app)}</td><td class="num ${out?.diff!=null && Math.abs(out.diff)>state.config.tolerance?'diff':''}">${out?.diff==null?'—':money(out.diff)}</td><td class="notes" title="${safe(record.note)}">${safe(record.note || '—')}</td><td>${state.version==='2.0'?'只读':carry?'结转记录':`<button class="mini" data-edit="${record.uid}">编辑</button> <button class="mini danger" data-delete="${record.uid}">删除</button>`}</td></tr>`;
  }).join(''):'<tr><td colspan="9" class="blank">没有匹配的记录</td></tr>';
  summary();
}
$('jobForm').addEventListener('submit',event=>{
  event.preventDefault();
  if(state.version!=='3.0')return;
  const record=formValues(), index=state.records.findIndex(row=>row.uid===state.editing);
  let error=Core.validateRecord(record,state.config);
  if(!error && state.editing!==null && index<0)error='正在编辑的记录已不存在，请重新选择。';
  if(!error && record.invoice && state.records.some(row=>row.uid!==state.editing && row.invoice===record.invoice))error='Invoice ID 重复：'+record.invoice;
  if(!error && index<0 && state.records.length>=Core.MAX_RECORDS)error='本周期已达 300 条，请先保存并创建新周期。表单内容已保留。';
  showError('formError',error);if(error)return;
  if(index>=0)state.records[index]={...record,uid:state.editing};
  else state.records.push(...identified([record]));
  state.revision++;clearForm();showRows();
});
$('cancelEdit').onclick=()=>{if(discardDraft()){clearForm();summary()}};
$('discardDraft').onclick=()=>{if(discardDraft()){clearForm();summary()}};
for(const id of fields)$(id).addEventListener('input',()=>{updatePreview();summary()});
$('search').addEventListener('input',showRows);
$('rows').addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button || state.version!=='3.0')return;
  const id=button.dataset.edit ?? button.dataset.delete, index=state.records.findIndex(record=>record.uid===id);
  if(index<0)return;
  const record=state.records[index];
  if(button.dataset.edit!==undefined) {
    if(!discardDraft())return;
    state.editing=id;for(const field of fields)$(field).value=record[field] ?? '';
    state.formBaseline=JSON.stringify(formValues());
    $('formTitle').textContent='编辑工作记录';$('submitJob').textContent='保存这项修改';$('cancelEdit').style.display='';
    showError('formError','');updatePreview();summary();window.scrollTo({top:0,behavior:'smooth'});
  } else {
    if(id===state.editing && !discardDraft())return;
    if(!confirm('确认删除 '+(record.invoice || record.date)+'？删除后仍需另存 Excel。'))return;
    state.records.splice(index,1);state.revision++;
    if(id===state.editing)clearForm();showRows();
  }
});
function commitFile(out,file,handle,needsSave=false) {
  if(hasUnsaved() && !confirm('当前有尚未保存或确认的内容。确定放弃这些内容并打开选定文件吗？'))return false;
  state.records=identified(out.records);state.config={...out.config};state.version=out.version;
  state.sourceHandle=handle;state.protectedHandles=handle?[handle]:[];state.fileName=file.name;
  state.opened=true;state.revision=needsSave?1:0;state.persistedRevision=0;state.pending=null;
  $('search').value='';clearForm();showRows();return true;
}
function reviewChanges({title,records,before,after,beforeVersion,accept}) {
  const changes=records.map(record=>({record,old:Core.calculate(record,before,beforeVersion),next:Core.calculate(record,after)}));
  $('reviewTitle').textContent=title;
  const describe=(config,version)=>`最低 ${config.minHours}h；AH ${Core.timeText(config.ahStart)}–${version==='2.0'?'24:00':Core.timeText(config.ahEnd)}；${config.mult}×；阈值 ${money(config.tolerance)}`;
  $('reviewRules').textContent='原规则：'+describe(before,beforeVersion)+'。新规则：'+describe(after,'3.0')+'。以下对比使用同一组当前原始记录；原文件保持不变，确认后仍须另存。'+(beforeVersion==='2.0'?'旧文件没有历史规则快照，此处只比较 2.0 与 3.0 算法，不推测更早的规则。':'');
  $('reviewRows').innerHTML=changes.length?changes.map(({record,old,next})=>`<tr><td>${safe(record.invoice || 'Invoice 待补')}</td><td>${safe(record.date)}</td><td>${money(old.total)}</td><td>${money(next.total)}</td><td>${money(Core.round(next.total-old.total))}</td></tr>`).join(''):'<tr><td colspan="5">无工作记录，仅更新规则。</td></tr>';
  state.review={accept};$('reviewModal').showModal();
}
$('reviewCancel').onclick=()=>{$('reviewModal').close();state.review=null};
$('reviewModal').addEventListener('cancel',()=>{state.review=null});
$('reviewConfirm').onclick=()=>{
  const review=state.review;if(!review)return;
  if(review.accept()!==false){state.review=null;$('reviewModal').close()}
};
async function takeFile(file,handle=null) {
  if(state.busy)return;
  state.busy=true;summary();
  try {
    const out=await openZip(await file.arrayBuffer());
    if(out.configChanged)reviewChanges({title:'Config 已变化：确认整个周期的规则差异',records:out.records,before:out.baseline,after:out.config,beforeVersion:'3.0',accept:()=>commitFile(out,file,handle,true)});
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
  if(state.version!=='2.0' || state.busy)return;
  const config={...state.config,ahEnd:6};
  try{Core.validateConfig(config)}catch(error){alert('无法升级：'+error.message);return}
  reviewChanges({title:'升级为 3.0：预览逐笔金额变化',records:state.records,before:state.config,after:config,beforeVersion:'2.0',accept:()=>{state.config=config;state.version='3.0';changed();clearForm();showRows()}});
};
function versionedFilename(newCycle=false) {
  const date=new Date(), pad=(n,w=2)=>String(n).padStart(w,'0');
  const stamp=`${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}_${pad(date.getMilliseconds(),3)}`;
  const stem=newCycle?'RouterStack_New_Cycle':String(state.fileName).replace(/\.xlsx$/i,'').replace(/_V3_\d{8}_\d{6}_\d{3}$/,'').replace(/[\\/:*?"<>|]/g,'_').slice(0,120);
  return stem+'_V3_'+stamp+'.xlsx';
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
    let handle=null;
    if(window.showSaveFilePicker) {
      handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:'Excel',accept:{'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx']}}]});
      if(handle.name===state.fileName)throw Error('请选择新的版本文件名；原文件保持不变。');
      for(const protectedHandle of state.protectedHandles)if(await handle.isSameEntry(protectedHandle))throw Error('不能写回已打开或已导出的文件，请选择新文件。');
    }
    const blob=await buildExport(records,config);
    if(handle) {
      let writer;
      try{writer=await handle.createWritable();await writer.write(blob);await writer.close()}
      catch(error){try{await writer?.abort()}catch{/* Preserve the original write error. */}throw error}
      state.protectedHandles.push(handle);
      if(kind==='same'){state.persistedRevision=revision;state.fileName=handle.name;state.pending=null}
      alert('已另存新文件：'+handle.name+(kind==='cycle'?'。原周期仍保持打开；请打开新文件继续录入。':''));
    } else {
      downloadBlob(blob,filename);
      state.pending={revision,filename,kind};
      alert('已发起下载，待确认保留：'+filename+'。浏览器无法确认你是否已保留文件；确认后请点击“我已保留下载文件”。'+(kind==='cycle'?'原周期保持打开，请打开新周期文件继续。':''));
    }
    return true;
  } catch(error){if(error.name!=='AbortError')alert('保存失败：'+error.message);return false}
  finally{state.busy=false;summary()}
}
$('saveBtn').onclick=async()=>{
  if(state.busy || state.version!=='3.0' || !noDraft())return;
  try{Core.validateRecords(state.records,state.config)}catch(error){alert(error.message);return}
  await exportSnapshot(clone(state.records),{...state.config},state.revision,'same');
};
$('confirmDownload').onclick=()=>{
  if(!state.pending || state.busy)return;
  const pending=state.pending;
  if(pending.kind==='same'){state.persistedRevision=pending.revision;state.fileName=pending.filename}
  state.pending=null;summary();
};
$('copyBtn').onclick=async()=>{
  const differences=state.records.map(record=>({record,out:calculate(record)})).filter(({record,out})=>record.kind==='Job' && out?.diff!=null && Math.abs(out.diff)>state.config.tolerance);
  const lines=['Invoice | Date | Expected | App | Difference',...differences.map(({record,out})=>`${record.invoice || '[Invoice pending]'} | ${record.date} | ${money(out.total)} | ${money(record.app)} | ${money(out.diff)}`)];
  try{await navigator.clipboard.writeText(lines.join('\n'));alert('已复制 '+differences.length+' 条差异记录')}catch{window.prompt('复制以下内容',lines.join('\n'))}
};
$('cycleBtn').onclick=()=>{
  if(state.busy || state.version!=='3.0' || !noDraft())return;
  if(state.dirty || state.pending){alert('请先保存并确认保留当前周期文件，再创建新周期。');return}
  state.carryCandidates=clone(state.records.filter(record=>record.invoice));
  $('carryRows').innerHTML=state.carryCandidates.length?state.carryCandidates.map(record=>`<label class="carryrow"><input type="checkbox" data-carry-id="${record.uid}"/><span><strong>${safe(record.invoice)}</strong> <span class="muted">${safe(record.date)}</span><div class="helper">${record.kind==='Carryover'?'上期确认余额':'本项预计'} ${money(calculate(record)?.total)}；结转金额须按证据确认。</div></span><input data-carry-amount="${record.uid}" type="number" min="0.01" step="0.01" value="${record.kind==='Carryover'?safe(record.balance):''}" placeholder="未结清 NZD"/></label>`).join(''):'<div class="muted">无已填写 Invoice ID 的记录，可以建立空白新周期。</div>';
  $('selectedCount').textContent='已选 0 项';showError('cycleError','');$('cycleModal').showModal();
};
$('closeCycle').onclick=()=>{$('cycleModal').close()};
$('carryRows').addEventListener('change',()=>{$('selectedCount').textContent='已选 '+$('carryRows').querySelectorAll('input[type=checkbox]:checked').length+' 项'});
$('createCycle').onclick=async()=>{
  if(state.busy)return;
  try {
    const checks=[...$('carryRows').querySelectorAll('input[type=checkbox]:checked')], records=[];
    for(const check of checks) {
      const origin=state.carryCandidates.find(record=>record.uid===check.dataset.carryId);
      const amount=$('carryRows').querySelector(`[data-carry-amount="${origin.uid}"]`).value;
      const record={kind:'Carryover',date:origin.date,invoice:origin.invoice,start:'',end:'',lunch:'',rate:'',app:'',extra:'',balance:amount,note:origin.note};
      const error=Core.validateRecord(record,state.config);if(error)throw Error(origin.invoice+' · '+error);
      records.push(record);
    }
    if(!records.length && !confirm('未选择结转项。确定建立完全空白的新周期吗？'))return;
    if(await exportSnapshot(records,{...state.config},state.revision,'cycle'))$('cycleModal').close();
  }catch(error){showError('cycleError',error.message)}
};
window.addEventListener('beforeunload',event=>{if(hasUnsaved() || state.busy){event.preventDefault();event.returnValue=''}});
clearForm();showRows();
