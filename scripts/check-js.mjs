// 只检查工程源码目录，不读取本地工作簿、备份或测试产物。
import {readdirSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function sourceFiles(folder){
  return readdirSync(folder,{withFileTypes:true}).flatMap(entry=>{
    const path=resolve(folder,entry.name);
    if(entry.isDirectory())return sourceFiles(path);
    return entry.isFile() && /\.(?:js|mjs)$/.test(entry.name)?[path]:[];
  });
}
const files=[resolve(root,'playwright.config.mjs'),...['src','scripts','tests','vendor'].flatMap(folder=>sourceFiles(resolve(root,folder)))].sort();
for(const path of files){
  const result=spawnSync(process.execPath,['--check',path],{stdio:'inherit'});
  if(result.error || result.status!==0){
    console.error('Syntax check failed: '+relative(root,path),result.error?.message || '');
    process.exit(result.status || 1);
  }
}
console.log(`Syntax checks passed for ${files.length} JavaScript files.`);
