const string=(value,fallback='')=>typeof value==='string'?value:fallback;
const rows=value=>Array.isArray(value)?value:[];
const kind=value=>({apple_note:'Apple Note',conversation_message:'Conversation',source_code:'Repository file',user_correction:'Your correction',app_state:'Saved app work',decision:'Decision',correction:'Correction',preference:'Preference',interpretation:'Interpretation'}[value]||string(value,'Source'));
const stamp=value=>{const date=new Date(value);return Number.isFinite(date.valueOf())?date.toLocaleString():string(value,'Not recorded');};

// The parent provides the existing declared context and companion capabilities.
// This module never chooses an endpoint or receives a device credential.
export function createKnowledgePanel({container,read,request,document:doc=document,onChange=()=>{},download}) {
  const make=(tag,text,className)=>{const node=doc.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
  const root=make('details',undefined,'knowledge-panel'),summary=make('summary','Sources and preferences');
  const intro=make('p','Inspect saved evidence and the interpretations your companion has made.','knowledge-muted');
  const feedback=make('p','', 'knowledge-feedback');feedback.setAttribute('role','status');feedback.hidden=true;
  const tabs=make('div',undefined,'knowledge-tabs'),sourceTab=make('button','Sources'),memoryTab=make('button','Preferences');
  const tools=make('div',undefined,'knowledge-tools'),refresh=make('button','Refresh'),exportButton=make('button','Export knowledge');
  const sourcePane=make('div',undefined,'knowledge-sources'),memoryPane=make('div',undefined,'knowledge-memories');
  const search=make('form',undefined,'knowledge-search'),searchLabel=make('label','Find a saved source'),query=make('input'),searchButton=make('button','Search');
  query.type='search';query.placeholder='Words, a note title, or a project';query.maxLength=500;searchLabel.append(query);searchButton.type='submit';search.append(searchLabel,searchButton);
  const sourceCount=make('p','', 'knowledge-muted'),sourceList=make('div',undefined,'knowledge-source-list'),more=make('button','Show more sources'),sourceDetail=make('div',undefined,'knowledge-source-detail');
  sourcePane.append(search,sourceCount,sourceList,more,sourceDetail);
  const memoryCount=make('p','', 'knowledge-muted'),memoryList=make('div');memoryPane.append(memoryCount,memoryList);
  const portable=make('details',undefined,'knowledge-portable'),portableTitle=make('summary','Import saved knowledge'),fileLabel=make('label','Choose a Spider knowledge archive'),file=make('input'),importReview=make('div');
  file.type='file';file.accept='.json,application/json';fileLabel.append(file);portable.append(portableTitle,make('p','Import replaces Spider’s saved knowledge. App source state and browser pairing stay separate.','knowledge-muted'),fileLabel,importReview);
  tabs.append(sourceTab,memoryTab);tools.append(refresh,exportButton);root.append(summary,intro,tabs,feedback,tools,sourcePane,memoryPane,portable);container.append(root);
  let online=false,workspace=null,knowledgeGeneration=null,externalGeneration=null,epoch=0,busy=false,destroyed=false,loaded=false,tab='sources';
  let sources=[],total=0,offset=0,memories=[],memoryLimit=100,selected=null,history=[],historyTotal=0,confirmForget=false,fullText=false,pendingArchive=null;
  const remote=node=>{node.dataset.knowledgeRemote='true';return node;};
  for(const control of [refresh,exportButton,searchButton,file,more])remote(control);
  for(const button of [sourceTab,memoryTab,refresh,exportButton,more])button.type='button';
  tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Inspect shared knowledge');
  for(const button of [sourceTab,memoryTab])button.setAttribute('role','tab');
  const say=(text,error=false)=>{feedback.textContent=text;feedback.hidden=!text;feedback.dataset.error=String(error);};
  function disable(){for(const node of root.querySelectorAll('[data-knowledge-remote]'))node.disabled=busy||!online;root.setAttribute('aria-busy',String(busy));}
  function switchPane(next){tab=next;sourcePane.hidden=tab!=='sources';memoryPane.hidden=tab!=='memories';sourceTab.setAttribute('aria-selected',String(tab==='sources'));memoryTab.setAttribute('aria-selected',String(tab==='memories'));}
  async function operate(action,done) {
    if(busy||!online||destroyed)return;
    busy=true;disable();const version=epoch;say('');
    try {const result=await action();if(version===epoch&&!destroyed)done?.(result);}
    catch(error){if(version===epoch&&!destroyed)say(string(error?.message,'Knowledge is unavailable. Reconnect to your Mac and refresh.'),true);}
    finally{if(version===epoch&&!destroyed){busy=false;disable();}}
  }
  const metadata=(parent,items)=>{const dl=make('dl',undefined,'knowledge-provenance');for(const [name,value] of items){if(value===undefined||value===null||value==='')continue;dl.append(make('dt',name),make('dd',String(value)));}parent.append(dl);};
  function renderSources(){
    sourceList.replaceChildren();sourceCount.textContent=query.value.trim()?`${sources.length} matching saved sources`:`${sources.length} of ${total} saved sources`;
    if(!sources.length)sourceList.append(make('p',query.value.trim()?'No matching saved sources. Try another word.':'Saved sources will appear after Spider checks for changes.','knowledge-muted'));
    for(const source of sources){
      const button=remote(make('button',undefined,'knowledge-source'));button.type='button';
      button.append(make('span',string(source.label,source.id)),make('small',`${kind(source.kind)}${source.status&&source.status!=='current'?' · '+(source.status==='deleted'?'No longer in source':'Unreadable'):''}`));
      button.onclick=()=>openSource(source.id,undefined,source);sourceList.append(button);
    }
    more.hidden=!!query.value.trim()||offset>=total;disable();
  }
  function renderDetail(){
    sourceDetail.replaceChildren();if(!selected)return;
    sourceDetail.append(make('h4',string(selected.label,'Saved source')));
    if(selected.forgotten){
      sourceDetail.append(make('p','Forgotten from Spider. Its retained copies and dependent memory were removed.'));
      const reconnect=remote(make('button','Reconnect this source'));reconnect.type='button';reconnect.onclick=()=>mutate({action:'knowledge-reconnect',sourceId:selected.id},()=>{say('Source reconnected. It can return on the next check for changes.');selected=null;renderDetail();});sourceDetail.append(reconnect);disable();return;
    }
    sourceDetail.append(make('p',selected.current===false?'Historical saved version':'Current when opened', 'knowledge-currentness'));
    const body=string(selected.text),excerpt=make('pre',fullText?body:body.slice(0,20000));sourceDetail.append(excerpt);
    if(!fullText&&body.length>20000){const expand=make('button','Show the complete saved source');expand.type='button';expand.onclick=()=>{fullText=true;renderDetail();};sourceDetail.append(make('p','Showing the first 20,000 characters.','knowledge-muted'),expand);}
    const details=make('details'),title=make('summary','Source and provenance');details.append(title);
    metadata(details,[['Type',kind(selected.kind)],['Source',selected.id],['Revision',selected.revision],['Content hash',selected.hash],['Source modified',selected.modifiedAt?stamp(selected.modifiedAt):null],['Saved',selected.observedAt?stamp(selected.observedAt):null],['Folder',selected.metadata?.folder],['Account',selected.metadata?.account],['Project',selected.metadata?.project],['Conversation',selected.metadata?.sessionId],['Original reference',selected.metadata?.nativeId]]);sourceDetail.append(details);
    const versions=make('details'),versionsTitle=make('summary',`Saved history (${historyTotal})`);versions.append(versionsTitle);
    for(const revision of history){const button=remote(make('button',`${stamp(revision.modifiedAt||revision.observedAt)}${revision.revision===selected.revision?' — shown':''}`));button.type='button';button.onclick=()=>openSource(selected.id,revision.revision);versions.append(button);}
    if(history.length<historyTotal){const next=remote(make('button','Show older versions'));next.type='button';next.onclick=()=>operate(()=>read({action:'history',sourceId:selected.id,offset:history.length}),result=>{history.push(...rows(result.revisions));renderDetail();});versions.append(next);}
    sourceDetail.append(versions);
    if(!confirmForget){const forget=remote(make('button','Forget saved source','knowledge-forget'));forget.type='button';forget.onclick=()=>{confirmForget=true;renderDetail();};sourceDetail.append(forget);}
    else{
      const confirmation=make('div',undefined,'knowledge-confirmation');confirmation.append(make('p','Remove this source’s saved copies and the memory derived from them? The original source stays where it is.'));
      const forget=remote(make('button','Forget saved source')),keep=make('button','Keep source');forget.type=keep.type='button';
      forget.onclick=()=>{const old={id:selected.id,label:selected.label};mutate({action:'knowledge-forget',sourceId:old.id},()=>{selected={...old,forgotten:true};history=[];confirmForget=false;sources=sources.filter(s=>s.id!==old.id);memories=[];renderSources();renderMemories();renderDetail();say('Saved source forgotten.');});};keep.onclick=()=>{confirmForget=false;renderDetail();};confirmation.append(forget,keep);sourceDetail.append(confirmation);
    }
    disable();
  }
  async function openSource(id,revision,summary={}){
    await operate(()=>Promise.all([read({action:'read',sourceId:id,...(revision?{revision}:{})}),read({action:'history',sourceId:id})]),([source,versions])=>{selected={...summary,...source};history=rows(versions.revisions);historyTotal=Number(versions.total??history.length);fullText=false;confirmForget=false;switchPane('sources');renderDetail();});
  }
  function renderMemories(){
    memoryList.replaceChildren();memoryCount.textContent=`${memories.length} saved interpretations and decisions`;
    if(!memories.length)memoryList.append(make('p','No learned preferences yet. Interpretations will stay tentative until you confirm or correct them.','knowledge-muted'));
    for(const memory of memories.slice(0,memoryLimit)){
      const entry=make('article',undefined,'knowledge-memory');
      const confidence=memory.confidence==='accepted'?'Confirmed by you':'Tentative';
      entry.append(make('h4',kind(memory.kind)),make('p',`${confidence}${memory.status&&memory.status!=='current'?' · '+(memory.status==='superseded'?'Superseded':'Historical'):''}`,'knowledge-confidence'),make('p',string(memory.text)));
      const refs=make('div',undefined,'knowledge-citations');for(const reference of rows(memory.sources)){const button=remote(make('button','View source'));button.type='button';button.onclick=()=>openSource(reference.id,reference.revision);refs.append(button);}entry.append(refs);
      if(memory.status==='current'&&memory.confidence!=='accepted'){const accept=remote(make('button','Confirm this memory'));accept.type='button';accept.onclick=()=>mutate({action:'memory-accept',id:memory.id},()=>{memory.confidence='accepted';renderMemories();say('Memory confirmed.');});entry.append(accept);}
      const correction=make('details'),heading=make('summary','Correct this memory'),form=make('form'),label=make('label','Your correction'),input=make('textarea'),save=remote(make('button','Save correction'));
      input.rows=3;input.maxLength=4096;input.required=true;input.value=string(memory.text);save.type='submit';label.append(input);form.append(label,save);
      form.onsubmit=event=>{event.preventDefault();const text=input.value.trim();if(!text||text===memory.text){say('Edit the memory before saving a correction.');return;}mutate({action:'memory-correct',id:memory.id,text,requestId:doc.defaultView.crypto.randomUUID()},result=>{memory.status='superseded';if(result?.id)memories.unshift(result);renderMemories();say('Your correction is saved and confirmed.');});};correction.append(heading,form);entry.append(correction);memoryList.append(entry);
    }
    if(memoryLimit<memories.length){const next=make('button','Show more memories');next.type='button';next.onclick=()=>{memoryLimit+=100;renderMemories();};memoryList.append(next);}disable();
  }
  async function load(append=false){
    const activeTab=tab;
    await operate(async()=>{const [status,result]=await Promise.all([read({action:'status'}),read(activeTab==='memories'?{action:'memories'}:query.value.trim()?{action:'search',query:query.value.trim(),limit:100}:{action:'list',includeHistory:true,offset:append?offset:0})]);return {status,result};},({status,result})=>{
      knowledgeGeneration=status.generation;loaded=true;
      if(activeTab==='memories'){memories=rows(result.memories);renderMemories();}
      else{const unique=new Map((append?sources:[]).map(s=>[s.id,s]));for(const source of rows(result.sources))unique.set(source.id,source);sources=[...unique.values()];offset=(append?offset:0)+rows(result.sources).length;total=Number(result.total??sources.length);renderSources();}
    });
  }
  async function mutate(body,done){
    await operate(async()=>{const result=await request({...body,expectedGeneration:knowledgeGeneration});let status;try{status=await read({action:'status'});}catch{}return {result,status};},({result,status})=>{knowledgeGeneration=status?.generation||result?.generation||knowledgeGeneration;done?.(result);onChange();});
  }
  function renderImport(){
    importReview.replaceChildren();if(!pendingArchive)return;
    const selectedFile=pendingArchive;importReview.append(make('p',`${selectedFile.name}: ${rows(selectedFile.value.sources).length} saved sources and ${rows(selectedFile.value.revisions).length} source versions. Replace the saved knowledge currently in Spider?`));
    const replace=remote(make('button','Replace saved knowledge')),cancel=make('button','Keep current knowledge');replace.type=cancel.type='button';
    replace.onclick=()=>mutate({action:'knowledge-import',archive:selectedFile.value},()=>{pendingArchive=null;file.value='';sources=[];memories=[];selected=null;history=[];loaded=false;renderImport();renderSources();renderMemories();renderDetail();say('Saved knowledge imported. Refresh to inspect it.');});cancel.onclick=()=>{pendingArchive=null;file.value='';renderImport();};importReview.append(replace,cancel);disable();
  }
  file.onchange=()=>{
    const selectedFile=file.files?.[0];if(!selectedFile)return;
    operate(async()=>{if(selectedFile.size>512*1024*1024)throw Error('Choose a knowledge archive up to 512 MiB.');const value=JSON.parse(await selectedFile.text());if(value.format!=='spider.knowledge'||value.version!==1||!Array.isArray(value.sources)||!Array.isArray(value.revisions))throw Error('Choose a Spider knowledge archive. App source state uses its own import.');return {name:selectedFile.name,value};},result=>{pendingArchive=result;renderImport();});
  };
  exportButton.onclick=()=>operate(()=>read({action:'export'}),archive=>{
    const content=JSON.stringify(archive,null,2);if(download){download({name:'spider-knowledge.json',content});say('Knowledge archive prepared.');return;}
    const view=doc.defaultView,url=view.URL.createObjectURL(new view.Blob([content],{type:'application/json'})),link=make('a');link.href=url;link.download='spider-knowledge.json';root.append(link);link.click();link.remove();view.setTimeout(()=>view.URL.revokeObjectURL(url),1000);say('Knowledge archive downloaded.');
  });
  sourceTab.onclick=()=>{switchPane('sources');load();};memoryTab.onclick=()=>{switchPane('memories');load();};refresh.onclick=()=>load();more.onclick=()=>load(true);search.onsubmit=event=>{event.preventDefault();load();};root.addEventListener('toggle',()=>{if(root.open&&!loaded)load();});switchPane('sources');disable();
  return {
    update(next){
      const workspaceChanged=workspace!==next.workspaceId,connectionChanged=online!==!!next.online;
      const generationChanged=typeof next.generation==='string'&&externalGeneration!==null&&next.generation!==externalGeneration&&next.generation!==knowledgeGeneration;
      if(workspaceChanged||connectionChanged||generationChanged){epoch++;busy=false;}
      if(workspaceChanged||generationChanged){sources=[];memories=[];selected=null;history=[];pendingArchive=null;knowledgeGeneration=null;loaded=false;offset=0;total=0;query.value='';file.value='';say('');renderSources();renderDetail();renderMemories();renderImport();}
      if(typeof next.generation==='string')externalGeneration=next.generation;
      workspace=next.workspaceId;online=!!next.online;disable();if(!online)say('Mac unreachable. Reconnect before changing saved knowledge.');else if(root.open&&!loaded)load();
    },
    destroy(){destroyed=true;epoch++;sources=[];memories=[];selected=null;pendingArchive=null;root.remove();},
  };
}
