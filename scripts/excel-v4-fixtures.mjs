// Only synthetic data and a caller-supplied temporary directory are used here.
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {url} from '../tests/browser/helpers.mjs';
const [stage,folder]=process.argv.slice(2);
if(!folder || !['prepare','verify','verify-carry'].includes(stage))throw Error('Usage: excel-v4-fixtures.mjs prepare|verify|verify-carry <temporary-directory>');
const file=name=>resolve(folder,name),browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();await page.goto(url);
  if(stage==='prepare') {
    const fixture=await page.evaluate(async()=>{
      const R=TrackerReconciliation;
      const jobs=[{kind:'Job',date:'2026-01-10',invoice:'INV-9001',start:'19:00',end:'20:00',lunch:'',rate:60,app:150,extra:'',note:'  Synthetic v4 中文\n',balance:''},{kind:'Job',date:'2026-01-10',invoice:'INV-9002',start:'09:00',end:'11:00',lunch:'',rate:60,app:0,extra:'',note:'Synthetic second',balance:''},{kind:'Carryover',date:'2025-12-01',invoice:'INV-9999',start:'',end:'',lunch:'',rate:'',app:'',extra:'',note:'Synthetic opening',balance:27.35}];
      let bundle=R.migrate({version:'3.0',config:{...TrackerCore.DEFAULT_CONFIG},records:jobs},{sourceName:'synthetic-v3.xlsx'});
      bundle=R.updateRecord(bundle,bundle.tables.records[0].id,{app:180});
      bundle=R.addRecord(bundle,{date:'2026-01-11',invoice:'INV-9003',note:'Synthetic pending',site:'Synthetic DC'},{pending:true});
      const proof={reason:'Synthetic verified settlement',evidence:{confirmedAt:'2026-01-12',summary:'Synthetic bank statement and scope',source:'Synthetic Tim',reference:'synthetic-ref-01'}};
      bundle=R.addBatch(bundle,{name:'Synthetic partial batch'});const partial=bundle.tables.batches.at(-1).id;
      bundle=R.addPayment(bundle,{date:'2026-01-12',amount:100});const payment=bundle.tables.payments.at(-1).id;
      bundle=R.attachPayment(bundle,payment,partial,proof);bundle=R.allocatePayment(bundle,{paymentId:payment,recordId:bundle.tables.records[0].id,amount:100,...proof});
      bundle=R.confirmAmount(bundle,{recordId:bundle.tables.records[0].id,kind:'CarryBalance',amount:80,...proof});
      bundle=R.addBatch(bundle,{name:'Synthetic aggregate verified batch'});const aggregate=bundle.tables.batches.at(-1).id;
      bundle=R.addPayment(bundle,{date:'2026-01-13',amount:120});bundle=R.attachPayment(bundle,bundle.tables.payments.at(-1).id,aggregate,proof);
      bundle=R.setBatchScope(bundle,aggregate,[{recordId:bundle.tables.records[1].id,kind:'Theory'}],{...proof,scopeConfirmed:true,basisConfirmed:true,actualConfirmed:true});bundle=R.closeBatch(bundle,aggregate,proof);
      const blob=await TrackerWorkbookV4.write(bundle,{fileName:'v4-source.xlsx'}),bytes=[...new Uint8Array(await blob.arrayBuffer())];
      return {bytes,tables:bundle.tables,targetId:bundle.tables.records[0].id,secondId:bundle.tables.records[1].id,note:bundle.tables.records[0].note};
    });
    await writeFile(file('v4-source.xlsx'),Buffer.from(fixture.bytes));delete fixture.bytes;
    await writeFile(file('v4-expected.json'),JSON.stringify(fixture,null,2));
    console.log('Prepared schema 4 synthetic workbook: jobs, pending, opening, partial payment, confirmed balance, aggregate reconciled batch and evidence.');
  } else if(stage==='verify') {
    const expected=JSON.parse(await readFile(file('v4-expected.json'),'utf8'));
    for(const name of ['v4-excel-resaved.xlsx','v4-excel-sorted.xlsx']) {
      const bytes=[...await readFile(file(name))];
      const result=await page.evaluate(async bytes=>{const parsed=await TrackerWorkbookV4.read(new Uint8Array(bytes));return {tables:parsed.bundle.tables,changes:parsed.changes}},bytes);
      assert.deepEqual(result.tables,expected.tables,name);assert.deepEqual(result.changes,[],name);
    }
    const editedBytes=[...await readFile(file('v4-excel-edited.xlsx'))];
    const accepted=await page.evaluate(async bytes=>{
      const W=TrackerWorkbookV4,R=TrackerReconciliation,parsed=await W.read(new Uint8Array(bytes));
      let oldWriteBlocked=false;try{await W.write(parsed.bundle)}catch{oldWriteBlocked=true}
      const bundle=R.acceptExternalChanges(parsed.bundle,parsed.changes,{source:'synthetic Excel edits'});
      const blob=await W.write(bundle,{fileName:'v4-tool-resaved.xlsx'});
      return {bytes:[...new Uint8Array(await blob.arrayBuffer())],changes:parsed.changes.map(row=>row.kind),bundle,oldWriteBlocked};
    },editedBytes);
    assert.equal(accepted.oldWriteBlocked,true);assert.deepEqual(accepted.changes.sort(),['Rules','Work']);
    const target=accepted.bundle.tables.records.find(row=>row.id===expected.targetId);
    assert.equal(target.app,170);assert.equal(target.rate,65);assert.equal(target.note,expected.note);
    assert.equal(accepted.bundle.tables.rules[0].ahStart,18.5);
    assert.equal(accepted.bundle.tables.observations.length,expected.tables.observations.length+1);
    assert.equal(accepted.bundle.tables.observations.at(-1).oldAmount,180);assert.equal(accepted.bundle.tables.observations.at(-1).newAmount,170);
    assert.deepEqual(accepted.bundle.tables.payments,expected.tables.payments);assert.deepEqual(accepted.bundle.tables.allocations,expected.tables.allocations);
    assert.equal(accepted.bundle.tables.batches[1].status,'ReviewRequired'); // Config change requires the previous aggregate to be reviewed.
    await writeFile(file('v4-tool-resaved.xlsx'),Buffer.from(accepted.bytes));
    const verified=await page.evaluate(async bytes=>{const parsed=await TrackerWorkbookV4.read(new Uint8Array(bytes));return {tables:parsed.bundle.tables,changes:parsed.changes}},accepted.bytes);
    assert.deepEqual(verified.tables,accepted.bundle.tables);assert.deepEqual(verified.changes,[]);
    const cycles=await page.evaluate(async bytes=>{
      const R=TrackerReconciliation,W=TrackerWorkbookV4,original=(await W.read(new Uint8Array(bytes))).bundle,items=[];let b=original;
      for(const name of ['v4-cycle-one.xlsx','v4-cycle-two.xlsx']){const next=R.carryForward(b,{name:'Synthetic '+name});const blob=await W.write(next,{fileName:name});b=(await W.read(await blob.arrayBuffer())).bundle;items.push({name,bytes:[...new Uint8Array(await blob.arrayBuffer())],tables:b.tables})}
      return items;
    },accepted.bytes);
    for(const item of cycles){await writeFile(file(item.name),Buffer.from(item.bytes));delete item.bytes}
    await writeFile(file('v4-cycles-expected.json'),JSON.stringify(cycles));
    console.log('Verified Excel financial tables, sorting, immutable payments, raw-input review and two standalone carry exports.');
  } else {
    const cycles=JSON.parse(await readFile(file('v4-cycles-expected.json'),'utf8'));
    for(const item of cycles){const parsed=await page.evaluate(async bytes=>{const R=TrackerReconciliation,out=await TrackerWorkbookV4.read(new Uint8Array(bytes));return {tables:out.bundle.tables,changes:out.changes,current:R.currentRecords(out.bundle).length,balance:R.confirmedCarryTotal(out.bundle)}},[...await readFile(file(item.name.replace('.xlsx','-excel.xlsx')))]);assert.deepEqual(parsed.tables,item.tables);assert.deepEqual(parsed.changes,[]);assert.equal(parsed.current,0);assert.equal(parsed.balance,10735)}
    console.log('Verified both carried workbooks after desktop Excel recalculation and SaveAs; financial facts and 107.35 balance unchanged.');
  }
} finally {await browser.close()}
