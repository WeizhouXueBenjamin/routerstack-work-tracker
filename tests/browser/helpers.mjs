import {readFile} from 'node:fs/promises';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export const root=fileURLToPath(new URL('../../',import.meta.url));
export const url=pathToFileURL(resolve(root,'index.html')).href;
export const synthetic=changes=>({date:'2026-01-10',invoice:'INV-9001',start:'09:00',end:'17:00',lunch:'',rate:'60',app:'',extra:'',note:'Synthetic 中文 & <test>',...changes});
export async function boot(page){
 await page.addInitScript(()=>{window.showOpenFilePicker=undefined;window.showSaveFilePicker=undefined});
 page.on('dialog',dialog=>dialog.accept());await page.goto(url);
}
export async function details(page){if(!await page.locator('#additionalDetails').evaluate(node=>node.open))await page.locator('#additionalDetails>summary').click()}
export async function drawer(page,name){await page.locator('#'+name+'Btn').click()}
export async function add(page,changes={}){await details(page);for(const [key,value] of Object.entries(synthetic(changes)))await page.locator('#'+key).fill(value);await page.locator('#submitJob').click()}
export async function download(page,button='#saveBtn',confirm=true){
 const waiting=page.waitForEvent('download');await page.locator(button).click();const file=await waiting;const bytes=await readFile(await file.path());await page.waitForFunction(()=>!state.busy);if(confirm)await page.locator('#confirmDownload').click();return bytes;
}
export async function open(page,bytes,name='synthetic.xlsx'){
 await page.locator('#fileInput').setInputFiles({name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});await page.waitForFunction(()=>!state.busy);
}
export async function makeBytes(page,{count=1,standalone=false}={}){
 return Buffer.from(await page.evaluate(async({count,standalone})=>{
  const M=TrackerModel;let value=M.create();
  if(count){value=M.addRecord(value,{date:'2026-01-10',invoice:'INV-9000',start:'19:00',end:'20:00',rate:60,note:'  Synthetic 中文\n=SUM(1,2) '});const base=value.records[0];value.records=Array.from({length:count},(_,i)=>({...base,id:crypto.randomUUID(),invoice:'INV-'+String(9000+i),date:i%2?'2026-02-10':'2026-01-10',app:i%3?0:null}));}
  if(standalone){value=M.saveIssue(value,{description:'Independent unknown',amountCents:null});value=M.saveIssue(value,{description:'Independent zero',amountCents:0});value=M.saveBalance(value,{description:'Confirmed zero',amountCents:0},null,'Explicit confirmation');}
  return [...new Uint8Array(await(await TrackerWorkbook.write(value)).arrayBuffer())];
 },{count,standalone}));
}
export async function mutate(page,bytes,operations=[],mode=''){
 return Buffer.from(await page.evaluate(async({bytes,operations,mode})=>{
  const NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main',zip=await JSZip.loadAsync(new Uint8Array(bytes)),docs={};
  for(const operation of operations){
   const path=operation.path || 'xl/worksheets/sheet1.xml',doc=docs[path] ||= new DOMParser().parseFromString(await zip.file(path).async('string'),'application/xml');
   let cell=[...doc.getElementsByTagNameNS(NS,'c')].find(node=>node.getAttribute('r')===operation.ref);
   if(!cell){const r=operation.ref.match(/\d+$/)[0];let row=[...doc.getElementsByTagNameNS(NS,'row')].find(node=>node.getAttribute('r')===r);if(!row){row=doc.createElementNS(NS,'row');row.setAttribute('r',r);doc.getElementsByTagNameNS(NS,'sheetData')[0].appendChild(row)}cell=doc.createElementNS(NS,'c');cell.setAttribute('r',operation.ref);row.appendChild(cell)}
   if(operation.removeFormula){[...cell.children].find(node=>node.localName==='f')?.remove();continue}
   cell.replaceChildren();cell.setAttribute('t',operation.type || (typeof operation.value==='number'?'n':'str'));
   if(operation.value!==undefined){const v=doc.createElementNS(NS,'v');v.textContent=String(operation.value);cell.appendChild(v)}
   if(operation.formula){const f=doc.createElementNS(NS,'f');f.textContent=operation.formula;cell.appendChild(f)}
  }
  for(const [path,doc] of Object.entries(docs))zip.file(path,new XMLSerializer().serializeToString(doc));
  if(mode==='sort' || mode==='shared' || mode==='broken-shared' || mode==='cache'){
   const path='xl/worksheets/sheet1.xml',doc=new DOMParser().parseFromString(await zip.file(path).async('string'),'application/xml'),table=new DOMParser().parseFromString(await zip.file('xl/tables/table1.xml').async('string'),'application/xml');
   const range=/A(\d+):AC(\d+)/.exec(table.documentElement.getAttribute('ref')),top=+range[1],bottom=+range[2];
   const rows=[...doc.getElementsByTagNameNS(NS,'row')].filter(row=>+row.getAttribute('r')>top && +row.getAttribute('r')<=bottom);
   if(mode==='sort')rows.reverse().forEach((row,i)=>{const old=+row.getAttribute('r'),next=top+i+1;row.setAttribute('r',next);for(const c of row.children){const ref=c.getAttribute('r'),col=ref.match(/^[A-Z]+/)[0];c.setAttribute('r',col+next);const f=[...c.children].find(node=>node.localName==='f');if(f)f.textContent=TrackerCore.translateFormula(f.textContent,col+old,col+next)}row.parentNode.appendChild(row)});
   if(mode==='shared' || mode==='broken-shared')for(const row of rows){const cell=[...row.children].find(node=>node.getAttribute('r').startsWith('D')),f=[...cell.children].find(node=>node.localName==='f');f.setAttribute('t','shared');f.setAttribute('si','7');if(+row.getAttribute('r')===top+1 && mode==='shared')f.setAttribute('ref',`D${top+1}:D${bottom}`);else f.textContent=''}
   if(mode==='cache')for(const cell of doc.getElementsByTagNameNS(NS,'c')){if(![...cell.children].some(node=>node.localName==='f'))continue;const v=[...cell.children].find(node=>node.localName==='v');if(v)v.textContent='999999'}
   zip.file(path,new XMLSerializer().serializeToString(doc));
  }
  return [...new Uint8Array(await zip.generateAsync({type:'arraybuffer'}))];
 },{bytes:[...bytes],operations,mode}));
}
