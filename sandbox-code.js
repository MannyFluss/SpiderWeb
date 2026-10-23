export const SANDBOX_ID='spider.playground';
const HASH=/^[a-f0-9]{64}$/;
export function sandboxVersion(value){
 if(!value||!HASH.test(value.bundleHash)||!Number.isSafeInteger(value.epoch)||value.epoch<0)throw Error('Sandbox version is unavailable. Reconnect and reopen Sandbox.');
 return {bundleHash:value.bundleHash,epoch:value.epoch};
}
export function sameSandboxVersion(a,b){return !!a&&!!b&&a.bundleHash===b.bundleHash&&a.epoch===b.epoch;}
export function sandboxWriteVersion(context,current){
 if(context.appId!==SANDBOX_ID)return undefined;
 if(context.sandboxVersion==null&&current==null)return undefined;
 const loaded=sandboxVersion(context.sandboxVersion),latest=sandboxVersion(current);
 if(context.sandboxReadonly||!sameSandboxVersion(loaded,latest)||current.busy)throw Error('Sandbox code or state changed. Reopen Sandbox before editing. Unsent changes remain available for export.');
 return loaded;
}
export function quarantineSandboxEdits(local,current){
 if(!current)return 0;
 const latest=sandboxVersion(current),kept=[],moved=[];
 for(const op of local.pending||[]){
  if(op.appId===SANDBOX_ID&&!sameSandboxVersion(op.sandboxVersion,latest))moved.push({...op,recoveryReason:'sandbox-version-changed'});
  else kept.push(op);
 }
 if(moved.length){
  const known=new Set([...(local.recoveredChanges||[]),...(local.conflicts||[])].map(op=>op.id));
  local.recoveredChanges||=[];for(const op of moved)if(!known.has(op.id)){local.recoveredChanges.push(op);known.add(op.id);}
  local.pending=kept;
 }
 return moved.length;
}
async function sha(bytes){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');}
function checkedMetadata(raw,workspaceId){
 if(raw?.targetId!==SANDBOX_ID||raw.workspaceId!==workspaceId||raw.available===false||raw.busy)throw Error('Sandbox is unavailable or recovering. Reconnect after recovery.');
 return {...sandboxVersion(raw),workspaceId};
}
export function createSandboxLoader({metadata,bundle,cache,maxBytes=16*1024*1024}){
 async function verify(record,scope,expected){
  if(!record||record.scope!==scope||record.targetId!==SANDBOX_ID||typeof record.html!=='string')throw Error('Verified Sandbox code is not saved for this Mac/workspace.');
  const version=sandboxVersion(record),bytes=new TextEncoder().encode(record.html);
  if(bytes.length>maxBytes||await sha(bytes)!==version.bundleHash||(expected&&!sameSandboxVersion(version,expected)))throw Error('Saved Sandbox bundle failed its integrity check.');
  return record;
 }
 async function offline(scope,reason){
  const pointer=await cache?.get(scope+':last');
  if(!pointer)throw Error('Reconnect to the Mac to load a verified Sandbox version for the first time.');
  const record=await verify(await cache?.get(scope+':'+pointer.epoch+':'+pointer.bundleHash),scope,pointer);
  return {html:record.html,version:sandboxVersion(record),readonly:true,status:'cached-offline',message:reason||'Last verified Sandbox code · reconnect and reopen to edit.'};
 }
 return {async load({workspaceId,runtime,online}){
  if(!workspaceId||!runtime)throw Error('Connect to the Sandbox Mac first.');
  const scope=encodeURIComponent(runtime)+':'+encodeURIComponent(workspaceId);
  if(!online)return offline(scope);
  let raw;
  try{raw=await metadata();}catch(error){if(error.status===401||error.status===403||error.kind==='access')throw error;return offline(scope,'Current Sandbox version could not be confirmed. Last verified code is read-only.');}
  const version=checkedMetadata(raw,workspaceId);
  const response=await bundle(version.bundleHash);
  if(!response||response.redirected||response.type==='opaqueredirect'||!response.ok)throw Error('Current Sandbox bundle could not be verified. Reconnect and reopen.');
  const length=Number(response.headers.get('Content-Length'));if(Number.isFinite(length)&&length>maxBytes)throw Error('Sandbox bundle exceeds the limit.');
  const bytes=await response.arrayBuffer();if(bytes.byteLength>maxBytes||await sha(bytes)!==version.bundleHash)throw Error('Current Sandbox bundle hash mismatch. No code was opened.');
  let html;try{html=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw Error('Sandbox bundle is not valid UTF-8.');}
  const record={scope,targetId:SANDBOX_ID,...version,html};
  if(cache){try{await cache.put(scope+':'+version.epoch+':'+version.bundleHash,record);await cache.put(scope+':last',version);}catch{}}
  return {html,version:sandboxVersion(version),readonly:false,status:'current',message:''};
 }};
}
