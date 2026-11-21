import {test,expect} from '@playwright/test';
import {add,download,open,url,details,drawer} from './helpers.mjs';
test.beforeEach(async({page})=>{
  page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;window.showOpenFilePicker=undefined});
  await page.goto(url);
});
async function workingFile(page){
  await add(page);
  await page.evaluate(async()=>{
    window.disk=await (await TrackerWorkbook.write(state.workbook)).arrayBuffer();window.writes=0;
    const handle={name:'working.xlsx',id:'working',isSameEntry:async other=>other.id==='working',queryPermission:async()=> 'granted',requestPermission:async()=> 'granted',getFile:async()=>new File([window.disk],'working.xlsx'),createWritable:async()=>({write:async blob=>{window.nextDisk=await blob.arrayBuffer();window.writes++},close:async()=>{window.disk=window.nextDisk},abort:async()=>{}})};
    await takeFile(await handle.getFile(),handle);window.working=handle;
  });
}
test('Save writes current file, Save As moves to a new working file and protects the archive',async({page})=>{
  await workingFile(page);await add(page,{invoice:'INV-9002'});
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(async()=>({writes:window.writes,dirty:state.dirty,count:(await TrackerWorkbook.read(window.disk)).records.length}))).toEqual({writes:1,dirty:false,count:2});
  await page.evaluate(()=>{window.showSaveFilePicker=async()=>({name:'copy.xlsx',id:'copy',isSameEntry:async other=>other.id==='copy',createWritable:async()=>({write:async()=>{},close:async()=>{}})})});
  await page.locator('#saveAsBtn').click();await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(()=>({name:state.fileName,archive:state.archiveHandles.map(h=>h.id)}))).toEqual({name:'copy.xlsx',archive:['working']});
  await page.evaluate(async()=>{await takeFile(await window.working.getFile(),window.working)});
  await add(page,{invoice:'INV-9003'});await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(()=>({writes:window.writes,dirty:state.dirty}))).toEqual({writes:1,dirty:true});
});
test('external Excel modification blocks Save and retains records and form input',async({page})=>{
  await workingFile(page);await add(page,{invoice:'INV-9002'});
  await page.evaluate(()=>{window.disk=new TextEncoder().encode('external change').buffer});
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(()=>({writes:window.writes,dirty:state.dirty,count:state.records.length}))).toEqual({writes:0,dirty:true,count:2});
});
for(const failure of ['permission','missing','write','close'])test('current-file failure preserves data: '+failure,async({page})=>{
  await workingFile(page);await add(page,{invoice:'INV-9002'});
  await page.evaluate(failure=>{
    if(failure==='permission'){window.working.queryPermission=async()=> 'prompt';window.working.requestPermission=async()=> 'denied'}
    if(failure==='missing')window.working.getFile=async()=>{throw Error('file moved')};
    if(['write','close'].includes(failure))window.working.createWritable=async()=>({write:async()=>{if(failure==='write')throw Error('write failed')},close:async()=>{throw Error('close failed')},abort:async()=>{}});
  },failure);
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(()=>({dirty:state.dirty,count:state.records.length,pending:state.pending}))).toEqual({dirty:true,count:2,pending:null});
});
for(const failure of ['denied','missing','storage','cancel'])test('recent file recovery and failure retain drafts: '+failure,async({page})=>{
  await workingFile(page);await page.locator('#note').fill('Keep draft');
  if(failure==='cancel'){page.removeAllListeners('dialog');page.on('dialog',d=>d.dismiss())}
  await page.evaluate(failure=>{
    if(failure==='denied'){window.working.queryPermission=async()=> 'prompt';window.working.requestPermission=async()=> 'denied'}
    if(failure==='missing')window.working.getFile=async()=>{throw Error('moved')};
    if(failure==='storage')window.TrackerRecentFile={read:async()=>{throw Error('storage disabled')},write:async()=>{throw Error('storage disabled')}};
  },failure);
  if(failure==='storage'){await page.evaluate(()=>loadRecentFile());await expect(page.locator('#recentStatus')).toContainText('不可用')}
  else {await page.locator('#recentBtn').click();await page.waitForFunction(()=>!state.busy);await expect(page.locator('#note')).toHaveValue('Keep draft')}
  expect(await page.evaluate(()=>state.records.length)).toBe(1);
});
test('recent reads the actual file and requests permission only after click',async({page})=>{
  await workingFile(page);
  await page.evaluate(async()=>{
    const next=TrackerModel.addRecord(state.workbook,{...state.records[0],invoice:'INV-9002'});window.disk=await(await TrackerWorkbook.write(next)).arrayBuffer();window.requests=0;
    window.working.queryPermission=async()=> 'prompt';window.working.requestPermission=async()=>{window.requests++;return 'granted'};
  });
  expect(await page.evaluate(()=>window.requests)).toBe(0);await page.locator('#recentBtn').click();await page.waitForFunction(()=>!state.busy);
  expect(await page.evaluate(()=>({requests:window.requests,count:state.records.length}))).toEqual({requests:1,count:2});
});

test('recent requests permission on click without waiting for an unresponsive permission query',async({page})=>{
  await workingFile(page);
  await page.evaluate(()=>{
    window.requests=0;
    window.working.queryPermission=()=>new Promise(()=>{});
    window.working.requestPermission=async()=>{window.requests++;return 'granted'};
  });
  await page.locator('#recentBtn').click();
  await expect.poll(()=>page.evaluate(()=>window.requests),{timeout:2000}).toBe(1);
  await expect(page.locator('#saveState')).toHaveText('已载入');
  expect(await page.evaluate(()=>state.records.length)).toBe(1);
});

for(const stage of ['permission','file','bytes'])test('recent timeout preserves unsaved work and drafts; late '+stage+' results cannot replace a later file',async({page})=>{
  await workingFile(page);await add(page,{invoice:'INV-9002'});await page.locator('#note').fill('Keep recent draft');
  const before=await page.evaluate(()=>({workbook:JSON.stringify(state.workbook),revision:state.revision,persisted:state.persistedRevision,hash:state.sourceHash}));
  const replacement=await page.evaluate(async()=>{
    const next=TrackerModel.addRecord(TrackerModel.create(),{date:'2026-02-12',start:'10:00',end:'11:00',rate:70,note:'Later chosen file'});
    return [...new Uint8Array(await(await TrackerWorkbook.write(next)).arrayBuffer())];
  });
  await page.clock.install();
  await page.evaluate(stage=>{
    const file=new File([window.disk],'working.xlsx');
    if(stage==='permission'){
      window.working.queryPermission=async()=> 'prompt';
      window.working.requestPermission=()=>new Promise(resolve=>{window.finishRecentAccess=()=>resolve('granted')});
    }
    if(stage==='file')window.working.getFile=()=>new Promise(resolve=>{window.finishRecentAccess=()=>resolve(file)});
    if(stage==='bytes'){
      file.arrayBuffer=()=>new Promise(resolve=>{window.finishRecentAccess=async()=>resolve(await new Blob([window.disk]).arrayBuffer())});
      window.working.getFile=async()=>file;
    }
  },stage);
  await page.locator('#recentBtn').click();await page.waitForFunction(()=>!!window.finishRecentAccess);
  await expect(page.locator('#saveState')).toHaveText('正在处理');
  await page.clock.fastForward(30000);
  await expect(page.locator('#saveState')).toHaveText('文件操作失败');
  await expect(page.locator('#fileError')).toContainText('超时');
  await expect(page.locator('#fileError')).toContainText('重新选择');
  await expect(page.locator('#openBtn')).toBeEnabled();await expect(page.locator('#saveBtn')).toBeEnabled();
  await expect(page.locator('#note')).toHaveValue('Keep recent draft');
  expect(await page.evaluate(()=>({workbook:JSON.stringify(state.workbook),revision:state.revision,persisted:state.persistedRevision,hash:state.sourceHash}))).toEqual(before);
  await open(page,Buffer.from(replacement),'replacement.xlsx');
  await page.evaluate(async()=>{
    const original=TrackerWorkbook;
    const completed=new Promise(resolve=>{window.TrackerWorkbook={...original,hashBytes:async bytes=>{const hash=await original.hashBytes(bytes);resolve();return hash}}});
    await window.finishRecentAccess();await completed;
  });
  await expect(page.locator('#saveState')).toHaveText('已载入');
  expect(await page.evaluate(()=>[state.fileName,state.records.length,state.records[0].note])).toEqual(['replacement.xlsx',1,'Later chosen file']);
});

test('external changes during write abort before close and retain a concurrent form draft',async({page})=>{
  await workingFile(page);await add(page,{invoice:'INV-9002'});
  const hash=await page.evaluate(()=>state.sourceHash);
  await page.evaluate(()=>{window.closedWriter=false;window.abortedWriter=false;window.working.createWritable=async()=>({write:async()=>{window.disk=new TextEncoder().encode('Synthetic external edit during write').buffer;document.getElementById('note').value='Keep concurrent unsubmitted draft'},close:async()=>{window.closedWriter=true},abort:async()=>{window.abortedWriter=true}})});
  await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);
  await expect(page.locator('#note')).toHaveValue('Keep concurrent unsubmitted draft');
  expect(await page.evaluate(()=>({closed:window.closedWriter,aborted:window.abortedWriter,count:state.records.length,dirty:state.dirty,hash:state.sourceHash}))).toEqual({closed:false,aborted:true,count:2,dirty:true,hash});
});
for(const stage of ['before-writer','after-writer'])test('three-stage source hash conflict: '+stage,async({page})=>{
 await workingFile(page);await add(page,{invoice:'INV-9002'});
 await page.evaluate(stage=>{
  window.closedWriter=false;window.abortedWriter=false;
  if(stage==='before-writer')window.disk=new TextEncoder().encode('Synthetic external change').buffer;
  window.working.createWritable=async()=>{if(stage==='after-writer')window.disk=new TextEncoder().encode('Synthetic changed during createWritable').buffer;return {write:async()=>{window.writes++},close:async()=>{window.closedWriter=true},abort:async()=>{window.abortedWriter=true}}};
 },stage);
 await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);
 expect(await page.evaluate(()=>[window.writes,window.closedWriter,state.dirty])).toEqual([0,false,true]);if(stage==='after-writer')expect(await page.evaluate(()=>window.abortedWriter)).toBe(true);
});
test('download confirmation refers to the old snapshot and cannot clear newer edits',async({page})=>{
 await add(page);await download(page,'#saveBtn',false);await add(page,{invoice:'INV-9002'});await page.locator('#confirmDownload').click();expect(await page.evaluate(()=>[state.records.length,state.dirty,state.persistedRevision,state.revision])).toEqual([2,true,1,2]);
});
test('save picker cancellation and close failure preserve memory and pending download state',async({page})=>{
 await add(page);await page.evaluate(()=>{window.showSaveFilePicker=async()=>{throw new DOMException('Synthetic cancelled','AbortError')}});await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);expect(await page.evaluate(()=>[state.dirty,state.records.length,state.pending])).toEqual([true,1,null]);
});
test('write waits for close before marking the snapshot saved, retaining concurrent job edits and drafts',async({page})=>{
 await workingFile(page);await add(page,{invoice:'INV-9002'});
 await page.evaluate(()=>{window.originalClose=null;window.working.createWritable=async()=>({write:async blob=>{window.nextDisk=await blob.arrayBuffer()},close:()=>new Promise(resolve=>{window.originalClose=()=>{window.disk=window.nextDisk;resolve()}}),abort:async()=>{}})});
 await page.locator('#saveBtn').click();await page.waitForFunction(()=>window.originalClose);expect(await page.evaluate(()=>[state.busy,state.dirty])).toEqual([true,true]);
 await add(page,{invoice:'INV-9003'});await page.locator('#note').fill('Concurrent draft');await page.evaluate(()=>window.originalClose());await page.waitForFunction(()=>!state.busy);
 expect(await page.evaluate(async()=>[state.records.length,(await TrackerWorkbook.read(window.disk)).records.length,state.dirty,hasDraft()])).toEqual([3,2,true,true]);await expect(page.locator('#note')).toHaveValue('Concurrent draft');
});
test('unsubmitted work, Config and review drafts block file saving without clearing them',async({page})=>{
 await details(page);await page.locator('#note').fill('Work draft');await page.locator('#saveBtn').click();await expect(page.locator('#formError')).toContainText('尚未提交');await page.locator('#discardDraft').click();
 await drawer(page,'unresolved');await page.locator('#newIssue').click();await page.locator('#reviewDescription').fill('Independent draft');await page.locator('#saveBtn').click();await expect(page.locator('#reviewError')).toContainText('未提交');await expect(page.locator('#reviewDescription')).toHaveValue('Independent draft');await page.locator('#cancelReview').click();
 await drawer(page,'config');await page.locator('#defaultRate').fill('80');await page.locator('#saveBtn').click();await expect(page.locator('#configError')).toContainText('草稿');await expect(page.locator('#defaultRate')).toHaveValue('80');
});
test('oversized File is rejected before reading its bytes and preserves all drafts',async({page})=>{
 await add(page);await page.locator('#note').fill('Keep input');
 const result=await page.evaluate(async()=>{let reads=0;await takeFile({size:TrackerWorkbook.FILE_LIMIT+1,name:'oversized.xlsx',arrayBuffer:async()=>{reads++;return new ArrayBuffer(0)}});return {reads,count:state.records.length,draft:$('note').value,dirty:state.dirty}});
 expect(result).toEqual({reads:0,count:1,draft:'Keep input',dirty:true});
});
test('Save As from an archived source creates a writable new snapshot without reopening the archived handle',async({page})=>{
 await workingFile(page);const original=await page.evaluate(()=>state.sourceHash);
 await drawer(page,'unresolved');await page.locator('#cycleBtn').click();await page.locator('#cycleName').fill('Next');await download(page,'#createCycle');expect(await page.evaluate(()=>state.sourceWritable)).toBe(false);
 await page.evaluate(()=>{
  window.copyDisk=null;window.copyWrites=0;window.showSaveFilePicker=async()=>({name:'new-working-copy.xlsx',id:'copy-after-archive',isSameEntry:async other=>other.id==='copy-after-archive',getFile:async()=>new File([window.copyDisk],'new-working-copy.xlsx'),createWritable:async()=>({write:async blob=>{window.copyNext=await blob.arrayBuffer();window.copyWrites++},close:async()=>{window.copyDisk=window.copyNext},abort:async()=>{}})});
 });
 await page.locator('#saveAsBtn').click();await page.waitForFunction(()=>!state.busy);await add(page,{invoice:'INV-9002'});await page.locator('#saveBtn').click();await page.waitForFunction(()=>!state.busy);
 expect(await page.evaluate(async()=>[window.copyWrites,state.dirty,(await TrackerWorkbook.read(window.copyDisk)).records.length,await TrackerWorkbook.hashBytes(window.disk)])).toEqual([2,false,2,original]);
});
