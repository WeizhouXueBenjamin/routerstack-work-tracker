// 本地 UI 验收脚本；只生成合成数据和测试截图，不提供产品导出功能。
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {boot,open,drawer,root} from '../tests/browser/helpers.mjs';
const folder=resolve(root,process.argv[2] || 'playwright-report/desktop-workbench/final');
await mkdir(folder,{recursive:true});
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage();await boot(page);
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const bytes=await page.evaluate(async()=>{
    const M=TrackerModel,W=TrackerWorkbook;
    let value=M.create({name:'November · Synthetic review'});
    for(let i=0;i<2;i++)value=M.addRecord(value,{date:'2026-10-28',invoice:'INV-'+(9200+i),start:'17:30',end:'20:30',rate:60,app:i?0:null,note:'Synthetic historical work · retained original rules'});
    value=await W.read(await(await W.write(value)).arrayBuffer());value=M.carryForward(value,{name:'November · Synthetic review'});
    for(let i=0;i<28;i++)value=M.addRecord(value,{date:`2026-11-${String(i+1).padStart(2,'0')}`,invoice:'INV-'+(9202+i),start:i%3?'09:00':'18:00',end:i%3?'17:00':'21:00',lunch:i%3?0.5:0,rate:60,app:i%4?450:null,
      note:i===0?'Synthetic full work information: installation, configuration, commissioning and verification. '.repeat(5)+'\n第二段：保留完整备注、原始换行及最终核对信息。\nFinal inspection complete — synthetic example only.':'Synthetic work '+(i+1)+' · installation and testing'});
    value=M.setDefaultRate(value,60);value=M.saveIssue(value,{description:'Synthetic App amount to verify',amountCents:null});value=M.saveBalance(value,{description:'Synthetic confirmed balance',amountCents:2500},null,'Explicit synthetic confirmation');value=M.saveBank(value,{date:'2026-11-17',amountCents:48000,note:'Synthetic bank receipt'});
    return [...new Uint8Array(await(await W.write(value,{fileName:'Synthetic_November.xlsx'})).arrayBuffer())];
  });
  await open(page,Buffer.from(bytes),'Synthetic_November.xlsx');
  const measurements=[];
  for(const viewport of [{width:1366,height:768},{width:1920,height:1080}]){
    await page.setViewportSize(viewport);await page.locator('#compactBtn').click();
    await page.screenshot({path:resolve(folder,`compact-${viewport.width}.png`)});
    measurements.push(await page.evaluate(()=>{
      const scroll=$('workScroll'),box=scroll.getBoundingClientRect(),header=$('workTable').tHead.getBoundingClientRect();
      return {width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,pageHeight:document.documentElement.scrollHeight,columns:$('workTable').tHead.rows[0].cells.length,entryWidth:$('entryPanel').getBoundingClientRect().width,summaryHeight:document.querySelector('.summary-panel').getBoundingClientRect().height,rowHeight:$('rows').firstElementChild.getBoundingClientRect().height,visibleRows:[...$('rows').children].filter(row=>{const r=row.getBoundingClientRect();return r.top>=header.bottom && r.bottom<=box.bottom}).length,horizontalScroll:scroll.scrollWidth>scroll.clientWidth};
    }));
    await page.locator('#expandedBtn').click();await page.screenshot({path:resolve(folder,`expanded-${viewport.width}.png`)});
  }
  await page.setViewportSize({width:1366,height:768});await page.locator('#compactBtn').click();
  await page.locator('#rows tr[data-record-id]').nth(2).click();await page.screenshot({path:resolve(folder,'editing-record.png')});await page.locator('#cancelEdit').click();
  for(const name of ['config','bank','unresolved']){await drawer(page,name);await page.screenshot({path:resolve(folder,`drawer-${name}.png`)});await page.locator('#closeDrawer').click()}
  await drawer(page,'bank');await page.locator('#newBank').click();await page.locator('#bankNote').fill('Synthetic preserved draft');await page.locator('#closeDrawer').click();await page.locator('#expandedBtn').click();await page.screenshot({path:resolve(folder,'protected-drawer-draft.png')});await page.locator('#cancelBank').click();await page.locator('#closeDrawer').click();
  await page.evaluate(()=>{window.showSaveFilePicker=async()=>{throw Error('Synthetic file permission failure — current data preserved')}});await page.locator('#saveAsBtn').click();await page.waitForFunction(()=>!state.busy);await page.screenshot({path:resolve(folder,'persistent-file-error.png')});
  await writeFile(resolve(folder,'measurements.json'),JSON.stringify({measurements,errors},null,2));console.log(JSON.stringify({folder,measurements,errors},null,2));
}finally{await browser.close()}
