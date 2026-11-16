import {test,expect} from '@playwright/test';
import {boot,add,download,open,makeBytes,details,drawer} from './helpers.mjs';
test.beforeEach(async({page})=>boot(page));
test('offline add → save → reopen → two selected cycles preserve historical and standalone facts',async({page})=>{
 await add(page,{app:'0'});await drawer(page,'unresolved');await page.locator('#newIssue').click();await page.locator('#reviewDescription').fill('Standalone unknown');await page.locator('#reviewReason').fill('Known concern');await page.locator('#applyReview').click();
 await drawer(page,'unresolved');await page.locator('#newBalance').click();await page.locator('#reviewDescription').fill('Standalone zero');await page.locator('#reviewAmount').fill('0');await page.locator('#reviewReason').fill('Explicit confirmation');await page.locator('#applyReview').click();
 await drawer(page,'bank');await page.locator('#newBank').click();await page.locator('#bankDate').fill('2026-01-11');await page.locator('#bankAmount').fill('10');await page.locator('#submitBank').click();
 const bytes=await download(page);await open(page,bytes);const ids=await page.evaluate(()=>state.records.map(row=>row.id));
 for(const name of ['Next synthetic','Third synthetic']){
  await drawer(page,'unresolved');await page.locator('#cycleBtn').click();await page.locator('#cycleName').fill(name);const next=await download(page,'#createCycle');await open(page,next,name+'.xlsx');
  await expect(page.locator('#rows tr.historical')).toHaveCount(1);expect(await page.evaluate(()=>state.records.map(row=>row.id))).toEqual(ids);
  expect(await page.evaluate(()=>[state.workbook.issues.length,state.workbook.balances.length,state.workbook.bankReceived.length])).toEqual([1,1,0]);
 }
 expect(await page.evaluate(()=>state.workbook.balances[0].amountCents)).toBe(0);expect(await page.evaluate(()=>state.workbook.issues[0].recordId)).toBeNull();
});
test('continuous entry preserves date, restores default rate, clears per-job values and focuses Start',async({page})=>{
 await drawer(page,'config');await page.locator('#defaultRate').fill('65');await page.locator('#applyDefaultRate').click();await page.locator('#closeDrawer').click();
 await add(page,{date:'2026-02-12',rate:'72',invoice:'INV-9010',lunch:'1',extra:'25',app:'0'});
 await expect(page.locator('#date')).toHaveValue('2026-02-12');await expect(page.locator('#rate')).toHaveValue('65');await expect(page.locator('#start')).toBeFocused();
 for(const key of ['invoice','start','end','lunch','extra','app','note'])await expect(page.locator('#'+key)).toHaveValue('');
 await expect(page.locator('#statusBar')).toContainText('尚未保存');await add(page,{invoice:'INV-9011'});await page.locator('#rows tr[data-record-id]').first().click();await page.locator('#note').fill('Changed');await page.locator('#submitJob').click();expect(await page.evaluate(()=>state.records.length)).toBe(2);
 const bytes=await download(page);await open(page,bytes);await expect(page.locator('#rate')).toHaveValue('65');expect(await page.evaluate(()=>state.config.defaultRate)).toBe(65);
});
test('same Invoice is rejected while same-day jobs and unknown Invoices are allowed',async({page})=>{
 await add(page);await add(page);await expect(page.locator('#formError')).toContainText('Invoice');await expect(page.locator('#note')).toHaveValue('Synthetic 中文 & <test>');
 await page.locator('#invoice').fill('');await page.locator('#submitJob').click();await add(page,{invoice:''});expect(await page.evaluate(()=>state.records.length)).toBe(3);
});
test('Notes Enter, IME Enter and repeated Enter do not add duplicate records',async({page})=>{
 for(const [key,value] of Object.entries({date:'2026-01-10',start:'09:00',end:'10:00',rate:'60'}))await page.locator('#'+key).fill(value);
 await details(page);await page.locator('#note').fill('Line 1');await page.locator('#note').press('Enter');await page.locator('#note').type('Line 2');expect(await page.evaluate(()=>state.records.length)).toBe(0);
 await page.locator('#rate').dispatchEvent('compositionstart');await page.locator('#rate').press('Enter');expect(await page.evaluate(()=>state.records.length)).toBe(0);await page.locator('#rate').dispatchEvent('compositionend');
 await page.locator('#rate').dispatchEvent('keydown',{key:'Enter',repeat:true,bubbles:true,cancelable:true});expect(await page.evaluate(()=>state.records.length)).toBe(0);
 await page.locator('#rate').press('Enter');await page.locator('#rate').press('Enter');expect(await page.evaluate(()=>state.records.length)).toBe(1);expect(await page.evaluate(()=>state.records[0].note)).toContain('\n');
 await page.locator('#invoice').focus();await page.keyboard.press('Tab');await expect(page.locator('#app')).toBeFocused();
});
test('bank create, edit, cancel deletion, confirm deletion and total stay independent of balances',async({page})=>{
 await open(page,await makeBytes(page,{count:0,standalone:true}));
 await drawer(page,'bank');await page.locator('#newBank').click();await page.locator('#bankDate').fill('2026-01-10');await page.locator('#bankAmount').fill('25');await page.locator('#bankNote').fill('Synthetic');await page.locator('#submitBank').click();
 await page.locator('[data-bank]').click();await page.locator('#bankAmount').fill('30');await page.locator('#bankDate').fill('2026-01-11');await page.locator('#submitBank').click();await expect(page.locator('#bankTotal')).toContainText('$30.00');
 page.removeAllListeners('dialog');page.once('dialog',dialog=>dialog.dismiss());await page.locator('[data-delete-bank]').click();await expect(page.locator('#bankRows [data-bank]')).toHaveCount(1);
 page.once('dialog',async dialog=>{expect(dialog.message()).toContain('2026-01-11');expect(dialog.message()).toContain('$30.00');await dialog.accept()});await page.locator('[data-delete-bank]').click();await expect(page.locator('#bankTotal')).toContainText('$0.00');expect(await page.evaluate(()=>[state.workbook.balances[0].amountCents,state.workbook.balanceHistory.length])).toEqual([0,1]);
});
test('standalone items may be linked, replaced and detached using real work without changing money or ID',async({page})=>{
 await open(page,await makeBytes(page,{count:2,standalone:true}));const ids=await page.evaluate(()=>state.records.map(row=>row.id)),entityId=await page.evaluate(()=>state.workbook.balances[0].id);
 for(const recordId of [ids[0],ids[1],'']){
  await drawer(page,'unresolved');await page.locator('[data-entity="balances"]').click();await page.locator('#reviewRecord').selectOption(recordId);await page.locator('#reviewReason').fill('Association verified');await page.locator('#applyReview').click();
 }
 expect(await page.evaluate(()=>({id:state.workbook.balances[0].id,amount:state.workbook.balances[0].amountCents,refs:state.workbook.balanceHistory.map(row=>row.recordId)}))).toEqual({id:entityId,amount:0,refs:[null,...ids,null]});
});
test('Config preview cancel, confirm and stale protection; only Current changes and Rate default never backfills',async({page})=>{
 await add(page,{start:'19:00',end:'20:00'});const bytes=await download(page);await open(page,bytes);await drawer(page,'unresolved');await page.locator('#cycleBtn').click();await page.locator('#cycleName').fill('Next');const next=await download(page,'#createCycle');await open(page,next);await add(page,{invoice:'INV-9002',start:'09:00',end:'10:00'});
 await drawer(page,'config');await page.locator('#configMinHours').fill('3');await page.locator('#previewConfig').click();await expect(page.locator('#reviewRows tr')).toHaveCount(1);await page.locator('#reviewCancel').click();expect(await page.evaluate(()=>state.config.minHours)).toBe(2);
 await page.locator('#configMinHours').fill('3');await page.locator('#previewConfig').click();await page.evaluate(()=>{state.revision++});await page.locator('#reviewConfirm').click();await expect(page.locator('#configPreviewError')).toContainText('过期');await page.locator('#reviewCancel').click();
 await page.locator('#configMinHours').fill('3');await page.locator('#previewConfig').click();await page.locator('#reviewConfirm').click();expect(await page.evaluate(()=>state.records.map(row=>Model.calculate(state.workbook,row).total))).toEqual([180,180]);expect(await page.evaluate(()=>state.workbook.appChanges.length)).toBe(0);
});
test('eight columns, both types visible, full Summary and all filters at desktop acceptance sizes',async({page})=>{
 await open(page,await makeBytes(page,{count:2}));await page.evaluate(()=>{const next=Model.carryForward(state.workbook,{name:'Next'});useWorkbook(Model.addRecord(next,{date:'2026-03-01',start:'09:00',end:'10:00',rate:60}));state.revision++;showRows()});
 await expect(page.locator('#workTable thead th')).toHaveCount(8);await expect(page.locator('#rows tr.historical')).toHaveCount(2);const summary=await page.locator('#summaryRows').textContent();
 await page.locator('#typeFilter').selectOption('Current');await expect(page.locator('#rows tr[data-record-id]')).toHaveCount(1);await expect(page.locator('#summaryRows')).toHaveText(summary);
 await page.locator('#resetFilters').click();await page.locator('#search').fill('not found');await expect(page.locator('#rows tr[data-record-id]')).toHaveCount(0);await expect(page.locator('#summaryRows')).toHaveText(summary);await page.locator('#resetFilters').click();
 for(const width of [1366,1920]){await page.setViewportSize({width,height:width===1366?768:1080});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await page.screenshot({path:test.info().outputPath('work-log-'+width+'.png'),fullPage:true})}
 expect(await page.locator('#rows tr.historical').first().evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(240, 240, 240)');
});
test('new independent balance requires explicit amount and basis; invalid input is preserved',async({page})=>{
 await drawer(page,'unresolved');await page.locator('#newBalance').click();await page.locator('#reviewDescription').fill('Unknown source');await page.locator('#applyReview').click();await expect(page.locator('#reviewError')).toContainText('金额');await expect(page.locator('#reviewDescription')).toHaveValue('Unknown source');
 await page.locator('#reviewAmount').fill('0');await page.locator('#applyReview').click();await expect(page.locator('#reviewError')).toContainText('依据');expect(await page.evaluate(()=>state.workbook.balances.length)).toBe(0);
});
test('excluding an independent balance requires separate confirmation and leaves the old file unresolved',async({page})=>{
 const original=await makeBytes(page,{count:0,standalone:true});await open(page,original);await drawer(page,'unresolved');await page.locator('#cycleBtn').click();await page.locator('[data-carry-balance]').uncheck();await page.locator('#cycleName').fill('Only independent issues');
 page.removeAllListeners('dialog');page.once('dialog',dialog=>dialog.dismiss());await page.locator('#createCycle').click();await expect(page.locator('#cycleModal')).toBeVisible();expect(await page.evaluate(()=>state.workbook.balances[0].status)).toBe('Open');
 page.on('dialog',dialog=>dialog.accept());const next=await download(page,'#createCycle');await open(page,next);expect(await page.evaluate(()=>[state.records.length,state.workbook.issues.length,state.workbook.balances.length])).toEqual([0,2,0]);await open(page,original);expect(await page.evaluate(()=>state.workbook.balances[0].status)).toBe('Open');
});
test('manual amount, close and reopen use the dedicated history; changing App never resolves them',async({page})=>{
 await open(page,await makeBytes(page,{count:1,standalone:true}));
 for(const status of ['Closed','Open']){await drawer(page,'unresolved');await page.locator('[data-entity="balances"]').click();await page.locator('#reviewStatus').selectOption(status);await page.locator('#reviewAmount').fill(status==='Closed'?'30':'0');await page.locator('#reviewReason').fill('Synthetic status reviewed');await page.locator('#applyReview').click()}
 await page.locator('#closeDrawer').click();await page.locator('#rows tr[data-record-id]').click();await page.locator('#app').fill('180');await page.locator('#submitJob').click();expect(await page.evaluate(()=>[state.workbook.balances[0].status,state.workbook.balances[0].amountCents,state.workbook.balanceHistory.map(row=>row.action)])).toEqual(['Open',0,['Create','Close','Reopen']]);
});
