function el(tag,className='',text){const n=document.createElement(tag);if(className)n.className=className;if(text!==undefined)n.textContent=text;return n;}
function button(text,action){const n=el('button','',text);n.type='button';n.addEventListener('click',action);return n;}
import {activeWork,visibleMessages,pendingSend,workStatus,scrollPosition,pendingSaved} from './hermes-state.js';
export function createHermesChat(body,{request,read,write,space}){
 body.classList.add('hermes-chat');
 body.style.cssText+=';display:flex;flex-direction:column;gap:10px;padding:16px;overflow:hidden;min-width:0;min-height:0;flex:1';
 let disposed=false,busy=false,sending=false,generation='',timer=0,cursor=null,messages=[],working=false,failures=0;
 let connectionNotice=0;
 function clearConnectionNotice(){clearTimeout(connectionNotice);connectionNotice=0;}
 let pending=read().hermesPending?.[space]||null;
 const intro=el('p','','Your shared Hermes conversation, including Signal. Messages are saved by Spider.'),bar=el('div'),log=el('div'),status=el('p'),form=el('form'),input=el('textarea'),send=el('button','primary','Send');
 const refresh=button('Refresh / reconnect',()=>load()),earlier=button('Load earlier',()=>load(true));bar.append(refresh,earlier);
 log.style.cssText='flex:1;min-height:0;overflow:auto;overflow-anchor:none';bar.style.cssText='display:flex;flex-wrap:wrap;gap:8px;flex-shrink:0';
 for(const node of [intro,status,form])node.style.flexShrink='0';
 log.setAttribute('role','log');log.setAttribute('aria-label','Hermes conversation');status.setAttribute('role','status');
 input.setAttribute('aria-label','Message Hermes');input.placeholder='Message Hermes…';input.rows=3;input.maxLength=20000;input.style.cssText='width:100%;box-sizing:border-box;min-height:80px;font-size:16px';
 form.style.cssText='display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:end';send.style.cssText='min-width:72px;max-width:120px;white-space:normal';input.value=String(read().hermesDrafts?.[space]||pending?.prompt||'');send.type='submit';form.append(input,send);body.append(intro,bar,log,status,form);
 input.addEventListener('input',()=>write(['hermesDrafts',space],input.value));
 function controls(){send.disabled=sending||busy||!generation||!request||(!pending&&!input.value.trim());send.textContent=sending?'Saving…':pending?'Retry unconfirmed send':'Send';input.disabled=sending||!!pending;refresh.disabled=busy||sending;earlier.hidden=!cursor;earlier.disabled=busy||sending;}
 input.addEventListener('input',controls);
 function render(older=false){const top=log.scrollTop,height=log.scrollHeight,initial=!log.children.length,nearBottom=height-top-log.clientHeight<60;log.replaceChildren();for(const m of visibleMessages(messages)){const row=el('article'),text=el('div','',m.content);row.style.cssText='padding:12px 0;border-bottom:1px solid #ccc';text.style.cssText='white-space:pre-wrap;overflow-wrap:anywhere';row.append(el('strong','',m.role==='user'?'You':'Hermes'),text);log.append(row);}if(!log.children.length)log.append(el('p','','No saved messages to show yet.'));log.scrollTop=scrollPosition({older,initial,nearBottom,top,height,nextHeight:log.scrollHeight});}
 function schedule(){clearTimeout(timer);if(!disposed&&(working||failures||pending))timer=setTimeout(()=>load(),failures||pending?60000:4000);}
 async function load(older=false){
  if(disposed||busy||sending||!request)return;busy=true;clearTimeout(timer);controls();
  try{const s=await request('companion',{action:'chat-status'});if(disposed)return;let resumedSend=false;
   if(generation&&generation!==s.generation){messages=[];cursor=null;older=false;}generation=s.generation;if(pending&&pendingSaved(pending,s.work)){pending=null;write(['hermesPending',space],null);input.value='';write(['hermesDrafts',space],'');resumedSend=true;}
   const page=await request('companion',{action:'chat-history',expectedGeneration:generation,limit:50,maxChars:64000,...(older&&cursor?{before:cursor}:{})});if(disposed)return;
   messages=older?[...(page.messages||[]),...messages]:(page.messages||[]);cursor=page.hasMore?page.nextCursor:null;render(older);working=resumedSend||activeWork(s.work).length>0;failures=0;clearConnectionNotice();
   status.textContent=pending?'A send is unconfirmed. Retry retains its original message ID and text.':workStatus(s.work)||(working?'Hermes is working. Replies refresh automatically.':'Connected to Hermes. Refresh to check for new messages.');
  }catch(e){if(!disposed){generation='';failures++;if(!connectionNotice)connectionNotice=setTimeout(()=>{connectionNotice=0;if(!disposed&&failures)status.textContent='Connection interrupted. Checking again every 60 seconds; use Refresh to try now. Your draft is retained. '+e.message;},3000);}}
  finally{busy=false;if(!disposed){controls();schedule();}}
 }
 form.addEventListener('submit',async e=>{e.preventDefault();if(disposed||sending||busy||!generation||!request)return;const prompt=input.value.trim();if(!pending&&!prompt)return;
  pending=pendingSend(pending,prompt,()=>crypto.randomUUID());write(['hermesPending',space],pending);sending=true;clearTimeout(timer);controls();let saved=false;
  try{await request('companion',{action:'chat-send',...pending,expectedGeneration:generation});if(disposed)return;saved=true;pending=null;write(['hermesPending',space],null);input.value='';write(['hermesDrafts',space],'');status.textContent='Message saved and queued. Waiting for Hermes…';working=true;}
  catch(error){if(!disposed){failures++;status.textContent='Send not confirmed: '+error.message+'. Retry sends the same ID and original text; your draft is retained. Spider will only check status automatically. Use Retry unconfirmed send to retry manually with the original ID.';}}
  finally{sending=false;if(!disposed){controls();if(saved)await load();else schedule();}}
 });
 if(!request)status.textContent='Connect Spider to your Mac to use chat. No simulated replies are shown.';controls();load();
 return {destroy(){disposed=true;clearTimeout(timer);clearConnectionNotice();},update(){}};
}
