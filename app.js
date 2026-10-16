import { portableView } from "./export.js";
import { uid } from "./sdk.js";
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
  ? localStorage.getItem("spider.node") || ""
  : location.origin;
try {
  if (fragment.has("node")) nodeBase = normalizeNode(fragment.get("node"));
} catch {}
if (nodeBase) localStorage.setItem("spider.node", nodeBase);
const trustKey = () => "spider.trust:" + nodeBase;
let deviceToken = hosted ? localStorage.getItem(trustKey()) : null;
const ownClient = clientInfo(navigator);
const $ = (s) => document.querySelector(s),
  APP = "spider.frontend",
  ports = new Map(),
  contexts = new Map();
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
let cacheKey = "spider.client.v1:" + instanceId + ":" + nodeBase,
  local;
try {
  local = JSON.parse(
    localStorage.getItem(cacheKey) ||
      (!hosted && localStorage.getItem("spider.client.v1:" + instanceId)) ||
      "null",
  );
} catch {}
if (!local) {
  try {
    const previous = localStorage.getItem("spider.lastCache");
    const cached = JSON.parse(
      localStorage.getItem(previous || "spider.client.v1") || "null",
    );
    if (cached)
      if (!hosted || cached.nodeBase === nodeBase)
        local = { ...cached, pending: previous ? [] : cached.pending || [] };
  } catch {}
}
try {
  localStorage.setItem("spider.lastCache", cacheKey);
} catch {}
local ||= {
  snapshot: null,
  clientId: null,
  pending: [],
  conflicts: [],
  views: [],
  workspaceId: null,
};
snapshot = local.snapshot;
clientId = local.clientId;
apps = local.apps || [];
report = local.report || null;
function persist() {
  try {
    local.nodeBase = nodeBase;
    local.snapshot = snapshot;
    local.clientId = clientId;
    local.apps = apps;
    localStorage.setItem(cacheKey, JSON.stringify(local));
  } catch {
    notice(
      "Browser storage is full. Export source state before closing this page.",
    );
  }
}
function notice(message) {
  $("#notice").textContent = message;
  $("#notice").hidden = !message;
}
async function api(path, body, method) {
  return requestNode(nodeBase, path, {
    body,
    method,
    hosted,
    token: deviceToken,
  });
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
  return {
    workspaceId: snapshot?.id,
    appId: ctx.appId,
    sessionId: ctx.sessionId,
    data: projected(ctx.appId, ctx.sessionId),
    online,
    revision: snapshot?.revision || 0,
    jobs: Object.fromEntries(
      Object.entries(snapshot?.jobs || {}).filter(
        ([, j]) => j.appId === ctx.appId && j.sessionId === ctx.sessionId,
      ),
    ),
    connections:
      ctx.appId === "spider.connections"
        ? {
            ...report,
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
            },
          }
        : undefined,
  };
}
function broadcast() {
  updateSessionSelectors();
  for (const [id, port] of ports) {
    const c = contexts.get(id);
    if (c) port.postMessage({ type: "state", state: contextState(c) });
  }
  $("#connection-status").textContent = online
    ? local.pending.length
      ? "Syncing"
      : "Connected to Mac"
    : "Offline · edits saved here";
  $("#connection-status").classList.toggle("offline", !online);
  $("#sync-status").textContent =
    `Revision ${snapshot?.revision || 0} · ${local.pending.length} pending${local.conflicts.length ? " · " + local.conflicts.length + " resolved to Mac" : ""}`;
}
async function write(app, sid, path, value) {
  if (!snapshot) throw Error("Connect to Spider first");
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
      (o) => o.key === key && o.workspaceId === snapshot.id && !o.attempted,
    );
  if (previous) {
    previous.value = value;
  } else {
    const predecessor = [...local.pending]
      .reverse()
      .find((o) => o.key === key && o.workspaceId === snapshot.id);
    local.pending.push({
      id: uid(),
      workspaceId: snapshot.id,
      appId: app,
      sessionId: sid,
      path,
      value,
      baseVersion: targetVersion(key),
      key,
      predecessor: predecessor?.id,
    });
  }
  persist();
  broadcast();
  flush();
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
      persist();
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
async function refresh(shouldFlush = true) {
  try {
    const data = await api("/api/state");
    if (snapshot && snapshot.id !== data.state.id && local.pending.length)
      notice(
        "A different workspace is active. Pending changes remain preserved.",
      );
    if (snapshot && snapshot.id !== data.state.id) {
      for (const p of ports.values()) p.close();
      ports.clear();
      contexts.clear();
      $("#mounts").replaceChildren();
      local.views = [];
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
    apps = data.apps;
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
          "This browser needs pairing again. Your cached work and pending changes remain here.",
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
  $("#client-label").textContent =
    projected("spider.connections", "directory").names?.[clientId] ||
    snapshot.devices?.[clientId]?.label ||
    "Paired browser";
  if (!rendered) {
    rendered = true;
    const serverViews = snapshot.apps?.[APP]?.sessions?.[clientId]?.data?.views;
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
function saveLayout() {
  persist();
  $("#empty").hidden = !!local.views.length;
  if (clientId && snapshot)
    write(APP, clientId, ["views"], local.views).catch((e) =>
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
    sessionId: sessionId || uid(),
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
async function dispatch(ctx, msg) {
  if (ctx.workspaceId !== snapshot?.id || contexts.get(ctx.mountId) !== ctx)
    throw Error(
      "This view belongs to a previous workspace. Reopen it before continuing.",
    );
  const { method, args = {} } = msg;
  switch (method) {
    case "write":
      return write(ctx.appId, ctx.sessionId, args.path, args.value);
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
      if (
        args.clientId !== "authority" &&
        !(report?.devices || []).some((d) => d.id === args.clientId)
      )
        throw Error("Choose a paired device");
      return write(
        "spider.connections",
        "directory",
        ["names", args.clientId],
        label,
      );
    }
    case "resize": {
      const frame = document.querySelector(
        '[data-mount="' + ctx.mountId + '"] iframe',
      );
      if (frame)
        frame.style.height =
          Math.max(
            350,
            Math.min(
              ctx.appId === "spider.connections" ? 1800 : 1000,
              Number(args.height) || 500,
            ),
          ) + "px";
      return { ok: true };
    }
    case "models":
      if (!apps.find((a) => a.id === ctx.appId)?.services?.includes("ollama"))
        throw Error("Ollama is not declared by this app");
      return api("/api/models");
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
      });
    case "cancel": {
      const job = snapshot.jobs?.[args.taskId];
      if (job?.appId !== ctx.appId || job?.sessionId !== ctx.sessionId)
        throw Error("Task belongs to another session");
      return api("/api/jobs/cancel", args);
    }
    case "mount": {
      const child = makeContext(
        args.appId,
        args.sessionId,
        ctx.ancestors,
        ctx.mountId,
      );
      const app = apps.find((a) => a.id === child.appId);
      return {
        src: `/apps/${app.id}/${app.entry || "index.html"}`,
        name: app.name,
        context: child,
        state: contextState(child),
        html: await loadAppHtml(app),
      };
    }
    case "child":
      return dispatch(childContext(ctx, args.mountId), args.message);
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
  for (const c of contexts.values()) if (c.parentId === id) dispose(c.mountId);
  ports.get(id)?.close();
  ports.delete(id);
  contexts.delete(id);
}
async function loadAppHtml(app) {
  const url = hosted
    ? new URL(`apps/${app.id}/${app.entry || "index.html"}`, import.meta.url)
        .href
    : `/apps/${app.id}/${app.entry || "index.html"}`;
  let cache;
  try {
    cache = await caches.open("spider-code-v1");
  } catch {}
  try {
    const response = await fetch(url);
    if (!response.ok) throw Error("App code is unavailable");
    if (cache) await cache.put(url, response.clone());
    return await response.text();
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
    const close = document.createElement("button");
    close.className = "close";
    close.textContent = "×";
    close.setAttribute("aria-label", `Close ${app.name}`);
    close.onclick = () => {
      dispose(view.id);
      panel.remove();
      local.views = local.views.filter((v) => v.id !== view.id);
      saveLayout();
    };
    bar.append(label, tag, close);
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
      bar.insertBefore(link, close);
    }
    const picker = document.createElement("select");
    picker.className = "session-picker";
    picker.setAttribute("aria-label", app.name + " session");
    picker.onchange = () => {
      const sid = picker.value === "new" ? uid() : picker.value;
      c.sessionId = sid;
      view.sessionId = sid;
      saveLayout();
      broadcast();
    };
    if (app.id !== "spider.connections") bar.insertBefore(picker, close);
    panel.dataset.mount = view.id;
    const frame = document.createElement("iframe");
    frame.className = "app-frame";
    frame.title = app.name;
    frame.sandbox = "allow-scripts allow-forms";
    const html = loadAppHtml(app);
    panel.append(bar, frame);
    $("#mounts").append(panel);
    const channel = new MessageChannel();
    ports.set(view.id, channel.port1);
    channel.port1.onmessage = async ({ data }) => {
      try {
        const result = await dispatch(c, data);
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
  const result = await checkConnection(entered, { hosted, token: checkToken });
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
for (const button of document.querySelectorAll("[data-app]"))
  button.onclick = () => {
    const v = { id: uid(), appId: button.dataset.app, sessionId: uid() };
    local.views.push(v);
    renderView(v);
    saveLayout();
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
const pairing = fragment.get("pair");
if (pairing) {
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
window.addEventListener("online", () => refresh());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});

if ("serviceWorker" in navigator)
  navigator.serviceWorker
    .register(hosted ? "./sw.js" : "/sw.js", { scope: hosted ? "./" : "/" })
    .catch(() => {});
