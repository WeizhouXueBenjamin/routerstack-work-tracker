(function(root){
  'use strict';
  // A convenience reference only. Workbook bytes and work records never enter this store.
  const database='routerstack-file-reference',store='recent';
  let writes=Promise.resolve();
  async function transaction(mode,action){
    const db=await new Promise((resolve,reject)=>{
      const request=root.indexedDB.open(database,1);
      request.onupgradeneeded=()=>request.result.createObjectStore(store);
      request.onsuccess=()=>resolve(request.result);
      request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(Error('最近文件存储被其他窗口占用'));
    });
    try{return await new Promise((resolve,reject)=>{
      const tx=db.transaction(store,mode),request=action(tx.objectStore(store));
      tx.oncomplete=()=>resolve(request.result);
      tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error || Error('最近文件存储已取消'));
    })}finally{db.close()}
  }
  root.TrackerRecentFile=Object.freeze({
    read:()=>transaction('readonly',table=>table.get('current')),
    write:(handle,name,writable)=>(writes=writes.catch(()=>{}).then(()=>transaction('readwrite',table=>table.put({handle,name,writable},'current'))))
  });
})(globalThis);
