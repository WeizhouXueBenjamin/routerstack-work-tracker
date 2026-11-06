import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
const require=createRequire(import.meta.url);
const root=fileURLToPath(new URL('../../',import.meta.url));
const JSZip=require(resolve(root,'vendor/jszip.min.js'));
export const url=pathToFileURL(resolve(root,'index.html')).href;
export const synthetic=changes=>({date:'2026-01-10',invoice:'INV-9001',start:'09:00',end:'17:00',lunch:'',rate:'60',app:'',extra:'',note:'Synthetic 中文 & <test>',...changes});
export async function add(page,changes={}) {for(const [key,value]of Object.entries(synthetic(changes)))await page.locator('#'+key).fill(value);await page.locator('#submitJob').click()}
export async function download(page,button='#saveBtn',confirm=true) {
  const waiting=page.waitForEvent('download');await page.locator(button).click();const file=await waiting;
  const bytes=await readFile(await file.path());await page.waitForFunction(()=>!state.busy);
  if(confirm)await page.locator('#confirmDownload').click();
  return bytes;
}
export async function open(page,bytes,name='synthetic.xlsx') {
  await page.locator('#fileInput').setInputFiles({name,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:bytes});
  await page.waitForFunction(()=>!state.busy);
}
export async function legacy() {
  const zip=await JSZip.loadAsync(await readFile(resolve(root,'templates/RouterStack_Tracker_V2_Blank.xlsx')));
  let xml=await zip.file('xl/worksheets/sheet2.xml').async('string');
  const cells={A6:46032,B6:'INV-9901',K6:19/24,L6:20/24,E6:60,M6:'Job',J6:'Synthetic legacy'};
  for(const [ref,value]of Object.entries(cells))xml=xml.replace(new RegExp('<x:c r="'+ref+'"[^>]*?(?:/>|>[\\s\\S]*?</x:c>)'),`<x:c r="${ref}" t="${typeof value==='number'?'n':'str'}"><x:v>${value}</x:v></x:c>`);
  zip.file('xl/worksheets/sheet2.xml',xml);return zip.generateAsync({type:'nodebuffer'});
}
export async function mutate(page,bytes,operations=[],mode='') {
  return Buffer.from(await page.evaluate(async({bytes,operations,mode})=>{
    const zip=await JSZip.loadAsync(new Uint8Array(bytes)), NS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const docs={};
    for(const operation of operations) {
      const path=operation.path || 'xl/worksheets/sheet2.xml';
      const doc=docs[path] ||= new DOMParser().parseFromString(await zip.file(path).async('string'),'application/xml');
      if(operation.removeRow){[...doc.getElementsByTagNameNS(NS,'row')].find(row=>row.getAttribute('r')===String(operation.removeRow))?.remove();continue}
      let cell=[...doc.getElementsByTagNameNS(NS,'c')].find(cell=>cell.getAttribute('r')===operation.ref);
      if(!cell) {
        const n=operation.ref.match(/\d+/)[0];let row=[...doc.getElementsByTagNameNS(NS,'row')].find(row=>row.getAttribute('r')===n);
        if(!row){row=doc.createElementNS(NS,'row');row.setAttribute('r',n);doc.getElementsByTagNameNS(NS,'sheetData')[0].appendChild(row)}
        cell=doc.createElementNS(NS,'c');cell.setAttribute('r',operation.ref);row.appendChild(cell);
      }
      if(operation.removeFormula){[...cell.children].find(node=>node.localName==='f')?.remove();continue}
      cell.replaceChildren();cell.setAttribute('t',operation.type || (typeof operation.value==='number'?'n':'str'));
      if(operation.value!==''){const value=doc.createElementNS(NS,'v');value.textContent=String(operation.value);cell.appendChild(value)}
      if(operation.formula){const f=doc.createElementNS(NS,'f');f.textContent=operation.formula;cell.appendChild(f)}
    }
    for(const [path,doc]of Object.entries(docs))zip.file(path,new XMLSerializer().serializeToString(doc));
    if(mode==='relationships') {
      const old='xl/worksheets/sheet2.xml', next='xl/worksheets/jobs-renamed.xml';zip.file(next,await zip.file(old).async('string'));zip.remove(old);
      zip.file('xl/_rels/workbook.xml.rels',(await zip.file('xl/_rels/workbook.xml.rels').async('string')).replace('/worksheets/sheet2.xml','/worksheets/jobs-renamed.xml'));
      const book=new DOMParser().parseFromString(await zip.file('xl/workbook.xml').async('string'),'application/xml'), sheets=book.getElementsByTagNameNS(NS,'sheets')[0];sheets.insertBefore(sheets.lastElementChild,sheets.firstElementChild);zip.file('xl/workbook.xml',new XMLSerializer().serializeToString(book));
    }
    if(mode==='shared' || mode==='broken-shared') {
      const doc=new DOMParser().parseFromString(await zip.file('xl/worksheets/sheet2.xml').async('string'),'application/xml');
      for(const cell of doc.getElementsByTagNameNS(NS,'c'))if(/^F(?:[6-9]|\d{2,3})$/.test(cell.getAttribute('r'))) {
        const f=[...cell.children].find(node=>node.localName==='f');if(!f)continue;
        f.setAttribute('t','shared');f.setAttribute('si','7');
        if(cell.getAttribute('r')==='F6' && mode==='shared')f.setAttribute('ref','F6:F305');else f.textContent='';
      }
      zip.file('xl/worksheets/sheet2.xml',new XMLSerializer().serializeToString(doc));
    }
    return [...new Uint8Array(await zip.generateAsync({type:'arraybuffer'}))];
  },{bytes:[...bytes],operations,mode}));
}
