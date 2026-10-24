// Local-only, metadata-only diagnostics. Never record payloads, URLs or error messages.
export const DIAGNOSTICS_BUILD='local-diagnostics-v1';
const KEY='spider.diagnostics.v1',LIMIT=800,MAX_BYTES=240000;
const fields=new Set(['method','route','status','durationMs','kind','online','visible','pending','conflicts','revision','count']);
export function createDiagnostics({storage,now=()=>new Date().toISOString()}={}){
 let events=[],persistent=true,listeners=new Set();
 function clean(event,detail={}){
  const row={at:now(),event:/^[a-z.-]{1,48}$/.test(event)?event:'unknown'};
  for(const [k,v] of Object.entries(detail))if(fields.has(k)){
   if(typeof v==='boolean'||(typeof v==='number'&&Number.isFinite(v)))row[k]=v;
   else if(typeof v==='string'&&/^[a-zA-Z0-9_.:/-]{1,80}$/.test(v))row[k]=v;
  }
  return row;
 }
 try{const saved=JSON.parse(storage?.getItem(KEY)||'[]');if(Array.isArray(saved))events=saved.slice(-LIMIT).filter(x=>x&&typeof x==='object').map(x=>({...clean(x.event,x),at:typeof x.at==='string'&&/^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(x.at)?x.at:now()}));}catch{persistent=false;}
 function save(){while(events.length>LIMIT||JSON.stringify(events).length>MAX_BYTES)events.shift();try{if(!storage)throw Error();storage.setItem(KEY,JSON.stringify(events));persistent=true;}catch{persistent=false;}for(const fn of listeners)try{fn();}catch{}}
 return {record(event,detail){events.push(clean(event,detail));save();},clear(){events=[];save();},subscribe(fn){listeners.add(fn);return()=>listeners.delete(fn);},snapshot(){return {schemaVersion:1,build:DIAGNOSTICS_BUILD,exportedAt:now(),persistent,privacy:'Metadata only. No request bodies, saved work, tokens, full URLs, keystrokes or error messages. No automatic upload.',events:events.map(x=>({...x}))};}};
}
let storage;try{storage=globalThis.localStorage;}catch{}
export const diagnostics=createDiagnostics({storage});
export function diagnosticRoute(path){return /^\/api\/service\/[a-z-]+$/.test(path)?path:['/api/state','/api/patch','/api/connections','/api/apps','/api/pair','/api/invite','/api/sandbox/version'].includes(path)?path:'other';}
export function installDiagnostics(log=diagnostics,win=globalThis.window,doc=globalThis.document){
 if(!win||!doc)return;
 log.record('page.start',{online:win.navigator.onLine,visible:!doc.hidden});
 for(const event of ['online','offline','pageshow','pagehide'])win.addEventListener(event,()=>log.record('page.'+event,{online:win.navigator.onLine}));
 doc.addEventListener('visibilitychange',()=>log.record('page.visibility',{visible:!doc.hidden}));
 win.addEventListener('error',()=>log.record('javascript.error',{kind:'uncaught'}));
 win.addEventListener('unhandledrejection',()=>log.record('javascript.error',{kind:'unhandled-rejection'}));
}
export function createDiagnosticsApp(log=diagnostics){
 const dialog=document.createElement('dialog');dialog.setAttribute('aria-label','Reliability logs');
 const title=document.createElement('h2');title.textContent='Reliability logs';
 const intro=document.createElement('p');intro.textContent='Local to this browser. Export after a problem and share the JSON with Hermes. Metadata only; nothing is uploaded automatically. Different browsers and frontend addresses keep separate logs.';
 const status=document.createElement('p');status.setAttribute('role','status');
 const preview=document.createElement('pre');preview.style.cssText='max-height:45vh;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere';
 const tools=document.createElement('div');tools.className='toolbar';
 const button=(text,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=fn;tools.append(b);};
 button('Export JSON',()=>{try{const blob=new Blob([JSON.stringify(log.snapshot(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='spider-reliability-'+new Date().toISOString().replaceAll(':','-')+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}catch{status.textContent='Download failed. Select and copy the visible log below.';}});
 button('Mark problem now',()=>log.record('user.problem'));
 button('Clear logs',()=>{if(confirm('Delete reliability logs on this browser?'))log.clear();});
 button('Close',()=>dialog.close());
 dialog.append(title,intro,status,tools,preview);document.body.append(dialog);
 function render(){if(!dialog.open)return;const s=log.snapshot();status.textContent=`${s.events.length} events · ${s.persistent?'Saved locally across reloads':'Memory only — browser storage unavailable; export before closing'} · ${s.build}`;preview.textContent=JSON.stringify(s,null,2);}
 log.subscribe(render);return {open(){if(!dialog.open)dialog.showModal();render();}};
}
