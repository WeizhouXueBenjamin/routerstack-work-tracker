import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {C,job} from './fixtures.mjs';
const require=createRequire(import.meta.url),JSZip=require('../vendor/jszip.min.js');
for(const [start,end,length,bill,ah,total] of [
 ['19:00','20:00',1,2,2,180],['22:00','02:00',4,4,4,360],['17:30','18:30',1,2,1,150],
 ['06:00','08:00',2,2,0,120],['02:00','04:00',2,2,2,180],['05:00','07:00',2,2,1,150],
 ['18:00','06:00',12,12,12,1080],['06:00','18:00',12,12,0,720],['23:30','00:00',0.5,2,2,180]
])test('calculation 3.0 baseline '+start+'–'+end,()=>{
 const out=C.calculate(job({start,end}));assert.equal(out.lengthHours,length);assert.equal(out.bill,bill);assert.ok(Math.abs(out.ah-ah)<1e-9);assert.equal(out.total,total);
});
test('Lunch regular first, proportional minimum, extras and stepwise rounding',()=>{
 assert.equal(C.calculate(job({lunch:1,rate:55})).total,385);
 assert.equal(C.calculate(job({start:'17:00',end:'22:00',lunch:1,rate:55,extra:25,app:330})).diff,25);
 const result=C.calculate(job({start:'17:30',end:'18:30',lunch:0.25}));assert.equal(result.total,160);assert.equal(result.lengthHours,0.75);
 assert.equal(C.calculate(job({lunch:0})).total,C.calculate(job()).total);
 assert.equal(C.round(1.005),1.01);assert.equal(C.round(-1.005),-1.01);assert.equal(C.round(10.075),10.08);
});
test('unknown App, explicit zero and negative extras are distinct',()=>{
 assert.equal(C.calculate(job()).diff,null);assert.equal(C.calculate(job({app:0,extra:25})).diff,505);assert.equal(C.calculate(job({extra:-20})).total,460);
});
test('minute AH boundaries, non-wrapping windows and invalid input',()=>{
 assert.equal(C.calculate(job({start:'17:00',end:'19:00'}),{...C.DEFAULT_CONFIG,ahStart:18.5}).total,135);
 assert.equal(C.calculate(job({start:'09:00',end:'11:00'}),{...C.DEFAULT_CONFIG,ahStart:9,ahEnd:17}).total,180);
 for(const change of [{start:'24:00'},{end:'12:60'},{start:'09:00',end:'09:00'},{lunch:8},{lunch:-1},{rate:0},{rate:Infinity},{app:NaN},{extra:Infinity},{date:'2026-02-30'}])assert.ok(C.validateRecord(job(change)),JSON.stringify(change));
 for(const change of [{minHours:''},{ahStart:24},{ahEnd:18},{mult:0},{tolerance:-1},{allocation:'Other'}])assert.throws(()=>C.validateConfig({...C.DEFAULT_CONFIG,...change}));
 assert.equal(C.fromSerial(C.toSerial('2026-11-07')),'2026-11-07');assert.throws(()=>C.fromSerial(60));
});
test('300 is not a business limit; duplicate known Invoice remains invalid',()=>{
 C.validateRecords(Array.from({length:1000},()=>job()));assert.throws(()=>C.validateRecords([job({invoice:'INV-9001'}),job({invoice:'INV-9001'})]),/重复/);
});
test('shared formula translation preserves absolute references and string literals',()=>{
 assert.equal(C.translateFormula('IF(A6="A6",$B6+C$6,\'Work Log\'!D6)','C6','D7'),'IF(B7="A6",$B7+D$6,\'Work Log\'!E7)');
});
test('offline classic scripts and UI IDs are consistent',()=>{
 const html=readFileSync(new URL('../index.html',import.meta.url),'utf8'),ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
 for(const name of ['app.js','review-ui.js'])for(const match of readFileSync(new URL('../src/'+name,import.meta.url),'utf8').matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.has(match[1]),match[1]);
 assert.doesNotMatch(html,/<script[^>]*src="https?:/);assert.doesNotMatch(html,/reconciliation\.js|workbook-v4|copyBtn|upgradeBtn/);
});
test('single current blank template has four sheets, eight tables and matching embedded bytes',async()=>{
 const template=readFileSync(new URL('../templates/RouterStack_Tracker_V5_Blank.xlsx',import.meta.url)),zip=await JSZip.loadAsync(template);
 const embedded=readFileSync(new URL('../src/template-data.js',import.meta.url),'utf8').match(/const TEMPLATE_BASE64='([^']+)'/)[1];assert.deepEqual(Buffer.from(embedded,'base64'),template);
 assert.equal(zip.file(/^xl\/tables\/.*\.xml$/).length,8);assert.equal(zip.file(/^xl\/worksheets\/[^/]+\.xml$/).length,4);
 const xml=await zip.file('xl/worksheets/sheet1.xml').async('string');assert.match(xml,/sqref="A8:H8"/);assert.match(xml,/\$N8=&quot;Historical&quot;|\$N8="Historical"/);assert.match(xml,/min="9" max="29" hidden="1"/);
 const styles=await zip.file('xl/styles.xml').async('string');assert.match(styles,/<dxfs[^>]*>[\s\S]*?<bgColor rgb="FFF0F0F0"\/>[\s\S]*?<\/dxfs>/,'Excel conditional fill must explicitly set its background, not indexed system black');
});
