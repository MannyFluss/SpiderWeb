// Evidence-backed world observatory; no simulated workers or completion.
const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export function createHermesWorld(body,{request,openChat,openApp}){
 let stopped=false,timer,busy=false,generation='',world={},selected='',questionId=null;
 body.classList.add('hermes-world');
 const heading=node('h2','A living workspace'),intro=node('p','Hermes coordinates. Your Mac keeps the work. This view shows saved evidence—not simulated activity.'),toolbar=node('div'),status=node('p'),lanes=node('div'),details=node('section'),feedback=node('form');
 lanes.style.cssText='display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px';
 const button=(text,fn)=>{const b=node('button',text);b.type='button';b.onclick=fn;return b;};
 const chat=button('Talk to Hermes',openChat),refresh=button('Refresh',()=>load()),pause=button('Enable heartbeat',()=>change({action:'world-heartbeat',paused:world.heartbeat?.paused===false}).catch(()=>{}));
 const run=button('Run heartbeat now',()=>change({action:'world-heartbeat',paused:false,runNow:true}).catch(()=>{}));
 const interval=node('select');interval.setAttribute('aria-label','Heartbeat interval');for(const hours of [1,3,6,12,24]){const option=node('option',hours+' hours');option.value=String(hours*3600);interval.append(option);}interval.onchange=()=>change({action:'world-heartbeat',intervalSeconds:Number(interval.value)}).catch(()=>{});
 toolbar.style.cssText='display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0 16px';
 const experimentForm=node('form'),experimentPrompt=node('textarea'),experimentSubmit=node('button','Prepare experiment');experimentPrompt.setAttribute('aria-label','Experiment assignment');experimentPrompt.placeholder='Give the experiment lab a bounded assignment';experimentPrompt.required=true;experimentPrompt.maxLength=6000;experimentSubmit.type='submit';experimentForm.append(experimentPrompt,experimentSubmit);let experimentRequest=null;experimentForm.onsubmit=async e=>{e.preventDefault();experimentSubmit.disabled=true;try{experimentRequest??=crypto.randomUUID();await change({action:'world-experiment',operation:'plan',requestId:experimentRequest,prompt:experimentPrompt.value});experimentRequest=null;experimentPrompt.value='';}catch{}finally{experimentSubmit.disabled=false;}};
 toolbar.append(chat,refresh,pause,run,interval);status.setAttribute('role','status');
 feedback.style.cssText='display:flex;flex-wrap:wrap;gap:10px;padding:18px 0;border-top:1px solid #bccbc9;margin-top:20px';
 details.style.cssText='margin-top:18px;max-width:100%;overflow-wrap:anywhere';
 const input=node('textarea');input.placeholder='Feedback on the selected work';input.maxLength=4000;input.setAttribute('aria-label','Work feedback');
 const scope=node('select');scope.setAttribute('aria-label','Feedback scope');for(const [value,label] of [['task','Just this task'],['project','This project'],['broader','Broader preference']]){const o=node('option',label);o.value=value;scope.append(o);}
 const submit=node('button','Save scoped feedback');submit.type='submit';feedback.append(input,scope,submit);
 feedback.onsubmit=async e=>{e.preventDefault();try{await change({action:'world-feedback',text:input.value,scope:scope.value,workId:selected||null,questionId});input.value='';questionId=null;}catch{}};
 // The camera is browser-local; work, scheduling and receipts remain backend-owned.
 const viewport=node('div'),camera=node('div'),navigation=node('div'),zoomLabel=node('output');
 viewport.setAttribute('aria-label','Living workspace map');viewport.tabIndex=0;
 viewport.style.cssText='position:relative;height:480px;min-height:300px;overflow:hidden;touch-action:none;border:1px solid #bccbc9;border-radius:20px;background:radial-gradient(circle,#c5d2cc 1px,transparent 1px) 0 0/24px 24px #edf1e9';
 camera.style.cssText='transform-origin:0 0;padding:24px;width:1120px;box-sizing:border-box';
 lanes.style.cssText='display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;align-items:start';
 camera.append(lanes);viewport.append(camera);
 let view={x:0,y:0,scale:0.6};const pointers=new Map();let gesture=null;
 const paint=()=>{camera.style.transform=`translate(${view.x}px,${view.y}px) scale(${view.scale})`;zoomLabel.textContent=Math.round(view.scale*100)+'%';};
 const zoom=(factor,x=viewport.clientWidth/2,y=viewport.clientHeight/2)=>{const previous=view.scale,next=Math.max(0.3,Math.min(2,previous*factor));view.x=x-(x-view.x)*next/previous;view.y=y-(y-view.y)*next/previous;view.scale=next;paint();};
 const fit=()=>{view={x:0,y:0,scale:Math.max(0.3,Math.min(1,viewport.clientWidth/1120))};paint();};
 navigation.style.cssText='display:flex;gap:8px;align-items:center;margin:8px 0';
 navigation.append(button('Zoom out',()=>zoom(0.8)),zoomLabel,button('Zoom in',()=>zoom(1.25)),button('Fit workspace',fit),node('span','Drag the map · pinch to zoom · arrow keys to pan'));
 viewport.addEventListener('wheel',e=>{e.preventDefault();const r=viewport.getBoundingClientRect();if(e.ctrlKey||e.metaKey)zoom(Math.exp(-e.deltaY*0.005),e.clientX-r.left,e.clientY-r.top);else{view.x-=e.deltaX;view.y-=e.deltaY;paint();}},{passive:false});
 const begin=()=>{const points=[...pointers.values()];gesture=points.length===2?{x:(points[0].x+points[1].x)/2,y:(points[0].y+points[1].y)/2,d:Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y)}:points[0]||null;};
 viewport.addEventListener('pointerdown',e=>{if(e.target.closest('button,input,textarea,select,a'))return;viewport.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});begin();});
 viewport.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId))return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});const points=[...pointers.values()];if(points.length===2){const x=(points[0].x+points[1].x)/2,y=(points[0].y+points[1].y)/2,d=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y),r=viewport.getBoundingClientRect();if(gesture?.d){view.x+=x-gesture.x;view.y+=y-gesture.y;zoom(d/gesture.d,x-r.left,y-r.top);}}else if(points.length===1&&gesture){view.x+=e.clientX-gesture.x;view.y+=e.clientY-gesture.y;paint();}begin();});
 for(const type of ['pointerup','pointercancel','lostpointercapture'])viewport.addEventListener(type,e=>{pointers.delete(e.pointerId);begin();});
 viewport.addEventListener('keydown',e=>{if(e.target!==viewport)return;const delta={ArrowLeft:[50,0],ArrowRight:[-50,0],ArrowUp:[0,50],ArrowDown:[0,-50]}[e.key];if(delta){e.preventDefault();view.x+=delta[0];view.y+=delta[1];paint();}else if(e.key==='+'||e.key==='='){e.preventDefault();zoom(1.25);}else if(e.key==='-'){e.preventDefault();zoom(0.8);}else if(e.key==='Home'){e.preventDefault();fit();}});
 body.append(heading,intro,toolbar,status,experimentForm,navigation,viewport,details,feedback);
 const resize=new ResizeObserver(()=>paint());resize.observe(viewport);fit();
 let changing=false;
 async function change(args){if(changing)throw Error('An update is already being saved.');changing=true;for(const control of [pause,run,interval,submit])control.disabled=true;try{await request({...args,expectedGeneration:generation});while(busy&&!stopped)await new Promise(resolve=>setTimeout(resolve,25));await load();}catch(e){status.textContent=e.message;throw e;}finally{changing=false;for(const control of [pause,run,interval,submit])control.disabled=false;}}
 async function load(){if(stopped||busy)return;clearTimeout(timer);busy=true;refresh.disabled=true;try{
 const [s,w]=await Promise.all([request({action:'status'}),request({action:'world-status'})]);if(stopped)return;generation=w.generation;world=w.world;
 interval.value=String(world.heartbeat?.intervalSeconds||10800);
 pause.textContent=world.heartbeat?.paused===false?'Pause heartbeat':'Enable heartbeat';
 status.textContent=world.heartbeat?.paused===false?'Backend heartbeat enabled. Next opportunity: '+new Date(world.heartbeat.nextAt*1000).toLocaleString():'Heartbeat paused. Work and receipts remain on your Mac.';
 lanes.replaceChildren();
 const experimentWork=(w.experimentJobs||[]).map(job=>({...job,title:'Experiment lab · '+job.action,phase:job.error||job.action,result:{content:job.error||JSON.stringify(job,null,2)}}));
 const work=[...(s.work||[]),...experimentWork].filter(w=>w.type!=='notification').sort((a,b)=>String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))).slice(0,24);
 const capabilities=[['Hermes',s.readiness?.ready?'Provider prerequisites ready; execution requires a receipt':'Connection preparing'],['Codex',s.codingTeam?.ready?'Selected downstream teammate available':'Downstream teammate unavailable or unselected'],['Experiment lab','Submit a bounded assignment here, or ask Hermes to dispatch one. Backend job receipts appear below; dispatch is not completion.'],['Learning harness','Learning Reader exposes synchronized LearnHarness records read-only. Teaching-agent dispatch is not connected.']];
 for(const [name,state] of capabilities){const card=node('section');card.style.cssText='padding:16px;border:1px solid #bccbc9;border-radius:18px;background:#f5f4ed';card.append(node('h3',name),node('p',state));const target={'Experiment lab':'spider.experiments','Learning harness':'spider.learning','Codex':'spider.openrig'}[name];if(target&&openApp)card.append(button('Open '+name,()=>openApp(target)));lanes.append(card);}
 for(const w of work){const card=node('article');card.style.cssText='padding:14px;border:1px solid #c8d6d7;border-radius:14px;background:white';const inspect=button(w.title||w.id,()=>{selected=w.id;questionId=null;input.placeholder='Feedback on the selected work';details.replaceChildren(node('h3',w.title||w.id),node('p','Recorded status: '+w.status+' · '+(w.phase||'')));const pre=node('pre',w.result?.content||w.result?.reason||JSON.stringify(w.events||[],null,2));pre.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';details.append(pre);});card.append(inspect,node('p',(w.status||'unknown')+' · '+(w.phase||'')+(w.type==='heartbeat'?' · heartbeat':'')));lanes.append(card);}
 if(!work.length)lanes.append(node('p','No saved work to display. Start with a conversation.'));
 const questions=node('section');questions.append(node('h3','Questions for you'));for(const question of (world.questions||[]).filter(q=>q.status==='open')){const item=node('article');item.append(node('h4',question.text),node('p',question.reason),button('Give feedback on this',()=>{selected=question.workId||'';questionId=question.id;input.placeholder=question.text;input.focus();}));questions.append(item);}if(!world.questions?.some(q=>q.status==='open'))questions.append(node('p','No targeted questions saved.'));lanes.append(questions);
 const history=node('section');history.append(node('h3','Saved feedback'));for(const item of (world.feedback||[]).slice(-12).reverse()){history.append(node('p',item.scope+' · '+(item.workId||'No work selected')+' — '+item.text));}if(!world.feedback?.length)history.append(node('p','No feedback saved yet.'));lanes.append(history);
 }catch(e){if(!stopped)status.textContent='Cannot refresh: '+e.message+'. Last loaded evidence is retained.';}finally{busy=false;refresh.disabled=false;if(!stopped)timer=setTimeout(load,15000);}}
 load();return{destroy(){stopped=true;clearTimeout(timer);resize.disconnect();pointers.clear();}};
}
