import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const root=fileURLToPath(new URL('../',import.meta.url));
const Core=require(root+'src/core.js'), JSZip=require(root+'vendor/jszip.min.js');
const job=changes=>({kind:'Job',date:'2026-01-10',invoice:'INV-9001',start:'09:00',end:'17:00',lunch:'',rate:'60',app:'',extra:'',note:'Synthetic',balance:'',...changes});
for(const [start,end,bill,ah,total] of [
  ['19:00','20:00',2,2,180],['22:00','02:00',4,4,360],['17:30','18:30',2,1,150],
  ['06:00','08:00',2,0,120],['02:00','04:00',2,2,180],['05:00','07:00',2,1,150],
  ['18:00','06:00',12,12,1080],['06:00','18:00',12,0,720],['23:30','00:00',2,2,180]
])test('daily AH and proportional minimum '+start+'–'+end,()=>{
  const out=Core.calculate(job({start,end}));assert.equal(out.bill,bill);assert.ok(Math.abs(out.ah-ah)<1e-9);assert.equal(out.total,total);
});
test('numeric lunch is deducted once, regular hours first',()=>{
  assert.equal(Core.calculate(job({lunch:'1',rate:'55'})).total,385);
  assert.equal(Core.calculate(job({start:'17:00',end:'22:00',lunch:'1',rate:'55',extra:'25',app:'330'})).diff,25);
  assert.equal(Core.calculate(job({start:'17:30',end:'18:30',lunch:'0.25'})).total,160);
  assert.equal(Core.calculate(job({lunch:'0'})).total,Core.calculate(job({lunch:''})).total);
});
test('blank App, explicit zero, extras and carryover retain distinct meanings',()=>{
  assert.equal(Core.calculate(job()).diff,null);
  assert.equal(Core.calculate(job({app:'0',extra:'25'})).diff,505);
  assert.equal(Core.calculate(job({extra:'-20'})).total,460);
  const carry=Core.calculate({kind:'Carryover',balance:'22.50'});assert.equal(carry.total,22.5);assert.equal(carry.bill,null);assert.equal(carry.diff,null);
});
test('legacy 2.0 rules remain available without adopting 3.0 behavior',()=>{
  assert.equal(Core.calculate(job({start:'19:00',end:'20:00'}),Core.DEFAULT_CONFIG,'2.0').total,150);
  assert.equal(Core.calculate(job({start:'22:00',end:'02:00'}),Core.DEFAULT_CONFIG,'2.0').total,300);
});
test('configurable minute boundaries and non-wrapping AH windows',()=>{
  assert.equal(Core.timeText(18.5),'18:30');
  assert.equal(Core.calculate(job({start:'17:00',end:'19:00'}),{...Core.DEFAULT_CONFIG,ahStart:18.5}).total,135);
  assert.equal(Core.calculate(job({start:'09:00',end:'11:00'}),{...Core.DEFAULT_CONFIG,ahStart:9,ahEnd:17}).total,180);
});
test('invalid times, nonfinite amounts, dates and lunch are rejected',()=>{
  for(const change of [{start:'24:00'},{end:'12:60'},{start:'09:00',end:'09:00'},{lunch:'8'},{lunch:'-1'},{rate:'0'},{rate:'Infinity'},{app:'NaN'},{extra:'Infinity'},{kind:'Unknown'},{date:'2026-02-30'}])assert.ok(Core.validateRecord(job(change)),JSON.stringify(change));
  assert.equal(Core.calculate(job({start:'09:00',end:'09:00'})),null);
  assert.equal(Core.fromSerial(Core.toSerial('2026-11-07')),'2026-11-07');
  assert.throws(()=>Core.fromSerial('NaN'));assert.throws(()=>Core.fromSerial(60));
});
test('same-day jobs and pending IDs are allowed, duplicates and overflow are rejected',()=>{
  Core.validateRecords([job({invoice:''}),job({invoice:''})]);
  Core.validateRecords([job(),job({invoice:'INV-9002'})]);
  assert.throws(()=>Core.validateRecords([job(),job()]),/重复/);
  assert.throws(()=>Core.validateRecords(Array.from({length:301},()=>job({invoice:''}))),/300/);
});
test('config and carryover validation prevent silent defaults or rounding',()=>{
  for(const config of [{minHours:''},{ahStart:24},{ahEnd:18},{mult:0},{tolerance:-1},{allocation:'Other'}])assert.throws(()=>Core.validateConfig({...Core.DEFAULT_CONFIG,...config}));
  assert.ok(Core.validateRecord({kind:'Carryover',date:'',invoice:'INV-9999',balance:'0.001'}));
  assert.ok(Core.validateRecord({kind:'Carryover',date:'',invoice:'INV-9999',balance:'0.000000001'}));
  assert.ok(Core.validateRecord({kind:'Carryover',date:'',invoice:'INV-9999',balance:'10',rate:'60'}));
});
test('currency rounding matches Excel signs and half-cent boundaries',()=>{
  assert.equal(Core.round(1.005),1.01);assert.equal(Core.round(-1.005),-1.01);assert.equal(Core.round(10.075),10.08);
});
test('shared formula translation preserves strings and absolute axes',()=>{
  assert.equal(Core.translateFormula('IF(A6="A6",$B6+C$6,\'Work Log\'!D6)','C6','D7'),'IF(B7="A6",$B7+D$6,\'Work Log\'!E7)');
});
test('static UI references exist and scripts support offline classic loading',()=>{
  const html=readFileSync(root+'index.html','utf8'), app=readFileSync(root+'src/app.js','utf8');
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
  for(const match of app.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(match[1]),match[1]);
  assert.doesNotMatch(html,/<script[^>]*src="https?:/);
  assert.match(html,/src="\.\/src\/core\.js"/);assert.match(html,/src="\.\/src\/workbook\.js"/);
});
test('both template generations agree with versioned formula specifications',async()=>{
  const decode=text=>text.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
  for(const version of ['2.0','3.0']) {
    const template=readFileSync(root+`templates/RouterStack_Tracker_V${version[0]}_Blank.xlsx`), zip=await JSZip.loadAsync(template);
    const xml=await zip.file('xl/worksheets/sheet2.xml').async('string');
    for(let row=6;row<=305;row++)for(const [col,expected] of Object.entries(Core.formulas(row,version))) {
      const cell=xml.match(new RegExp('<x:c r="'+col+row+'"[^>]*>([\\s\\S]*?)</x:c>'))?.[1];
      assert.ok(cell,version+' '+col+row);assert.equal(decode(cell.match(/<x:f[^>]*>([\s\S]*?)<\/x:f>/)[1]),expected);
    }
    for(const match of xml.matchAll(/<x:c r="([A-Z]+)(\d+)"[^>]*?(?:\/>|>([\s\S]*?)<\/x:c>)/g)) {
      if(Number(match[2])>=6 && Number(match[2])<=305 && Core.RAW_COLUMNS.includes(match[1]))assert.doesNotMatch(match[3] || '',/<x:(?:v|is)\b/,'Blank templates must not contain job data');
    }
    if(version==='3.0') {
      const embedded=readFileSync(root+'src/template-data.js','utf8').match(/const TEMPLATE_BASE64='([^']+)'/)[1];
      assert.deepEqual(Buffer.from(embedded,'base64'),template);
      assert.match(await zip.file('xl/worksheets/sheet3.xml').async('string'),/r="B17"/);
    }
  }
});
