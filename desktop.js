// Window geometry is stored with each view; moving a window never remounts its app.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback) => Number.isFinite(value) ? value : fallback;
export function fitRect(rect, bounds) {
  const width = clamp(number(rect.width, 720), Math.min(320, bounds.width), bounds.width);
  const height = clamp(number(rect.height, 580), Math.min(240, bounds.height), bounds.height);
  return {x: clamp(number(rect.x, 0), 0, bounds.width - width),
    y: clamp(number(rect.y, 0), 0, bounds.height - height), width, height};
}

export function createDesktop({container, onChange, onFocus, onState}) {
  const windows = new Map();
  let active = null, fullscreen = null, order = 0, gesture = null;
  const bounds = () => ({width: Math.max(1, container.clientWidth), height: Math.max(1, container.clientHeight)});
  function paint(entry) {
    const {view, panel} = entry;
    const rect = fitRect(view.rect, bounds());
    // Keep the saved rectangle independent of temporary viewport changes.
    Object.assign(panel.style, {left: rect.x+'px', top: rect.y+'px', width: rect.width+'px', height: rect.height+'px', zIndex: String(view.order)});
    panel.classList.toggle('is-active', active === view.id);
    panel.classList.toggle('is-fullscreen', fullscreen === view.id);
    panel.inert = !!fullscreen && fullscreen !== view.id;
    entry.green.setAttribute('aria-pressed', String(fullscreen === view.id));
    entry.green.setAttribute('aria-label', `${fullscreen === view.id ? 'Restore' : 'Full screen'} ${entry.name}`);
    entry.green.title = fullscreen === view.id ? 'Restore window' : 'Full screen';
    entry.yellow.setAttribute('aria-pressed', String(!!view.expanded));
  }
  function paintAll() {
    for (const entry of windows.values()) paint(entry);
    for (const element of document.querySelectorAll('#workspace > header, #workspace > footer, #workspace .work-heading')) element.inert = !!fullscreen;
  }
  function focus(entry) {
    if (!entry) return;
    entry.frame.focus({preventScroll:true});
    onFocus(entry.view.id);
  }
  function activate(id, input = false) {
    const entry = windows.get(id);
    if (!entry || (fullscreen && fullscreen !== id)) return false;
    if (active !== id) {
      active = id;
      entry.view.order = ++order;
      paintAll();
      onState();
      onChange();
    }
    if (input) focus(entry);
    return true;
  }
  function setFullscreen(id, value) {
    if (!windows.has(id) || (fullscreen && fullscreen !== id)) return false;
    finishGesture();
    fullscreen = value ? id : null;
    activate(id);
    document.body.classList.toggle('desktop-fullscreen', !!fullscreen);
    paintAll();
    onState();
    focus(windows.get(id));
    return true;
  }
  function finishGesture(event) {
    if (!gesture) return;
    if (event && event.pointerId !== gesture.pointerId) return;
    const {target, pointerId, entry} = gesture;
    gesture = null;
    if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
    document.body.classList.remove('window-gesture');
    onChange();
    focus(entry);
  }
  function startGesture(event, entry, edge = '') {
    if (gesture || event.isPrimary === false || event.button !== 0 || fullscreen) return;
    if (!edge && event.target.closest('button,select,a,input')) return;
    event.preventDefault();
    activate(entry.view.id);
    const rect = fitRect(entry.view.rect, bounds());
    gesture = {entry, edge, rect, x:event.clientX, y:event.clientY, pointerId:event.pointerId, target:event.currentTarget};
    gesture.target.setPointerCapture(event.pointerId);
    document.body.classList.add('window-gesture');
  }
  function moveGesture(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const {entry, edge, rect, x, y} = gesture, area = bounds();
    const dx = event.clientX-x, dy = event.clientY-y;
    let next = {...rect};
    if (!edge) { next.x += dx; next.y += dy; }
    else {
      const minWidth = Math.min(320, area.width), minHeight = Math.min(240, area.height);
      if (edge.includes('e')) next.width = clamp(rect.width+dx, minWidth, area.width-rect.x);
      if (edge.includes('s')) next.height = clamp(rect.height+dy, minHeight, area.height-rect.y);
      if (edge.includes('w')) {next.x = clamp(rect.x+dx, 0, rect.x+rect.width-minWidth); next.width = rect.x+rect.width-next.x;}
      if (edge.includes('n')) {next.y = clamp(rect.y+dy, 0, rect.y+rect.height-minHeight); next.height = rect.y+rect.height-next.y;}
      entry.view.expanded = false;
    }
    entry.view.rect = fitRect(next, area);
    paint(entry);
  }
  function wireGesture(target, entry, edge = '') {
    target.addEventListener('pointerdown', event => startGesture(event, entry, edge));
    target.addEventListener('pointermove', moveGesture);
    target.addEventListener('pointerup', finishGesture);
    target.addEventListener('pointercancel', finishGesture);
    target.addEventListener('lostpointercapture', finishGesture);
  }
  function resize(id) {
    const entry = windows.get(id);
    if (!entry) return;
    if (fullscreen === id) setFullscreen(id, false);
    const view = entry.view, area = bounds();
    if (view.expanded && view.restoreRect) {
      view.rect = view.restoreRect;
      delete view.restoreRect;
      view.expanded = false;
    } else {
      view.restoreRect = {...view.rect};
      view.rect = fitRect({x:area.width*.04,y:area.height*.04,width:area.width*.92,height:area.height*.92},area);
      view.expanded = true;
    }
    activate(id, true); paint(entry); onChange();
  }
  const observer = new ResizeObserver(paintAll);
  observer.observe(container);
  return {
    activate,
    fullscreen: setFullscreen,
    state: id => ({active: active === id, fullscreen: fullscreen === id}),
    attach(view, panel, {bar, frame, name, close}) {
      const area = bounds(), index = windows.size;
      const wide = !['spider.calculator','spider.chat'].includes(view.appId);
      view.rect = view.rect || fitRect({x:24+(index%7)*30,y:20+(index%7)*24,width:wide?1000:view.appId==='spider.calculator'?430:650,height:wide?760:590},area);
      view.order = number(view.order, ++order);
      order = Math.max(order, view.order);
      const controls = document.createElement('div');
      controls.className = 'window-controls';
      const button = (color, symbol, label, fn) => {
        const el = document.createElement('button');
        el.className = 'window-control '+color; el.textContent = symbol;
        el.setAttribute('aria-label', label+' '+name); el.title = label;
        el.onclick = fn; controls.append(el); return el;
      };
      button('red', '×', 'Close', close);
      const yellow = button('yellow', '↔', 'Resize', () => resize(view.id));
      const green = button('green', '⤢', 'Full screen', () => setFullscreen(view.id, fullscreen !== view.id));
      bar.prepend(controls);
      const entry = {view, panel, frame, green, yellow, name};
      windows.set(view.id, entry);
      panel.tabIndex = -1;
      panel.setAttribute('aria-label', name+' window');
      panel.addEventListener('pointerdown', () => activate(view.id), {capture:true});
      bar.addEventListener('dblclick', event => {
        if (!event.target.closest('button,select,a,input')) setFullscreen(view.id, fullscreen !== view.id);
      });
      wireGesture(bar, entry);
      for (const edge of ['n','e','s','w','ne','se','sw','nw']) {
        const handle = document.createElement('div');
        handle.className = 'window-edge edge-'+edge;
        handle.setAttribute('aria-hidden','true');
        panel.append(handle); wireGesture(handle, entry, edge);
      }
      if (!active || view.order >= windows.get(active)?.view.order) active = view.id;
      paintAll(); onState();
    },
    remove(id) {
      if (gesture?.entry.view.id === id) finishGesture();
      windows.delete(id);
      if (fullscreen === id) {fullscreen = null; document.body.classList.remove('desktop-fullscreen');}
      if (active === id) {
        active = null;
        const next = [...windows.values()].sort((a,b) => b.view.order-a.view.order)[0];
        if (next) activate(next.view.id, true);
      }
      paintAll(); onState();
    },
  };
}
