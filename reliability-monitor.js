// Metadata-only incident selection. Unknown events are retained, not silently trusted.
export function classifyEvent(row){
 if(row.route==='/api/service/companion')return 'monitor-transport';
 if(['javascript.error','user.problem'].includes(row.event))return 'suspicious';
 if(row.event==='request.error')return 'suspicious';
 if(row.event==='request.response')return row.status>=400?'suspicious':'normal';
 if(row.event==='workspace.state')return row.conflicts>0?'suspicious':'normal';
 if(['request.start','page.start','page.online','page.offline','page.pageshow','page.pagehide','page.visibility'].includes(row.event))return 'normal';
 return 'unknown';
}
export function createReliabilityMonitor({log,send,storage,now=Date.now,scope=()=>'',ready=()=>true}){
 const key='spider.reliability.delivery.v1';
 let state={scope:'',pending:null,lastSent:0},busy=false,nextTry=0;
 try{const saved=JSON.parse(storage?.getItem(key)||'null');if(saved&&typeof saved==='object')state={...state,...saved};}catch{}
 const save=()=>{try{storage?.setItem(key,JSON.stringify(state));}catch{}};
 const signature=r=>JSON.stringify([r.at,r.event,r.route,r.kind,r.status,r.conflicts]);
 async function tick(){
  if(busy||!ready()||now()<nextTry)return;
  const current=scope();if(!current)return;
  if(state.scope!==current){state={scope:current,pending:null,lastSent:0};save();}
  if(!state.pending){
   const events=log.snapshot().events;
   const candidates=events.filter(r=>['suspicious','unknown'].includes(classifyEvent(r))&&Date.parse(r.at)>state.lastSent);
   if(!candidates.length||now()-state.lastSent<300000)return;
   const selected=candidates.slice(-20);
   // Always retain selected anomalies even when normal polling fills the tail.
   const tail=events.filter(r=>r.route!=='/api/service/companion').slice(-40);
   const context=[...selected,...tail].filter((r,i,a)=>a.findIndex(x=>signature(x)===signature(r))===i);
   state.pending={id:globalThis.crypto.randomUUID(),through:Math.max(...selected.map(r=>Date.parse(r.at))),events:context,flagged:selected.map(r=>({signature:signature(r),classification:classifyEvent(r)}))};save();
  }
  busy=true;
  try{
   const receipt=await send(state.pending);
   if(!receipt?.accepted)throw Error('Incident was not acknowledged');
   state.lastSent=state.pending.through;state.pending=null;nextTry=now()+300000;save();
  }catch{nextTry=now()+60000;}finally{busy=false;}
 }
 return {tick,status:()=>({pending:!!state.pending,lastAcknowledged:state.lastSent,busy})};
}
