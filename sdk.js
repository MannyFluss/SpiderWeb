import {isolatePageZoom} from './gestures.js';
export const uid = () =>
  globalThis.crypto?.randomUUID?.() ||
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function connect() {
  if (window.parent === window) return Promise.resolve(null);
  isolatePageZoom(document);
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      window.removeEventListener('message', ready);
      reject(Error('Spider host connection timed out. Reopen this view to connect; your saved writing is retained.'));
    }, 15000);
    const ready = (e) => {
      if (e.source !== parent || e.data?.type !== "spider:init" || !e.ports[0])
        return;
      clearTimeout(deadline);
      window.removeEventListener("message", ready);
      const port = e.ports[0],
        pending = new Map(),
        listeners = new Set(),
        focusListeners = new Set();
      let state = e.data.state;
      port.onmessage = ({ data }) => {
        if (data.type === "focus") {
          window.focus();
          for (const fn of focusListeners) fn();
          return;
        }
        if (data.type === "state") {
          state = data.state;
          for (const fn of listeners) fn(state);
          return;
        }
        const task = pending.get(data.id);
        if (task) {
          pending.delete(data.id);
          clearTimeout(task.timer);
          data.error
            ? task.reject(Error(data.error))
            : task.resolve(data.result);
        }
      };
      function request(method, args = {}, transfers = []) {
        return new Promise((resolve, reject) => {
          const id = uid();
          // A timed-out mutation may already have reached the host. Never replay it.
          const timer = setTimeout(() => {
            pending.delete(id);
            reject(Error('Spider bridge reply timed out; this action is unconfirmed. Your saved writing is retained. Check its status before retrying.'));
          }, 75000);
          pending.set(id, { resolve, reject, timer });
          try { port.postMessage({ id, method, args }, transfers); }
          catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
        });
      }
      const sdk = {
        context: e.data.context,
        get state() {
          return state;
        },
        read: () => state?.data || {},
        write: (path, value) => request("write", { path, value }),
        request,
        onFocus(fn) {
          focusListeners.add(fn);
          return () => focusListeners.delete(fn);
        },
        async openTerminal(options, onEvent) {
          const channel = new MessageChannel();
          channel.port1.onmessage = ({data}) => onEvent(data);
          try { await request("openrig-terminal", options, [channel.port2]); }
          catch(error) { channel.port1.close(); throw error; }
          return {
            send: frame => channel.port1.postMessage(frame),
            close: () => { channel.port1.postMessage({type:"disconnect"}); channel.port1.close(); },
          };
        },
        onState(fn) {
          listeners.add(fn);
          fn(state);
          return () => listeners.delete(fn);
        },
        async mount(appId, container, options = {}) {
          const desc = await request("mount", { appId, ...options });
          const frame = document.createElement("iframe");
          frame.srcdoc = desc.html;
          frame.title = desc.name;
          frame.sandbox = "allow-scripts allow-forms";
          frame.allowFullscreen = true;
          frame.className = "embedded-app";
          container.append(frame);
          const channel = new MessageChannel();
          channel.port1.onmessage = async (ev) => {
            const msg = ev.data;
            try {
              const result = await request("child", {
                mountId: desc.context.mountId,
                message: msg,
              }, ev.ports);
              channel.port1.postMessage({ id: msg.id, result });
            } catch (error) {
              channel.port1.postMessage({ id: msg.id, error: error.message });
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
              { type: "spider:init", context: desc.context, state: desc.state },
              "*",
              [channel.port2],
            );
          };
          window.addEventListener("message", ready);
          const unsubscribe = sdk.onState(() => {
            request("childState", { mountId: desc.context.mountId })
              .then((s) =>
                channel.port1.postMessage({ type: "state", state: s }),
              )
              .catch(() => {});
          });
          const unfocus = sdk.onFocus(() => {
            if (document.activeElement === frame) channel.port1.postMessage({type:"focus"});
          });
          return {
            frame,
            close() {
              unsubscribe();
              unfocus();
              request("unmount", { mountId: desc.context.mountId }).catch(
                () => {},
              );
              frame.remove();
              channel.port1.close();
            },
          };
        },
      };
      // App gestures activate their owning desktop window without moving focus
      // away from the field or terminal the person actually clicked.
      const activate = () => request("activate").catch(() => {});
      document.addEventListener("pointerdown", activate, {capture:true, passive:true});
      document.addEventListener("focusin", activate);
      document.addEventListener('keydown', event => {
        if(event.altKey && !event.ctrlKey && !event.metaKey && event.code==='Space' && !event.repeat) {
          event.preventDefault(); event.stopImmediatePropagation(); request('launcher').catch(()=>{});
        }
      },true);
      resolve(sdk);
    };
    window.addEventListener("message", ready);
    parent.postMessage({ type: "spider:ready" }, "*");
  });
}
