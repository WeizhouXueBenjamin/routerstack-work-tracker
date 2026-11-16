// Build the structural template through the same offline writer as the Tool.
import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage();await page.goto(pathToFileURL(resolve(root,'index.html')).href);
  const bytes=await page.evaluate(async()=>[...new Uint8Array(await (await TrackerWorkbookV4.write(TrackerReconciliation.create({schemaVersion:"4.0"}),{template:true})).arrayBuffer())]);
  await writeFile(resolve(root,'templates/RouterStack_Tracker_V4_Blank.xlsx'),Buffer.from(bytes));
  console.log('已生成 4.0 结构空白模板；没有工作、付款、历史或共享业务身份，2.0/3.0 模板保持不变。');
} finally {await browser.close()}
