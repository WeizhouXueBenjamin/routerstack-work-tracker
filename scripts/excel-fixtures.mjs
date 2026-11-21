import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {url} from '../tests/browser/helpers.mjs';
const [mode,folder]=process.argv.slice(2);
if(!folder)throw Error('需要合成夹具目录');
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();await page.goto(url);
 async function parse(name){const bytes=await readFile(join(folder,name));return page.evaluate(bytes=>TrackerWorkbook.read(new Uint8Array(bytes)),[...bytes])}
 async function write(name,value){const bytes=await page.evaluate(async({name,value})=>[...new Uint8Array(await(await TrackerWorkbook.write(value,{fileName:name})).arrayBuffer())],{name,value});await writeFile(join(folder,name),Buffer.from(bytes))}
 async function carry(value,name){return page.evaluate(({value,name})=>TrackerModel.carryForward(value,{name}),{value,name})}
 if(mode==='prepare'){
  const value=await page.evaluate(async()=>{
   const M=TrackerModel,W=TrackerWorkbook;
   let state=M.addRecord(M.create(),{date:'2026-01-01',invoice:'INV-9000',start:'19:00',end:'20:00',rate:60,app:150,note:'Synthetic historical 中文'});
   state=M.carryForward(await W.read(await(await W.write(state)).arrayBuffer()),{name:'Synthetic Excel current'});
   const jobs=[['22:00','02:00',null,60,null],['17:30','18:30',0.25,60,0],['06:00','08:00',null,55,110],['02:00','04:00',null,60,180],['05:00','07:00',null,60,150],['18:00','06:00',1,60,960],['06:00','18:00',1,60,null],['23:30','00:00',null,60,null],['17:00','22:00',1,55,330]];
   jobs.forEach(([start,end,lunch,rate,app],i)=>{state=M.addRecord(state,{date:i%2?'2026-11-10':'2026-10-10',invoice:'INV-'+String(9001+i),start,end,lunch,rate,app,extra:i===8?25:null,note:'  Synthetic\n=SUM(1,2) & <test>  '})});
   state=M.saveIssue(state,{description:'Independent unknown',amountCents:null});state=M.saveIssue(state,{description:'Independent signed reference',amountCents:-123});state=M.saveBalance(state,{description:'Confirmed zero',amountCents:0},null,'Explicit confirmation');state=M.saveBank(state,{date:'2026-11-11',amountCents:200});
   return state;
  });
  await write('source.xlsx',value);const source=await parse('source.xlsx');
  const expected=await page.evaluate(value=>({records:value.records.map(row=>({...row,...TrackerModel.calculate(value,row)})),summary:TrackerReports.summary(value),top:TrackerWorkbook.tableLayout(value)[0].top}),source);
  await writeFile(join(folder,'expected.json'),JSON.stringify(expected,null,2));await writeFile(join(folder,'source-state.json'),JSON.stringify(source,null,2));
  console.log(JSON.stringify({result:'PREPARED',records:source.records.length,folder}));
 }else if(mode==='verify-first'){
  const original=JSON.parse(await readFile(join(folder,'source-state.json'),'utf8')),parsed=await parse('excel-resaved.xlsx');
  const canonical=value=>JSON.stringify(Object.fromEntries(Object.entries(value).map(([key,rows])=>[key,Array.isArray(rows)?[...rows].sort((a,b)=>a.id.localeCompare(b.id)):rows])));
  assert.equal(canonical(parsed),canonical(original),'Normal Excel recalculation, sorting and filtering must retain controlled values');
  await write('tool-resaved.xlsx',parsed);await write('next1.xlsx',await carry(parsed,'Synthetic next 1'));console.log('PASS: Excel → Tool → export; next1 prepared');
 }else if(mode==='verify-next1'){
  const state=await parse('next1-resaved.xlsx');assert.equal(state.records.every(row=>row.type==='Historical'),true);assert.equal(state.bankReceived.length,0);assert.equal(state.issues.length,2);assert.equal(state.balances[0].amountCents,0);await write('next2.xlsx',await carry(state,'Synthetic next 2'));console.log('PASS: first carried workbook; next2 prepared');
 }else if(mode==='verify-final'){
  const state=await parse('next2-resaved.xlsx');assert.equal(state.records.every(row=>row.type==='Historical'),true);assert.equal(state.bankReceived.length,0);assert.equal(state.issues.length,2);assert.equal(state.balances[0].amountCents,0);await write('next2-tool.xlsx',state);console.log('PASS: second carried workbook reopened and exported');
 }else throw Error('Unknown fixture mode');
}finally{await browser.close()}
