(function (root) {
  'use strict';
  const C=typeof module==='object' && module.exports?require('./core.js'):root.TrackerCore;
  const SCHEMA='5.0', REMINDER_KINDS=Object.freeze(['missing_invoice','missing_app','difference']);
  const clone=value=>JSON.parse(JSON.stringify(value));
  const fail=message=>{throw Error(message)};
  const now=()=>new Date().toISOString();
  const id=()=>root.crypto.randomUUID();
  const nullable=value=>C.blank(value)?null:value;
  const number=value=>C.blank(value)?null:Number(value);
  const canonical=value=>JSON.stringify(normalize(value));
  function normalize(value) {
    if(Array.isArray(value))return value.map(normalize);
    if(value && typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,normalize(value[key])]));
    return value;
  }
  const CONFIG_FIELDS=['minHours','ahStart','ahEnd','mult','tolerance','allocation','defaultRate'];
  const META_FIELDS=['schemaVersion','calculationVersion','currentPeriodId','fileId','fileVersionId','previousFileVersionId','sourceFileId','sourceFileVersionId','fileName','integrityAlgorithm','integrityDigest'];
  const RECORD_FIELDS=['id','type','periodId','date','invoice','start','end','lunch','rate','extra','app','note','createdAt','updatedAt','reminderKinds','ruleSnapshot'];
  const TABLE_FIELDS=Object.freeze({
    periods:['id','name','start','end','createdAt'],
    bankReceived:['id','date','amountCents','note','createdAt','updatedAt'],
    issues:['id','recordId','periodId','category','description','amountCents','status','createdAt','updatedAt'],
    balances:['id','recordId','periodId','amountCents','description','confirmedAt','status','followUp','createdAt','updatedAt'],
    appChanges:['id','recordId','invoice','oldApp','newApp','observedAt','recordedAt','note','estimatedCents','differenceCents'],
    issueHistory:['id','issueId','sequence','action','timestamp','recordId','category','amountCents','description','status','reason'],
    balanceHistory:['id','balanceId','sequence','action','timestamp','recordId','amountCents','description','confirmedAt','status','followUp','reason']
  });
  const ROOT_FIELDS=['metadata','config','periods','records','bankReceived','issues','balances','appChanges','issueHistory','balanceHistory'];
  function exact(object,fields,label) {
    if(!object || typeof object!=='object' || Array.isArray(object) || Object.keys(object).length!==fields.length || fields.some(key=>!Object.hasOwn(object,key)))fail(label+': 字段不符');
  }
  function text(value,label,required=false) {
    if(typeof value!=='string' || value.length>32767 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(value) || required && !value.trim())fail(label+': 文本无效或超过 Excel 单元格上限');
  }
  function timestamp(value,label) {
    if(typeof value!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value) || !C.validDate(value.slice(0,10)) || +value.slice(11,13)>23 || +value.slice(14,16)>59 || +value.slice(17,19)>59 || !Number.isFinite(Date.parse(value)))fail(label+': 需要有效的含时区时间');
  }
  function cents(value,label,{optional=false,positive=false,signed=false}={}) {
    if(optional && value===null)return;
    if(!Number.isSafeInteger(value) || !signed && value<0 || positive && value<=0)fail(label+': 需要'+(positive?'正数':signed?'有符号':'非负')+'整数 cents');
  }
  function scope(value) {
    if(!Array.isArray(value) || value.some(kind=>!REMINDER_KINDS.includes(kind)) || new Set(value).size!==value.length || canonical(value)!==canonical(REMINDER_KINDS.filter(kind=>value.includes(kind))))fail('Historical 提醒范围无效');
  }
  function create({name='当前工作周期',start=null,end=null,config={...C.DEFAULT_CONFIG,defaultRate:null}}={}) {
    const periodId=id();
    return validate({metadata:{schemaVersion:SCHEMA,calculationVersion:C.VERSION,currentPeriodId:periodId,fileId:id(),fileVersionId:null,previousFileVersionId:null,sourceFileId:null,sourceFileVersionId:null,fileName:'',integrityAlgorithm:'SHA-256',integrityDigest:null},config:clone(config),periods:[{id:periodId,name,start:nullable(start),end:nullable(end),createdAt:now()}],records:[],...Object.fromEntries(Object.keys(TABLE_FIELDS).filter(key=>key!=='periods').map(key=>[key,[]]))});
  }
  function rulesFor(state,record) {return record.type==='Historical'?record.ruleSnapshot:state.config}
  function calculate(state,record) {return C.calculate(record,rulesFor(state,record))}
  function reminders(state,record) {
    const found=[];
    if(record.invoice===null)found.push('missing_invoice');
    if(record.app===null)found.push('missing_app');
    const diff=calculate(state,record).diff;
    if(diff!==null && Math.abs(diff)>rulesFor(state,record).tolerance)found.push('difference');
    return record.type==='Current'?found:found.filter(kind=>record.reminderKinds.includes(kind));
  }
  function validate(state) {
    exact(state,ROOT_FIELDS,'WorkbookState');exact(state.metadata,META_FIELDS,'metadata');exact(state.config,CONFIG_FIELDS,'Config');
    const meta=state.metadata;
    if(meta.schemaVersion!==SCHEMA || meta.calculationVersion!==C.VERSION)fail('仅支持 schema 5.0 / calculation 3.0；旧格式不提供迁移');
    for(const key of ['currentPeriodId','fileId'])text(meta[key],key,true);
    for(const key of ['fileVersionId','previousFileVersionId','sourceFileId','sourceFileVersionId'])if(meta[key]!==null)text(meta[key],key,true);
    if((meta.sourceFileId===null)!==(meta.sourceFileVersionId===null))fail('结转来源身份不完整');
    text(meta.fileName,'fileName');
    if(meta.integrityAlgorithm!=='SHA-256' || meta.integrityDigest!==null && !/^[a-f0-9]{64}$/.test(meta.integrityDigest))fail('完整性算法或摘要无效');
    C.validateConfig(state.config);
    if(state.config.defaultRate!==null && (typeof state.config.defaultRate!=='number' || !Number.isFinite(state.config.defaultRate) || state.config.defaultRate<=0))fail('默认 Rate 必须为空或正数');
    const maps={};
    for(const key of ROOT_FIELDS.filter(key=>!['metadata','config'].includes(key))) {
      if(!Array.isArray(state[key]))fail(key+': 需要集合');
      const map=maps[key]=new Map();
      for(const row of state[key]) {
        exact(row,key==='records'?RECORD_FIELDS:TABLE_FIELDS[key],key);text(row.id,key+' ID',true);
        if(map.has(row.id))fail(key+': 重复身份 '+row.id);map.set(row.id,row);
      }
    }
    const ref=(value,map,label,optional=false)=>{if(optional && value===null)return;if(typeof value!=='string' || !map.has(value))fail(label+': 孤立引用 '+value)};
    ref(meta.currentPeriodId,maps.periods,'CurrentPeriodID');
    for(const row of state.periods) {
      text(row.name,'周期名称',true);timestamp(row.createdAt,'周期创建时间');
      for(const key of ['start','end'])if(row[key]!==null && !C.validDate(row[key]))fail('周期日期无效');
      if(row.start && row.end && row.start>row.end)fail('周期结束早于开始');
    }
    const invoices=new Set();let estimatedTotal=0,differenceTotal=0,appTotal=0;
    for(const row of state.records) {
      if(!['Current','Historical'].includes(row.type))fail('WorkRecord type 无效');
      ref(row.periodId,maps.periods,'工作周期');
      if((row.type==='Current')!==(row.periodId===meta.currentPeriodId))fail('工作类型与周期不符');
      scope(row.reminderKinds);
      if(row.type==='Current' && (row.ruleSnapshot!==null || row.reminderKinds.length))fail('Current 不保存规则副本或提醒范围');
      if(row.type==='Historical') {exact(row.ruleSnapshot,CONFIG_FIELDS.filter(key=>key!=='defaultRate'),'Historical rules');C.validateConfig(row.ruleSnapshot)}
      for(const key of ['lunch','extra','app'])if(row[key]!==null && (typeof row[key]!=='number' || !Number.isFinite(row[key])))fail('工作数值类型无效 '+key);
      if(typeof row.rate!=='number' || !Number.isFinite(row.rate) || row.invoice!==null && typeof row.invoice!=='string')fail('工作费率或 Invoice 类型无效');
      const error=C.validateRecord(row,rulesFor(state,row));if(error)fail(error);
      if(row.invoice!==null){if(!row.invoice || invoices.has(row.invoice))fail('重复或无效 Invoice ID');invoices.add(row.invoice)}
      text(row.note,'Notes');timestamp(row.createdAt,'工作创建时间');timestamp(row.updatedAt,'工作修改时间');
      const result=calculate(state,row);for(const value of [result.total,result.diff])if(value!==null && !Number.isSafeInteger(Math.round(value*100)))fail('工作金额超过安全精度');
      estimatedTotal+=Math.round(result.total*100);differenceTotal+=result.diff===null?0:Math.round(result.diff*100);appTotal+=row.app ?? 0;
      if(!Number.isSafeInteger(estimatedTotal) || !Number.isSafeInteger(differenceTotal) || !Number.isSafeInteger(Math.round(appTotal*100)))fail('工作合计超过安全精度');
    }
    for(const row of state.bankReceived) {
      if(!C.validDate(row.date))fail('银行日期无效');cents(row.amountCents,'银行金额',{positive:true});text(row.note,'银行备注');timestamp(row.createdAt,'银行创建时间');timestamp(row.updatedAt,'银行修改时间');
    }
    cents(state.bankReceived.reduce((sum,row)=>sum+row.amountCents,0),'银行合计');
    for(const key of ['issues','balances'])for(const row of state[key]) {
      ref(row.recordId,maps.records,key+' RecordID',true);ref(row.periodId,maps.periods,key+' PeriodID');
      text(row.description,'说明',true);timestamp(row.createdAt,'创建时间');timestamp(row.updatedAt,'修改时间');
      if(!['Open','Closed'].includes(row.status))fail('事项或余额状态无效');
      cents(row.amountCents,'事项或余额金额',{optional:key==='issues',signed:key==='issues'});
      if(key==='issues')text(row.category,'事项分类',true);
      else {timestamp(row.confirmedAt,'余额确认时间');if(typeof row.followUp!=='boolean')fail('余额跟进标记无效')}
    }
    for(const row of state.appChanges) {
      ref(row.recordId,maps.records,'AppChange RecordID');
      if(row.invoice!==null)text(row.invoice,'Invoice 快照',true);
      for(const key of ['oldApp','newApp'])if(row[key]!==null && (typeof row[key]!=='number' || !Number.isFinite(row[key]) || row[key]<0))fail('App 历史金额无效');
      if(row.oldApp===row.newApp)fail('同值 AppChange 无效');
      timestamp(row.observedAt,'观察时间');timestamp(row.recordedAt,'记录时间');text(row.note,'观察备注');
      cents(row.estimatedCents,'当时 Estimated',{signed:true});cents(row.differenceCents,'当时 Difference',{signed:true,optional:true});
      if(row.differenceCents!==(row.newApp===null?null:Math.round(C.round(row.estimatedCents/100-row.newApp)*100)))fail('AppChange 差额快照不符');
    }
    for(const [table,entity,key,fields] of [
      ['issueHistory','issues','issueId',['recordId','category','amountCents','description','status']],
      ['balanceHistory','balances','balanceId',['recordId','amountCents','description','confirmedAt','status','followUp']]
    ]) {
      const groups=new Map();
      for(const row of state[table]) {
        ref(row[key],maps[entity],table+' 实体');ref(row.recordId,maps.records,table+' RecordID',true);
        if(!Number.isSafeInteger(row.sequence) || row.sequence<1 || !['Create','Edit','Close','Reopen'].includes(row.action))fail('专用历史序号或动作无效');
        text(row.reason,'处理依据',true);text(row.description,'历史说明',true);timestamp(row.timestamp,'历史时间');
        cents(row.amountCents,'历史金额',{optional:entity==='issues',signed:entity==='issues'});
        if(!['Open','Closed'].includes(row.status))fail('历史状态无效');
        if(entity==='issues')text(row.category,'历史分类',true);
        else {timestamp(row.confirmedAt,'历史确认时间');if(typeof row.followUp!=='boolean')fail('历史跟进标记无效')}
        if(!groups.has(row[key]))groups.set(row[key],[]);groups.get(row[key]).push(row);
      }
      for(const row of state[entity]) {
        const history=(groups.get(row.id) || []).sort((a,b)=>a.sequence-b.sequence);
        if(!history.length || history.some((entry,index)=>entry.sequence!==index+1 || (index===0)!==(entry.action==='Create')))fail('专用历史不完整 '+row.id);
        const latest=history.at(-1);
        if(fields.some(field=>latest[field]!==row[field]))fail('专用历史末项与当前实体不符 '+row.id);
      }
    }
    return state;
  }
  function command(state,change) {validate(state);const next=clone(state);change(next);return validate(next)}
  function get(state,key,recordId) {const row=state[key].find(item=>item.id===recordId);if(!row)fail(key+': 找不到 '+recordId);return row}
  function recordInput(input) {
    return {date:input.date,invoice:nullable(input.invoice),start:input.start,end:input.end,lunch:number(input.lunch),rate:number(input.rate),extra:number(input.extra),app:number(input.app),note:input.note ?? ''};
  }
  function appChange(state,row,oldApp,observation={}) {
    if(row.app===oldApp){if(observation.observedAt || observation.note)fail('App 金额未变化，观察资料尚未提交；请更正金额或取消观察输入');return}
    const calc=calculate(state,row);
    state.appChanges.push({id:id(),recordId:row.id,invoice:row.invoice,oldApp,newApp:row.app,observedAt:observation.observedAt || now(),recordedAt:now(),note:observation.note || '',estimatedCents:Math.round(calc.total*100),differenceCents:calc.diff===null?null:Math.round(calc.diff*100)});
  }
  function addRecord(state,input,observation) {return command(state,next=>{
    const row={id:id(),type:'Current',periodId:next.metadata.currentPeriodId,...recordInput(input),createdAt:now(),updatedAt:now(),reminderKinds:[],ruleSnapshot:null};
    next.records.push(row);appChange(next,row,null,observation);
  })}
  function updateRecord(state,recordId,input,observation) {return command(state,next=>{
    const row=get(next,'records',recordId),oldApp=row.app;Object.assign(row,recordInput({...row,...input}),{updatedAt:now()});appChange(next,row,oldApp,observation);
  })}
  function deleteRecord(state,recordId) {return command(state,next=>{
    if(get(next,'records',recordId).type!=='Current')fail('仅允许直接删除 Current 工作');
    if(['issues','balances','issueHistory','balanceHistory'].some(key=>next[key].some(row=>row.recordId===recordId)))fail('有事项、余额或必要历史引用，不能删除工作');
    next.records=next.records.filter(row=>row.id!==recordId);next.appChanges=next.appChanges.filter(row=>row.recordId!==recordId);
  })}
  function saveBank(state,input,bankId=null) {return command(state,next=>{
    const data={date:input.date,amountCents:input.amountCents,note:input.note ?? '',updatedAt:now()};
    if(bankId)Object.assign(get(next,'bankReceived',bankId),data);
    else next.bankReceived.push({id:id(),...data,createdAt:now()});
  })}
  function deleteBank(state,bankId) {return command(state,next=>{get(next,'bankReceived',bankId);next.bankReceived=next.bankReceived.filter(row=>row.id!==bankId)})}
  function saveEntity(state,kind,input,entityId,reason) {return command(state,next=>{
    text(reason,'处理原因／依据',true);
    const table=kind==='issues'?'issueHistory':'balanceHistory',key=kind==='issues'?'issueId':'balanceId';
    const original=entityId?get(next,kind,entityId):null;
    const defaults={id:id(),recordId:null,periodId:next.metadata.currentPeriodId,amountCents:kind==='issues'?null:undefined,description:'',status:'Open',createdAt:now(),...(kind==='issues'?{category:'Manual'}:{confirmedAt:now(),followUp:true})};
    const row={...(original || defaults),...input,updatedAt:now()};
    if(kind==='balances' && original && row.amountCents!==original.amountCents)row.confirmedAt=now();
    // IDs and registration provenance cannot be changed by an edit form.
    for(const field of ['id','periodId','createdAt'])row[field]=(original || defaults)[field];
    const action=!original?'Create':row.status!==original.status?(row.status==='Closed'?'Close':'Reopen'):'Edit';
    if(original)Object.assign(original,row);else next[kind].push(row);
    const fields=kind==='issues'?['recordId','category','amountCents','description','status']:['recordId','amountCents','description','confirmedAt','status','followUp'];
    const sequence=next[table].reduce((max,entry)=>entry[key]===row.id?Math.max(max,entry.sequence):max,0)+1;
    next[table].push({id:id(),[key]:row.id,sequence,action,timestamp:now(),...Object.fromEntries(fields.map(field=>[field,row[field]])),reason});
  })}
  const saveIssue=(state,input,entityId=null,reason='登记人工事项')=>saveEntity(state,'issues',input,entityId,reason);
  const saveBalance=(state,input,entityId=null,reason)=>saveEntity(state,'balances',input,entityId,reason);
  function previewConfig(state,config,revision) {
    validate(state);const next=clone(state);next.config={...state.config,...config};validate(next);
    return {revision,baseline:canonical(state),config:next.config,affected:state.records.filter(row=>row.type==='Current').map(row=>({id:row.id,invoice:row.invoice,before:calculate(state,row).total,after:calculate(next,row).total})).filter(row=>row.before!==row.after).map(row=>({...row,difference:C.round(row.after-row.before)}))};
  }
  function applyConfig(state,preview,revision) {
    if(preview.revision!==revision || preview.baseline!==canonical(state))fail('预览已过期，请重新预览');
    return command(state,next=>{next.config=clone(preview.config)});
  }
  function setDefaultRate(state,value) {return command(state,next=>{next.config.defaultRate=number(value)})}
  function buildCarryForwardPlan(state,{selection={}}={}) {
    validate(state);
    const scopeCandidates=state.records.filter(row=>row.type==='Historical' || reminders(state,row).length).map(row=>({recordId:row.id,detected:reminders(state,row),allowed:row.type==='Historical'?[...row.reminderKinds]:[...REMINDER_KINDS]}));
    const issueCandidates=state.issues.filter(row=>row.status==='Open');
    const balanceCandidates=state.balances.filter(row=>row.status==='Open' && row.followUp);
    const reminderScopes=Object.fromEntries(scopeCandidates.map(row=>[row.recordId,row.allowed]));
    for(const [recordId,kinds] of Object.entries(selection.reminderScopes || {})){get(state,'records',recordId);scope(kinds);reminderScopes[recordId]=[...kinds]}
    const choose=(provided,candidates,label)=>{
      const ids=provided===undefined?candidates.map(row=>row.id):provided;
      const available=new Set(candidates.map(row=>row.id));
      if(!Array.isArray(ids) || new Set(ids).size!==ids.length || ids.some(value=>!available.has(value)))fail(label+': 选择无效');return ids;
    };
    const issueIds=choose(selection.issueIds,issueCandidates,'事项'),balanceIds=choose(selection.balanceIds,balanceCandidates,'余额');
    const recordIds=new Set(Object.entries(reminderScopes).filter(([,kinds])=>kinds.length).map(([recordId])=>recordId));
    for(const [key,history,entityKey,selected] of [['issues','issueHistory','issueId',issueIds],['balances','balanceHistory','balanceId',balanceIds]]) {
      const ids=new Set(selected);
      for(const row of [...state[key].filter(row=>ids.has(row.id)),...state[history].filter(row=>ids.has(row[entityKey]))])if(row.recordId!==null)recordIds.add(row.recordId);
    }
    return {scopeCandidates,issueCandidates,balanceCandidates,reminderScopes,issueIds,balanceIds,recordIds:[...recordIds],excludedBalanceIds:balanceCandidates.filter(row=>!balanceIds.includes(row.id)).map(row=>row.id)};
  }
  function carryForward(state,{name,start=null,end=null,selection={}}) {
    if(!state.metadata.fileVersionId)fail('请先保存并确认保留当前文件');
    const plan=buildCarryForwardPlan(state,{selection}),next=create({name,start,end,config:state.config});
    const records=new Set(plan.recordIds),issues=new Set(plan.issueIds),balances=new Set(plan.balanceIds);
    next.records=clone(state.records.filter(row=>records.has(row.id))).map(row=>({...row,type:'Historical',ruleSnapshot:row.type==='Historical'?row.ruleSnapshot:Object.fromEntries(CONFIG_FIELDS.filter(key=>key!=='defaultRate').map(key=>[key,state.config[key]])),reminderKinds:plan.reminderScopes[row.id] || []}));
    next.issues=clone(state.issues.filter(row=>issues.has(row.id)));
    next.balances=clone(state.balances.filter(row=>balances.has(row.id)));
    next.issueHistory=clone(state.issueHistory.filter(row=>issues.has(row.issueId)));
    next.balanceHistory=clone(state.balanceHistory.filter(row=>balances.has(row.balanceId)));
    next.appChanges=clone(state.appChanges.filter(row=>records.has(row.recordId)));
    const periods=new Set([...next.records,...next.issues,...next.balances].map(row=>row.periodId));
    next.periods.push(...clone(state.periods.filter(row=>periods.has(row.id))));
    next.metadata.sourceFileId=state.metadata.fileId;next.metadata.sourceFileVersionId=state.metadata.fileVersionId;
    return validate(next);
  }
  const api=Object.freeze({SCHEMA,REMINDER_KINDS,CONFIG_FIELDS,META_FIELDS,RECORD_FIELDS,TABLE_FIELDS,ROOT_FIELDS,clone,canonical,create,validate,rulesFor,calculate,reminders,get,addRecord,updateRecord,deleteRecord,saveBank,deleteBank,saveIssue,saveBalance,previewConfig,applyConfig,setDefaultRate,buildCarryForwardPlan,carryForward});
  if(typeof module==='object' && module.exports)module.exports=api;else root.TrackerModel=api;
})(globalThis);
