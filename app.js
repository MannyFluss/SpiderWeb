import {createHermesReader} from './hermes-reader.js';
import {diagnostics,installDiagnostics,createDiagnosticsApp} from './diagnostics.js';
import {createReliabilityMonitor} from './reliability-monitor.js';
installDiagnostics();
const diagnosticsApp=createDiagnosticsApp();
import {downloadSpec,p5ReferenceUrl} from "./download.js";
import { portableView } from "./export.js";
import { uid } from "./sdk.js";
import { createDesktop } from "./desktop.js";
import { createLauncher } from "./launcher.js";
import { clientStorage } from "./client-storage.js";
import { siteConfig } from "./site-config.js";
import {createCompanion} from "./companion-ui.js";
import {SANDBOX_ID,createSandboxLoader,sandboxVersion,sameSandboxVersion,sandboxWriteVersion,quarantineSandboxEdits} from "./sandbox-code.js";
import {
  normalizeNode,
  clientInfo,
  requestNode,
  connectionMessage,
  checkConnection,
} from "./connection.js";
const fragment = new URLSearchParams(location.hash.slice(1));
const hosted = document.documentElement.dataset.hosting === "static";
let nodeBase = hosted
  ? localStorage.getItem("spider.node") || siteConfig.runtimeUrl || ""
  : location.origin;
try {
  if (fragment.has("node")) nodeBase = normalizeNode(fragment.get("node"));
} catch {}
try {if (nodeBase) localStorage.setItem("spider.node", nodeBase);} catch {}
const trustKey = () => "spider.trust:" + nodeBase;
let deviceToken = hosted ? localStorage.getItem(trustKey()) : null;
const accessRequired = hosted && siteConfig.access && nodeBase === siteConfig.runtimeUrl;
let accessPaused = false, accessError = null, accessWindow = null;
const ownClient = clientInfo(navigator);
const $ = (s) => document.querySelector(s),
  APP = "spider.frontend",
  ports = new Map(),
  contexts = new Map(),
  terminalConnections = new Map();
let flushWaiters = [];
let snapshot = null,
  clientId = null,
  apps = [],
  online = false,
  flushing = false,
  report = null,
  invite = null,
  session = uid(),
  polling = false,
  rendered = false;
let instanceId;
try {
  instanceId = sessionStorage.getItem("spider.instance") || uid();
  sessionStorage.setItem("spider.instance", instanceId);
} catch {
  instanceId = uid();
}
const cacheKey = "spider.client.v1:" + instanceId + ":" + nodeBase;
let journal;
try {journal=await clientStorage({key:cacheKey,nodeBase});}
catch {journal={local:{pending:[],conflicts:[],views:[],recoveredChanges:[]},save:async()=>{throw Error('Browser cannot save unsent edits');},kind:'unavailable'};}
let local=journal.local;
clientId = local.clientId;
let endpoints={};
async function companionService(service,args) {
  if(!online||!snapshot||!clientId)throw Error('Reconnect to your Mac to use the companion.');
  if(!apps.find(app=>app.id===APP)?.services?.includes(service))throw Error('This service is not available to Spider.');
  const workspaceId=snapshot.id,sessionId=clientId;
  const result=await api('/api/service/'+service,{...args,appId:APP,sessionId,workspaceId});
  if(snapshot?.id!==workspaceId||clientId!==sessionId)throw Error('Workspace changed during this request.');
  return result;
}
const companion=createCompanion({button:$('#companion-toggle'),request:args=>companionService('companion',args),knowledge:args=>companionService('context',args)});
createHermesReader({button:$('#hermes-reader-toggle'),request:args=>companionService('companion',args),scope:()=>nodeBase+':'+(snapshot?.id||'')});
const reliabilityMonitor=createReliabilityMonitor({log:diagnostics,storage:globalThis.localStorage,scope:()=>nodeBase+':'+(snapshot?.id||''),ready:()=>online&&!!snapshot&&!accessPaused,send:report=>companionService('companion',{action:'reliability-report',report})});
setInterval(()=>{void reliabilityMonitor.tick();},15000);
const launcher=createLauncher({dialog:$('#app-dialog'),input:$('#app-search'),results:$('#app-results'),onLaunch:openApp});
const desktop = createDesktop({
  container: $("#mounts"),
  onChange: saveLayout,
  onCamera: (camera,options) => {
    local.camera=camera;
    persist();
    if(clientId && snapshot)write(APP,clientId,["camera"],camera,options).catch(e=>notice(e.message));
  },
  onState: broadcast,
  onFocus: id => ports.get(id)?.postMessage({type:"focus"}),
});
function rootMount(ctx) {
  while (ctx.parentId && contexts.has(ctx.parentId)) ctx = contexts.get(ctx.parentId);
  return ctx.mountId;
}
async function persist() {
  try {
    local.nodeBase = nodeBase;
    local.clientId = clientId;
    await journal.save(local);
  } catch {
    notice(
      "Unsent edits could not be saved on this browser. Keep this page open until they sync, or export source state in Settings.",
    );
  }
}
function notice(message) {
  $("#notice").textContent = message;
  $("#notice").hidden = !message;
}
async function api(path, body, method, options = {}) {
  // Only a read-only workspace probe may bypass an expired Access latch.
  // Never retry a mutation whose outcome could be unknown.
  const accessProbe = options.accessProbe === true && path === '/api/state' && !body && (!method || method === 'GET');
  if (accessPaused && !accessProbe) throw accessError || Error("Sign into Cloudflare Access to continue.");
  try {const result = await requestNode(nodeBase, path, {
    body,
    method,
    hosted,
    access: accessRequired,
    token: deviceToken,
    timeoutMs: options.timeoutMs ?? 8000,
  });
    if (accessProbe) {
      accessPaused = false; accessError = null;
      $('#access-status').textContent = 'Cloudflare Access connected.';
    }
    return result;
  } catch(error) {
    if (accessRequired && error.kind === "access") {
      accessPaused = true; accessError = error;
      for (const entry of terminalConnections.values()) entry.close();
      $("#access-status").textContent = connectionMessage(error);
      if (snapshot) notice(connectionMessage(error)+" Unsent edits remain saved in this browser.");
    }
    throw error;
  }
}
function currentSandboxVersion(){return snapshot?.apps?.[SANDBOX_ID]?.sandbox;}
const sandboxCodeCache={
 async get(key){try{const c=await caches.open('spider-sandbox-verified-v1'),r=await c.match(new URL('/__spider_sandbox_cache/'+encodeURIComponent(key),location.origin).href);return r?await r.json():undefined;}catch{}},
 async put(key,value){const c=await caches.open('spider-sandbox-verified-v1');await c.put(new URL('/__spider_sandbox_cache/'+encodeURIComponent(key),location.origin).href,new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}}));}
};
const sandboxLoader=createSandboxLoader({
 metadata:()=>api('/api/sandbox/version'),
 bundle:hash=>fetch(nodeBase+'/api/sandbox/bundle/'+hash,{credentials:hosted?'include':'same-origin',...(hosted?{redirect:'manual'}:{}),cache:'no-store',headers:deviceToken?{Authorization:'Spider '+deviceToken}:{},signal:AbortSignal.timeout(15000)}),
 cache:sandboxCodeCache
});
function updateSandboxViews(){
 for(const c of contexts.values()){
  if(c.appId!==SANDBOX_ID||!c.sandboxVersion)continue;
  const stale=c.sandboxReadonly||!sameSandboxVersion(c.sandboxVersion,currentSandboxVersion());
  const panel=document.querySelector('[data-mount="'+c.mountId+'"]'),reload=panel?.querySelector('.sandbox-reload');
  if(reload){reload.hidden=!stale;reload.title=stale?'The old view is read-only. Reopen to use matching code and state.':'';}
 }
}
const versionKey = (app, sid, path) =>
  [app, sid, ...path]
    .map((s) => s.replaceAll("~", "~0").replaceAll("/", "~1"))
    .join("/");
function targetVersion(key) {
  return Math.max(
    0,
    ...Object.entries(snapshot?.versions || {})
      .filter(
        ([k]) =>
          k === key || k.startsWith(key + "/") || key.startsWith(k + "/"),
      )
      .map(([, v]) => v),
  );
}
function setPath(root, path, value) {
  let p = root;
  for (const key of path.slice(0, -1)) {
    if (!p[key] || typeof p[key] !== "object") p[key] = {};
    p = p[key];
  }
  p[path.at(-1)] = structuredClone(value);
}
function projected(app, sid) {
  const data = structuredClone(
    snapshot?.apps?.[app]?.sessions?.[sid]?.data || {},
  );
  for (const op of local.pending) {
    if (
      op.workspaceId === snapshot?.id &&
      op.appId === app &&
      op.sessionId === sid
    )
      setPath(data, op.path, op.value);
  }
  return data;
}
function contextState(ctx) {
  const stale=ctx.appId===SANDBOX_ID&&ctx.sandboxVersion&&!sameSandboxVersion(ctx.sandboxVersion,currentSandboxVersion());
  const scopedData=stale||ctx.sandboxReadonly?structuredClone(ctx.lastSandboxData||{}):projected(ctx.appId,ctx.sessionId);
  if(ctx.appId===SANDBOX_ID&&!stale&&!ctx.sandboxReadonly)ctx.lastSandboxData=structuredClone(scopedData);
  return {
    workspaceId: snapshot?.id,
    appId: ctx.appId,
    sessionId: ctx.sessionId,
    data: scopedData,
    online: online&&!stale&&!ctx.sandboxReadonly,
    sandboxVersion:ctx.appId===SANDBOX_ID?ctx.sandboxVersion:undefined,
    sandboxReadOnly:stale||!!ctx.sandboxReadonly,
    connectionStatus: stale||ctx.sandboxReadonly ? 'update-required' : accessPaused ? 'sign-in-required' : online ? 'connected' : 'reconnecting',
    connectionMessage: stale||ctx.sandboxReadonly ? 'Update available. This view is read-only; preserve your writing, then reopen Sandbox.' : accessPaused ? 'Sign-in required. Saved edits are retained.' : online ? 'Connected to Mac' : 'Reconnecting to Mac. Saved edits are retained.',
    revision: snapshot?.revision || 0,
    window: desktop.state(rootMount(ctx)),
    jobs: Object.fromEntries(
      Object.entries(snapshot?.jobs || {}).filter(
        ([, j]) => j.appId === ctx.appId && j.sessionId === ctx.sessionId,
      ),
    ),
    connections:
      ctx.appId === "spider.connections"
        ? {
            ...report,
            directory: projected("spider.connections", "directory"),
            authority: {
              ...report?.authority,
              name:
                projected("spider.connections", "directory").names?.authority ||
                report?.authority?.name,
            },
            devices: (report?.devices || []).map((d) => ({
              ...d,
              label:
                projected("spider.connections", "directory").names?.[d.id] ||
                d.label,
            })),
            local: {
              pending: local.pending.length,
              conflicts: local.conflicts.length,
              online,
              revision: snapshot?.revision,
              clientId,
              instanceId,
            },
          }
        : undefined,
  };
}
let lastDiagnosticState='';
function broadcast() {
  const diagnosticState={online,pending:local.pending.length,conflicts:local.conflicts.length,revision:snapshot?.revision||0,kind:accessPaused?'sign-in-required':'normal'};
  const diagnosticKey=JSON.stringify(diagnosticState);
  if(diagnosticKey!==lastDiagnosticState){lastDiagnosticState=diagnosticKey;diagnostics.record('workspace.state',diagnosticState);}
  updateSandboxViews();
  companion.update({online,workspaceId:snapshot?.id});
  updateSessionSelectors();
  for (const [id, port] of ports) {
    const c = contexts.get(id);
    if (c && (c.appId!==SANDBOX_ID||c.sandboxVersion||currentSandboxVersion()==null)) port.postMessage({ type: "state", state: contextState(c) });
  }
  if(online||accessPaused){clearTimeout(connectionNoticeTimer);connectionNoticeTimer=0;connectionNoticeReady=false;}
  else if(!connectionNoticeTimer&&!connectionNoticeReady){connectionNoticeTimer=setTimeout(()=>{connectionNoticeTimer=0;connectionNoticeReady=true;broadcast();},3000);}
  const updateRequired=[...contexts.values()].some(c=>c.appId===SANDBOX_ID&&(c.sandboxReadonly||(c.sandboxVersion&&!sameSandboxVersion(c.sandboxVersion,currentSandboxVersion()))));
  $('#connection-status').setAttribute('role','status');
  $('#connection-status').setAttribute('aria-live','polite');
  $("#connection-status").textContent = updateRequired
    ? 'Update required · preserve writing and reopen Sandbox'
    : online
      ? local.pending.length ? 'Syncing' : 'Connected to Mac'
      : accessPaused ? 'Sign-in required · saved edits retained' : connectionNoticeReady ? 'Reconnecting to Mac · saved edits retained' : 'Checking connection · saved edits retained';
  $("#connection-status").classList.toggle("offline", !online);
  $("#sync-status").textContent =
    `Revision ${snapshot?.revision || 0} · ${local.pending.length} pending${local.conflicts.length ? " · " + local.conflicts.length + " resolved to Mac" : ""}`;
}
async function write(app, sid, path, value, {defer=false,sandboxVersion:loadedVersion}={}) {
  if (!snapshot) throw Error("Connect to Spider first");
  if(app===SANDBOX_ID){loadedVersion=sandboxWriteVersion({appId:app,sandboxVersion:loadedVersion},currentSandboxVersion());}
  if (
    !Array.isArray(path) ||
    !path.length ||
    path.some(
      (k) =>
        typeof k !== "string" ||
        ["__proto__", "constructor", "prototype"].includes(k),
    )
  )
    throw Error("Invalid app state path");
  const key = versionKey(app, sid, path);
  let previous = [...local.pending]
    .reverse()
    .find(
      (o) => o.key === key && o.workspaceId === snapshot.id && !o.attempted && (app!==SANDBOX_ID||(!loadedVersion&&!o.sandboxVersion)||sameSandboxVersion(o.sandboxVersion,loadedVersion)),
    );
  if (previous) {
    previous.value = structuredClone(value);
  } else {
    const predecessor = [...local.pending]
      .reverse()
      .find((o) => o.key === key && o.workspaceId === snapshot.id);
    local.pending.push({
      id: uid(),
      workspaceId: snapshot.id,
      appId: app,
      sessionId: sid,
      path: [...path],
      value: structuredClone(value),
      ...(app===SANDBOX_ID&&loadedVersion?{sandboxVersion:{...loadedVersion}}:{}),
      baseVersion: targetVersion(key),
      key,
      predecessor: predecessor?.id,
    });
  }
  await persist();
  broadcast();
  if(!defer)flush();
  return { pending: true };
}
function payload(op) {
  return Object.fromEntries(
    [
      "id",
      "workspaceId",
      "appId",
      "sessionId",
      "path",
      "value",
      "baseVersion",
      "sandboxVersion",
    ].map((k) => [k, op[k]]),
  );
}
async function flush() {
  if (flushing) return new Promise((resolve) => flushWaiters.push(resolve));
  if (!online) return;
  flushing = true;
  try {
    while (local.pending.length && online) {
      const pendingIndex = local.pending.findIndex(
        (o) => o.workspaceId === snapshot.id,
      );
      if (pendingIndex < 0) break;
      const op = local.pending[pendingIndex];
      if (op.workspaceId !== snapshot.id) {
        notice(
          "This workspace changed. Earlier pending changes are preserved locally and cannot be replayed here.",
        );
        break;
      }
      op.sending = true;
      op.attempted = true;
      await persist();
      let result;
      try {
        result = await api("/api/patch", payload(op));
      } catch (e) {
        op.sending = false;
        if (e.status) {
          notice(e.message);
          break;
        }
        online = false;
        break;
      }
      if(result.status === "applied") {
        // Publish this receipt before dropping its pending operation. A new
        // edit can arrive while refresh awaits the next full snapshot.
        snapshot.versions[op.key] = result.targetVersion;
        snapshot.revision = Math.max(snapshot.revision, result.revision);
        const sessions = snapshot.apps[op.appId].sessions;
        sessions[op.sessionId] ||= {data:{}};
        setPath(sessions[op.sessionId].data, op.path, op.value);
      }
      local.pending.splice(pendingIndex, 1);
      for (const next of local.pending) {
        if (next.predecessor === op.id) {
          if (result.status === "applied")
            next.baseVersion = result.targetVersion;
          delete next.predecessor;
        }
      }
      if (result.status === "conflict") {
        local.conflicts.push(op);
        notice(
          "An offline change conflicted with the Mac. The Mac’s value was kept; your change remains in the conflict history.",
        );
      }
      await refresh(false);
      persist();
      broadcast();
    }
  } finally {
    flushing = false;
    for (const resolve of flushWaiters.splice(0)) resolve();
  }
}
let lastAccessProbe = 0, accessSignedOut = false;
let lastRecoveryProbe = 0, connectionNoticeTimer = 0, connectionNoticeReady = false;
async function refresh(shouldFlush = true, foreground = false) {
  // Expired sign-in is probed slowly, or immediately on foreground return.
  // Explicit sign-out remains deliberate and is never undone by background work.
  if (accessSignedOut) return;
  if (!foreground && !online && lastRecoveryProbe && Date.now() - lastRecoveryProbe < 60000) return;
  if (accessPaused && (!foreground && Date.now() - lastAccessProbe < 60000)) return;
  lastRecoveryProbe = Date.now();
  if (accessPaused) lastAccessProbe = Date.now();
  try {
    const data = await api("/api/state", undefined, undefined, {accessProbe: accessPaused});
    if (snapshot && snapshot.id !== data.state.id && local.pending.length)
      notice(
        "A different workspace is active. Pending changes remain preserved.",
      );
    if (snapshot && snapshot.id !== data.state.id) {
      desktop.reset();
      for (const id of [...contexts.keys()]) dispose(id);
      for (const p of ports.values()) p.close();
      ports.clear();
      contexts.clear();
      local.views = [];
      local.camera = null;
      rendered = false;
      report = null;
    }
    if (
      !snapshot ||
      snapshot.id !== data.state.id ||
      data.state.revision >= snapshot.revision
    )
      snapshot = data.state;
    clientId = data.clientId;
    const quarantined=quarantineSandboxEdits(local,snapshot?.apps?.[SANDBOX_ID]?.sandbox);
    if(quarantined)notice("Sandbox was restored or deployed. Earlier unsent edits were kept for export and will not replay. Reopen Sandbox to continue.");
    apps = data.apps;
    endpoints=data.endpoints || {};
    local.workspaceId = snapshot.id;
    online = true;
    persist();
    showWorkspace();
    if (shouldFlush) flush();
  } catch (e) {
    online = false;
    if (e.status === 401) {
      if (!snapshot) {
        $("#pair-error").textContent = connectionMessage(e);
        $("#pair-screen").hidden = false;
        $("#workspace").hidden = true;
      } else
        notice(
        "This browser needs pairing again. Unsent edits remain available for export in Settings.",
        );
    } else if (!snapshot) {
      $("#pair-screen").hidden = false;
      $("#pair-error").textContent = connectionMessage(e);
    }
  }
  if (snapshot) showWorkspace();
  broadcast();
}
function showWorkspace() {
  if (!snapshot) return;
  $("#pair-screen").hidden = true;
  $("#workspace").hidden = false;
  launcher.update([...apps,{id:'spider.local-diagnostics',name:'Reliability logs',category:'Utilities',keywords:['logs','diagnostics','export','offline']}]);
  $("#client-label").textContent =
    projected("spider.connections", "directory").names?.[clientId] ||
    snapshot.devices?.[clientId]?.label ||
    "Paired browser";
  if (!rendered) {
    rendered = true;
    const layout = projected(APP,clientId);
    const serverViews = layout.views;
    desktop.restoreCamera(layout.camera || local.camera);
    local.views = Array.isArray(serverViews)
      ? serverViews
      : local.views?.length
        ? local.views
        : [
            { id: uid(), appId: "spider.chat", sessionId: uid() },
            { id: uid(), appId: "spider.calculator", sessionId: uid() },
            { id: uid(), appId: "spider.connections", sessionId: uid() },
          ];
    for (const view of local.views) renderView(view);
    saveLayout();
  }
}
function saveLayout(options) {
  persist();
  $("#empty").hidden = !!local.views.length;
  if (clientId && snapshot)
    write(APP, clientId, ["views"], local.views, options).catch((e) =>
      notice(e.message),
    );
}
function makeContext(
  appId,
  sessionId,
  ancestors = ["spider.frontend"],
  parentId = null,
  mountId = uid(),
) {
  const app = apps.find((a) => a.id === appId);
  if (!app) throw Error("App is not registered");
  if (app.rootOnly) throw Error("This app is root-only and cannot be embedded");
  if (ancestors.includes(appId))
    throw Error("Embedding would repeat an app in its own ancestor chain");
  if (ancestors.length >= 5) throw Error("Maximum embedding depth reached");
  if (contexts.size >= 32) throw Error("Close a view before opening another");
  const c = {
    mountId,
    workspaceId: snapshot.id,
    appId,
    sessionId: sessionId || app.defaultSession || uid(),
    ancestors: [...ancestors, appId],
    parentId,
  };
  contexts.set(mountId, c);
  return c;
}
function childContext(parent, id) {
  const ctx = contexts.get(id);
  if (!ctx || ctx.parentId !== parent.mountId)
    throw Error("View does not belong to this parent");
  return ctx;
}
async function dispatch(ctx, msg, transferPort) {
  if (ctx.workspaceId !== snapshot?.id || contexts.get(ctx.mountId) !== ctx)
    throw Error(
      "This view belongs to a previous workspace. Reopen it before continuing.",
    );
  if(currentSandboxVersion()!=null&&ctx.appId!==SANDBOX_ID&&ctx.ancestors?.includes(SANDBOX_ID))throw Error("Sandbox cannot write through another app context.");
  if(ctx.appId===SANDBOX_ID)sandboxWriteVersion(ctx,currentSandboxVersion());
  const { method, args = {} } = msg;
  switch (method) {
    case "launcher":
      launcher.open('search'); return {ok:true};
    case "cloudflare":
      if (!apps.find(a=>a.id===ctx.appId)?.services?.includes('cloudflare'))throw Error('Remote access is not declared by this app');
      return api('/api/service/cloudflare',{action:args.action});
    case "activate":
      return {active: desktop.activate(rootMount(ctx), !!args.focus)};
    case "fullscreen":
      return {ok: desktop.fullscreen(rootMount(ctx), args.enabled ?? !desktop.state(rootMount(ctx)).fullscreen)};
    case "openrig-terminal": {
      if (!apps.find(a=>a.id===ctx.appId)?.services?.includes("openrig-terminal")) throw Error("Terminal access is not declared by this app");
      if (!online || !transferPort) throw Error("Reconnect to the Mac to open a terminal");
      if (terminalConnections.size>=16) throw Error("Close another terminal view first");
      const sessionId=ctx.sessionId, workspaceId=ctx.workspaceId;
      const prepared=await api("/api/service/openrig-terminal",{...args,appId:ctx.appId,sessionId,workspaceId});
      if(contexts.get(ctx.mountId)!==ctx||ctx.sessionId!==sessionId||snapshot?.id!==workspaceId)throw Error("View changed while connecting");
      const url=new URL("/api/openrig/terminal",nodeBase);url.protocol=url.protocol==="https:"?"wss:":"ws:";url.searchParams.set("ticket",prepared.ticket);
      const socket=new WebSocket(url),connectionId=uid();
      const close=()=>{socket.close();transferPort.close();terminalConnections.delete(connectionId);};
      terminalConnections.set(connectionId,{mountId:ctx.mountId,close});
      socket.onmessage=event=>{try{transferPort.postMessage(JSON.parse(event.data));}catch{close();}};
      socket.onerror=()=>transferPort.postMessage({type:"closed",reason:"Terminal connection failed. Check the Mac connection and reconnect."});
      socket.onclose=()=>{transferPort.postMessage({type:"closed",reason:"Terminal disconnected. Input is not replayed."});transferPort.close();terminalConnections.delete(connectionId);};
      transferPort.onmessage=({data})=>{
        if(data?.type==="disconnect"){close();return;}
        if(contexts.get(ctx.mountId)!==ctx||ctx.sessionId!==sessionId||snapshot?.id!==workspaceId||!online){close();return;}
        if(socket.readyState!==WebSocket.OPEN){transferPort.postMessage({type:"input-rejected",reason:"Terminal is not connected; this input was not sent."});return;}
        if(socket.bufferedAmount>128000){transferPort.postMessage({type:"input-rejected",reason:"Terminal connection is busy; this input was not sent."});return;}
        socket.send(JSON.stringify(data));
      };
      return {connected:true};
    }
    case "write":
      return write(ctx.appId, ctx.sessionId, args.path, args.value,{sandboxVersion:ctx.appId===SANDBOX_ID?sandboxWriteVersion(ctx,currentSandboxVersion()):undefined});
    case "renameDevice": {
      if (ctx.appId !== "spider.connections")
        throw Error("Device management is not declared by this app");
      const label = String(args.label || "").trim();
      if (
        !label ||
        [...label].length > 80 ||
        /[\u0000-\u001f\u007f]/.test(label)
      )
        throw Error("Use a name of 1–80 characters");
      if (args.clientId !== "authority" && !snapshot?.devices?.[args.clientId])
        throw Error("Choose a paired device");
      return write(
        "spider.connections",
        "directory",
        ["names", args.clientId],
        label,
      );
    }
    case "assignDevice": {
      if (ctx.appId !== "spider.connections")
        throw Error("Device management is not declared by this app");
      if (!(report?.devices || []).some((d) => d.id === args.clientId))
        throw Error("Choose a paired browser");
      if (args.deviceId !== "authority" && !snapshot?.devices?.[args.deviceId])
        throw Error("Choose a known device");
      return write(
        "spider.connections",
        "directory",
        ["deviceForClient", args.clientId],
        args.deviceId,
      );
    }
    case "resize": {
      // Desktop windows own their size. Content scrolls inside the live iframe.
      return { ok: true, managed: true };
    }
    case "download": {
      if(!apps.find(app=>app.id===ctx.appId)?.services?.includes("download"))throw Error("Downloads are not declared by this app");
      const {blob,filename}=downloadSpec(args),url=URL.createObjectURL(blob),link=document.createElement("a");
      link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
      return{filename,bytes:blob.size};
    }
    case "p5-reference": {
      if(!apps.find(app=>app.id===ctx.appId)?.services?.includes("p5-reference"))throw Error("p5 references are not declared by this app");
      window.open(p5ReferenceUrl(args.url),"_blank","noopener,noreferrer");return{requested:true};
    }
    case "models":
      if (!apps.find((a) => a.id === ctx.appId)?.services?.includes("ollama"))
        throw Error("Ollama is not declared by this app");
      return api("/api/models");
    case "codex": {
      if (!apps.find((a) => a.id === ctx.appId)?.services?.includes("codex"))
        throw Error("Codex import is not declared by this app");
      if (!online) throw Error("Reconnect to the core to browse or import Codex conversations");
      const result = await api("/api/service/codex", {
        ...args,
        appId: ctx.appId,
        sessionId: ctx.sessionId,
        workspaceId: ctx.workspaceId,
      });
      if (args.action === "import") await refresh();
      return result;
    }
    case "builder":
    case "github-readme":
    case "apple-notes":
    case "openrig":
    case "agent":
    case "context":
    case "companion":
    case "reader": {
      if (!apps.find((a) => a.id === ctx.appId)?.services?.includes(method))
        throw Error(`${method} is not declared by this app`);
      if (!online) throw Error("Reconnect to the core to use this action");
      await flush();
      if (ctx.workspaceId !== snapshot?.id) throw Error("Workspace changed before submission");
      if (local.pending.some((op) => op.appId === ctx.appId && op.sessionId === ctx.sessionId))
        throw Error("Wait for this app to finish syncing");
      const chat = method === 'companion' && ['chat-status','chat-history','chat-send'].includes(args.action);
      const result = await api(`/api/service/${method}`, { ...args, appId:ctx.appId, sessionId:ctx.sessionId, workspaceId:ctx.workspaceId,
        ...(ctx.appId===SANDBOX_ID?{sandboxVersion:sandboxWriteVersion(ctx,currentSandboxVersion())}:{}) }, undefined, chat ? {timeoutMs:60000} : {});
      if (!chat) await refresh();
      return result;
    }
    case "ollama":
      if (!apps.find((a) => a.id === ctx.appId)?.services?.includes("ollama"))
        throw Error("Ollama is not declared by this app");
      if (!online) throw Error("Reconnect to the Mac to send a message");
      await flush();
      if (ctx.workspaceId !== snapshot?.id)
        throw Error("Workspace changed before submission");
      if (
        local.pending.some(
          (o) => o.appId === ctx.appId && o.sessionId === ctx.sessionId,
        )
      )
        throw Error("Wait for this conversation to finish syncing");
      return api("/api/service/ollama", {
        ...args,
        appId: ctx.appId,
        sessionId: ctx.sessionId,
        workspaceId: snapshot.id,
        ...(ctx.appId===SANDBOX_ID?{sandboxVersion:sandboxWriteVersion(ctx,currentSandboxVersion())}:{}),
      });
    case "cancel": {
      const job = snapshot.jobs?.[args.taskId];
      if (job?.appId !== ctx.appId || job?.sessionId !== ctx.sessionId)
        throw Error("Task belongs to another session");
      return api("/api/jobs/cancel", args);
    }
    case "mount": {
      if((currentSandboxVersion()!=null||ctx.sandboxVersion)&&(ctx.appId===SANDBOX_ID||ctx.ancestors?.includes(SANDBOX_ID)))throw Error("Sandbox cannot create another app’s write context.");
      const child = makeContext(
        args.appId,
        args.sessionId,
        ctx.ancestors,
        ctx.mountId,
      );
      const app = apps.find((a) => a.id === child.appId);
      const html=await loadAppHtml(app,child);
      return {
        src: `/apps/${app.id}/${app.entry || "index.html"}`,
        name: app.name,
        context: child,
        state: contextState(child),
        html,
      };
    }
    case "child":
      return dispatch(childContext(ctx, args.mountId), args.message, transferPort);
    case "childState":
      return contextState(childContext(ctx, args.mountId));
    case "unmount": {
      const child = childContext(ctx, args.mountId);
      dispose(child.mountId);
      return { ok: true };
    }
    default:
      throw Error("Unknown Spider app operation");
  }
}
function dispose(id) {
  if (contexts.get(id)?.parentId === null) desktop.remove(id);
  for(const entry of terminalConnections.values())if(entry.mountId===id)entry.close();
  for (const c of contexts.values()) if (c.parentId === id) dispose(c.mountId);
  ports.get(id)?.close();
  ports.delete(id);
  contexts.delete(id);
}
async function loadAppHtml(app,ctx) {
  if(app.id===SANDBOX_ID&&(currentSandboxVersion()!=null||ctx?.sandboxVersion)){
    const loaded=await sandboxLoader.load({workspaceId:snapshot?.id,runtime:nodeBase,online});
    if(!loaded.readonly){await refresh(false);if(!online||!sameSandboxVersion(loaded.version,currentSandboxVersion()))throw Error("Sandbox changed while loading. Reopen it to load matching code and state.");}
    if(ctx){ctx.sandboxVersion=Object.freeze({...loaded.version});ctx.sandboxReadonly=loaded.readonly;ctx.lastSandboxData=sameSandboxVersion(loaded.version,currentSandboxVersion())?projected(ctx.appId,ctx.sessionId):{};}
    if(loaded.message)notice(loaded.message);return loaded.html;
  }
  const url = hosted
    ? new URL(`apps/${app.id}/${app.entry || "index.html"}`, import.meta.url)
        .href
    : `/apps/${app.id}/${app.entry || "index.html"}`;
  let cache;
  try {
    cache = await caches.open("spider-code-v2");
  } catch {}
  try {
    const candidates = hosted && online
      ? [url, nodeBase + `/apps/${app.id}/${app.entry || "index.html"}`]
      : [url];
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, {
          credentials: hosted && candidate.startsWith(nodeBase + "/") ? "include" : "same-origin",
          ...(hosted ? {redirect: "manual"} : {}),
        });
        if (response.type === "opaqueredirect" || response.redirected) continue;
        if (!response.ok) continue;
        if (cache) await cache.put(url, response.clone());
        return await response.text();
      } catch {}
    }
    throw Error("App code is unavailable");
  } catch (e) {
    const response = await cache?.match(url);
    if (response) return response.text();
    throw Error("Reconnect to the Mac to load this app for the first time.");
  }
}
async function renderView(view) {
  try {
    const app = apps.find((a) => a.id === view.appId);
    if (!app) return;
    const c = makeContext(view.appId, view.sessionId, undefined, null, view.id);
    const panel = document.createElement("section");
    panel.className = "app-window";
    panel.dataset.app = app.id;
    const bar = document.createElement("div");
    bar.className = "window-bar";
    const label = document.createElement("span");
    label.className = "window-title";
    label.textContent = app.name;
    const tag = document.createElement("span");
    tag.className = "window-tag";
    tag.textContent =
      app.id === "spider.connections" ? "Device graph" : "App session";
    const close = () => {
      dispose(view.id);
      panel.remove();
      local.views = local.views.filter((v) => v.id !== view.id);
      saveLayout();
    };
    bar.append(label, tag);
    if(app.id===SANDBOX_ID){const reload=document.createElement("button");reload.type="button";reload.className="sandbox-reload";reload.textContent="Reload Sandbox";reload.setAttribute("aria-label","Reload Sandbox with current code and state");reload.hidden=true;reload.onclick=async()=>{dispose(view.id);panel.remove();await renderView(view);};bar.append(reload);}
    if (app.id === "spider.calculator") {
      const link = document.createElement("a");
      link.href = hosted
        ? new URL(`apps/${app.id}/${app.entry}`, import.meta.url).href
        : "/apps/" + app.id + "/" + app.entry;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "↗";
      link.title = "Open Calculator standalone";
      link.className = "standalone-link";
      bar.append(link);
    }
    const picker = document.createElement("select");
    picker.className = "session-picker";
    picker.setAttribute("aria-label", app.name + " session");
    picker.onchange = () => {
      for(const entry of terminalConnections.values())if(entry.mountId===c.mountId)entry.close();
      const sid = picker.value === "new" ? uid() : picker.value;
      c.sessionId = sid;
      view.sessionId = sid;
      saveLayout();
      broadcast();
    };
    if (app.id !== "spider.connections") bar.append(picker);
    panel.dataset.mount = view.id;
    const frame = document.createElement("iframe");
    frame.className = "app-frame";
    frame.title = app.name;
    frame.sandbox = "allow-scripts allow-forms";
    frame.allowFullscreen = true;
    const html = loadAppHtml(app,c);
    panel.append(bar, frame);
    desktop.world.append(panel);
    desktop.attach(view, panel, {bar, frame, name:app.name, close});
    const channel = new MessageChannel();
    ports.set(view.id, channel.port1);
    channel.port1.onmessage = async ({ data, ports: transfers }) => {
      try {
        const result = await dispatch(c, data, transfers?.[0]);
        channel.port1.postMessage({ id: data.id, result });
      } catch (e) {
        channel.port1.postMessage({ id: data.id, error: e.message });
      }
    };
    const ready = (event) => {
      if (
        event.source !== frame.contentWindow ||
        event.data?.type !== "spider:ready"
      )
        return;
      window.removeEventListener("message", ready);
      frame.contentWindow.postMessage(
        { type: "spider:init", context: c, state: contextState(c) },
        "*",
        [channel.port2],
      );
      if (desktop.state(view.id).active) desktop.activate(view.id, true);
    };
    window.addEventListener("message", ready);
    const contents = await html;
    if (contexts.get(c.mountId) !== c) return;
    frame.srcdoc = contents;
  } catch (e) {
    notice(e.message);
  }
}
function updateSessionSelectors() {
  for (const view of local.views || []) {
    const ctx = contexts.get(view.id),
      picker = document.querySelector('[data-mount="' + view.id + '"] select');
    if (!ctx || !picker || document.activeElement === picker) continue;
    const entries = snapshot?.apps?.[ctx.appId]?.sessions || {};
    const ids = [
      ctx.sessionId,
      ...Object.keys(entries).filter((id) => id !== ctx.sessionId),
    ];
    picker.replaceChildren();
    for (const id of ids) {
      const data = entries[id]?.data || {},
        first = Object.values(data.messages || {}).find(
          (m) => m.role === "user",
        );
      const option = document.createElement("option");
      option.value = id;
      option.textContent = (
        first?.content ||
        data.expression ||
        "Session " + id.slice(0, 5)
      ).slice(0, 32);
      picker.append(option);
    }
    const fresh = document.createElement("option");
    fresh.value = "new";
    fresh.textContent = "+ New session";
    picker.append(fresh);
    picker.value = ctx.sessionId;
  }
}
async function pairBrowser(code) {
  $("#pair-error").textContent = "Connecting…";
  try {
    if (hosted) {
      const entered = normalizeNode($("#node-url").value);
      if (entered !== nodeBase) {
        location.hash = new URLSearchParams({
          node: entered,
          pair: code,
          label: $("#device-name").value,
        }).toString();
        location.reload();
        return;
      }
    }
    const paired = await api("/api/pair", {
      code,
      label: $("#device-name").value || guessLabel(),
      client: ownClient,
      token: hosted,
    });
    if (paired.deviceToken) {
      deviceToken = paired.deviceToken;
      localStorage.setItem(trustKey(), deviceToken);
    }
    try {sessionStorage.removeItem("spider.pendingPair:"+nodeBase);}catch{}
    const recovered = [...(local.recoveredChanges || []), ...local.pending];
    local = {
      recoveredChanges: recovered,
      snapshot: null,
      clientId: null,
      pending: [],
      conflicts: [],
      views: [],
      workspaceId: null,
    };
    snapshot = null;
    rendered = false;
    await refresh();
  } catch (e) {
    $("#pair-error").textContent = connectionMessage(e);
  }
}
const pendingPairKey = "spider.pendingPair:" + nodeBase;
function pendingPair() {
  try {const saved=JSON.parse(sessionStorage.getItem(pendingPairKey));
    if(saved?.expires>Date.now())return saved.code;
    sessionStorage.removeItem(pendingPairKey);
  }catch{}
}
async function resumeAccess() {
  accessSignedOut=false; accessPaused=false; accessError=null;
  try {
    await api('/health');
    $('#access-status').textContent='Cloudflare Access connected. Spider pairing is checked separately.';
    const code=pendingPair();
    if(code && !deviceToken)await pairBrowser(code);
    await refresh();
  }catch(error){$('#access-status').textContent=connectionMessage(error);}
}
for(const button of document.querySelectorAll('[data-access-login]')) {
  button.hidden=!accessRequired;
  button.onclick=()=>{
    persist();
    accessWindow=window.open(nodeBase+'/access/return','spider-access');
    if(!accessWindow)$('#access-status').textContent='Allow this sign-in popup, then try again. Your edits remain saved.';
  };
}
window.addEventListener('message',event=>{
  if(event.origin===nodeBase && event.source===accessWindow && event.data?.type==='spider:access-return')resumeAccess();
});
for(const button of document.querySelectorAll('[data-access-retry]')) {
  button.hidden=!accessRequired;button.onclick=resumeAccess;
}
$('#access-signout').hidden=!accessRequired;
$('#access-signout').onclick=()=>{
  persist();
  for(const entry of terminalConnections.values())entry.close();
  accessSignedOut=true;accessPaused=true;accessError=Object.assign(Error('Sign into Cloudflare Access to continue.'),{kind:'access'});
  online=false;broadcast();
  $('#access-status').textContent='Signed out in this tab. Complete Cloudflare logout in the opened tab. Spider pairing and unsent edits are preserved.';
  window.open(nodeBase+'/cdn-cgi/access/logout','spider-access');
};
function guessLabel() {
  return /iPad/.test(navigator.userAgent) ||
    (/Mac/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
    ? "iPad"
    : /iPhone/.test(navigator.userAgent)
      ? "iPhone"
      : /Mac/.test(navigator.userAgent)
        ? "Mac browser"
        : "Browser";
}
$("#device-name").value = fragment.get("label") || guessLabel();
$("#node-field").hidden = false;
$("#node-url").readOnly = !hosted;
$("#node-url").required = hosted;
$("#node-url").value = nodeBase;
function updateTrustLink() {
  try {
    $("#trust-mac").href = normalizeNode($("#node-url").value);
    $("#trust-mac").hidden = false;
  } catch {
    $("#trust-mac").hidden = true;
  }
}
$("#node-url").oninput = updateTrustLink;
updateTrustLink();
let diagnosticReport = null,
  diagnosticRun = 0;
async function runConnectionCheck() {
  const run = ++diagnosticRun;
  $("#run-connection-check").disabled = true;
  $("#copy-connection-report").disabled = true;
  $("#connection-check-summary").textContent =
    "Checking the Mac from this browser…";
  $("#connection-check-results").replaceChildren();
  const entered = $("#node-url").value || nodeBase;
  $("#connection-check-address").textContent =
    entered || "No Mac address selected";
  try {
    $("#open-check-mac").href = normalizeNode(entered) + "/health";
    $("#open-check-mac").hidden = false;
  } catch {
    $("#open-check-mac").hidden = true;
  }
  let checkToken;
  try {
    if (normalizeNode(entered) === nodeBase) checkToken = deviceToken;
  } catch {}
  const result = await checkConnection(entered, { hosted, token: checkToken, access: accessRequired });
  if (run !== diagnosticRun) return;
  diagnosticReport = {
    ...result,
    frontend: location.origin,
    frontendMode: hosted ? "GitHub Pages" : "Mac served",
  };
  $("#connection-check-summary").textContent = result.message;
  for (const item of result.checks) {
    const row = document.createElement("li"),
      name = document.createElement("strong"),
      detail = document.createElement("span");
    row.dataset.result = item.status;
    name.textContent = item.name;
    detail.textContent = item.detail;
    row.append(name, detail);
    $("#connection-check-results").append(row);
  }
  $("#run-connection-check").disabled = false;
  $("#copy-connection-report").disabled = false;
}
for (const button of document.querySelectorAll("[data-connection-help]"))
  button.onclick = () => {
    $("#connection-dialog").showModal();
    runConnectionCheck();
  };
$("#run-connection-check").onclick = runConnectionCheck;
$("#copy-connection-report").onclick = () =>
  copy(
    JSON.stringify(diagnosticReport, null, 2),
    "Connection report copied. It contains no pairing code, credential, or saved workspace.",
  );
$("#pair-form").onsubmit = (e) => {
  e.preventDefault();
  pairBrowser($("#pair-code").value.trim());
};
$('#diagnostics-toggle').onclick=()=>diagnosticsApp.open();
function openApp(appId) {
    if(appId==='spider.local-diagnostics'){diagnosticsApp.open();return;}
    const manifest = apps.find((app) => app.id === appId && !app.rootOnly);
    if(!manifest)return;
    const v = { id: uid(), appId, sessionId: manifest.defaultSession || uid() };
    local.views.push(v);
    renderView(v);
    saveLayout();
  }
$('#app-menu-toggle').onclick=()=>launcher.open();
$('#search-apps').onclick=()=>launcher.open('search');
document.addEventListener('keydown',event=>{
  if(event.altKey && !event.ctrlKey && !event.metaKey && event.code==='Space' && !event.repeat && snapshot){event.preventDefault();launcher.open('search');}
},true);
$('#settings-toggle').onclick=async()=>{
  $('#settings-address').textContent=nodeBase;
  $('#settings-storage').textContent=`${local.pending.length} unsent edits · ${local.recoveredChanges?.length||0} recovered edits available in export`;
  $('#settings-dialog').showModal();
  try {const remote=await api('/api/service/cloudflare',{action:'status'});$('#settings-remote').textContent=remote.publicUrl ? `Configured address: ${remote.publicUrl}. ${remote.accessRequired?'Cloudflare Access is required.':'Access protection is not configured.'} This status does not verify the remote connection.` : 'No permanent Cloudflare address configured. On the Mac, complete Cloudflare Access setup before running spider remote setup.';}
  catch{$('#settings-remote').textContent=endpoints.public ? `Cloudflare address: ${endpoints.public}` : 'Reconnect to your Mac to check remote access.';}
};
for (const button of document.querySelectorAll("[data-close]"))
  button.onclick = () => $("#" + button.dataset.close).close();
$("#add-device").onclick = async () => {
  try {
    invite = await api("/api/invite", {});
    $("#qr-image").innerHTML = invite.qr;
    $("#invite-code").textContent = invite.code;
    $("#invite-url").href = invite.url;
    $("#pair-dialog").showModal();
  } catch (e) {
    notice(e.message);
  }
};
$("#copy-invitation").onclick = () => copy(invite.url, "Invitation copied");
async function copy(text, message) {
  try {
    await navigator.clipboard.writeText(text);
    notice(message);
  } catch {
    const t = document.createElement("textarea");
    t.value = text;
    document.body.append(t);
    t.select();
    document.execCommand("copy");
    t.remove();
    notice(message);
  }
}
function sourceForExport() {
  return portableView(snapshot, local.pending, local.recoveredChanges || []);
}
$("#state-toggle").onclick = () => {
  $("#source-state").textContent = JSON.stringify(sourceForExport(), null, 2);
  $("#state-dialog").showModal();
};
$("#copy-state").onclick = () =>
  copy(
    JSON.stringify(sourceForExport(), null, 2),
    local.pending.length
      ? "Source state copied, including pending device edits"
      : "Source state copied",
  );
$("#refresh-state").onclick = async () => {
  await refresh();
  $("#source-state").textContent = JSON.stringify(sourceForExport(), null, 2);
};
const downloadLink = document.querySelector(
  'a[download="spider-source-state.json"]',
);
downloadLink.onclick = (e) => {
  e.preventDefault();
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(sourceForExport(), null, 2)], {
      type: "application/json",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "spider-source-state.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
// Keep connection help usable while the first network probe is pending.
if (!snapshot) $("#pair-screen").hidden = false;
const pairing = fragment.get("pair") || pendingPair();
if (pairing) {
  try {if(fragment.has('pair'))sessionStorage.setItem(pendingPairKey,JSON.stringify({code:pairing,expires:Date.now()+600000}));}catch{}
  history.replaceState(null, "", location.pathname);
  $("#pair-screen").hidden = false;
  if (hosted && !deviceToken) await pairBrowser(pairing);
  else {
    try {
      await api("/api/state");
    } catch {
      await pairBrowser(pairing);
    }
  }
}
await refresh();
setInterval(async () => {
  if (polling) return;
  polling = true;
  try {
    await refresh();
    if (online) {
      report = await api("/api/connections", {
        revision: snapshot.revision,
        session,
        instance: instanceId,
        client: ownClient,
      });
      local.report = report;
      persist();
      broadcast();
    }
  } catch {
    online = false;
    broadcast();
  } finally {
    polling = false;
  }
}, 1800);
window.addEventListener("online", () => refresh(true, true));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh(true, true);
});

if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register(hosted ? "./sw.js" : "/sw.js", { scope: hosted ? "./" : "/" })
    .catch(() => {});
