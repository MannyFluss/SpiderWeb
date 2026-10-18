// Saved source state belongs to the Mac. Only the unsent-edit journal needs
// durable browser storage; IndexedDB avoids Web Storage's small string quota.
export const browserRecord = local => Object.fromEntries(
  ['clientId','pending','conflicts','recoveredChanges','views','camera','workspaceId','nodeBase'].map(key=>[key,local[key]]),
);
export async function clientStorage({key, nodeBase, storage=globalThis.localStorage, database=globalThis.indexedDB}) {
  let db;
  try {
    db = await new Promise((resolve,reject)=>{
      const request=database.open('spider-client-journal',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('clients');
      request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
      request.onblocked=()=>reject(Error('Browser edit journal is busy'));
    });
  } catch {}
  function readItem(k) {try{return JSON.parse(storage.getItem(k)||'null');}catch{return null;}}
  async function read(k) {
    const synchronous=readItem(k);
    if(db) {
      try {const record=await new Promise((resolve,reject)=>{const r=db.transaction('clients').objectStore('clients').get(k);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});if(record)return (synchronous?.journalRevision||0)>(record.journalRevision||0)?synchronous:record;}catch{}
    }
    return synchronous;
  }
  let local=await read(key), previous;
  try {previous=storage.getItem('spider.lastCache');}catch{}
  if(!local) {
    const older=await read(previous || 'spider.client.v1');
    if(older && (!older.nodeBase || older.nodeBase===nodeBase)) {
      local={...older,pending:[],recoveredChanges:[...(older.recoveredChanges||[]),...(older.pending||[])]};
    }
  }
  local ||= {pending:[],conflicts:[],views:[],workspaceId:null};
  let journalRevision=local.journalRevision||0;
  local.pending ||= [];local.conflicts ||= [];local.recoveredChanges ||= [];
  // Carry pending edits from older tabs forward for export without replaying
  // them from two tabs or changing their immutable operation IDs.
  const legacyKeys=[];
  try {for(let i=0;i<storage.length;i++){const k=storage.key(i);if(k==='spider.client.v1'||k?.startsWith('spider.client.v1:'))legacyKeys.push(k);}}catch{}
  const known=new Set([...local.pending,...local.recoveredChanges,...local.conflicts].map(op=>op.id));
  for(const k of legacyKeys) {
    const old=readItem(k);
    if(old && (!old.nodeBase || old.nodeBase===nodeBase)) {
      for(const op of [...(old.pending||[]),...(old.recoveredChanges||[]),...(old.conflicts||[])]) {
        if(!known.has(op.id)){local.recoveredChanges.push(op);known.add(op.id);}
      }
    }
  }
  async function save(value) {
    const record={...browserRecord({...value,nodeBase}),journalRevision:++journalRevision};
    // Small journals also get a synchronous copy so last-moment pagehide
    // camera changes survive even if the browser aborts an IDB transaction.
    // Large unsent edits use IDB; accepted workspace snapshots are never saved.
    let synchronous=false;
    try {storage.setItem(key,JSON.stringify(record));synchronous=true;}catch{}
    if(db) {
      try {await new Promise((resolve,reject)=>{
        const transaction=db.transaction('clients','readwrite');
        transaction.objectStore('clients').put(record,key);
        transaction.oncomplete=resolve;transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error||Error('Edit journal write cancelled'));
      });} catch(error) {if(!synchronous)throw error;}
    } else if(!synchronous) throw Error('Browser could not save the unsent-edit journal');
    try{storage.setItem('spider.lastCache',key);}catch{}
  }
  // Remove full browser snapshots only after the replacement journal is durable.
  await save(local);
  for(const k of legacyKeys) {
    const old=readItem(k);
    if(k!==key && old && (!old.nodeBase || old.nodeBase===nodeBase))try{storage.removeItem(k);}catch{}
  }
  delete local.snapshot;delete local.apps;delete local.report;
  return {local,save,kind:db?'IndexedDB':'browser storage'};
}
