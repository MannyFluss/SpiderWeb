// Window geometry is stored with each view; moving a window never remounts its app.
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const number = (value, fallback) => Number.isFinite(value) ? value : fallback;
const LIMIT = 1000000, MIN_ZOOM = .00001, MAX_ZOOM = 3;
export function normalizeCamera(value) {
  return {x:clamp(number(value?.x,0),-LIMIT,LIMIT), y:clamp(number(value?.y,0),-LIMIT,LIMIT), zoom:clamp(number(value?.zoom,1),MIN_ZOOM,MAX_ZOOM)};
}
export function zoomAt(camera, point, zoom) {
  zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM);
  return normalizeCamera({zoom, x:point.x-(point.x-camera.x)/camera.zoom*zoom, y:point.y-(point.y-camera.y)/camera.zoom*zoom});
}
export function fitWindows(rects, bounds, margin = 40) {
  if (!rects.length) return {x:0,y:0,zoom:1};
  const left=Math.min(...rects.map(r=>r.x)), top=Math.min(...rects.map(r=>r.y));
  const width=Math.max(...rects.map(r=>r.x+r.width))-left, height=Math.max(...rects.map(r=>r.y+r.height))-top;
  const zoom=clamp(Math.min(1,Math.max(1,bounds.width-margin*2)/width,Math.max(1,bounds.height-margin*2)/height),MIN_ZOOM,MAX_ZOOM);
  return normalizeCamera({zoom,x:(bounds.width-width*zoom)/2-left*zoom,y:(bounds.height-height*zoom)/2-top*zoom});
}
function worldRect(rect) {
  return {x:clamp(number(rect?.x,0),-LIMIT,LIMIT),y:clamp(number(rect?.y,0),-LIMIT,LIMIT),width:clamp(number(rect?.width,720),320,4000),height:clamp(number(rect?.height,580),240,4000)};
}
export function createDesktop({container, onChange, onCamera, onFocus, onState}) {
  const windows = new Map();
  let active = null, fullscreen = null, order = 0, gesture = null, camera=normalizeCamera(), navigation=null, panMode=false, saveTimer, cameraDirty=false, leaving=false;
  const contacts = new Map();
  const bounds = () => ({width: Math.max(1, container.clientWidth), height: Math.max(1, container.clientHeight)});
  const background=document.createElement('div'); background.className='desktop-background'; background.setAttribute('aria-hidden','true');
  const world=document.createElement('div'); world.className='desktop-world';
  const tools=document.createElement('nav'); tools.className='desktop-tools'; tools.setAttribute('aria-label','Canvas navigation');
  tools.innerHTML='<button type="button" data-pan aria-pressed="false" title="Drag anywhere to move the canvas">Pan</button><select aria-label="Go to window"><option value="">Go to…</option></select><button type="button" data-zoom-out aria-label="Zoom canvas out">−</button><button type="button" data-actual aria-label="Canvas at 100 percent">100%</button><button type="button" data-zoom-in aria-label="Zoom canvas in">+</button><button type="button" data-fit>Fit all</button>';
  const chooser=tools.querySelector('select'), zoomLabel=tools.querySelector('[data-actual]'), panButton=tools.querySelector('[data-pan]');
  container.append(background,world,tools);
  container.tabIndex=0;
  container.setAttribute('aria-label','App canvas. Drag empty space to pan, pinch or Ctrl and scroll to zoom. Arrow keys move the focused canvas.');
  function paintCamera() {
    world.style.transform=`translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`;
    container.dataset.camera=JSON.stringify(camera);
    zoomLabel.textContent=camera.zoom<.01?'<1%':Math.round(camera.zoom*100)+'%';
    background.style.backgroundPosition=`${camera.x}px ${camera.y}px`;
    background.style.backgroundSize=`${40*camera.zoom}px ${40*camera.zoom}px`;
    background.style.backgroundImage=camera.zoom<.2?'none':'';
    tools.inert=!!fullscreen;
  }
  function saveCamera() {clearTimeout(saveTimer);if(!cameraDirty)return;cameraDirty=false;onCamera({...camera},{defer:leaving});}
  function setCamera(value, save=true) {camera=normalizeCamera(value);paintCamera();if(save){cameraDirty=true;saveCamera();}}
  function zoom(factor) {if(fullscreen)return;const area=bounds();setCamera(zoomAt(camera,{x:area.width/2,y:area.height/2},camera.zoom*factor));}
  function fitAll() {if(!fullscreen)setCamera(fitWindows([...windows.values()].map(e=>e.view.rect),bounds(),48));}
  function reveal(id) {
    const entry=windows.get(id);if(!entry || fullscreen)return;
    const rect=entry.view.rect, area=bounds(), zoom=Math.min(1,(area.width-48)/rect.width,(area.height-90)/rect.height);
    setCamera({zoom,x:(area.width-rect.width*zoom)/2-rect.x*zoom,y:(area.height-rect.height*zoom)/2-rect.y*zoom});
    activate(id,true);
  }
  tools.querySelector('[data-zoom-out]').onclick=()=>zoom(1/1.2);
  tools.querySelector('[data-zoom-in]').onclick=()=>zoom(1.2);
  zoomLabel.onclick=()=>zoom(1/camera.zoom);
  tools.querySelector('[data-fit]').onclick=fitAll;
  chooser.onchange=()=>{reveal(chooser.value);chooser.value='';};
  function setPan(value) {panMode=value;container.classList.toggle('pan-mode',value);panButton.setAttribute('aria-pressed',String(value));}
  panButton.onclick=()=>setPan(!panMode);
  function paint(entry) {
    const {view, panel} = entry;
    const rect = worldRect(view.rect);
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
    paintCamera();
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
    finishNavigation();
    setPan(false);
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
    onChange({defer:leaving});
    focus(entry);
  }
  function startGesture(event, entry, edge = '') {
    if (gesture || navigation || event.isPrimary === false || event.button !== 0 || fullscreen) return;
    if (!edge && event.target.closest('button,select,a,input')) return;
    event.preventDefault();
    activate(entry.view.id);
    const rect = worldRect(entry.view.rect);
    gesture = {entry, edge, rect, x:event.clientX, y:event.clientY, pointerId:event.pointerId, target:event.currentTarget};
    gesture.target.setPointerCapture(event.pointerId);
    document.body.classList.add('window-gesture');
  }
  function moveGesture(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const {entry, edge, rect, x, y} = gesture;
    const dx = (event.clientX-x)/camera.zoom, dy = (event.clientY-y)/camera.zoom;
    let next = {...rect};
    if (!edge) { next.x += dx; next.y += dy; }
    else {
      if (edge.includes('e')) next.width = clamp(rect.width+dx,320,4000);
      if (edge.includes('s')) next.height = clamp(rect.height+dy,240,4000);
      if (edge.includes('w')) {next.width=clamp(rect.width-dx,320,4000);next.x=rect.x+rect.width-next.width;}
      if (edge.includes('n')) {next.height=clamp(rect.height-dy,240,4000);next.y=rect.y+rect.height-next.height;}
      entry.view.expanded = false;
    }
    entry.view.rect = worldRect(next);
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
      view.rect = worldRect({x:(area.width*.04-camera.x)/camera.zoom,y:(area.height*.04-camera.y)/camera.zoom,width:area.width*.92/camera.zoom,height:area.height*.92/camera.zoom});
      view.expanded = true;
    }
    activate(id, true); paint(entry); onChange();
  }
  const localPoint=event=>{const r=container.getBoundingClientRect();return{x:event.clientX-r.left,y:event.clientY-r.top};};
  function finishNavigation(event) {
    if(!navigation || (event && !contacts.has(event.pointerId)))return;
    const moved=navigation.moved;
    navigation=null;
    const ids=[...contacts.keys()];contacts.clear();
    for(const id of ids)if(container.hasPointerCapture(id))container.releasePointerCapture(id);
    container.classList.remove('is-navigating');
    if(moved)saveCamera();
  }
  container.addEventListener('pointerdown',event=>{
    if(fullscreen || gesture || event.target.closest('.desktop-tools') || ![0,1].includes(event.button))return;
    if(!panMode && event.button!==1 && event.target.closest('.app-window'))return;
    event.preventDefault();event.stopPropagation();container.focus({preventScroll:true});
    const point=localPoint(event);contacts.set(event.pointerId,point);container.setPointerCapture(event.pointerId);
    if(contacts.size===1)navigation={kind:'pan',start:point,camera:{...camera},moved:false};
    else if(contacts.size===2){
      const [a,b]=contacts.values();navigation={kind:'pinch',start:{x:(a.x+b.x)/2,y:(a.y+b.y)/2},distance:Math.max(1,Math.hypot(a.x-b.x,a.y-b.y)),camera:{...camera},moved:false};
    }
    container.classList.add('is-navigating');
  },true);
  container.addEventListener('pointermove',event=>{
    if(!navigation || !contacts.has(event.pointerId))return;
    const point=localPoint(event);contacts.set(event.pointerId,point);
    if(navigation.kind==='pinch' && contacts.size===2){
      const [a,b]=contacts.values(),mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      const next=zoomAt(navigation.camera,navigation.start,navigation.camera.zoom*Math.hypot(a.x-b.x,a.y-b.y)/navigation.distance);
      camera=normalizeCamera({...next,x:next.x+mid.x-navigation.start.x,y:next.y+mid.y-navigation.start.y});
    }else if(navigation.kind==='pan')camera=normalizeCamera({...navigation.camera,x:navigation.camera.x+point.x-navigation.start.x,y:navigation.camera.y+point.y-navigation.start.y});
    event.preventDefault();navigation.moved=true;cameraDirty=true;paintCamera();
  });
  for(const type of ['pointerup','pointercancel','lostpointercapture'])container.addEventListener(type,finishNavigation);
  container.addEventListener('wheel',event=>{
    if(fullscreen || gesture || navigation || event.defaultPrevented || event.target.closest('.desktop-tools'))return;
    if(!panMode && !event.ctrlKey && !event.metaKey && event.target.closest('.app-window'))return;
    event.preventDefault();
    const factor=event.deltaMode===1?16:event.deltaMode===2?bounds().height:1;
    if(event.ctrlKey || event.metaKey)camera=zoomAt(camera,localPoint(event),camera.zoom*Math.exp(-clamp(event.deltaY*factor,-500,500)*.002));
    else camera=normalizeCamera({...camera,x:camera.x-event.deltaX*factor,y:camera.y-event.deltaY*factor});
    cameraDirty=true;paintCamera();clearTimeout(saveTimer);saveTimer=setTimeout(saveCamera,180);
  },{passive:false});
  container.addEventListener('keydown',event=>{
    if(fullscreen || event.target!==container || event.ctrlKey || event.metaKey || event.altKey)return;
    const step=event.shiftKey?160:48;
    if(event.key.startsWith('Arrow')){
      event.preventDefault();setCamera({...camera,x:camera.x+(event.key==='ArrowLeft'?step:event.key==='ArrowRight'?-step:0),y:camera.y+(event.key==='ArrowUp'?step:event.key==='ArrowDown'?-step:0)});
    }else if(['+','=','-','0','Home'].includes(event.key)){
      event.preventDefault();if(event.key==='Home')fitAll();else zoom(event.key==='0'?1/camera.zoom:event.key==='-'?1/1.2:1.2);
    }
  });
  container.addEventListener('scroll',()=>{container.scrollTop=0;container.scrollLeft=0;},{passive:true});
  window.addEventListener('blur',()=>{finishGesture();finishNavigation();});
  window.addEventListener('pagehide',()=>{leaving=true;finishGesture();finishNavigation();saveCamera();});
  window.addEventListener('pageshow',()=>{leaving=false;});
  const observer = new ResizeObserver(paintAll);
  observer.observe(container);
  return {
    world,
    restoreCamera: value=>setCamera(value,false),
    reset() {
      finishGesture();finishNavigation();clearTimeout(saveTimer);setPan(false);
      windows.clear();world.replaceChildren();chooser.replaceChildren(new Option('Go to…',''));
      active=null;fullscreen=null;order=0;document.body.classList.remove('desktop-fullscreen');setCamera(undefined,false);paintAll();
    },
    activate,
    fullscreen: setFullscreen,
    state: id => ({active: active === id, fullscreen: fullscreen === id}),
    attach(view, panel, {bar, frame, name, close}) {
      const area = bounds(), index = windows.size;
      const wide = !['spider.calculator','spider.chat'].includes(view.appId);
      view.rect = view.rect ? worldRect(view.rect) : worldRect({x:(24+(index%7)*30-camera.x)/camera.zoom,y:(20+(index%7)*24-camera.y)/camera.zoom,width:Math.min(wide?1000:view.appId==='spider.calculator'?430:650,area.width-48),height:Math.min(wide?760:590,area.height-40)});
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
      chooser.add(new Option(name,view.id));
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
      for(const option of chooser.options)if(option.value===id){option.remove();break;}
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
