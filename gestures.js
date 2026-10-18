const installed = new WeakSet();

// Each browsing context needs its own policy: touch-action on an iframe does
// not govern gestures inside the embedded document. Apps keep custom zoom;
// unhandled pinches must not magnify the surrounding browser/OS viewport.
export function isolatePageZoom(doc = document) {
  if (installed.has(doc)) return;
  installed.add(doc);
  const view = doc.defaultView;
  const action = view.getComputedStyle(doc.documentElement).touchAction;
  if (action === 'auto' || action === 'manipulation') doc.documentElement.style.touchAction = 'pan-x pan-y';
  else if (action.includes('pinch-zoom')) doc.documentElement.style.touchAction = action.replace(/\bpinch-zoom\b/g,'').trim() || 'none';
  const preventNativeZoom = event => { if (event.cancelable) event.preventDefault(); };
  // Bubble at the window so app element/document handlers see the gesture first.
  view.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) preventNativeZoom(event);
  }, {passive:false});
  for (const type of ['gesturestart','gesturechange','gestureend'])
    view.addEventListener(type, preventNativeZoom, {passive:false});
}
