(function (root) {
  'use strict';
  const C=typeof module==='object' && module.exports?require('./core.js'):root.TrackerCore;
  const SCHEMA_VERSION='4.1',CALCULATION_VERSION='3.0';
  const REMINDER_KINDS=Object.freeze(['missing_invoice','missing_app','difference']);
  const uuid=()=>root.crypto.randomUUID();
  const clone=value=>JSON.parse(JSON.stringify(value));
  const now=()=>new Date().toISOString();
  const fail=message=>{throw Error(message)};
  const blank=C.blank;
  const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  // Each property becomes a visible, typed Excel table column. No financial JSON cells.
  const definitions={
    cycles:{sheet:'Entries',fields:{id:'id',name:'text',start:'date?',end:'date?',createdAt:'time',parentId:'ref?',sourceFileId:'ref?'}},
    records:{sheet:'Entries',fields:{id:'id',originCycleId:'ref?',originRecordId:'ref?',sourceFileId:'ref?',createdAt:'time',modifiedAt:'time',state:'text',date:'date?',invoice:'text',start:'text',end:'text',lunch:'decimal?',rate:'decimal?',app:'decimal?',extra:'decimal?',note:'text',site:'text',openingCents:'cents?',calculationVersion:'text',minHours:'decimal?',ahStart:'decimal?',ahEnd:'decimal?',mult:'decimal?',tolerance:'decimal?',allocation:'text'}},
    payments:{sheet:'Reconciliation',fields:{id:'id',date:'date',cents:'cents',note:'text',batchId:'ref?',status:'text',createdAt:'time',modifiedAt:'time'}},
    batches:{sheet:'Reconciliation',fields:{id:'id',name:'text',scopeConfirmed:'boolean',basisConfirmed:'boolean',actualConfirmed:'boolean',status:'text',createdAt:'time',modifiedAt:'time',closedAt:'time?',reason:'text',evidenceId:'ref?'}},
    scope:{sheet:'Reconciliation',fields:{id:'id',batchId:'ref',recordId:'ref',kind:'text',cents:'centsSigned',confirmationId:'ref?',sourceScopeId:'ref?',active:'boolean'}},
    allocations:{sheet:'Reconciliation',fields:{id:'id',paymentId:'ref',batchId:'ref',recordId:'ref',invoice:'text',cents:'cents',status:'text',createdAt:'time',reason:'text',evidenceId:'ref'}},
    confirmations:{sheet:'Reconciliation',fields:{id:'id',recordId:'ref',kind:'text',cents:'centsNonnegative',paidAtConfirmationCents:'centsNonnegative',active:'boolean',createdAt:'time',reason:'text',evidenceId:'ref'}},
    balanceReferences:{sheet:'Reconciliation',fields:{id:'id',confirmationId:'ref',allocationId:'ref',cents:'cents'}},
    issues:{sheet:'Reconciliation',fields:{id:'id',kind:'text',code:'text',recordId:'ref?',batchId:'ref?',status:'text',createdAt:'time',modifiedAt:'time',reason:'text',evidenceId:'ref?'}},
    evidence:{sheet:'Reconciliation',fields:{id:'id',confirmedAt:'dateOrTime',reason:'text',summary:'text',source:'text',reference:'text',createdAt:'time'}},
    observations:{sheet:'History',fields:{id:'id',recordId:'ref',invoice:'text',oldAmount:'decimal?',newAmount:'decimal?',expectedCents:'centsSigned?',differenceCents:'centsSigned?',observedAt:'time?',recordedAt:'time',source:'text',note:'text',kind:'text',calculationVersion:'text',minHours:'decimal?',ahStart:'decimal?',ahEnd:'decimal?',mult:'decimal?',tolerance:'decimal?',allocation:'text'}},
    origins:{sheet:'History',fields:{id:'id',fileId:'ref',fileVersionId:'ref?',name:'text',sha256:'text',importedAt:'time',schemaVersion:'text'}},
    rules:{sheet:'Config',fields:{id:'key',minHours:'decimal',ahStart:'decimal',ahEnd:'decimal',mult:'decimal',tolerance:'decimal',allocation:'text'}},
    entrySettings:{sheet:'Config',fields:{id:'key',defaultRate:'decimal?'}},
    ratePresets:{sheet:'Config',fields:{id:'id',name:'text',rate:'decimal'}}
  };
  const freezeTables=data=>Object.freeze(Object.fromEntries(Object.entries(data).map(([key,value])=>[key,Object.freeze({...value,fields:Object.freeze({...value.fields})})])));
  const TABLES_V4=freezeTables(definitions);
  definitions.records.fields.reminderKinds='text';
  definitions.issues.fields.amountCents='centsSigned?';
  const TABLES=freezeTables(definitions);
  const tablesFor=bundle=>bundle.schemaVersion==='4.0'?TABLES_V4:TABLES;
  function reminderScope(record){
    if(!Object.hasOwn(record,'reminderKinds'))return null;
    return record.reminderKinds===''?[]:record.reminderKinds.split(',');
  }
  function encodeReminderScope(kinds){
    if(!Array.isArray(kinds) || new Set(kinds).size!==kinds.length || kinds.some(kind=>!REMINDER_KINDS.includes(kind)))fail('提醒范围含未知或重复类别');
    return REMINDER_KINDS.filter(kind=>kinds.includes(kind)).join(',');
  }
  const auditFields=Object.freeze({id:'id',sequence:'integer',originFileId:'ref',originSequence:'integer',type:'text',at:'time',reason:'text',evidenceId:'ref?'});
  const changeFields=Object.freeze({id:'id',eventId:'ref',ordinal:'integer',table:'text',recordId:'text',field:'text',oldType:'text',oldValue:'text',newType:'text',newValue:'text'});
  const numericFields=['lunch','rate','app','extra'];
  function cents(value,{positive=false}={}) {
    if(!['number','string'].includes(typeof value) || blank(value) || !C.finite(value))fail('金额必须是有限数字');
    const amount=Number(value),result=Math.round(amount*100);
    if(!Number.isSafeInteger(result) || Math.abs(result/100-amount)>1e-8 || (positive && result<=0))fail('金额最多两位小数，且须在可精确记录的范围内'+(positive?'并大于 0':''));
    return result;
  }
  const timestamp=value=>typeof value==='string' && /^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:0\d|1[0-4]):[0-5]\d)$/.test(value) && C.validDate(value.slice(0,10)) && Number.isFinite(Date.parse(value));
  function validateScalar(value,type,label) {
    if(type.endsWith('?') && value==='')return;
    const base=type.replace(/\?$/,'');
    const good=base==='text'?typeof value==='string':base==='id' || base==='ref'?typeof value==='string' && uuidPattern.test(value):base==='key'?typeof value==='string' && value.length>0:base==='date'?C.validDate(value):base==='time'?timestamp(value):base==='dateOrTime'?C.validDate(value) || timestamp(value):base==='boolean'?typeof value==='boolean':base==='decimal'?typeof value==='number' && Number.isFinite(value):base==='integer' || base.startsWith('cents')?Number.isSafeInteger(value) && (base==='cents'?value>0:base==='centsNonnegative'?value>=0:true):false;
    if(!good)fail(label+': 字段类型/数值无效（'+type+'）');
  }
  function validateRows(rows,fields,name,ids) {
    if(!Array.isArray(rows))fail(name+': 需要记录表');
    for(const [index,row] of rows.entries()) {
      if(!row || Object.keys(row).sort().join('|')!==Object.keys(fields).sort().join('|'))fail(name+' 第 '+(index+1)+' 条: 字段不完整或含未支持字段');
      for(const [field,type] of Object.entries(fields))validateScalar(row[field],type,name+' / '+(row.id || index)+' / '+field);
      const identity=name+':'+row.id;
      if(ids.has(identity))fail(name+': 重复 ID '+row.id);
      ids.add(identity);
    }
  }
  const rulesFor=(bundle,record)=>record.state==='Job' || record.state==='Pending' && record.originCycleId===bundle.cycleId?config(bundle):Object.fromEntries(Object.keys(C.DEFAULT_CONFIG).map(key=>[key,record[key]]));
  const config=bundle=>{const row=bundle.tables.rules[0];return Object.fromEntries(Object.keys(C.DEFAULT_CONFIG).map(key=>[key,row[key]]))};
  const rawRecord=record=>({kind:'Job',date:record.date,invoice:record.invoice,start:record.start,end:record.end,lunch:record.lunch,rate:record.rate,app:record.app,extra:record.extra,note:record.note,balance:'',site:record.site});
  function calculate(bundle,record) {
    if(!record || !['Job','Historical'].includes(record.state))return null;
    return C.calculate(rawRecord(record),rulesFor(bundle,record),record.calculationVersion);
  }
  function detectedReminders(bundle,record){
    if(!['Job','Historical'].includes(record.state))return [];
    const found=[],out=calculate(bundle,record);
    if(!record.invoice)found.push('missing_invoice');
    if(blank(record.app))found.push('missing_app');
    if(out?.diff!=null && Math.abs(out.diff)>rulesFor(bundle,record).tolerance)found.push('difference');
    return found;
  }
  function automaticReminders(bundle,record){
    const detected=detectedReminders(bundle,record);
    if(record.state==='Job')return detected;
    const scope=reminderScope(record);
    // Missing legacy scope requires an explicit upgrade decision, never an implicit all/none.
    return scope===null?[]:detected.filter(kind=>scope.includes(kind));
  }
  const currentRecords=bundle=>bundle.tables.records.filter(record=>record.state==='Job');
  function viewRecords(bundle) {
    const records=currentRecords(bundle).map(record=>({...rawRecord(record),uid:record.id}));
    for(const record of bundle.tables.records) {
      const remaining=carryRemaining(bundle,record.id);
      if(remaining!==null && remaining>0)records.push({kind:'Carryover',date:record.date,invoice:record.invoice,start:'',end:'',lunch:'',rate:'',app:'',extra:'',note:record.note,balance:(remaining/100).toFixed(2),site:record.site,uid:record.id});
    }
    return records;
  }
  function paid(bundle,recordId) {return bundle.tables.allocations.filter(row=>row.recordId===recordId && row.status==='Active').reduce((sum,row)=>sum+row.cents,0)}
  function paymentAllocated(bundle,paymentId) {return bundle.tables.allocations.filter(row=>row.paymentId===paymentId && row.status==='Active').reduce((sum,row)=>sum+row.cents,0)}
  const index=(bundle,table)=>new Map(bundle.tables[table].map(row=>[row.id,row]));
  function get(bundle,table,id) {return index(bundle,table).get(id) || fail(table+': 缺少关联记录 '+id)}
  function validateBusiness(bundle) {
    const maps=Object.fromEntries(Object.keys(TABLES).map(key=>[key,index(bundle,key)]));
    if(bundle.tables.rules.length!==1 || bundle.tables.rules[0].id!=='current')fail('Config: 缺少唯一规则记录');
    C.validateConfig(config(bundle));
    if(bundle.tables.entrySettings.length!==1 || bundle.tables.entrySettings[0].id!=='current')fail('Config: 缺少唯一录入设置');
    if(!blank(bundle.tables.entrySettings[0].defaultRate) && bundle.tables.entrySettings[0].defaultRate<=0)fail('Config: 默认费率必须大于 0');
    for(const preset of bundle.tables.ratePresets)if(!preset.name.trim() || preset.rate<=0)fail('Config: 费率预设无效');
    const reference=(table,id,label,optional=false)=>{if(optional && id==='')return;if(!maps[table].has(id))fail(label+': 缺少 '+table+' 关联 '+id)};
    reference('cycles',bundle.cycleId,'Workbook / Cycle');
    for(const cycle of bundle.tables.cycles){
      reference('cycles',cycle.parentId,'Cycle parent',true);if(cycle.start && cycle.end && cycle.start>cycle.end)fail('Cycle: 起止日期顺序无效');
      const seen=new Set([cycle.id]);let parent=cycle.parentId;
      while(parent){if(seen.has(parent))fail('Cycle: 来源关系形成循环');seen.add(parent);parent=maps.cycles.get(parent)?.parentId || ''}
    }
    const invoices=new Map();
    for(const record of bundle.tables.records) {
      if(bundle.schemaVersion==='4.1' && encodeReminderScope(reminderScope(record))!==record.reminderKinds)fail('Record: 提醒范围编码无效');
      reference('cycles',record.originCycleId,'Record '+record.id,true);
      if(!['Job','Pending','Historical','Opening'].includes(record.state))fail('Record: 未知状态');
      if(record.invoice) {
        if(!/^INV-\d{4,}$/.test(record.invoice))fail('Record: Invoice ID 无效');
        if(invoices.has(record.invoice))fail('Record: 重复 Invoice ID '+record.invoice);
        invoices.set(record.invoice,record.id);
      }
      if(record.state==='Job' && record.originCycleId!==bundle.cycleId)fail('Work Log: 本期工作原周期不符');
      if(['Job','Historical'].includes(record.state)) {
        C.validateConfig(rulesFor(bundle,record));
        const error=C.validateRecord(rawRecord(record),rulesFor(bundle,record),record.calculationVersion);
        if(error)fail('Record '+record.id+': '+error);
        if(record.calculationVersion!==CALCULATION_VERSION)fail('Record: 不支持此计费版本');
      } else if(record.state==='Pending') {
        if(record.start && C.minutes(record.start)===null || record.end && C.minutes(record.end)===null)fail('Pending: 已填写时间无效');
        if(!blank(record.lunch) && record.lunch<0 || !blank(record.rate) && record.rate<=0 || !blank(record.app) && record.app<0)fail('Pending: 已填写金额/休息无效');
      } else if(!record.invoice || !Number.isSafeInteger(record.openingCents) || record.openingCents<=0)fail('Opening: 需要 Invoice 及确认期初余额');
    }
    if(currentRecords(bundle).length>C.MAX_RECORDS)fail('Work Log: 一个周期最多 300 条记录');
    for(const payment of bundle.tables.payments) {
      reference('batches',payment.batchId,'Payment '+payment.id,true);
      if(!['Active','Voided'].includes(payment.status))fail('Payment: 未知状态');
      const allocated=paymentAllocated(bundle,payment.id);
      if(!Number.isSafeInteger(allocated) || allocated>payment.cents || payment.status==='Voided' && allocated>0)fail('Payment '+payment.id+': 有效分配超出实际到账金额');
    }
    for(const batch of bundle.tables.batches) {
      if(!['Open','Reconciled','ClosedExplained','ReviewRequired'].includes(batch.status))fail('Batch: 未知状态');
      reference('evidence',batch.evidenceId,'Batch evidence',true);
    }
    for(const row of bundle.tables.scope){
      reference('batches',row.batchId,'Scope');reference('records',row.recordId,'Scope');reference('confirmations',row.confirmationId,'Scope confirmation',true);reference('scope',row.sourceScopeId,'Scope source',true);if(!['Theory','Balance'].includes(row.kind))fail('Scope: 未知金额类型');
      if(row.confirmationId){const c=maps.confirmations.get(row.confirmationId);if(c.recordId!==row.recordId || c.kind!=='CarryBalance' || row.kind!=='Balance')fail('Scope: 余额确认不属于该来源')}
      const seen=new Set([row.id]);let parent=row.sourceScopeId;while(parent){const source=maps.scope.get(parent);if(seen.has(parent) || source.recordId!==row.recordId || source.batchId===row.batchId)fail('Scope: 接续来源不一致或形成循环');seen.add(parent);parent=source.sourceScopeId}
    }
    const activeScope=new Set();
    for(const row of bundle.tables.scope.filter(row=>row.active)){const key=row.batchId+':'+row.recordId;if(activeScope.has(key))fail('Scope: 同一来源全额/余额不能重复纳入');activeScope.add(key)}
    for(const row of bundle.tables.allocations) {
      reference('payments',row.paymentId,'Allocation');reference('batches',row.batchId,'Allocation');reference('records',row.recordId,'Allocation');reference('evidence',row.evidenceId,'Allocation');
      if(!['Active','Reversed'].includes(row.status) || !row.reason.trim())fail('Allocation: 状态或依据无效');
      if(row.status==='Active' && get(bundle,'payments',row.paymentId).batchId!==row.batchId)fail('Allocation: 付款与批次归属不一致');
    }
    const activeConfirmations=new Set();
    for(const row of bundle.tables.confirmations){reference('records',row.recordId,'Confirmation');reference('evidence',row.evidenceId,'Confirmation');if(!['Payable','CarryBalance'].includes(row.kind) || !row.reason.trim())fail('Confirmation: 类型或依据无效');if(row.active){const key=row.recordId+':'+row.kind;if(activeConfirmations.has(key))fail('Confirmation: 同一来源存在重复有效确认');activeConfirmations.add(key)}}
    const balanceLinks=new Set();
    for(const row of bundle.tables.balanceReferences){reference('confirmations',row.confirmationId,'Balance reference');reference('allocations',row.allocationId,'Balance reference');const confirm=maps.confirmations.get(row.confirmationId),allocation=maps.allocations.get(row.allocationId),key=row.confirmationId+':'+row.allocationId;if(confirm.recordId!==allocation.recordId || row.cents!==allocation.cents || balanceLinks.has(key))fail('Balance reference: 计算基点与付款关联不一致');balanceLinks.add(key)}
    for(const row of bundle.tables.confirmations.filter(row=>row.kind==='CarryBalance'))if(sumCents(bundle.tables.balanceReferences.filter(link=>link.confirmationId===row.id))!==row.paidAtConfirmationCents)fail('Confirmation: 历史余额已反映付款合计不一致');
    for(const row of bundle.tables.issues){reference('records',row.recordId,'Issue',true);reference('batches',row.batchId,'Issue',true);reference('evidence',row.evidenceId,'Issue',true);if(!['Open','Resolved','Closed'].includes(row.status))fail('Issue: 状态无效')}
    for(const row of bundle.tables.observations){reference('records',row.recordId,'App observation');if(!['First','Update','Clear','Imported'].includes(row.kind))fail('App observation: 操作类型无效')}
    for(const event of bundle.audit)reference('evidence',event.evidenceId,'Audit evidence',true);
    for(const batch of bundle.tables.batches)if(batch.status==='Reconciled') {
      const summary=batchSummary(bundle,batch.id);
      if(!batch.scopeConfirmed || !batch.basisConfirmed || !batch.actualConfirmed || !batch.closedAt || !batch.reason.trim() || !batch.evidenceId || !summary.scopeCount || summary.differenceCents!==0)fail('Batch: 已核对状态缺少匹配金额、范围、口径或依据');
    }
    return bundle;
  }
  function encode(value,present=true) {return !present?{type:'absent',value:''}:{type:typeof value,value:String(value)}}
  function decode(type,value) {
    if(type==='absent')return undefined;
    if(type==='string')return value;
    if(type==='boolean' && ['true','false'].includes(value))return value==='true';
    if(type==='number' && value!=='' && Number.isFinite(Number(value)))return Number(value);
    fail('History: 无效的字段值类型');
  }
  function replay(bundle) {
    const tables=Object.fromEntries(Object.keys(TABLES).map(table=>[table,new Map()]));
    let sequence=0;
    const events=new Set();
    for(const event of [...bundle.audit].sort((a,b)=>a.sequence-b.sequence)) {
      if(event.sequence!==++sequence)fail('History: 审计事件顺序缺失或重复');
      events.add(event.id);
      const changes=bundle.changes.filter(change=>change.eventId===event.id).sort((a,b)=>a.ordinal-b.ordinal);
      if(!changes.length)fail('History: 审计事件缺少字段记录');
      for(const [ordinal,change] of changes.entries()) {
        if(change.ordinal!==ordinal+1)fail('History: 事件内字段顺序缺失或重复');
        const table=tables[change.table],fields=TABLES[change.table]?.fields;
        if(!table || !Object.hasOwn(fields,change.field))fail('History: 未知的数据表或字段');
        const previous=table.get(change.recordId),had=!!previous && Object.hasOwn(previous,change.field);
        const encoded=encode(previous?.[change.field],had);
        if(encoded.type!==change.oldType || encoded.value!==change.oldValue)fail('History: 字段前值与审计链不一致');
        const value=decode(change.newType,change.newValue);
        if(change.field==='id' && change.newType==='absent'){table.delete(change.recordId);continue}
        const row=previous || {};
        if(change.newType==='absent')delete row[change.field];else row[change.field]=value;
        table.set(change.recordId,row);
      }
    }
    if(bundle.changes.some(change=>!events.has(change.eventId)))fail('History: 存在失联的字段变更');
    return Object.fromEntries(Object.entries(tables).map(([key,rows])=>[key,[...rows.values()]]));
  }
  const canonical=value=>value===null || typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  const normalizedTables=tables=>Object.fromEntries(Object.entries(tables).map(([key,rows])=>[key,[...rows].sort((a,b)=>a.id.localeCompare(b.id))]));
  function validate(bundle,{audit=true}={}) {
    if(!bundle || Object.keys(bundle).sort().join('|')!==['schemaVersion','calculationVersion','cycleId','fileId','fileVersionId','parentFileVersionId','sourceName','tables','audit','changes'].sort().join('|') || !['4.0',SCHEMA_VERSION].includes(bundle.schemaVersion) || bundle.calculationVersion!==CALCULATION_VERSION)fail('Workbook: 不是完整的受支持数据包');
    for(const key of ['cycleId','fileId'])validateScalar(bundle[key],'id','Workbook / '+key);
    validateScalar(bundle.fileVersionId,'ref?','Workbook / fileVersionId');
    validateScalar(bundle.parentFileVersionId,'ref?','Workbook / parentFileVersionId');validateScalar(bundle.sourceName,'text','Workbook / sourceName');
    if(Object.keys(bundle.tables).sort().join('|')!==Object.keys(TABLES).sort().join('|'))fail('Workbook: 数据表缺失或存在不支持的表');
    const ids=new Set();
    for(const [name,{fields}] of Object.entries(tablesFor(bundle)))validateRows(bundle.tables[name],fields,name,ids);
    validateRows(bundle.audit,auditFields,'Audit',ids);validateRows(bundle.changes,changeFields,'Changes',ids);
    validateBusiness(bundle);
    if(audit && canonical(normalizedTables(replay(bundle)))!==canonical(normalizedTables(bundle.tables)))fail('History: 当前对账数据与审计回放不一致，可能被直接修改');
    return bundle;
  }
  function appendAudit(before,after,{type,reason='',evidenceId='',at=now()}) {
    const event={id:uuid(),sequence:after.audit.length+1,originFileId:after.fileId,originSequence:after.audit.length+1,type,at,reason,evidenceId},changes=[];
    for(const name of Object.keys(TABLES)) {
      const oldRows=new Map(before.tables[name].map(row=>[row.id,row])),newRows=new Map(after.tables[name].map(row=>[row.id,row]));
      for(const id of new Set([...oldRows.keys(),...newRows.keys()])) {
        const old=oldRows.get(id),next=newRows.get(id);
        // Delete the identity last so the old values can still be checked by replay.
        const fields=Object.keys(tablesFor(after)[name].fields).sort((a,b)=>next?Number(b==='id')-Number(a==='id'):Number(a==='id')-Number(b==='id'));
        for(const field of fields) {
          const was=encode(old?.[field],!!old && Object.hasOwn(old,field)),is=encode(next?.[field],!!next && Object.hasOwn(next,field));
          if(was.type===is.type && was.value===is.value)continue;
          changes.push({id:uuid(),eventId:event.id,ordinal:changes.length+1,table:name,recordId:id,field,oldType:was.type,oldValue:was.value,newType:is.type,newValue:is.value});
        }
      }
    }
    if(changes.length){after.audit.push(event);after.changes.push(...changes)}
    return after;
  }
  function transact(bundle,type,mutate,options={}) {
    const context={reason:'',evidenceId:'',at:now(),...options};
    validate(bundle);const next=clone(bundle);mutate(next,context.at,context);refreshIssues(next,context.at);validateBusiness(next);appendAudit(bundle,next,{type,...context});return validate(next);
  }
  function create({name='新工作周期',start='',end='',at=now(),rules={...C.DEFAULT_CONFIG},schemaVersion=SCHEMA_VERSION}={}) {
    const bundle={schemaVersion,calculationVersion:CALCULATION_VERSION,cycleId:uuid(),fileId:uuid(),fileVersionId:'',parentFileVersionId:'',sourceName:'',tables:Object.fromEntries(Object.keys(TABLES).map(key=>[key,[]])),audit:[],changes:[]};
    const before=clone(bundle);
    bundle.tables.cycles.push({id:bundle.cycleId,name,start,end,createdAt:at,parentId:'',sourceFileId:''});
    bundle.tables.rules.push({id:'current',...rules});bundle.tables.entrySettings.push({id:'current',defaultRate:''});
    appendAudit(before,bundle,{type:'CreateCycle',at,reason:'创建工作周期'});return validate(bundle);
  }
  const schemaFields=(bundle,table)=>bundle.schemaVersion==='4.1'?(table==='records'?{reminderKinds:''}:{amountCents:''}):{};
  function upgradeV4(bundle,{legacyScopes,at=now()}={}){
    validate(bundle);if(bundle.schemaVersion!=='4.0')fail('只升级 schema 4.0 文件');
    const next=clone(bundle);next.schemaVersion=SCHEMA_VERSION;
    for(const record of next.tables.records){
      if(record.state==='Historical' && !Object.hasOwn(legacyScopes || {},record.id))fail('请明确确认每个旧历史来源的初始提醒范围');
      record.reminderKinds=record.state==='Historical'?encodeReminderScope(legacyScopes[record.id]):'';
    }
    for(const issue of next.tables.issues)issue.amountCents='';
    appendAudit(bundle,next,{type:'UpgradeSchema41',at,reason:'用户明确确认旧历史提醒范围；参考金额未知，旧确认金额及所有原数据保留'});
    return validate(next);
  }
  function normalizeInput(input) {
    const data={date:'',invoice:'',start:'',end:'',lunch:'',rate:'',app:'',extra:'',note:'',site:'',...input};
    for(const field of numericFields)data[field]=blank(data[field])?'':Number(data[field]);
    return Object.fromEntries(['date','invoice','start','end','lunch','rate','app','extra','note','site'].map(field=>[field,data[field]]));
  }
  function setDefaultRate(bundle,value){
    return transact(bundle,'SetDefaultRate',next=>{next.tables.entrySettings[0].defaultRate=blank(value)?'':Number(value)},{reason:'用户配置连续录入默认费率；不修改已有工作'});
  }
  function addObservation(bundle,record,previous,{at,observedAt=at,source='RouterStack App',note='',imported=false}) {
    if(previous===record.app)return;
    const out=calculate(bundle,record),rules=Object.fromEntries(Object.keys(C.DEFAULT_CONFIG).map(key=>[key,out?rulesFor(bundle,record)[key]:key==='allocation'?'':'']));
    bundle.tables.observations.push({id:uuid(),recordId:record.id,invoice:record.invoice,oldAmount:previous,newAmount:record.app,expectedCents:out?cents(out.total):'',differenceCents:out?.diff==null?'':cents(out.diff),observedAt,recordedAt:at,source,note,kind:imported?'Imported':blank(record.app)?'Clear':blank(previous)?'First':'Update',calculationVersion:out?CALCULATION_VERSION:'',...rules});
  }
  function syncAppIssue(bundle,record,at,reopen=false) {
    const out=calculate(bundle,record),open=out?.diff!=null && Math.abs(out.diff)>rulesFor(bundle,record).tolerance;
    let issue=bundle.tables.issues.find(row=>row.kind==='App' && row.recordId===record.id);
    // Keep legacy issue history compatible; 4.1 reminders themselves are purely derived.
    if(!issue && open && bundle.schemaVersion==='4.0'){issue={id:uuid(),kind:'App',code:'AppDifference',recordId:record.id,batchId:'',status:'Open',createdAt:at,modifiedAt:at,reason:'',evidenceId:'',...schemaFields(bundle,'issues')};bundle.tables.issues.push(issue)}
    if(issue && (issue.status!=='Closed' || reopen)){const status=!out || blank(record.app)?'Open':open?'Open':'Resolved';if(issue.status!==status){issue.status=status;issue.modifiedAt=at}}
  }
  function reviewRelatedBatches(bundle,recordIds,at) {
    const ids=new Set(recordIds),batchIds=new Set([...bundle.tables.scope.filter(row=>row.active && ids.has(row.recordId)).map(row=>row.batchId),...bundle.tables.allocations.filter(row=>row.status==='Active' && ids.has(row.recordId)).map(row=>row.batchId)]);
    for(const batch of bundle.tables.batches.filter(row=>batchIds.has(row.id)))Object.assign(batch,{status:'ReviewRequired',scopeConfirmed:false,basisConfirmed:false,modifiedAt:at,closedAt:'',reason:'工作原始字段或计费规则已更正，须重新核对',evidenceId:''});
  }
  function addRecord(bundle,input,{pending=false,at=now(),imported=false,observedAt,source,note=''}={}) {
    return transact(bundle,pending?'CreatePending':'CreateWork',(next)=>{
      const record={id:uuid(),originCycleId:next.cycleId,originRecordId:'',sourceFileId:next.fileId,createdAt:at,modifiedAt:at,state:pending?'Pending':'Job',...normalizeInput(input),openingCents:'',calculationVersion:CALCULATION_VERSION,...config(next),...schemaFields(next,'records')};
      record.originRecordId=record.id;next.tables.records.push(record);
      addObservation(next,record,'',{at,observedAt:observedAt ?? (imported?'':at),source:source || (imported?'导入文件中的 App 值':'RouterStack App'),note,imported});syncAppIssue(next,record,at);
    },{at});
  }
  function updateRecord(bundle,id,input,{promote=false,at=now(),observedAt=at,source='RouterStack App',note='',reason=''}={}) {
    return transact(bundle,promote?'CompletePending':'EditWork',next=>{
      const record=get(next,'records',id),previous=clone(record);
      if(record.state==='Opening')fail('历史确认期初余额不能改为新工作');
      Object.assign(record,normalizeInput({...record,...input}));
      if(promote){if(record.state!=='Pending')fail('只有待补记录可以转正');record.state=record.originCycleId===next.cycleId?'Job':'Historical';if(record.state==='Job')Object.assign(record,config(next))}
      if(canonical(previous)===canonical(record))return;
      record.modifiedAt=at;
      if(['date','invoice','start','end','lunch','rate','extra'].some(key=>previous[key]!==record[key]))reviewRelatedBatches(next,[id],at);
      addObservation(next,record,previous.app,{at,observedAt,source,note});syncAppIssue(next,record,at,['app','start','end','lunch','rate','extra','state'].some(key=>previous[key]!==record[key]));
    },{at,reason});
  }
  function removeRecord(bundle,id,{at=now()}={}) {
    return transact(bundle,'RemoveUnreconciledWork',next=>{
      const record=get(next,'records',id);
      if(!['Job','Pending'].includes(record.state) || ['scope','allocations','confirmations'].some(table=>next.tables[table].some(row=>row.recordId===id)) || next.tables.issues.some(row=>row.recordId===id && row.kind!=='App'))fail('此记录已关联核对/历史依据，不能直接删除；请先核实关联及更正原因');
      next.tables.records=next.tables.records.filter(row=>row.id!==id);
      next.tables.observations=next.tables.observations.filter(row=>row.recordId!==id);
      next.tables.issues=next.tables.issues.filter(row=>row.recordId!==id);
    },{at,reason:'用户确认删除尚未关联结算的工作；原始字段保留在审计记录中'});
  }
  function acceptExternalChanges(bundle,changes,{at=now(),source='Excel 原始字段导入',sourceName=bundle.sourceName,sourceHash=''}={}) {
    let next=bundle;
    const ruleChanges=changes.filter(change=>change.kind==='Rules');
    if(ruleChanges.length>1)fail('导入: 重复规则变更');
    if(ruleChanges.length) {
      const change=ruleChanges[0];
      if(C.configSnapshot(change.before)!==C.configSnapshot(config(bundle)))fail('导入: 规则变更预览已过期');
      next=transact(next,'AcceptExcelRules',draft=>{
        C.validateConfig(change.after);Object.assign(draft.tables.rules[0],change.after);
        const records=currentRecords(draft);
        for(const record of records){Object.assign(record,change.after);record.modifiedAt=at;syncAppIssue(draft,record,at)}
        reviewRelatedBatches(draft,records.map(record=>record.id),at);
      },{at,reason:'用户确认 '+source+' 的计费规则变更'});
    }
    for(const change of changes.filter(change=>change.kind!=='Rules')) {
      if(change.kind==='Work') {
        const previous=get(bundle,'records',change.id);
        if(canonical(normalizeInput(change.before))!==canonical(normalizeInput(previous)))fail('导入: 工作变更预览已过期');
        next=updateRecord(next,change.id,change.after,{at,source,observedAt:at,reason:'用户确认 '+source+' 的原始工作变更'});
      } else if(change.kind==='NewWork')next=addRecord(next,change.after,{at,imported:true});
      else fail('导入: 未知变更类型');
    }
    if(changes.length)next=transact(next,'AcceptSourceFile',draft=>{draft.tables.origins.push({id:uuid(),fileId:bundle.fileId,fileVersionId:bundle.fileVersionId,name:sourceName,sha256:sourceHash,importedAt:at,schemaVersion:bundle.schemaVersion})},{at,reason:'用户确认导入来源 '+source});
    return validate(next);
  }
  function migrate(legacy,{sourceName='',sourceHash='',at=now(),name=sourceName || '迁移周期'}={}) {
    if(!['2.0','3.0'].includes(legacy.version))fail('仅支持显式迁移 2.0/3.0');
    const rules={...legacy.config,ahEnd:legacy.config.ahEnd ?? 6};
    let bundle=create({name,rules,at});bundle.sourceName=sourceName;
    bundle=transact(bundle,'ImportLegacy',next=>{
      next.tables.origins.push({id:uuid(),fileId:next.fileId,fileVersionId:'',name:sourceName,sha256:sourceHash,importedAt:at,schemaVersion:legacy.version});
      for(const raw of legacy.records) {
        const opening=raw.kind==='Carryover';
        const record={id:uuid(),originCycleId:opening?'':next.cycleId,originRecordId:'',sourceFileId:next.fileId,createdAt:at,modifiedAt:at,state:opening?'Opening':'Job',...normalizeInput(raw),openingCents:opening?cents(raw.balance,{positive:true}):'',calculationVersion:opening?'':CALCULATION_VERSION,...(opening?Object.fromEntries(Object.keys(C.DEFAULT_CONFIG).map(key=>[key,''])):rules)};
        Object.assign(record,schemaFields(next,'records'));next.tables.records.push(record);
        if(!opening){addObservation(next,record,'',{at,observedAt:'',source:'导入 '+sourceName,imported:true});syncAppIssue(next,record,at)}
      }
    },{at,reason:'显式升级旧格式；缺失历史不补造'});
    return bundle;
  }
  const finalBatch=batch=>['Reconciled','ClosedExplained'].includes(batch.status);
  function sumCents(rows,selector=row=>row.cents) {let total=0;for(const row of rows){total+=selector(row);if(!Number.isSafeInteger(total))fail('金额合计超出可精确记录的范围')}return total}
  const confirmation=(bundle,recordId,kind)=>bundle.tables.confirmations.find(row=>row.recordId===recordId && row.kind===kind && row.active);
  function carryRemaining(bundle,recordId) {
    const record=get(bundle,'records',recordId),carry=confirmation(bundle,recordId,'CarryBalance');
    // A verified aggregate settlement resolves this balance source without asserting Invoice Paid.
    if(bundle.tables.scope.some(row=>row.active && row.kind==='Balance' && row.recordId===recordId && row.confirmationId===(carry?.id || '') && (()=>{const b=get(bundle,'batches',row.batchId);return finalBatch(b) && b.scopeConfirmed && b.basisConfirmed && b.actualConfirmed})()))return 0;
    if(carry)return carry.cents-(paid(bundle,recordId)-carry.paidAtConfirmationCents);
    const inactiveOpening=bundle.schemaVersion==='4.1' && bundle.tables.confirmations.some(row=>row.recordId===recordId && row.kind==='CarryBalance' && !row.active);
    return record.state==='Opening' && !inactiveOpening?record.openingCents-paid(bundle,recordId):null;
  }
  const confirmedCarryTotal=bundle=>sumCents(bundle.tables.records,row=>Math.max(0,carryRemaining(bundle,row.id) ?? 0));
  function invoiceSummary(bundle,recordId) {
    const record=get(bundle,'records',recordId),out=calculate(bundle,record),payable=confirmation(bundle,recordId,'Payable'),allocated=paid(bundle,recordId);
    const confirmed=payable?payable.cents:null,estimate=out?cents(out.total):null,balance=carryRemaining(bundle,recordId);
    return {recordId,estimateCents:estimate,paidCents:allocated,confirmedPayableCents:confirmed,confirmedRemainingCents:confirmed===null?null:confirmed-allocated,estimateRemainingCents:estimate===null?null:estimate-allocated,carryRemainingCents:balance,flags:[...(estimate!==null && allocated>estimate && allocated>0?['Amount Exceeds Estimate']:[]),...(confirmed!==null && allocated>confirmed?['Amount Exceeds Confirmed']:[]),...(balance!==null && balance<0?['Amount Exceeds Confirmed Balance']:[])]};
  }
  function batchSummary(bundle,batchId) {
    const batch=get(bundle,'batches',batchId),scope=bundle.tables.scope.filter(row=>row.batchId===batchId && row.active),payments=bundle.tables.payments.filter(row=>row.batchId===batchId && row.status==='Active');
    const referenceCents=sumCents(scope),actualCents=sumCents(payments),ready=batch.scopeConfirmed && batch.basisConfirmed && scope.length>0;
    return {batchId,status:batch.status,scopeCount:scope.length,paymentCount:payments.length,referenceCents,expectedCents:ready?referenceCents:null,actualCents,differenceCents:ready?referenceCents-actualCents:null,label:finalBatch(batch)?batch.status==='Reconciled'?'Batch Reconciled':'Closed with explanation':!batch.scopeConfirmed?'Scope Unverified':!batch.basisConfirmed?'Basis Unverified':'Pending Reconciliation'};
  }
  function coveredAtBatchLevel(bundle,recordId) {return bundle.tables.scope.some(row=>row.active && row.recordId===recordId && (()=>{const batch=get(bundle,'batches',row.batchId);return finalBatch(batch) && batch.scopeConfirmed && batch.basisConfirmed && batch.actualConfirmed})())}
  function unallocatedPayments(bundle) {
    return bundle.tables.payments.filter(row=>row.status==='Active').map(payment=>{
      const batch=payment.batchId?get(bundle,'batches',payment.batchId):null;
      const reconciled=batch && finalBatch(batch) && batch.scopeConfirmed && batch.basisConfirmed && batch.actualConfirmed;
      return {payment,unallocatedCents:reconciled?0:payment.cents-paymentAllocated(bundle,payment.id)};
    }).filter(row=>row.unallocatedCents>0);
  }
  function upsertIssue(bundle,{kind,code,recordId='',batchId='',open,reason='',evidenceId=''},at) {
    let issue=bundle.tables.issues.find(row=>row.kind===kind && row.code===code && row.recordId===recordId && row.batchId===batchId);
    if(!issue && open){issue={id:uuid(),kind,code,recordId,batchId,status:'Open',createdAt:at,modifiedAt:at,reason,evidenceId,...schemaFields(bundle,'issues')};bundle.tables.issues.push(issue)}
    if(issue && issue.status!=='Closed' && issue.status!==(open?'Open':'Resolved'))Object.assign(issue,{status:open?'Open':'Resolved',modifiedAt:at});
    return issue;
  }
  function refreshIssues(bundle,at) {
    for(const record of bundle.tables.records) {
      const view=invoiceSummary(bundle,record.id);
      for(const [code,flag] of [['ExceedsEstimate','Amount Exceeds Estimate'],['ExceedsConfirmed','Amount Exceeds Confirmed'],['ExceedsBalance','Amount Exceeds Confirmed Balance']])upsertIssue(bundle,{kind:'Amount',code,recordId:record.id,open:view.flags.includes(flag)},at);
    }
    for(const batch of bundle.tables.batches)upsertIssue(bundle,{kind:'Settlement',code:'BatchReview',batchId:batch.id,open:!finalBatch(batch)},at);
  }
  function proof(bundle,input,at) {
    if(input.evidenceId)return get(bundle,'evidence',input.evidenceId);
    const data=input.evidence || input,reason=String(input.reason || data.reason || '').trim(),summary=String(data.summary || '').trim();
    if(!reason && !summary)fail('请填写处理原因或证据摘要');
    const row={id:uuid(),confirmedAt:data.confirmedAt || at,reason,summary,source:String(data.source || ''),reference:String(data.reference || ''),createdAt:at};bundle.tables.evidence.push(row);return row;
  }
  function financial(bundle,type,input,mutate) {
    return transact(bundle,type,(next,at,context)=>{const evidence=proof(next,input,at);context.evidenceId=evidence.id;context.reason=String(input.reason || evidence.reason || evidence.summary);mutate(next,at,evidence,context.reason)},{at:input.at || now()});
  }
  function editableBatch(bundle,id) {const batch=get(bundle,'batches',id);if(finalBatch(batch))fail('此批次已关闭，请先凭依据重新打开');return batch}
  function invalidateBatch(bundle,id,at,{scope=false}={}) {
    if(!id)return;const batch=get(bundle,'batches',id);
    Object.assign(batch,{status:'ReviewRequired',actualConfirmed:false,modifiedAt:at,closedAt:'',reason:'已关联资料发生更正，需重新核对',evidenceId:''});if(scope)batch.scopeConfirmed=false;
  }
  function addPayment(bundle,{date,amount,note='',at=now(),duplicateConfirmed=false}) {
    const value=cents(amount,{positive:true});
    if(!duplicateConfirmed && bundle.tables.payments.some(row=>row.status==='Active' && row.date===date && row.cents===value))fail('同日期同金额的到账已存在；请核实后明确确认是否为另一笔到账');
    return transact(bundle,'RegisterBankPayment',next=>{next.tables.payments.push({id:uuid(),date,cents:value,note,batchId:'',status:'Active',createdAt:at,modifiedAt:at})},{at});
  }
  function correctPayment(bundle,paymentId,input) {
    return financial(bundle,'CorrectBankPayment',input,(next,at)=>{
      const row=get(next,'payments',paymentId),value=blank(input.amount)?row.cents:cents(input.amount,{positive:true});
      if(paymentAllocated(next,paymentId)>value || input.void && paymentAllocated(next,paymentId)>0)fail('请先撤销或重新分配，不能使银行到账出现超额分配');
      if(row.cents!==value || input.date && input.date!==row.date || input.void)invalidateBatch(next,row.batchId,at);
      Object.assign(row,{date:input.date || row.date,cents:value,note:input.note ?? row.note,status:input.void?'Voided':row.status,modifiedAt:at});
    });
  }
  function addBatch(bundle,{name,at=now()}) {
    if(typeof name!=='string' || !name.trim())fail('请填写核对批次名称');
    return transact(bundle,'CreateSettlementBatch',next=>{next.tables.batches.push({id:uuid(),name:name.trim(),scopeConfirmed:false,basisConfirmed:false,actualConfirmed:false,status:'Open',createdAt:at,modifiedAt:at,closedAt:'',reason:'',evidenceId:''})},{at});
  }
  function attachPayment(bundle,paymentId,batchId,input) {
    return financial(bundle,'AssignPaymentBatch',input,(next,at)=>{
      const payment=get(next,'payments',paymentId);editableBatch(next,batchId);
      if(payment.status!=='Active')fail('已作废的到账不能关联批次');
      if(payment.batchId===batchId)fail('此到账已经属于该批次');
      if(paymentAllocated(next,paymentId)>0)fail('已有付款关联，请先撤销关联再更改批次');
      invalidateBatch(next,payment.batchId,at);payment.batchId=batchId;payment.modifiedAt=at;
      const batch=get(next,'batches',batchId);batch.actualConfirmed=false;batch.modifiedAt=at;
    });
  }
  function allocatePayment(bundle,{paymentId,recordId,amount,...input}) {
    const value=cents(amount,{positive:true});
    return financial(bundle,'AllocatePayment',input,(next,at,evidence,reason)=>{
      const payment=get(next,'payments',paymentId),record=get(next,'records',recordId);
      if(payment.status!=='Active' || !payment.batchId)fail('请先将有效到账关联到一个待核对批次');
      if(!record.invoice)fail('请先补齐此来源的 Invoice ID');
      if(paymentAllocated(next,paymentId)+value>payment.cents)fail('分配合计不能超过这笔实际银行到账');
      const batch=get(next,'batches',payment.batchId),view=invoiceSummary(next,recordId);
      if(view.confirmedPayableCents!==null && view.paidCents+value>view.confirmedPayableCents)fail('累计付款不能超过已确认应结金额；请核实原始依据，不得强行平账');
      const balanceConfirmed=confirmation(next,recordId,'CarryBalance') || record.state==='Opening';
      // Supplementing proof for a previously reconciled aggregate does not pay its balance a second time.
      const historicalProof=finalBatch(batch) && next.tables.scope.some(row=>row.active && row.batchId===batch.id && row.recordId===recordId);
      if(balanceConfirmed && !historicalProof && value>view.carryRemainingCents)fail('新关联不能超过已确认历史剩余；请先核实余额及付款计算基点');
      if(finalBatch(batch) && !next.tables.scope.some(row=>row.batchId===batch.id && row.recordId===recordId && row.active))fail('此来源不在已关闭批次的范围内，请先重新核对批次');
      next.tables.allocations.push({id:uuid(),paymentId,batchId:batch.id,recordId,invoice:record.invoice,cents:value,status:'Active',createdAt:at,reason,evidenceId:evidence.id});
    });
  }
  function reverseAllocation(bundle,allocationId,input) {
    return financial(bundle,'ReverseAllocation',input,(next,at)=>{const row=get(next,'allocations',allocationId);if(row.status!=='Active')fail('此付款关联已经撤销');row.status='Reversed';invalidateBatch(next,row.batchId,at)});
  }
  function confirmAmount(bundle,{recordId,kind='Payable',amount,...input}) {
    const value=cents(amount);if(value<0)fail('确认金额不能为负数');
    if(!['Payable','CarryBalance'].includes(kind))fail('未知的确认金额类型');
    return financial(bundle,'Confirm'+kind,input,(next,at,evidence,reason)=>{
      get(next,'records',recordId);
      for(const previous of next.tables.confirmations.filter(row=>row.recordId===recordId && row.kind===kind && row.active))previous.active=false;
      const row={id:uuid(),recordId,kind,cents:value,paidAtConfirmationCents:paid(next,recordId),active:true,createdAt:at,reason,evidenceId:evidence.id};next.tables.confirmations.push(row);
      if(kind==='CarryBalance')for(const allocation of next.tables.allocations.filter(item=>item.recordId===recordId && item.status==='Active'))next.tables.balanceReferences.push({id:uuid(),confirmationId:row.id,allocationId:allocation.id,cents:allocation.cents});
      if(kind==='Payable')reviewRelatedBatches(next,[recordId],at);
    });
  }
  function scopeValue(bundle,batchId,item) {
    const record=get(bundle,'records',item.recordId);
    if(item.kind==='Balance') {
      const carry=confirmation(bundle,record.id,'CarryBalance'),remaining=carryRemaining(bundle,record.id);
      if(remaining===null)fail('此来源没有已确认的历史结转余额');
      const baselineIds=new Set(carry?bundle.tables.balanceReferences.filter(row=>row.confirmationId===carry.id).map(row=>row.allocationId):[]);
      const inBatch=sumCents(bundle.tables.allocations.filter(row=>row.recordId===record.id && row.batchId===batchId && row.status==='Active' && !baselineIds.has(row.id)));
      const amount=remaining+inBatch;if(amount<=0)fail('此历史余额已核对完成或出现超额异常，不能重复纳入');
      return {amount,confirmationId:carry?.id || ''};
    }
    if(item.kind!=='Theory')fail('请选择理论金额或确认余额');
    const out=calculate(bundle,record);if(!out)fail('来源理论收入尚未确定，不能纳入明确结算范围');
    if(coveredAtBatchLevel(bundle,record.id))fail('此工作已在关闭批次核对，请使用有依据的历史余额，不能重复纳入全额');
    return {amount:cents(out.total),confirmationId:''};
  }
  function setBatchScope(bundle,batchId,items,{scopeConfirmed=false,basisConfirmed=false,actualConfirmed=false,...input}) {
    return financial(bundle,'ConfirmBatchScope',input,(next,at,evidence,reason)=>{
      const batch=editableBatch(next,batchId),seen=new Set();
      if(!Array.isArray(items) || !items.length)fail('请明确选择纳入比较的工作/确认余额');
      for(const item of items) {
        if(seen.has(item.recordId))fail('同一来源的全额和余额不能重复纳入');seen.add(item.recordId);
        if(next.tables.scope.some(row=>row.active && row.recordId===item.recordId && row.batchId!==batchId && !finalBatch(get(next,'batches',row.batchId))))fail('此来源已在另一活动批次核对；请继续原批次或凭依据完成问题接续');
      }
      for(const row of next.tables.scope.filter(row=>row.batchId===batchId && row.active))row.active=false;
      for(const item of items){const value=scopeValue(next,batchId,item),previous=item.kind==='Balance'?[...next.tables.scope].reverse().find(row=>row.recordId===item.recordId && row.batchId!==batchId && finalBatch(get(next,'batches',row.batchId))):null;next.tables.scope.push({id:uuid(),batchId,recordId:item.recordId,kind:item.kind,cents:value.amount,confirmationId:value.confirmationId,sourceScopeId:item.sourceScopeId || previous?.id || '',active:true})}
      Object.assign(batch,{scopeConfirmed:!!scopeConfirmed,basisConfirmed:!!basisConfirmed,actualConfirmed:!!actualConfirmed,status:'Open',modifiedAt:at,reason,evidenceId:evidence.id});
    });
  }
  function clearBatchScope(bundle,batchId,input) {
    return financial(bundle,'ClearProvisionalScope',input,(next,at,evidence,reason)=>{const batch=editableBatch(next,batchId);for(const row of next.tables.scope.filter(row=>row.batchId===batchId && row.active))row.active=false;Object.assign(batch,{scopeConfirmed:false,basisConfirmed:false,status:'Open',modifiedAt:at,reason,evidenceId:evidence.id})});
  }
  function detachPayment(bundle,paymentId,input) {
    return financial(bundle,'UnassignPaymentBatch',input,(next,at)=>{const row=get(next,'payments',paymentId);if(paymentAllocated(next,paymentId)>0)fail('请先撤销付款关联再解除批次归属');invalidateBatch(next,row.batchId,at);row.batchId='';row.modifiedAt=at});
  }
  function closeEmptyBatch(bundle,batchId,input) {
    return financial(bundle,'CloseUnstartedBatch',input,(next,at,evidence,reason)=>{const batch=editableBatch(next,batchId);if(next.tables.payments.some(row=>row.batchId===batchId && row.status==='Active') || next.tables.allocations.some(row=>row.batchId===batchId && row.status==='Active'))fail('已有实际到账，请通过正式核对流程处理');Object.assign(batch,{status:'ClosedExplained',scopeConfirmed:false,basisConfirmed:false,actualConfirmed:false,closedAt:at,modifiedAt:at,reason,evidenceId:evidence.id})});
  }
  function closeBatch(bundle,batchId,{explained=false,...input}) {
    return financial(bundle,explained?'CloseBatchExplained':'ReconcileBatch',input,(next,at,evidence,reason)=>{
      const batch=editableBatch(next,batchId),view=batchSummary(next,batchId);
      if(!batch.scopeConfirmed || !batch.basisConfirmed || !batch.actualConfirmed || !view.scopeCount)fail('须确认结算范围、金额口径及本批次完整到账，才能关闭批次');
      if(!explained && view.differenceCents!==0)fail('本批次金额尚未匹配；可继续核实，或凭明确处理依据关闭争议');
      const sources=new Set([...next.tables.scope.filter(row=>row.batchId===batchId && row.active).map(row=>row.recordId),...next.tables.allocations.filter(row=>row.batchId===batchId && row.status==='Active').map(row=>row.recordId)]);
      if([...sources].some(id=>invoiceSummary(next,id).flags.some(flag=>['Amount Exceeds Confirmed','Amount Exceeds Confirmed Balance'].includes(flag))))fail('存在超过已确认金额的异常，不能静默结案');
      Object.assign(batch,{status:explained?'ClosedExplained':'Reconciled',closedAt:at,modifiedAt:at,reason,evidenceId:evidence.id});
    });
  }
  function reopenBatch(bundle,batchId,input) {
    return financial(bundle,'ReopenBatch',input,(next,at,evidence,reason)=>{const batch=get(next,'batches',batchId);if(!finalBatch(batch))fail('批次尚未关闭');Object.assign(batch,{status:'ReviewRequired',scopeConfirmed:false,basisConfirmed:false,actualConfirmed:false,closedAt:'',modifiedAt:at,reason,evidenceId:evidence.id})});
  }
  function addIssue(bundle,{recordId='',batchId='',code='ManualReview',amount='',...input}) {
    return financial(bundle,'OpenIndependentIssue',input,(next,at,evidence,reason)=>{
      if(!recordId && !batchId)fail('请选择问题来源');if(recordId)get(next,'records',recordId);if(batchId)get(next,'batches',batchId);
      if(next.tables.issues.some(row=>row.recordId===recordId && row.batchId===batchId && row.code===code && row.kind==='Invoice' && row.status==='Open'))fail('此来源已有相同未解决问题');
      if(next.schemaVersion==='4.0' && !blank(amount))fail('参考金额需要明确升级到 4.1');
      next.tables.issues.push({id:uuid(),kind:'Invoice',code,recordId,batchId,status:'Open',createdAt:at,modifiedAt:at,reason,evidenceId:evidence.id,...(next.schemaVersion==='4.1'?{amountCents:blank(amount)?'':cents(amount)}:{})});
    });
  }
  function setIssueStatus(bundle,issueId,status,input) {
    if(!['Open','Closed'].includes(status))fail('人工问题状态无效');
    return financial(bundle,status==='Open'?'ReopenIssue':'CloseIssue',input,(next,at,evidence,reason)=>{
      const issue=get(next,'issues',issueId);if(issue.kind==='Settlement')fail('请通过批次核对流程关闭或重新打开结算问题');
      if(issue.status===status)fail('问题状态没有变化');Object.assign(issue,{status,modifiedAt:at,reason,evidenceId:evidence.id});
    });
  }
  function reviseIssue(bundle,issueId,{amount='',...input}){
    return financial(bundle,'ReviseManualIssue',input,(next,at,evidence,reason)=>{
      const issue=get(next,'issues',issueId);if(issue.kind!=='Invoice' || next.schemaVersion!=='4.1')fail('仅修订 4.1 人工事项的参考金额与说明');
      Object.assign(issue,{amountCents:blank(amount)?'':cents(amount),reason,evidenceId:evidence.id,modifiedAt:at});
    });
  }
  function updateEvidence(bundle,evidenceId,input) {
    if(!String(input.reason || input.summary || '').trim())fail('请填写证据修订原因或摘要');
    return transact(bundle,'ReviseEvidence',next=>{const row=get(next,'evidence',evidenceId);for(const key of ['reason','summary','source','reference','confirmedAt'])if(input[key]!==undefined)row[key]=input[key]},{at:input.at || now(),reason:input.reason || input.summary,evidenceId});
  }
  function reviseObservation(bundle,observationId,input) {
    return transact(bundle,'ReviseAppObservation',next=>{const row=get(next,'observations',observationId);for(const key of ['observedAt','source','note'])if(input[key]!==undefined)row[key]=input[key]},{at:input.at || now(),reason:'用户修订 App 观察资料；金额与系统记录时间保持原始值'});
  }
  function carrySelection(bundle,selection={}){
    const scopes={},scopeCandidates=[],manualCandidates=bundle.tables.issues.filter(row=>row.kind==='Invoice' && row.status==='Open'),balanceCandidates=bundle.tables.records.filter(row=>(carryRemaining(bundle,row.id) ?? 0)>0);
    const overrides=selection.reminderScopes || {};
    for(const id of Object.keys(overrides))if(!bundle.tables.records.some(row=>row.id===id && ['Job','Historical'].includes(row.state)))fail('结转提醒范围引用了未知来源');
    for(const record of bundle.tables.records.filter(row=>['Job','Historical'].includes(row.state))){
      const detected=detectedReminders(bundle,record),initial=record.state==='Historical'?reminderScope(record):(detected.length?[...REMINDER_KINDS]:[]);
      if(initial===null)fail('旧历史来源必须先明确升级并确认提醒范围');
      scopes[record.id]=Object.hasOwn(overrides,record.id)?encodeReminderScope(overrides[record.id]):encodeReminderScope(initial);
      scopeCandidates.push({recordId:record.id,allowed:initial,detected});
    }
    const choose=(ids,candidates,label)=>{
      if(ids===undefined)return new Set(candidates);
      if(!Array.isArray(ids) || new Set(ids).size!==ids.length || ids.some(id=>!candidates.includes(id)))fail(label+'选择含未知或重复来源');
      return new Set(ids);
    };
    return {scopes,scopeCandidates,manualCandidates,balanceCandidates,issues:choose(selection.issueIds,manualCandidates.map(row=>row.id),'人工事项'),balances:choose(selection.balanceRecordIds,balanceCandidates.map(row=>row.id),'确认余额'),overrides};
  }
  function buildCarryForwardPlan(bundle,{selection}={}) {
    validate(bundle);
    const choices=bundle.schemaVersion==='4.1'?carrySelection(bundle,selection):null;
    const reasons=new Map(),addReason=(table,id,reason)=>{const key=table+':'+id;if(!reasons.has(key))reasons.set(key,[]);if(!reasons.get(key).includes(reason))reasons.get(key).push(reason)};
    for(const record of bundle.tables.records){
      if(record.state==='Pending')addReason('records',record.id,'待补工作');
      if(choices){
        const allowed=choices.scopes[record.id]?.split(',') || [],actual=detectedReminders(bundle,record);
        for(const kind of actual.filter(kind=>allowed.includes(kind)))addReason('records',record.id,kind);
        if(Object.hasOwn(choices.overrides,record.id) && allowed.some(Boolean))addReason('records',record.id,'用户明确调整历史跟进范围');
        if(choices.balances.has(record.id) || (carryRemaining(bundle,record.id) ?? 0)<0)addReason('records',record.id,'人工确认余额／金额异常');
      }else{
        if(record.state!=='Opening' && !record.invoice)addReason('records',record.id,'Invoice 待补');
        if(record.state!=='Opening' && blank(record.app))addReason('records',record.id,'App 待填');
        if(['Job','Historical'].includes(record.state) && !coveredAtBatchLevel(bundle,record.id))addReason('records',record.id,'工作结算范围尚未核对完成');
        if((carryRemaining(bundle,record.id) ?? 0)!==0)addReason('records',record.id,'确认历史余额或超额异常');
      }
    }
    for(const issue of bundle.tables.issues.filter(row=>row.status==='Open' && (!choices || row.kind==='Invoice' && choices.issues.has(row.id) || !['Invoice','App'].includes(row.kind))))addReason('issues',issue.id,issue.kind+' / '+issue.code);
    for(const batch of bundle.tables.batches.filter(row=>!finalBatch(row)))addReason('batches',batch.id,'批次尚未核对完成');
    for(const row of unallocatedPayments(bundle))addReason('payments',row.payment.id,'未分配／范围待核实到账');
    const keep=Object.fromEntries(Object.keys(TABLES).map(table=>[table,new Set()]));
    const byId=new Map();for(const [table,rows] of Object.entries(bundle.tables))for(const row of rows)if(uuidPattern.test(row.id))byId.set(row.id,table);
    const include=(table,id)=>{if(!id || keep[table].has(id))return false;keep[table].add(id);return true};
    for(const key of reasons.keys()){const split=key.indexOf(':');include(key.slice(0,split),key.slice(split+1))}
    for(const table of ['cycles','rules','entrySettings','ratePresets','origins'])for(const row of bundle.tables[table])include(table,row.id);
    let changed=true;
    while(changed){
      changed=false;
      for(const [table,rows] of Object.entries(bundle.tables))for(const row of rows){
        // Keep both directions of a retained financial relationship, including reversed/history rows.
        const excludedIssue=choices && table==='issues' && row.kind==='Invoice' && row.status==='Open' && !choices.issues.has(row.id);
        const related=!excludedIssue && (['scope','allocations','confirmations','issues','observations'].includes(table) && (row.recordId && keep.records.has(row.recordId) || row.batchId && keep.batches.has(row.batchId)) || table==='payments' && row.batchId && keep.batches.has(row.batchId) || table==='balanceReferences' && keep.confirmations.has(row.confirmationId));
        if(related)changed=include(table,row.id) || changed;
        if(keep[table].has(row.id))for(const value of Object.values(row))if(typeof value==='string' && byId.has(value))changed=include(byId.get(value),value) || changed;
      }
      // Earlier values and the evidence used in their events are part of the retained audit chain.
      const events=new Set();
      for(const change of bundle.changes)if(keep[change.table].has(change.recordId)){
        events.add(change.eventId);
        for(const value of [change.oldValue,change.newValue])if(byId.has(value))changed=include(byId.get(value),value) || changed;
      }
      for(const event of bundle.audit)if(events.has(event.id) && event.evidenceId)changed=include('evidence',event.evidenceId) || changed;
    }
    const entries=[...reasons].map(([key,why])=>{const split=key.indexOf(':'),table=key.slice(0,split),id=key.slice(split+1),row=get(bundle,table,id);return {table,id,label:row.invoice || row.name || (table==='payments'?row.date+' · '+(row.cents/100).toFixed(2):row.code),reasons:why}});
    return {entries,keep:Object.fromEntries(Object.entries(keep).map(([table,ids])=>[table,[...ids]])),recordCount:keep.records.size,paymentCount:keep.payments.size,batchCount:keep.batches.size,unresolvedCount:entries.length,confirmedCarryCents:choices?sumCents(bundle.tables.records.filter(row=>choices.balances.has(row.id)),row=>carryRemaining(bundle,row.id)):confirmedCarryTotal(bundle),excludedRecords:bundle.tables.records.length-keep.records.size,...(choices?{scopes:choices.scopes,scopeCandidates:choices.scopeCandidates,manualCandidates:choices.manualCandidates,balanceCandidates:choices.balanceCandidates,excludedBalanceIds:choices.balanceCandidates.filter(row=>!choices.balances.has(row.id)).map(row=>row.id)}:{})};
  }
  function carryForward(bundle,options) {
    const plan=buildCarryForwardPlan(bundle,{selection:options?.selection}),selected=clone(bundle),keep=Object.fromEntries(Object.entries(plan.keep).map(([table,ids])=>[table,new Set(ids)]));
    for(const table of Object.keys(TABLES))selected.tables[table]=selected.tables[table].filter(row=>keep[table].has(row.id));
    selected.changes=selected.changes.filter(row=>keep[row.table].has(row.recordId));
    const eventIds=new Set(selected.changes.map(row=>row.eventId));selected.audit=selected.audit.filter(row=>eventIds.has(row.id));
    for(const [i,event] of selected.audit.entries()){event.sequence=i+1;let ordinal=0;for(const change of selected.changes.filter(row=>row.eventId===event.id).sort((a,b)=>a.ordinal-b.ordinal))change.ordinal=++ordinal}
    validate(selected);
    const next=createCycleDraft(selected,{...options,reminderScopes:plan.scopes,excludedBalanceIds:plan.excludedBalanceIds});next.audit.at(-1).type='CarryForwardUnresolved';next.audit.at(-1).reason='按明确范围创建新周期；排除仅影响新周期跟进，不表示解决，原周期文件保持不变';
    return validate(next);
  }
  // A lossless data draft. A3 selects the unresolved graph before exposing cycle creation.
  function createCycleDraft(bundle,{name,start='',end='',sourceHash='',at=now(),reminderScopes,excludedBalanceIds=[]}={}) {
    if(!bundle.fileVersionId)fail('请先保存并确认保留当前周期文件');
    if(typeof name!=='string' || !name.trim())fail('请填写新周期名称');
    return transact(bundle,'CreateCycleDraft',next=>{
      const parent=next.cycleId,sourceFile=next.fileId;
      next.tables.origins.push({id:uuid(),fileId:sourceFile,fileVersionId:next.fileVersionId,name:next.sourceName,sha256:sourceHash,importedAt:at,schemaVersion:bundle.schemaVersion});
      next.cycleId=uuid();next.fileId=uuid();next.parentFileVersionId=next.fileVersionId;next.fileVersionId='';next.sourceName='';
      next.tables.cycles.push({id:next.cycleId,name:name.trim(),start,end,createdAt:at,parentId:parent,sourceFileId:sourceFile});
      for(const record of next.tables.records){
        if(record.state==='Job'){Object.assign(record,config(next));record.state='Historical';record.modifiedAt=at}
        if(reminderScopes && Object.hasOwn(reminderScopes,record.id))record.reminderKinds=reminderScopes[record.id];
        if(excludedBalanceIds.includes(record.id)){
          const active=confirmation(next,record.id,'CarryBalance');
          if(active)active.active=false;
          else if(record.state==='Opening'){
            const reason='新周期排除余额跟进；保留原文件确认期初金额快照，不表示已解决或已付款',evidence=proof(next,{reason,source:bundle.sourceName},at);
            const row={id:uuid(),recordId:record.id,kind:'CarryBalance',cents:record.openingCents,paidAtConfirmationCents:paid(next,record.id),active:false,createdAt:at,reason,evidenceId:evidence.id};next.tables.confirmations.push(row);
            for(const allocation of next.tables.allocations.filter(row=>row.recordId===record.id && row.status==='Active'))next.tables.balanceReferences.push({id:uuid(),confirmationId:row.id,allocationId:allocation.id,cents:allocation.cents});
          }
        }
      }
    },{at,reason:'创建新周期数据草稿；未裁剪历史，不作为完整结转验收'});
  }
  const api=Object.freeze({SCHEMA_VERSION,CALCULATION_VERSION,TABLES,TABLES_V4,tablesFor,REMINDER_KINDS,reminderScope,encodeReminderScope,automaticReminders,upgradeV4,auditFields,changeFields,uuid,clone,now,cents,canonical,config,rulesFor,rawRecord,calculate,detectedReminders,currentRecords,viewRecords,paid,paymentAllocated,get,replay,validate,transact,create,addRecord,updateRecord,removeRecord,setDefaultRate,acceptExternalChanges,migrate,createCycleDraft,buildCarryForwardPlan,carryForward,carryRemaining,confirmedCarryTotal,invoiceSummary,batchSummary,coveredAtBatchLevel,unallocatedPayments,addPayment,correctPayment,addBatch,attachPayment,detachPayment,allocatePayment,reverseAllocation,confirmAmount,setBatchScope,clearBatchScope,closeEmptyBatch,closeBatch,reopenBatch,addIssue,setIssueStatus,reviseIssue,updateEvidence,reviseObservation});
  if(typeof module==='object' && module.exports)module.exports=api;else root.TrackerReconciliation=api;
})(globalThis);
