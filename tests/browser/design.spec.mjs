import {test,expect} from '@playwright/test';
import {boot,add,details,drawer,download,open,makeBytes} from './helpers.mjs';
test.beforeEach(async({page})=>boot(page));

test('save status separates drafts, edits, pending downloads, confirmed snapshots and persistent failures',async({page})=>{
  await expect(page.locator('#saveState')).toHaveText('新工作簿');
  await details(page);await page.locator('#note').fill('Synthetic draft');await expect(page.locator('#saveState')).toHaveText('输入未提交');
  await page.locator('#discardDraft').click();await add(page);await expect(page.locator('#saveState')).toHaveText('尚未保存');
  await download(page,'#saveBtn',false);await expect(page.locator('#saveState')).toHaveText('下载待确认');
  await add(page,{invoice:'INV-9002'});await page.locator('#confirmDownload').click();await expect(page.locator('#saveState')).toHaveText('尚未保存');
  await download(page);await expect(page.locator('#saveState')).toHaveText('Saved');
  await page.evaluate(()=>{window.showSaveFilePicker=async()=>{throw new DOMException('Synthetic permission denied','NotAllowedError')}});
  await page.locator('#saveAsBtn').click();await page.waitForFunction(()=>!state.busy);
  await expect(page.locator('#fileNotice')).toBeVisible();await expect(page.locator('#fileError')).toContainText('Synthetic permission denied');
  await expect(page.locator('#saveState')).toHaveText('File Access Required');
  await drawer(page,'bank');await page.locator('#closeDrawer').click();await expect(page.locator('#fileNotice')).toBeVisible();
  expect(await page.evaluate(()=>state.records.length)).toBe(2);
});

for(const viewport of [{width:1366,height:768},{width:1920,height:1080}])test(`desktop ${viewport.width}: readable eight columns, compact rows and local scrolling`,async({page})=>{
  await page.setViewportSize(viewport);await open(page,await makeBytes(page,{count:40}),('Synthetic_'.repeat(18))+'.xlsx');
  await page.evaluate(()=>{Model.get(state.workbook,'periods',state.workbook.metadata.currentPeriodId).name='Synthetic period '.repeat(12);summary()});
  await expect(page.locator('#workTable thead th')).toHaveCount(8);await expect(page.locator('#rows button')).toHaveCount(0);
  await expect(page.locator('#additionalDetails')).not.toHaveAttribute('open','');
  const layout=await page.evaluate(()=>{
    const scroll=$('workScroll'),box=scroll.getBoundingClientRect(),header=$('workTable').tHead.getBoundingClientRect();
    const rows=[...$('rows').children].map(node=>node.getBoundingClientRect());
    return {pageWidth:document.documentElement.scrollWidth,pageHeight:document.documentElement.scrollHeight,entry:$('entryPanel').getBoundingClientRect().width,
      horizontal:scroll.scrollWidth>scroll.clientWidth,visible:rows.filter(row=>row.top>=header.bottom && row.bottom<=box.bottom).length,rowHeight:rows[0].height,
      font:parseFloat(getComputedStyle($('workTable')).fontSize),aligned:[...$('rows').firstElementChild.querySelectorAll('.num')].every(cell=>getComputedStyle(cell).textAlign==='right')};
  });
  expect(layout.pageWidth).toBe(viewport.width);expect(layout.pageHeight).toBe(viewport.height);expect(layout.entry).toBe(320);
  expect(layout.horizontal).toBe(false);expect(layout.visible).toBeGreaterThanOrEqual(10);expect(layout.rowHeight).toBeGreaterThanOrEqual(32);expect(layout.rowHeight).toBeLessThanOrEqual(36);expect(layout.font).toBeGreaterThanOrEqual(13);expect(layout.aligned).toBe(true);
  await page.locator('#workScroll').evaluate(node=>{node.scrollTop=250});
  expect(await page.locator('#workTable thead th').first().evaluate(node=>Math.abs(node.getBoundingClientRect().top-document.querySelector('#workScroll').getBoundingClientRect().top))).toBeLessThan(2);
});

test('Expanded shows complete Notes and retains filter, selection, scroll anchor and workbook data',async({page})=>{
  await open(page,await makeBytes(page,{count:40}));
  const text='Synthetic 完整工作信息：安装、测试与现场核对。 '.repeat(70)+'\nFinal line — 原始换行和末尾内容。';
  await page.evaluate(text=>{const id=$('rows').children[20].dataset.recordId;useWorkbook(Model.updateRecord(state.workbook,id,{note:text}));showRows()},text);
  await page.locator('#search').fill('INV-');await page.locator('#rows tr[data-record-id]').nth(20).click();
  const before=await page.evaluate(()=>({book:JSON.stringify(state.workbook),selected:state.editing,scroll:$('workScroll').scrollTop}));
  await expect(page.locator('#rows tr[aria-selected=true] .notes span')).toHaveText(text);
  expect(await page.locator('#rows tr[aria-selected=true] .notes span').evaluate(node=>node.scrollWidth>node.clientWidth)).toBe(true);
  await page.locator('#expandedBtn').click();await expect(page.locator('#entryPanel')).toBeHidden();await expect(page.locator('#workTable thead th')).toHaveCount(8);
  const expanded=await page.locator('#rows tr[aria-selected=true] .notes span').evaluate(node=>({overflow:node.scrollHeight>node.clientHeight,whiteSpace:getComputedStyle(node).whiteSpace,height:node.clientHeight}));
  expect(expanded.overflow).toBe(false);expect(expanded.whiteSpace).toBe('pre-wrap');expect(expanded.height).toBeGreaterThan(60);
  await page.locator('#compactBtn').click();await expect(page.locator('#entryPanel')).toBeVisible();await expect(page.locator('#search')).toHaveValue('INV-');
  expect(await page.evaluate(()=>({book:JSON.stringify(state.workbook),selected:state.editing,scroll:$('workScroll').scrollTop}))).toEqual(before);
});

test('row selection, edit, cancel and confirmed delete restore the new entry context',async({page})=>{
  await drawer(page,'config');await page.locator('#defaultRate').fill('65');await page.locator('#applyDefaultRate').click();await page.locator('#closeDrawer').click();
  await add(page,{date:'2026-02-12'});await add(page,{date:'2026-02-12',invoice:'INV-9002',note:'Second full note'});
  await page.locator('#rows tr[data-record-id]').first().click();await expect(page.locator('#formTitle')).toHaveText('Editing Record');
  await expect(page.locator('#additionalDetails')).toHaveAttribute('open','');await expect(page.locator('#recordIdentity')).toContainText('INV-9001');
  await page.locator('#note').fill('Unsaved editing draft');
  page.removeAllListeners('dialog');page.once('dialog',dialog=>dialog.dismiss());await page.locator('#rows tr[data-record-id]').nth(1).click();
  await expect(page.locator('#note')).toHaveValue('Unsaved editing draft');await expect(page.locator('#recordIdentity')).toContainText('INV-9001');
  await page.locator('#expandedBtn').click();await expect(page.locator('#entryPanel')).toBeVisible();await expect(page.locator('#uiNotice')).toContainText('草稿');
  page.on('dialog',dialog=>dialog.accept());await page.locator('#submitJob').click();
  await expect(page.locator('#date')).toHaveValue('2026-02-12');await expect(page.locator('#rate')).toHaveValue('65');await expect(page.locator('#start')).toBeFocused();
  await page.locator('#rows tr[data-record-id]').nth(1).click();await page.locator('#cancelEdit').click();await expect(page.locator('#formTitle')).toHaveText('New Entry');
  await page.locator('#rows tr[data-record-id]').nth(1).click();page.removeAllListeners('dialog');page.once('dialog',dialog=>dialog.dismiss());await page.locator('#deleteRecord').click();expect(await page.evaluate(()=>state.records.length)).toBe(2);
  page.once('dialog',dialog=>dialog.accept());await page.locator('#deleteRecord').click();expect(await page.evaluate(()=>state.records.length)).toBe(1);await expect(page.locator('#formTitle')).toHaveText('New Entry');
});

test('Additional Details remains expanded or collapsed across consecutive entries; editing reveals all fields',async({page})=>{
  await add(page);await expect(page.locator('#additionalDetails')).toHaveAttribute('open','');
  await page.locator('#additionalDetails>summary').click();
  for(const [key,value] of Object.entries({start:'10:00',end:'11:00',rate:'60'}))await page.locator('#'+key).fill(value);
  await page.locator('#submitJob').click();await expect(page.locator('#additionalDetails')).not.toHaveAttribute('open','');
  await page.locator('#rows tr[data-record-id]').first().click();await expect(page.locator('#note')).toBeVisible();await page.locator('#cancelEdit').click();
  await expect(page.locator('#additionalDetails')).not.toHaveAttribute('open','');
});

for(const panel of ['config','bank','unresolved'])test(`${panel} drawer preserves drafts on close and blocks switching drawers or Expanded`,async({page})=>{
  await open(page,await makeBytes(page,{count:30}));await page.locator('#workScroll').evaluate(node=>{node.scrollTop=150});await page.locator('#search').fill('INV-');
  await drawer(page,panel);
  const input=panel==='config'?'#configMinHours':panel==='bank'?'#bankNote':'#reviewDescription';
  if(panel==='bank')await page.locator('#newBank').click();if(panel==='unresolved')await page.locator('#newIssue').click();
  const value=panel==='config'?'3':'Synthetic preserved drawer draft';await page.locator(input).fill(value);
  const before=await page.evaluate(()=>({scroll:$('workScroll').scrollTop,revision:state.revision,book:JSON.stringify(state.workbook)}));
  await page.locator('#closeDrawer').click();await expect(page.locator('#businessDrawer')).toBeHidden();await expect(page.locator('#saveState')).toHaveText('输入未提交');
  await drawer(page,panel==='config'?'bank':'config');await expect(page.locator('#drawerTitle')).toHaveText({config:'Config',bank:'Bank Received',unresolved:'Unresolved'}[panel]);await expect(page.locator(input)).toHaveValue(value);
  await page.locator('#expandedBtn').click();await expect(page.locator('#expandedBtn')).toHaveAttribute('aria-pressed','false');await expect(page.locator(input)).toHaveValue(value);
  expect(await page.evaluate(()=>({scroll:$('workScroll').scrollTop,revision:state.revision,book:JSON.stringify(state.workbook)}))).toEqual(before);
  await page.locator(panel==='config'?'#cancelConfig':panel==='bank'?'#cancelBank':'#cancelReview').click();
  await page.locator('#expandedBtn').click();await expect(page.locator('#businessDrawer')).toBeHidden();await expect(page.locator('#entryPanel')).toBeHidden();
  await page.locator('#compactBtn').click();await drawer(page,'config');await drawer(page,'bank');await drawer(page,'unresolved');await expect(page.locator('#businessDrawer')).toHaveCount(1);
});

test('work draft survives drawer operations and keyboard record selection uses the shared editor',async({page})=>{
  await open(page,await makeBytes(page,{count:3}));await details(page);await page.locator('#note').fill('New entry draft');
  await drawer(page,'config');await page.locator('#closeDrawer').click();await expect(page.locator('#note')).toHaveValue('New entry draft');
  await page.locator('#expandedBtn').click();await expect(page.locator('#note')).toHaveValue('New entry draft');await page.locator('#discardDraft').click();
  const secondId=await page.locator('#rows tr[data-record-id]').nth(1).getAttribute('data-record-id');
  await page.locator('#workScroll').focus();await page.keyboard.press('ArrowDown');await expect(page.locator('#rows tr[aria-selected=true]')).toHaveCount(1);
  await page.keyboard.press('ArrowDown');const id=await page.locator('#rows tr[aria-selected=true]').getAttribute('data-record-id');
  expect(id).toBe(secondId);await page.keyboard.press('Enter');await expect(page.locator('#start')).toBeFocused();
});

test('many-month Summary can collapse older rows while keeping Historical, Total and original amounts',async({page})=>{
  await page.evaluate(()=>{for(let month=1;month<=10;month++)useWorkbook(Model.addRecord(state.workbook,{date:`2026-${String(month).padStart(2,'0')}-10`,start:'09:00',end:'10:00',rate:60,app:month%2?null:0}));showRows()});
  const total=await page.locator('#summaryRows .total').textContent();await expect(page.locator('#summaryRows tr')).toHaveCount(4);await expect(page.locator('#summaryRows .historical')).toBeVisible();
  await page.locator('#toggleSummary').click();await expect(page.locator('#summaryRows tr')).toHaveCount(12);await expect(page.locator('#summaryRows .total')).toBeVisible();
  await page.locator('.summary-wrap').evaluate(node=>{node.scrollTop=200});await expect(page.locator('#summaryRows .historical')).toBeVisible();await expect(page.locator('#summaryRows .total')).toBeVisible();
  await page.locator('#toggleSummary').click();await expect(page.locator('#summaryRows .total')).toHaveText(total);
});

test('drawer keyboard focus returns to its opener; cancelling rules preserves a separate default-rate draft',async({page})=>{
  await page.locator('#configBtn').focus();await page.keyboard.press('Enter');await expect(page.locator('#closeDrawer')).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('#configBtn')).toBeFocused();await expect(page.locator('#businessDrawer')).toBeHidden();
  await drawer(page,'config');await page.locator('#defaultRate').fill('75');await page.locator('#configMinHours').fill('3');
  await page.locator('#cancelConfig').click();await expect(page.locator('#defaultRate')).toHaveValue('75');await expect(page.locator('#configMinHours')).toHaveValue('2');
  await page.locator('#closeDrawer').click();await drawer(page,'bank');await expect(page.locator('#drawerTitle')).toHaveText('Config');await expect(page.locator('#defaultRate')).toHaveValue('75');
});
