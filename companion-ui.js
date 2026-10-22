import {createKnowledgePanel} from './knowledge-panel.js';

const activeStates=new Set(['queued','running','working','retrying']);
const text=(value,fallback='')=>typeof value==='string'?value:fallback;
const providerName=value=>value==='chatgpt-codex'?'ChatGPT subscription':value==='ollama'?'Ollama Cloud':null;
function provenanceLabel(value) {
  const provider=providerName(value?.provider);
  if(!provider||value?.harness!=='hermes')return '';
  const requested=text(value.requestedModel),actual=text(value.actualModel);
  return ['Hermes',provider,actual?`Model: ${actual}`:requested?`Requested: ${requested}`:'Model not recorded',!actual?'Actual model not recorded':actual!==requested&&requested?`Requested: ${requested}`:''].filter(Boolean).join(' · ');
}

function draftPreview(container,html,manifest,doc) {
  if(typeof html!=='string'||html.length>4_000_000)throw Error('Draft preview is not available.');
  const frame=doc.createElement('iframe');frame.className='companion-preview';frame.title='Interactive draft preview';frame.setAttribute('sandbox','allow-scripts');
  // The preview receives only disposable local data. It cannot call Mac services
  // or acquire the device credential used by the surrounding Spider shell.
  frame.srcdoc=`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'">`+html;
  const view=doc.defaultView;let port,requests=0,data={};
  const snapshot=()=>({data,online:true,jobs:{},appId:manifest?.id||'draft.preview',sessionId:'preview'});
  const valid=key=>typeof key==='string'&&key.length>0&&key.length<200&&!['__proto__','prototype','constructor'].includes(key)&&!key.includes('/');
  const connect=event=>{
    if(event.source!==frame.contentWindow||event.data?.type!=='spider:ready'||port)return;
    const channel=new MessageChannel();port=channel.port1;
    port.onmessage=({data:message})=>{
      const {id,method,args={}}=message||{};
      try{
        if(++requests>1000)throw Error('This preview reached its interaction limit. Reopen it to continue.');
        if(method==='write'){
          if(!Array.isArray(args.path)||!args.path.length||args.path.length>16||!args.path.every(valid))throw Error('Preview writes require field keys.');
          if(JSON.stringify(args.value)?.length>256000)throw Error('Preview value is too large.');
          const next=structuredClone(data);let target=next;
          for(const key of args.path.slice(0,-1)){if(!target[key]||typeof target[key]!=='object'||Array.isArray(target[key]))target[key]={};target=target[key];}
          target[args.path.at(-1)]=args.value;
          if(JSON.stringify(next).length>256000)throw Error('Preview data is too large.');data=next;
          port.postMessage({type:'state',state:snapshot()});port.postMessage({id,result:{status:'applied'}});
        } else if(method==='resize') {frame.style.height=Math.max(240,Math.min(720,Number(args.height)||420))+'px';port.postMessage({id,result:{ok:true}});}
        else throw Error('This preview cannot use Mac services.');
      }catch(error){port.postMessage({id,error:error.message});}
    };
    frame.contentWindow.postMessage({type:'spider:init',context:{appId:manifest?.id||'draft.preview',sessionId:'preview',workspaceId:'draft-preview'},state:snapshot()},'*',[channel.port2]);
  };
  view.addEventListener('message',connect);container.append(frame);
  return ()=>{view.removeEventListener('message',connect);port?.close();frame.remove();};
}

export function createCompanion({button,request,knowledge,document:doc=document}) {
  const dialog=doc.createElement('dialog');dialog.className='companion-panel';dialog.setAttribute('aria-labelledby','companion-title');
  dialog.innerHTML=`<div class="companion-head"><h2 id="companion-title">Companion</h2><button type="button" aria-label="Close companion">×</button></div>
    <p class="companion-readiness" role="status">Connecting to your companion…</p><p class="companion-cloud-setup" hidden><a target="_blank" rel="noopener noreferrer">Connect Ollama Cloud</a></p>
    <section class="companion-provider" aria-labelledby="companion-provider-title" hidden><h3 id="companion-provider-title">Model connection</h3><p class="companion-provider-selection"></p><p class="companion-provider-mode"></p><p class="companion-provider-auth"></p><p class="companion-provider-catalog"></p><p class="companion-provider-inference"></p><p class="companion-provider-error companion-error" role="status" hidden></p></section>
    <section class="companion-terminal" aria-labelledby="hermes-terminal-title"><h3 id="hermes-terminal-title">Hermes terminal</h3><p>Send prompts to your existing Hermes conversation. Signal messages share this saved history.</p><p class="companion-history-status" role="status">Open the companion to load saved messages.</p><div class="companion-transcript" role="log" aria-label="Hermes conversation" aria-live="polite"></div><div class="companion-history-actions"><button class="companion-history-older" type="button" disabled>Earlier messages</button><button class="companion-history-latest" type="button" hidden>Latest messages</button></div><form class="companion-request"><label for="companion-prompt">What would you like to work on?</label><textarea id="companion-prompt" rows="3" maxlength="32000" required placeholder="Ask Hermes…" aria-describedby="hermes-terminal-help"></textarea><span id="hermes-terminal-help">Enter to send · Shift+Enter for a new line</span><button class="primary" type="submit">Send request</button></form></section>
    <p class="companion-feedback" role="status" hidden></p>
    <section><h3>Working</h3><div class="companion-work"></div></section>
    <section><h3>Ready to review</h3><div class="companion-proposals"></div></section>
    <section><h3>Shared knowledge</h3><p class="companion-knowledge"></p><button class="companion-sync" type="button">Check for changes</button><p class="companion-native" hidden></p><button class="companion-native-setup" type="button" hidden>Check coding integration</button><div class="companion-knowledge-controls"></div></section>
    <section><h3>Coding help</h3><p class="companion-coding-status"></p><button class="companion-coding-load" type="button">Choose coding teammate</button><form class="companion-coding-form" hidden><label for="companion-coding-target">Existing coding team</label><select id="companion-coding-target" class="companion-coding-target" required></select><button class="companion-coding-save" type="submit">Use coding teammate</button><button class="companion-coding-clear" type="button">Stop using this teammate</button></form></section>
    <section><h3>Private Signal</h3><p class="companion-signal"></p><button class="companion-link" type="button">Link Signal</button><div class="companion-pairing"></div></section>`;
  doc.body.append(dialog);
  const $=selector=>dialog.querySelector(selector);
  let online=false,workspaceId=null,generation=0,state=null,busy=false,pending=null,lastPoll=0,mutating=false,available=false,statusError='',pairingPendingUntil=0;
  const knowledgePanel=createKnowledgePanel({container:$('.companion-knowledge-controls'),read:knowledge,request,document:doc,onChange:()=>poll(true)});
  const previews=new Set();
  let codingTargets=[],historyPage=null,historyBefore=null,historyBusy=false,historyError='',terminalPending=null;
  const make=(tag,value,className)=>{const el=doc.createElement(tag);if(value!==undefined)el.textContent=value;if(className)el.className=className;return el;};
  const feedback=value=>{$('.companion-feedback').textContent=value;$('.companion-feedback').hidden=!value;};
  function renderHistory() {
    const log=$('.companion-transcript'),atBottom=log.scrollHeight-log.scrollTop-log.clientHeight<40;
    log.replaceChildren();
    for(const message of historyPage?.messages||[]) {
      const row=make('article',undefined,'companion-message');row.dataset.message=text(message.id);
      const who=message.role==='user'?'You':message.role==='assistant'?'Hermes':message.role==='tool'?'Tool result':'Saved message';
      const channel=message.channel==='signal'?'Signal':message.channel==='terminal'?'Terminal':message.channel==='hermes'?'Hermes conversation':'Saved conversation';
      const direction=message.direction==='inbound'?'Incoming':message.direction==='outbound'?'Outgoing':message.direction==='incoming'?'Incoming':message.direction==='outgoing'?'Outgoing':'';
      const date=new Date(message.timestamp??NaN),stamp=Number.isFinite(date.getTime())?(message.timeBasis==='observed'?'Observed ':'Recorded ')+date.toLocaleString():'Time not recorded';
      const states={saved:'Saved',queued:'Queued',pending:'Waiting to send',sent:'Sent',unconfirmed:'Send unconfirmed',failed:'Send failed',unknown:'Delivery not recorded'};
      const delivery=states[message.delivery?.state]||'Delivery not recorded';
      row.append(make('div',[who,channel,direction,stamp,delivery].filter(Boolean).join(' · '),'companion-message-meta'),make('pre',text(message.content)));
      const provenance=provenanceLabel(message.provenance);if(provenance)row.append(make('p',provenance,'companion-message-provenance'));
      const part=message.fragment;if(part?.earlier===true||part?.later===true)row.append(make('p',[part.earlier?'Continued from earlier history.':'',part.later?'Continues in later history.':''].filter(Boolean).join(' '),'companion-message-meta'));
      log.append(row);
    }
    if(!historyPage?.messages?.length&&!historyError)log.append(make('p',historyBusy?'Loading saved messages…':'No saved conversation yet.','companion-empty'));
    $('.companion-history-status').textContent=historyError||(!online?'Mac unreachable. Showing the last loaded messages.':historyBefore?'Earlier saved messages. New work continues in the same conversation.':historyBusy?'Refreshing saved messages…':'Saved on your Mac.');
    $('.companion-history-older').disabled=!online||!available||historyBusy||!historyPage?.hasMore||!historyPage?.nextCursor;
    $('.companion-history-latest').hidden=!historyBefore;
    $('.companion-history-latest').disabled=!online||!available||historyBusy;
    if(atBottom)log.scrollTop=log.scrollHeight;
  }
  async function loadHistory(before=null) {
    if(!online||!available||historyBusy||!dialog.open)return;
    historyBusy=true;historyError='';const current=generation,expected=state?.generation;renderHistory();
    try {
      const result=await request({action:'history',limit:30,maxChars:32000,...(before?{before}:{}),expectedGeneration:expected});
      if(current!==generation||state?.generation!==expected)return;
      if(!Array.isArray(result.messages)||result.generation!==expected)throw Error('Saved conversation history is unavailable.');
      historyPage={messages:result.messages.slice(0,30),hasMore:result.hasMore===true,nextCursor:result.nextCursor,generation:result.generation};historyBefore=before;
    }catch(error){if(current===generation)historyError=error.message;}
    finally{historyBusy=false;if(current===generation)renderHistory();else if(online&&dialog.open)loadHistory();}
  }
  function render() {
    const work=Array.isArray(state?.work)?state.work:[],proposals=Array.isArray(state?.proposals)?state.proposals:[];
    const running=work.filter(item=>activeStates.has(item.status)&&item.heldByPolicy!==true),drafts=proposals.filter(item=>!['accepted','rejected','dismissed'].includes(item.status));
    const working=running.some(item=>['running','working'].includes(item.status));
    button.replaceChildren(make('span','✳','companion-thread'),make('span',running.length?`${working?'Working':'Waiting'} ${running.length}`:drafts.length?`Review ${drafts.length}`:'Companion'));
    button.dataset.working=String(online&&working);
    button.setAttribute('aria-label',running.length?`Companion: ${running.length} tasks in progress`:drafts.length?`Companion: ${drafts.length} drafts to review`:'Open companion');
    $('.companion-readiness').textContent=!online?'Mac unreachable. Showing the last available companion status.':statusError||text(state?.readiness?.message,state?.readiness?.ready===true?'Ready for your next request.':state?'Your companion is preparing. Other apps are available.':'Connecting to your companion…');
    const provider=state?.provider,name=providerName(provider?.id),restricted=provider?.mode==='observational';
    $('.companion-provider').hidden=!name;
    $('.companion-provider-selection').textContent=name?[name,text(provider.requestedModel,'Model not configured')].join(' · '):'';
    $('.companion-provider-mode').textContent=provider?.mode==='observational'?'Observational mode. Answers and shared context are available; proposals, app builds and delegation are disabled.':provider?.mode==='collaborative'?'Collaborative mode. Working drafts require your review.':'Companion mode is not recorded.';
    const auth={chatgpt:'Native ChatGPT sign-in available.','needs-login':'Native ChatGPT sign-in required.','wrong-account':'The native client is not signed in with ChatGPT.',unavailable:'Native sign-in status is unavailable.',connected:'Ollama Cloud transport connected.',unknown:'Sign-in status is not checked yet.'};
    $('.companion-provider-auth').textContent=auth[provider?.auth?.state]||auth.unknown;
    const catalog={listed:'The configured model is listed. Completed requests verify access.',missing:'The configured model is not listed.',unavailable:'Model listing is unavailable.',unknown:'Model listing is not checked yet.'};
    $('.companion-provider-catalog').textContent=catalog[provider?.catalog?.state]||catalog.unknown;
    const completion=provenanceLabel(provider?.inference?.provenance);
    $('.companion-provider-inference').textContent=completion?'Last completed request: '+completion:'No completed request is recorded for this provider and model.';
    const failures={'provider-auth':'ChatGPT sign-in needs attention.','provider-limit':'The provider limit was reached.','native-unavailable':'The managed native client is unavailable.','native-protocol':'The native connection could not complete the request.','native-tool-surface':'The native tool restrictions could not be verified.','provider-model':'The native model did not match the configured model.','request-budget':'This request reached its model-call limit.','model-request':'The model request did not complete.','policy-blocked':'A change-producing response was blocked by observational mode.'};
    const error=provider?.error,message=error?.providerStatus===429?failures['provider-limit']:failures[error?.reason],providerWaiting=['waiting','failed'].includes(provider?.inference?.state);
    const retry=new Date(typeof error?.retryAt==='number'?error.retryAt*1000:NaN);
    $('.companion-provider-error').hidden=!providerWaiting||!message;
    $('.companion-provider-error').textContent=message?message+(provider?.inference?.state==='waiting'&&Number.isFinite(retry.getTime())?' Next retry: '+retry.toLocaleString()+'.':''):'';
    const cloud=!provider||provider.id==='ollama'?state?.readiness?.transport?.cloud:null;let signIn;
    try{const url=new URL(cloud?.signInUrl);if(url.protocol==='https:'&&url.hostname==='ollama.com'&&url.pathname==='/connect'&&!url.username&&!url.password)signIn=url.href;}catch{}
    $('.companion-cloud-setup').hidden=!online||cloud?.ready===true||!signIn;
    if(signIn)$('.companion-cloud-setup a').href=signIn;else $('.companion-cloud-setup a').removeAttribute('href');
    for(const control of dialog.querySelectorAll('input,textarea,button'))if(!control.closest('.knowledge-panel'))control.disabled=mutating||!online;
    $('.companion-head button').disabled=false;
    $('.companion-request button').disabled=mutating||!online||!available||state?.readiness?.ready!==true;
    const visibleWork=work.filter(item=>item.heldByPolicy!==true&&!(item.priority==='quiet'&&item.status==='complete'&&(item.phase==='digested'||item.result?.kind==='skip')));
    const list=$('.companion-work');list.replaceChildren();
    if(!visibleWork.length)list.append(make('p','No work in progress.','companion-empty'));
    for(const job of visibleWork.slice(0,20)) {
      const row=make('article',undefined,'companion-job');row.dataset.status=text(job.status);
      row.append(make('h4',text(job.title,'Companion request')),make('p',text(job.phase,text(job.status,'Waiting'))));
      if(job.result?.kind==='answer'&&typeof job.result.content==='string')row.append(make('pre',job.result.content));
      if(job.error)row.append(make('p',text(job.error),'companion-error'));
      if(job.status==='retrying'){
        const failure=job.lastFailure,reasons={'provider-auth':'Provider sign-in needs attention.','provider-limit':'The provider limit was reached.','model-request':'The model request did not complete.','dependency-import':'A managed dependency is unavailable.','invalid-json':'The model response could not be read.','invalid-result':'The model response was not usable.','result-persistence':'The result could not be saved.'};
        const reason=failure?.providerStatus===429?reasons['provider-limit']:reasons[failure?.reason];
        if(reason){const retry=new Date(typeof job.retryAt==='number'?job.retryAt*1000:NaN);row.append(make('p',reason+' Your request is saved.'+(Number.isFinite(retry.getTime())?' Next retry: '+retry.toLocaleString()+'.':''),'companion-error'));}
      }
      const events=Array.isArray(job.events)?job.events:[];
      if(events.length){const details=make('details'),summary=make('summary','Work history'),ol=make('ol');for(const event of events.slice(-12))ol.append(make('li',text(event.message,text(event.phase))));details.append(summary,ol);row.append(details);}
      list.append(row);
    }
    const reviews=$('.companion-proposals'),fingerprint=JSON.stringify([drafts,online,available,mutating,state?.generation,restricted]);
    if(reviews.dataset.fingerprint!==fingerprint) {
    for(const dispose of previews)dispose();previews.clear();
    const expanded=new Set([...reviews.querySelectorAll('article')].filter(row=>row.querySelector('details')?.open).map(row=>row.dataset.proposal));reviews.replaceChildren();reviews.dataset.fingerprint=fingerprint;
    if(!drafts.length)reviews.append(make('p','Drafts will appear here for your review.','companion-empty'));
    for(const proposal of drafts.slice(0,20)) {
      const row=make('article',undefined,'companion-proposal');row.dataset.proposal=proposal.id;row.append(make('h4',text(proposal.title,'Working draft')));
      if(proposal.summary)row.append(make('p',text(proposal.summary)));
      const details=make('details'),summary=make('summary','Review draft'),artifact=make('pre',text(proposal.content,text(proposal.artifact?.content,'Draft content is not available yet.')));
      details.append(summary,artifact);details.open=expanded.has(proposal.id);
      const checks=Array.isArray(proposal.checks)?proposal.checks:[];
      if(checks.length){const evidence=make('ul');for(const check of checks)evidence.append(make('li',`${text(check.name,'Check')}: ${text(check.status,'pending')}${check.output?' — '+text(check.output):''}`));details.append(evidence);}
      row.append(details);
      if(proposal.artifact?.kind==='app') {
        const open=make('button',proposal.requiresRestore?'Restore and check preview':'Open interactive preview','companion-preview-open'),preview=make('div',undefined,'companion-preview-host');open.type='button';open.disabled=!online||!available||mutating||restricted;
        open.onclick=async()=>{
          open.disabled=true;const current=generation;
          try{
            const result=await request({action:'preview',id:proposal.id,version:proposal.version,expectedGeneration:state.generation});
            if(current!==generation)return;
            let host=preview,control=open;
            if(result.version&&result.version!==proposal.version){
              for(let attempt=0;busy&&attempt<50;attempt++)await new Promise(resolve=>doc.defaultView.setTimeout(resolve,100));
              await poll(true);if(current!==generation)return;
              const updated=state?.proposals?.find(item=>item.id===proposal.id);
              if(updated?.version!==result.version){feedback('The restored draft was checked. Reopen its updated preview before accepting.');return;}
              const fresh=[...reviews.children].find(item=>item.dataset.proposal===proposal.id);host=fresh?.querySelector('.companion-preview-host');control=fresh?.querySelector('.companion-preview-open');
              feedback('Restored draft checks passed. Review the updated preview before accepting.');
            }
            if(!host?.isConnected)return;
            host.replaceChildren(make('p','Interactive preview. Changes here stay in this draft.','companion-empty'));
            previews.add(draftPreview(host,result.html,result.manifest,doc));if(control)control.hidden=true;
          }catch(error){if(current===generation)feedback(error.message);open.disabled=false;}
        };
        row.append(open,preview);
      }
      const actions=make('div',undefined,'companion-actions'),accept=make('button','Accept draft'),reject=make('button','Dismiss');accept.type=reject.type='button';accept.className='primary';
      accept.disabled=!online||!available||mutating||restricted||proposal.reviewable!==true;
      accept.onclick=()=>mutate({action:'accept',id:proposal.id,version:proposal.version,expectedGeneration:state.generation});
      reject.disabled=!online||!available||mutating;reject.onclick=()=>mutate({action:'reject',id:proposal.id,version:proposal.version,expectedGeneration:state.generation});actions.append(accept,reject);row.append(actions);reviews.append(row);
    }
    }
    const source=state?.knowledge;
    const sync=source?.sync;
    const syncMessage=sync?.state==='waiting'?text(sync.error,'Last available context; source syncing is waiting.'):sync?.state==='syncing'?'Checking source changes in the background.':sync?.state==='partial'?'Some sources need attention. Saved readable sources remain available.':'Changes sync in the background.';
    $('.companion-knowledge').textContent=text(source?.message,source?`${source.sourceCount??'—'} sources. ${syncMessage}`:'Knowledge status is not available yet.');
    const native=state?.directIntegrations;
    $('.companion-native').hidden=!native;$('.companion-native').textContent=text(native?.message);
    $('.companion-native-setup').hidden=!native;$('.companion-native-setup').disabled=!online||!available||mutating;
    $('.companion-coding-status').textContent=text(state?.codingTeam?.message,'Choose an existing coding teammate to help with app work.');
    $('.companion-coding-load').disabled=!online||!available||mutating||restricted;
    $('.companion-coding-save').disabled=!online||!available||mutating||restricted||!codingTargets[$('.companion-coding-target').value];
    $('.companion-coding-clear').disabled=!online||!available||mutating||restricted||!state?.codingTeam?.target;
    const signal=state?.signal;
    const expired=signal?.pairingState==='expired'||(typeof signal?.expiresAt==='string'&&Date.parse(signal.expiresAt)<=Date.now());
    const waiting=!expired&&!signal?.linked&&(['creating','waiting'].includes(signal?.pairingState)||Date.now()<pairingPendingUntil);
    $('.companion-signal').textContent=expired?'The Signal code expired. Create a new code to link your phone.':text(signal?.message,signal?.linked?'Linked to your private Note to Self.':'Link your existing Signal account to receive updates and reply privately.');
    $('.companion-link').hidden=signal?.linked===true;
    $('.companion-link').disabled=mutating||!online||!available||waiting;
    $('.companion-link').textContent=expired?'Create new Signal code':'Link Signal';
    const pairing=$('.companion-pairing'),svg=text(signal?.qr).trim().replace(/^<\?xml[^?]*\?>\s*/,''),qr=!expired&&!signal?.linked&&svg.startsWith('<svg')&&svg.length<=256000?svg:'';
    if(pairing.dataset.qr!==qr){pairing.dataset.qr=qr;pairing.replaceChildren();if(qr){const image=doc.createElement('img');image.alt='Scan this QR code from Signal on your phone to link Spider';image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(qr);pairing.append(image);}}
    knowledgePanel.update({online:online&&available,workspaceId,generation:state?.generation});
    renderHistory();
  }
  async function poll(force=false) {
    if(!online||busy||!workspaceId||(!force&&Date.now()-lastPoll<2500))return;
    busy=true;lastPoll=Date.now();const current=generation;
    try {const result=await request({action:'status'});if(current===generation){const changed=JSON.stringify(state)!==JSON.stringify(result)||!available;state=result;available=true;statusError='';if(historyPage&&historyPage.generation!==state.generation){historyPage=null;historyBefore=null;}if(changed)render();if(!historyBefore)await loadHistory();}}
    catch(error){if(current===generation){available=false;statusError=error.message;render();button.dataset.working='false';}}
    finally{busy=false;if(pending){const run=pending;pending=null;run();}}
  }
  async function mutate(body) {
    if(mutating||!online||!available)return;
    mutating=true;const current=generation;feedback('');render();
    try {
      const result=await request(body);if(current!==generation)return;
      if(body.action==='signal-link') {
        pairingPendingUntil=result.linked?0:Date.now()+8000;state={...state,signal:{...state?.signal,...result}};render();
      } else if(body.action==='task'||body.action==='terminal-input'){$('#companion-prompt').value='';terminalPending=null;historyBefore=null;feedback('Request saved. Hermes progress appears below.');}
      else feedback(body.action==='accept'?'Draft accepted.':body.action==='reject'?'Draft dismissed.':'Updated.');
    }catch(error){if(current===generation)feedback(error.message);}
    finally{mutating=false;render();await poll(true);}
  }
  button.onclick=()=>{if(!dialog.open)dialog.showModal();if(busy)pending=()=>poll(true);else poll(true);};
  $('.companion-head button').onclick=()=>dialog.close();
  dialog.addEventListener('click',event=>{if(event.target===dialog&&event.clientX<dialog.getBoundingClientRect().left)dialog.close();});
  $('.companion-request').onsubmit=event=>{event.preventDefault();const prompt=$('#companion-prompt').value.trim();if(!prompt||!online||!available||mutating)return;if(new TextEncoder().encode(prompt).length>32000){feedback('Keep your request within 32,000 UTF-8 bytes.');return;}if(!terminalPending||terminalPending.prompt!==prompt)terminalPending={id:crypto.randomUUID(),prompt};mutate({action:'terminal-input',...terminalPending,expectedGeneration:state.generation});};
  $('#companion-prompt').onkeydown=event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();$('.companion-request').requestSubmit();}};
  $('.companion-history-older').onclick=()=>loadHistory(historyPage?.nextCursor);
  $('.companion-history-latest').onclick=()=>loadHistory();
  $('.companion-link').onclick=()=>mutate({action:'signal-link'});
  $('.companion-native-setup').onclick=()=>mutate({action:'direct-setup',expectedGeneration:state.generation});
  $('.companion-coding-target').onchange=()=>render();
  $('.companion-coding-load').onclick=async()=>{
    if(mutating||!online||!available)return;mutating=true;render();const current=generation;
    try{
      const result=await request({action:'coding-targets'});if(current!==generation)return;
      codingTargets=Array.isArray(result.targets)?result.targets.slice(0,100):[];
      const select=$('.companion-coding-target');select.replaceChildren();const placeholder=make('option',codingTargets.length?'Choose a teammate':'No coding team is available');placeholder.value='';select.append(placeholder);
      for(const [index,target]of codingTargets.entries()){const option=make('option',`${text(target.rigName,'Coding team')} · ${text(target.logicalId,text(target.session,'Teammate'))}`);option.value=String(index);option.selected=target.rigId===result.selected?.rigId&&target.session===result.selected?.session;select.append(option);}
      $('.companion-coding-form').hidden=false;if(!codingTargets.length)feedback('Open your coding team in Spider, then check again.');
    }catch(error){if(current===generation)feedback(error.message);}
    finally{mutating=false;render();}
  };
  $('.companion-coding-form').onsubmit=event=>{event.preventDefault();const target=codingTargets[$('.companion-coding-target').value];if(target)mutate({action:'coding-team',rigId:target.rigId,session:target.session,expectedGeneration:state.generation});};
  $('.companion-coding-clear').onclick=()=>mutate({action:'coding-team',clear:true,expectedGeneration:state.generation});
  $('.companion-sync').onclick=async()=>{if(mutating||!online||!available)return;const current=generation;try{await request({action:'sync',expectedGeneration:state.generation});if(current===generation)feedback('Checking for source changes in the background.');await poll(true);}catch(error){if(current===generation)feedback(error.message);}};
  render();
  return {
    update(next){
      const changed=workspaceId!==next.workspaceId,connectionChanged=online!==next.online;
      if(changed||connectionChanged)generation++;
      if(changed){state=null;available=false;statusError='';historyPage=null;historyBefore=null;historyError='';terminalPending=null;pairingPendingUntil=0;codingTargets=[];$('.companion-coding-form').hidden=true;$('.companion-coding-target').replaceChildren();feedback('');$('.companion-pairing').replaceChildren();lastPoll=0;}
      online=next.online;workspaceId=next.workspaceId;if(changed||connectionChanged)render();
      if(busy&&changed)pending=()=>poll(true);else poll();
    },
    destroy(){generation++;knowledgePanel.destroy();for(const dispose of previews)dispose();previews.clear();dialog.remove();button.onclick=null;},
  };
}
