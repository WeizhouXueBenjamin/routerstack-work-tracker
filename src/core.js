(function (root) {
  'use strict';
  const VERSION = '3.0';
  const MAX_RECORDS = 300;
  const DEFAULT_CONFIG = Object.freeze({minHours:2, ahStart:18, ahEnd:6, mult:1.5, tolerance:0.01, allocation:'Standard first'});
  const HEADERS = Object.freeze(['Date','Invoice ID','Shift','Lunch (h)','Rate (NZD/h)','Billable (AH)','Expected (NZD)','App Shown (NZD)','Difference','Notes','Start [h]','End [h]','Entry type','Extra NZD','Carryover NZD','Raw hours','Billable num','AH paid num','AH raw num','Base estimated']);
  const RAW_COLUMNS = Object.freeze(['A','B','D','E','H','J','K','L','M','N','O']);
  const FORMULA_COLUMNS = Object.freeze(['C','F','G','I','P','Q','R','S','T']);
  const blank = value => value === '' || value === null || value === undefined;
  const finite = value => !blank(value) && Number.isFinite(Number(value));
  const round = value => {
    const n = Number(value);
    return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON * Math.max(1, Math.abs(n))) * 100) / 100;
  };
  function minutes(value) {
    const match = /^(\d{2}):(\d{2})$/.exec(value || '');
    return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? Number(match[1])*60 + Number(match[2]) : null;
  }
  function timeText(hours) {
    const n = Math.round(hours*60);
    return String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0');
  }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || value < '1900-03-01') return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10) === value;
  }
  function toSerial(value) {
    if (!validDate(value)) throw Error('日期无效（需为 1900-03-01 之后的 YYYY-MM-DD）');
    return (Date.parse(value+'T00:00:00Z') - Date.UTC(1899,11,30))/86400000;
  }
  function fromSerial(value) {
    const n = Number(value);
    if (!finite(value) || !Number.isInteger(n) || n < 61 || n > 2958465) throw Error('日期必须是有效的 Excel 日期整数');
    return new Date(Date.UTC(1899,11,30) + n*86400000).toISOString().slice(0,10);
  }
  function validateConfig(config, version = VERSION) {
    for (const [key, label, test] of [
      ['minHours','最低计费',n=>n>0 && n<=24],
      ['ahStart','AH 起点',n=>n>=0 && n<24 && Math.abs(n*60-Math.round(n*60))<1e-7],
      ['mult','AH 倍数',n=>n>=1],
      ['tolerance','差额阈值',n=>n>=0]
    ]) if (typeof config[key]!=='number' || !Number.isFinite(config[key]) || !test(config[key])) throw Error(label+'配置无效');
    if (config.allocation !== 'Standard first') throw Error('仅支持 Standard first（Lunch 先扣普通时段）');
    if (version === VERSION && (typeof config.ahEnd!=='number' || !Number.isFinite(config.ahEnd) || config.ahEnd<0 || config.ahEnd>=24 || Math.abs(config.ahEnd*60-Math.round(config.ahEnd*60))>1e-7 || config.ahEnd===config.ahStart)) throw Error('AH 结束时间无效，且不能等于起点');
    return config;
  }
  function configSnapshot(config) {
    validateConfig(config);
    return JSON.stringify({minHours:Number(config.minHours), ahStart:Number(config.ahStart), ahEnd:Number(config.ahEnd), mult:Number(config.mult), tolerance:Number(config.tolerance), allocation:config.allocation});
  }
  function calculate(job, config = DEFAULT_CONFIG, version = VERSION) {
    if (job.kind === 'Carryover') return finite(job.balance) && Number(job.balance)>0 ? {bill:null,ah:null,base:0,total:Number(job.balance),diff:null,raw:null,rawAH:null} : null;
    if (job.kind !== 'Job') return null;
    const start = minutes(job.start), end = minutes(job.end);
    const rate = Number(job.rate), lunch = blank(job.lunch)?0:Number(job.lunch), extra = blank(job.extra)?0:Number(job.extra);
    if (start === null || end === null || start === end || !finite(job.rate) || rate<=0 || !Number.isFinite(lunch) || !Number.isFinite(extra) || (!blank(job.app) && (!finite(job.app) || Number(job.app)<0))) return null;
    const raw = ((end-start+1440)%1440)/60;
    if (lunch<0 || lunch>=raw) return null;
    const s = start/60, e = end/60;
    let rawAH;
    if (version === '2.0') {
      rawAH = end>start ? Math.max(0,e-Math.max(s,config.ahStart)) : Math.max(0,24-Math.max(s,config.ahStart))+Math.max(0,e-config.ahStart);
    } else {
      const segment = (a,b) => config.ahStart<config.ahEnd
        ? Math.max(0,Math.min(b,config.ahEnd)-Math.max(a,config.ahStart))
        : Math.max(0,Math.min(b,config.ahEnd)-a)+Math.max(0,b-Math.max(a,config.ahStart));
      rawAH = end>start ? segment(s,e) : segment(s,24)+segment(0,e);
    }
    const remaining = raw-lunch;
    const actualAH = Math.max(0,Math.min(remaining,rawAH-Math.max(0,lunch-(raw-rawAH))));
    const bill = Math.max(Number(config.minHours),remaining);
    const ah = version === '2.0' ? Math.min(bill,actualAH) : bill*actualAH/remaining;
    const base = round((bill+(Number(config.mult)-1)*ah)*rate), total = round(base+extra);
    if (![base,total].every(Number.isFinite)) return null;
    return {raw,rawAH,bill,ah,base,total,diff:blank(job.app)?null:round(total-Number(job.app))};
  }
  function validateRecord(record, config = DEFAULT_CONFIG, version = VERSION) {
    if (!['Job','Carryover'].includes(record.kind)) return 'M: Record kind 必须为 Job 或 Carryover';
    if ((record.kind==='Job' || !blank(record.date)) && !validDate(record.date)) return 'A: 请填写有效日期';
    if (!blank(record.invoice) && !/^INV-\d{4,}$/.test(record.invoice)) return 'B: Invoice ID 应为 INV-XXXX（至少 4 位数字）';
    if (record.kind === 'Carryover') {
      if (!record.invoice) return 'B: 结转必须有 Invoice ID';
      if (!finite(record.balance) || round(record.balance)<=0 || Math.abs(round(record.balance)-Number(record.balance))>1e-8) return 'O: 确认余额必须大于 0，且最多两位小数';
      for (const key of ['start','end','lunch','rate','app','extra']) if (!blank(record[key])) return '结转记录不能包含新工作工时、费率或 App 金额';
      return '';
    }
    if (minutes(record.start)===null || minutes(record.end)===null || record.start===record.end) return 'K/L: 开始与结束时间无效或相同（仅支持小于 24 小时的工作）';
    if (!blank(record.lunch) && (!finite(record.lunch) || Number(record.lunch)<0)) return 'D: Lunch 必须是非负数字小时';
    if (!finite(record.rate) || Number(record.rate)<=0) return 'E: Rate 必须是大于 0 的有限数字';
    if (!blank(record.app) && (!finite(record.app) || Number(record.app)<0)) return 'H: App 金额必须是非负有限数字';
    if (!blank(record.extra) && !finite(record.extra)) return 'N: Extra Cost 必须是有限数字';
    if (!blank(record.balance)) return 'O: Job 不能填写 Carryover 余额';
    if (!calculate(record,config,version)) return 'D/K/L: Lunch 必须小于实际工时，且金额须可计算';
    return '';
  }
  function validateRecords(records, config = DEFAULT_CONFIG, version = VERSION) {
    validateConfig(config,version);
    if (records.length>MAX_RECORDS) throw Error('Work Log: 一个周期最多 300 条记录');
    const ids = new Set();
    records.forEach((record,index)=>{
      const error = validateRecord(record,config,version);
      if (error) throw Error('Work Log 第 '+(index+6)+' 行 · '+error);
      if (record.invoice && ids.has(record.invoice)) throw Error('Work Log!B'+(index+6)+': 重复 Invoice ID '+record.invoice);
      if (record.invoice) ids.add(record.invoice);
    });
  }
  function formulas(r, version = VERSION) {
    const f = {
      C:`IF(OR(K${r}="",L${r}=""),"",TEXT(K${r},"hh:mm")&" - "&TEXT(L${r},"hh:mm"))`,
      F:`IF(M${r}="Carryover","—",IF(Q${r}="","",TEXT(Q${r},"0.##")&" ("&TEXT(R${r},"0.##")&")"))`,
      G:`IF(M${r}="Carryover",IF(O${r}="","",O${r}),IF(OR(Q${r}="",E${r}=""),"",ROUND(T${r}+N(N${r}),2)))`,
      I:`IF(OR(G${r}="",H${r}=""),"",ROUND(G${r}-H${r},2))`,
      P:`IF(OR(K${r}="",L${r}=""),"",MOD(L${r}-K${r},1)*24)`,
      Q:`IF(OR(P${r}="",E${r}=""),"",MAX(Config!$B$5,P${r}-N(D${r})))`,
      R:`IF(Q${r}="","",MAX(0,MIN(Q${r},S${r}-MAX(0,N(D${r})-(P${r}-S${r})))))`,
      S:`IF(OR(K${r}="",L${r}=""),"",IF(L${r}>=K${r},MAX(0,L${r}-MAX(K${r},Config!$B$6))*24,MAX(0,1-MAX(K${r},Config!$B$6))*24+MAX(0,L${r}-Config!$B$6)*24))`,
      T:`IF(Q${r}="","",ROUND((Q${r}+(Config!$B$7-1)*R${r})*E${r},2))`
    };
    if (version === '2.0') return f;
    const a = 'Config!$B$6', b = 'Config!$B$16';
    const segment = (s,e) => `IF(${a}<${b},MAX(0,MIN(${e},${b})-MAX(${s},${a})),MAX(0,MIN(${e},${b})-${s})+MAX(0,${e}-MAX(${s},${a})))`;
    f.F = `IF(M${r}="Carryover","—",IF(Q${r}="","",TEXT(Q${r},"0.00")&" ("&TEXT(R${r},"0.00")&")"))`;
    f.P = `IF(OR(K${r}="",L${r}="",K${r}=L${r}),"",MOD(L${r}-K${r},1)*24)`;
    f.Q = `IF(OR(P${r}="",E${r}="",N(D${r})<0,N(D${r})>=P${r}),"",MAX(Config!$B$5,P${r}-N(D${r})))`;
    f.R = `IF(Q${r}="","",Q${r}*MAX(0,MIN(P${r}-N(D${r}),S${r}-MAX(0,N(D${r})-(P${r}-S${r}))))/(P${r}-N(D${r})))`;
    f.S = `IF(OR(K${r}="",L${r}="",K${r}=L${r}),"",24*IF(L${r}>K${r},${segment('K'+r,'L'+r)},${segment('K'+r,'1')}+${segment('0','L'+r)}))`;
    return f;
  }
  // Translate only A1 references outside strings. Absolute axes remain fixed.
  function translateFormula(formula, from, to) {
    const number = col => [...col].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
    const column = value => {let out='';while(value>0){out=String.fromCharCode(65+(value-1)%26)+out;value=Math.floor((value-1)/26)}return out};
    const address = ref => {const m=/^([A-Z]+)(\d+)$/.exec(ref);if(!m)throw Error('无效公式地址 '+ref);return [number(m[1]),Number(m[2])]};
    const [fc,fr]=address(from), [tc,tr]=address(to);
    return formula.split(/("(?:[^"]|"")*")/g).map((part,index)=>index%2?part:part.replace(/(?<![A-Z0-9_.])([\$]?)([A-Z]{1,3})([\$]?)(\d+)(?![A-Z0-9_])/g,(all,ac,c,ar,r)=>{
      const nc=number(c)+(ac?0:tc-fc), nr=Number(r)+(ar?0:tr-fr);
      if(nc<1 || nr<1)throw Error('shared formula 引用越界');
      return ac+column(nc)+ar+nr;
    })).join('');
  }
  const api = Object.freeze({VERSION,MAX_RECORDS,DEFAULT_CONFIG,HEADERS,RAW_COLUMNS,FORMULA_COLUMNS,blank,finite,round,minutes,timeText,validDate,toSerial,fromSerial,validateConfig,configSnapshot,calculate,validateRecord,validateRecords,formulas,translateFormula});
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.TrackerCore=api;
})(globalThis);
