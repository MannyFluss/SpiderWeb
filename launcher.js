const groups = {
  'spider.builder': ['Create', '◇'], 'spider.sandbox': ['Create', '✺'],
  'spider.chat': ['Communicate', '↗'], 'spider.openrig': ['Develop', '⌘'],
  'spider.ingestion': ['Knowledge', '↓'], 'spider.encyclopedia': ['Knowledge', 'Aa'],
  'spider.reader': ['Knowledge', '▤'], 'spider.canvas': ['Explore', '◌'],
  'spider.experiments': ['Explore', '⚗'], 'spider.poetry': ['Create', '¶'],
  'spider.calculator': ['Utilities', '＋'], 'spider.connections': ['Utilities', '⌁'],
};
export const category = app => app.category || groups[app.id]?.[0] || 'Other apps';
export const appIcon = app => groups[app.id]?.[1] || '◇';
export function searchApps(apps, query = '') {
  const q = query.trim().toLocaleLowerCase();
  const score = app => {
    const name = app.name.toLocaleLowerCase();
    if (!q) return 1;
    if (name === q) return 100;
    if (name.startsWith(q)) return 80;
    if (name.split(/\s+/).some(word => word.startsWith(q))) return 60;
    if (name.includes(q)) return 40;
    if (`${app.id} ${category(app)} ${(app.keywords || []).join(' ')}`.toLocaleLowerCase().includes(q)) return 20;
    let index = 0;
    for (const letter of name) if (letter === q[index]) index++;
    return index === q.length ? 10 : 0;
  };
  return apps.filter(app => !app.rootOnly).map(app => ({app, score:score(app)}))
    .filter(row => row.score).sort((a,b) => b.score-a.score || a.app.name.localeCompare(b.app.name)).map(row => row.app);
}
export function createLauncher({dialog, input, results, onLaunch}) {
  let apps = [], matches = [], selected = 0, mode = 'browse', origin;
  const choose = id => { dialog.close(); onLaunch(id); };
  function row(app, index) {
    const button = document.createElement('button');
    button.type = 'button'; button.dataset.app = app.id;
    const icon = document.createElement('span'), name = document.createElement('span'), hint = document.createElement('span');
    icon.className = 'launcher-icon'; icon.textContent = appIcon(app); icon.setAttribute('aria-hidden','true');
    name.textContent = app.name; hint.className = 'launcher-category'; hint.textContent = category(app);
    button.append(icon, name, hint); button.onclick = () => choose(app.id);
    if (index !== undefined) {
      button.id = 'app-result-' + index; button.setAttribute('role','option');
      button.setAttribute('aria-selected', String(index === selected)); button.tabIndex = -1;
    }
    return button;
  }
  function render() {
    results.replaceChildren(); input.removeAttribute('aria-activedescendant');
    const searching = mode === 'search' || input.value.trim();
    results.setAttribute('role', searching ? 'listbox' : 'group');
    dialog.classList.toggle('is-search', !!searching);
    if (searching) {
      matches = searchApps(apps, input.value); selected = Math.min(selected, Math.max(0, matches.length-1));
      for (const [i, app] of matches.entries()) results.append(row(app,i));
      if (matches.length) input.setAttribute('aria-activedescendant','app-result-'+selected);
      else { const empty = document.createElement('p'); empty.className = 'launcher-empty'; empty.textContent = `No apps match “${input.value}”.`; results.append(empty); }
    } else {
      matches = [];
      const categories = [...new Set(apps.filter(a=>!a.rootOnly).map(category))].sort();
      for (const group of categories) {
        const details = document.createElement('details'), summary = document.createElement('summary');
        details.open = true; summary.textContent = group;
        details.append(summary, ...searchApps(apps).filter(app=>category(app)===group).map(app=>row(app)));
        results.append(details);
      }
    }
  }
  input.addEventListener('input', () => {selected=0;render();});
  input.addEventListener('keydown', event => {
    if (!matches.length) return;
    if (['ArrowDown','ArrowUp'].includes(event.key)) {
      event.preventDefault(); selected=(selected+(event.key==='ArrowDown'?1:-1)+matches.length)%matches.length;
      render(); document.getElementById('app-result-'+selected)?.scrollIntoView({block:'nearest'});
    } else if ((event.key==='Tab' && !event.shiftKey) || (event.key==='ArrowRight' && input.selectionStart===input.value.length)) {
      event.preventDefault(); input.value=matches[selected].name; selected=0;render();
    } else if (event.key==='Enter') {event.preventDefault();choose(matches[selected].id);}
  });
  dialog.addEventListener('click', event => {if(event.target===dialog) {const b=dialog.getBoundingClientRect(); if(event.clientX<b.left||event.clientX>b.right||event.clientY<b.top||event.clientY>b.bottom)dialog.close();}});
  dialog.addEventListener('close', () => {document.getElementById('app-menu-toggle')?.setAttribute('aria-expanded','false');origin?.focus();});
  return {
    update(next) { const changed=JSON.stringify(next)!==JSON.stringify(apps);apps=next;if(changed&&dialog.open)render(); },
    open(nextMode='browse') {if(dialog.open){dialog.close();return;} mode=nextMode;selected=0;input.value='';origin=document.activeElement;render();dialog.showModal();document.getElementById('app-menu-toggle')?.setAttribute('aria-expanded','true');input.focus();},
  };
}
