const held = w => w.held===true || w.quiet===true || /held|quiet|paused|setup|provider|budget|policy/.test(w.phase||'');
export const activeWork = work => (work||[]).filter(w=>['queued','running','pending','retrying'].includes(w.status)&&!held(w)&&!(w.status==='retrying'&&w.lastFailure));
export function failureText(value){
 if(typeof value==='string')return value;
 if(!value||typeof value!=='object')return '';
 for(const key of ['reason','message','detail','code']){const text=failureText(value[key]);if(text)return text;}
 return '';
}
export function workStatus(work){
 const latest=(work||[]).reduce((best,w)=>!best||String(w.updatedAt||'')>=String(best.updatedAt||'')?w:best,null);
 if(!latest)return '';
 if(['blocked','failed','interrupted'].includes(latest.status)||(latest.status==='retrying'&&latest.lastFailure))return 'Latest request needs attention: '+(failureText(latest.lastFailure)||latest.title||latest.status)+'. Use Refresh after resolving the issue.';
 if(held(latest))return 'Latest request is on hold. Use Refresh to check again.';
 return '';
}
export function answerText(value){
 const original=typeof value==='string'?value:JSON.stringify(value)??'';
 let parsed=value;if(typeof value==='string'){try{parsed=JSON.parse(value);}catch{return original;}}
 if(parsed&&!Array.isArray(parsed)&&['answer','proposal'].includes(parsed.kind)){
  if(typeof parsed.content==='string'&&parsed.content)return parsed.content;
  if(typeof parsed.summary==='string')return parsed.summary;
 }
 return original;
}
export function visibleMessages(messages){
 const visible=(messages||[]).filter(m=>['user','assistant'].includes(m.role)&&m.visible!==false&&!['analysis','tool','commentary'].includes(m.channel)).map(m=>({...m,content:m.role==='assistant'?answerText(m.content):String(m.content||'')})).filter(m=>m.content),out=[];
 for(const m of visible){const prior=out.at(-1),sameWork=prior&&m.workId&&(m.workId===prior.workId||m.workId==='signal-outbox:'+prior.workId);
  if(m.role==='assistant'&&prior?.role==='assistant'&&sameWork&&(m.content===prior.content||(m.channel==='signal'&&m.content==='Spider: '+prior.content)))continue;
  out.push(m);
 }
 return out;
}
export function pendingSend(existing,prompt,uuid){return existing||{id:uuid(),prompt};}
export function scrollPosition({older,initial,nearBottom,top,height,nextHeight}){return older?top+nextHeight-height:initial||nearBottom?nextHeight:top;}

export function pendingSaved(pending,work){return !!pending&&(work||[]).some(w=>typeof w.id==='string'&&w.id.startsWith('chat:')&&w.id.endsWith(':'+pending.id));}
