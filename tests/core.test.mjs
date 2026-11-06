import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const read=path=>readFileSync(resolve(root,path),'utf8');
const app=read('src/app.js');
const require=createRequire(import.meta.url);
const JSZip=require(resolve(root,'vendor/jszip.min.js'));

function calculation() {
  // Evaluate the exact production functions, avoiding copied finance logic in tests.
  const select=(from,to)=>{
    const start=app.indexOf(from),end=app.indexOf(to,start);
    assert.ok(start>=0&&end>start,`Missing production block: ${from}`);
    return app.slice(start,end);
  };
  const code=[
    select('const round=', 'const safe='),
    select('function toFrac(', 'function fromFrac('),
    select('function calculate(job)', 'function showError('),
    'calculate;'
  ].join('\n');
  return runInNewContext(code,{state:{config:{minHours:2,ahStart:18,mult:1.5,tolerance:.01,allocation:'Standard first'}}});
}

test('standard day deducts numeric lunch once',()=>{
  const out=calculation()({kind:'Job',start:'09:00',end:'17:00',lunch:'1',rate:55,extra:0,app:''});
  assert.ok(Math.abs(out.bill-7)<1e-9);
  assert.equal(out.ah,0);
  assert.equal(out.total,385);
  assert.equal(out.diff,null);
});

test('AH / lunch / extra cost / displayed difference stay distinct',()=>{
  const out=calculation()({kind:'Job',start:'17:00',end:'22:00',lunch:'1',rate:55,extra:25,app:330});
  assert.ok(Math.abs(out.bill-4)<1e-9);
  assert.ok(Math.abs(out.ah-4)<1e-9);
  assert.equal(out.base,330);
  assert.equal(out.total,355);
  assert.equal(out.diff,25);
});

test('minimum two billable hours; no inferred app income',()=>{
  const out=calculation()({kind:'Job',start:'10:00',end:'11:00',lunch:'',rate:60,extra:'',app:''});
  assert.equal(out.bill,2);
  assert.equal(out.total,120);
  assert.equal(out.diff,null);
});

test('confirmed carryover amount is not recomputed from hourly rules',()=>{
  const out=calculation()({kind:'Carryover',balance:22.5});
  assert.equal(out.total,22.5);
  assert.equal(out.diff,null);
});

test('original tool selectors still exist in the modular page',()=>{
  const html=read('index.html');
  const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
  const refs=[...app.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]);
  for(const id of refs)assert.ok(ids.has(id),`Missing UI element: ${id}`);
  assert.match(html,/src="\.\/src\/app\.js"/);
  assert.match(html,/src="\.\/vendor\/jszip\.min\.js"/);
});

test('blank workbook template matches embedded bytes and expected headings',async()=>{
  const template=readFileSync(resolve(root,'templates/RouterStack_Tracker_V2_Blank.xlsx'));
  const embedded=read('src/template-data.js').match(/const TEMPLATE_BASE64='([^']+)'/)[1];
  assert.deepEqual(Buffer.from(embedded,'base64'),template);
  const zip=await JSZip.loadAsync(template);
  for(const name of ['xl/workbook.xml','xl/worksheets/sheet2.xml','xl/worksheets/sheet3.xml']){
    assert.ok(zip.file(name),`Missing ${name}`);
  }
  const sheet=await zip.file('xl/worksheets/sheet2.xml').async('string');
  const cfg=await zip.file('xl/worksheets/sheet3.xml').async('string');
  assert.match(sheet,/Invoice ID/);
  assert.match(sheet,/Billable \(AH\)/);
  assert.match(cfg,/>2\.0(?:<|\.)/);
});
