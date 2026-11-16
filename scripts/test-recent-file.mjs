// Real synthetic XLSX + native external file handles, including a full browser restart.
import {chromium} from '@playwright/test';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {url} from '../tests/browser/helpers.mjs';
const folder=await mkdtemp(join(tmpdir(),'routerstack-native-'));
const filename=join(folder,'synthetic-native.xlsx'),profile=join(folder,'profile');
let context;
async function launch(){
  context=await chromium.launchPersistentContext(profile,{headless:true});
  const page=context.pages()[0];page.on('dialog',dialog=>dialog.accept());await page.goto(url);return page;
}
async function drop(page,open){
  await page.evaluate(open=>{
    window.nativeComplete=false;
    document.addEventListener('dragover',event=>event.preventDefault());
    document.addEventListener('drop',async event=>{
      event.preventDefault();
      try{window.nativeHandle=await event.dataTransfer.items[0].getAsFileSystemHandle();if(open)await takeFile(await window.nativeHandle.getFile(),window.nativeHandle);window.nativeComplete=true}
      catch(error){window.nativeError=error.message}
    },{once:true});
  },open);
  const client=await context.newCDPSession(page);
  for(const type of ['dragEnter','dragOver','drop'])await client.send('Input.dispatchDragEvent',{type,x:100,y:100,data:{items:[],files:[filename],dragOperationsMask:1}});
  await page.waitForFunction(()=>window.nativeComplete || window.nativeError);assert.equal(await page.evaluate(()=>window.nativeError),undefined);await client.detach();
}
try{
  let page=await launch();
  const fixture=await page.evaluate(async()=>{
    const R=TrackerModel,W=TrackerWorkbook;
    const first=R.addRecord(R.create(),{date:'2026-01-10',invoice:'INV-9001',start:'19:00',end:'20:00',rate:60});
    const second=R.addRecord(first,{date:'2026-01-11',invoice:'INV-9002',start:'09:00',end:'10:00',rate:60});
    return {first:[...new Uint8Array(await(await W.write(first)).arrayBuffer())],second:[...new Uint8Array(await(await W.write(second)).arrayBuffer())],ids:second.records.map(row=>row.id)};
  });
  await writeFile(filename,Buffer.from(fixture.first));await drop(page,true);
  await page.waitForFunction(()=>document.getElementById('recentStatus').textContent.includes('XLSX'));
  assert.deepEqual(await page.evaluate(async()=>Object.keys(await TrackerRecentFile.read()).sort()),['handle','name','writable']);
  await context.close();context=null;
  await writeFile(filename,Buffer.from(fixture.second));
  page=await launch();await page.waitForFunction(()=>state.recent);
  const permission=await page.evaluate(()=>state.recent.handle.queryPermission({mode:'read'}));
  await page.locator('#note').fill('Synthetic draft survives a failed restore');
  if(permission!=='granted'){
    await page.locator('#recentBtn').click();await page.waitForFunction(()=>!state.busy);
    assert.equal(await page.locator('#note').inputValue(),'Synthetic draft survives a failed restore');
    assert.equal(await page.evaluate(()=>state.records.length),0);
    await drop(page,true); // Reselect the real file; Chromium may permanently deny the old handle.
  }
  assert.equal(await page.evaluate(()=>state.recent.handle.queryPermission({mode:'read'})),'granted');
  await page.locator('#recentBtn').click();await page.waitForFunction(()=>!state.busy);
  assert.deepEqual(await page.evaluate(()=>state.workbook.records.map(row=>row.id)),fixture.ids);
  console.log(JSON.stringify({result:'PASS',permissionAfterRestart:permission,actualDiskRereadJobs:2,storedKeys:['handle','name','writable'],artifacts:folder}));
}finally{await context?.close()}
