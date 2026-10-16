// A device export includes its unacknowledged work without changing the
// authoritative snapshot or pretending those edits were accepted by the Mac.
export function portableView(snapshot, pending = [], recoveredChanges = []) {
  const value = structuredClone(snapshot);
  const relevant = pending.filter((op) => op.workspaceId === value.id);
  for (const op of relevant) {
    const app = value.apps[op.appId];
    if (!app) continue;
    app.sessions[op.sessionId] ||= { data: {} };
    let target = app.sessions[op.sessionId].data;
    for (const key of op.path.slice(0, -1)) {
      if (!target[key] || typeof target[key] !== "object") target[key] = {};
      target = target[key];
    }
    target[op.path.at(-1)] = structuredClone(op.value);
  }
  if (relevant.length) value.pendingDeviceChanges = structuredClone(relevant);
  if (recoveredChanges.length)
    value.recoveredDeviceChanges = structuredClone(recoveredChanges);
  return value;
}
