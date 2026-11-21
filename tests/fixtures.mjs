import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
export const C=require('../src/core.js'),M=require('../src/model.js'),R=require('../src/reports.js');
export const job=changes=>({date:'2026-01-10',invoice:null,start:'09:00',end:'17:00',lunch:null,rate:60,extra:null,app:null,note:'Synthetic 中文',...changes});
export function saved(state){const out=M.clone(state);out.metadata.fileVersionId=randomUUID();return M.validate(out)}
export function fixture(count=1){
 const state=M.addRecord(M.create(),job());
 const base=state.records[0];
 state.records=Array.from({length:count},(_,i)=>({...base,id:randomUUID(),invoice:'INV-'+String(9000+i),date:i%2?'2026-02-10':'2026-01-10',app:i%3?0:null}));
 return M.validate(state);
}
