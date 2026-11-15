// Synthetic artifacts only. Called by test-excel.ps1 in a fresh temporary directory.
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {url,legacy,withPhoneticNote} from '../tests/browser/helpers.mjs';
const require=createRequire(import.meta.url), Core=require('../src/core.js');
const [stage,folder]=process.argv.slice(2);
if(!folder || !['prepare','verify'].includes(stage))throw Error('Usage: excel-fixtures.mjs prepare|verify <temporary-directory>');
const file=name=>resolve(folder,name);
const cases=[
  ['19:00','20:00','','60','','0'],['22:00','02:00','','60','',''],['17:30','18:30','','60','',''],
  ['06:00','08:00','','60','',''],['02:00','04:00','','60','',''],['05:00','07:00','','60','',''],
  ['09:00','17:00','1','55','',''],['17:00','22:00','1','55','25','330'],['17:30','18:30','0.25','60','',''],
  ['23:30','00:00','','60','',''],['18:00','06:00','','60','',''],['06:00','18:00','','60','',''],
  ['12:00','14:30','','0.01','',''],['19:00','20:00','','0.01','-0.035',''],['05:59','06:01','','60','','']
];
const records=cases.map(([start,end,lunch,rate,extra,app],i)=>({kind:'Job',date:'2026-01-10',invoice:'INV-'+(9001+i),start,end,lunch,rate,extra,app,note:'Synthetic '+i+' 中文 & <test>',balance:''}));
records.push({kind:'Carryover',date:'2025-12-01',invoice:'INV-9999',start:'',end:'',lunch:'',rate:'',extra:'',app:'',note:'Synthetic carryover',balance:'22.50'});
const config={...Core.DEFAULT_CONFIG};
const expected=(data,rules)=>({records:data,config:rules,calculations:data.map(row=>Core.calculate(row,rules))});
const edited=structuredClone(records);Object.assign(edited[0],{lunch:'0.25',rate:'65',extra:'30',app:'0',note:'Synthetic edited in Excel'});
const editedConfig={...config,ahStart:18.5};
const normal=data=>data.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,['lunch','rate','extra','app','balance'].includes(key) && value!==''?Number(value):value])));
const browser=await chromium.launch({channel:process.env.TEST_BROWSER || 'chrome',headless:true});
try {
  const page=await browser.newPage({acceptDownloads:true});
  page.on('dialog',dialog=>dialog.accept());await page.addInitScript(()=>{window.showSaveFilePicker=undefined;window.showOpenFilePicker=undefined});
  await page.goto(url);
  async function exportFile(name,data,rules) {
    const bytes=await page.evaluate(async({data,rules})=>[...new Uint8Array(await (await TrackerLegacyWorkbook.write(data,rules)).arrayBuffer())],{data,rules});
    await writeFile(file(name),Buffer.from(bytes));
  }
  if(stage==='prepare') {
    await exportFile('source.xlsx',records,config);
    await writeFile(file('legacy.xlsx'),await legacy());
    const bytes=await readFile(file('source.xlsx'));
    for(const storage of ['inline','shared'])await writeFile(file('phonetic-'+storage+'.xlsx'),await withPhoneticNote(page,bytes,storage));
    await writeFile(file('expected.json'),JSON.stringify({original:expected(records,config),edited:expected(edited,editedConfig),phoneticNote:'  Synthetic note 中文\n'},null,2));
    console.log('Prepared synthetic Excel cases: '+records.length);
  } else {
    for(const [name,data,rules,changed]of [['excel-resaved.xlsx',records,config,false],['excel-edited-reordered.xlsx',edited,editedConfig,true]]) {
      const bytes=await readFile(file(name));
      const out=await page.evaluate(async bytes=>{const result=await TrackerLegacyWorkbook.read(new Uint8Array(bytes));return {version:result.version,records:result.records,config:result.config,configChanged:result.configChanged}},[...bytes]);
      assert.equal(out.version,'3.0');assert.deepEqual(normal(out.records),normal(data));assert.deepEqual(out.config,rules);assert.equal(out.configChanged,changed);
      if(changed) {
        // Legacy IO remains a compatibility adapter. Main UI only writes v4;
        // explicit migration/review is covered by workbook-v4 browser tests.
        await exportFile('tool-resaved.xlsx',out.records,out.config);
      }
    }
    // Excel-generated legacy shared formulas must also pass strict validation.
    const legacyBytes=await readFile(file('legacy-resaved.xlsx'));
    const old=await page.evaluate(async bytes=>{const out=await TrackerLegacyWorkbook.read(new Uint8Array(bytes));return {version:out.version,records:out.records}},[...legacyBytes]);
    assert.equal(old.version,'2.0');assert.equal(old.records.length,1);
    for(const storage of ['inline','shared']) {
      for(const suffix of ['','-resaved']) {
        const bytes=await readFile(file('phonetic-'+storage+suffix+'.xlsx'));
        const parsed=await page.evaluate(async bytes=>{const out=await TrackerLegacyWorkbook.read(new Uint8Array(bytes));return {records:out.records,config:out.config}},[...bytes]);
        assert.equal(parsed.records[0].note,'  Synthetic note 中文\n');
        if(suffix)await exportFile('phonetic-'+storage+'-tool.xlsx',parsed.records,parsed.config);
      }
    }
    console.log('Verified Excel edits, sheet reordering, both shared-formula versions and Tool re-export.');
  }
} finally {await browser.close()}
