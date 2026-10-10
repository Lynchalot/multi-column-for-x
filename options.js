// Options page: built entirely from XMCSettings.SCHEMA, so a new setting needs no work here.
(() => {
  'use strict';
  const S = XMCSettings;
  const ext = (() => { const a = typeof browser !== 'undefined' ? browser : typeof chrome !== 'undefined' ? chrome : null; return a && a.runtime && a.runtime.id ? a : null; })(); // (Firefox's `browser`, or Chrome's `chrome`)
  const storage = ext && ext.storage && ext.storage.local;
  let settings = S.normalize();
  let history = [];
  let readCount = 0; // posts remembered as read (only their ids, on this device)

  const POPUP = document.body.classList.contains('popup'); // the toolbar button's panel: the same settings, each section folding out of a list
  const FRAMED = POPUP && window.parent !== window; // the same page over x.com, from the gear in the columns' bar
  if (FRAMED) document.body.classList.add('framed');
  { const th = new URLSearchParams(location.search).get('theme'); if (POPUP && (th === 'dark' || th === 'light')) document.documentElement.dataset.theme = th; } // (X's colours, passed by the page that frames it)
  const toParent = (type) => { try { window.parent.postMessage({ xmc: type }, '*'); } catch { /* nobody to tell */ } };
  const $ = (sel) => document.querySelector(sel);
  const h = (tag, props, ...kids) => { const n = Object.assign(document.createElement(tag), props || {}); n.append(...kids.filter(Boolean)); return n; };
  const say = (msg) => { $('#status').textContent = msg; };

  async function load() {
    let v;
    try { v = storage ? await storage.get(null) : JSON.parse(localStorage.getItem('xmc.settings') || '{}'); } catch { v = {}; }
    settings = S.normalize(v);
    history = Array.isArray(v.dlHistory) ? v.dlHistory : [];
    try { readCount = (Array.isArray(v.seenPosts) ? v.seenPosts : storage ? [] : JSON.parse(localStorage.getItem('xmc.seen') || '[]')).length; } catch { readCount = 0; }
  }
  function persist(partial) {
    Object.assign(settings, partial);
    setTimeout(refreshPresets, 0);
    setTimeout(refreshMarks, 0);
    if (storage) storage.set(Object.assign({ v: S.VERSION }, partial)).catch((e) => say('Could not save: ' + e));
    else { try { localStorage.setItem('xmc.settings', JSON.stringify(S.diff(settings).set)); } catch { /* ignore */ } }
  }


  // Is the extension running on the tab you are looking at, and if not, why: it has no access to x.com (a permission that can be switched off),
  // the tab was open before the extension was loaded, or it is switched off. (`?forTab=` names another tab: for the tests.)
  async function hereCheck() {
    const line = $('#here'); if (!line) return;
    const ORIGINS = ['https://x.com/*', 'https://twitter.com/*'];
    const say2 = (text, ...btns) => { line.replaceChildren(h('span', { textContent: text }), ...btns); line.hidden = false; };
    const withTimeout = (p, ms) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
    try {
      const forTab = Number(new URLSearchParams(location.search).get('forTab')) || 0;
      const isX = (u) => /^https:\/\/(x|twitter)\.com(\/|$)/.test(u || '');
      const active = forTab ? await ext.tabs.get(forTab) : (await ext.tabs.query({ active: true, currentWindow: true }))[0];
      let tab = active;
      if (!forTab && !(active && isX(active.url))) { // (on the settings page, or the panel is open over some other tab: the x.com tab used last)
        const all = await ext.tabs.query({ url: ORIGINS.map((o) => o.replace('/*', '/*')) }).catch(() => []);
        all.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0));
        if (all[0]) tab = all[0];
      }
      const here = tab && active && tab.id === active.id ? 'this tab' : 'your x.com tab';
      const granted = await ext.permissions.contains({ origins: ORIGINS });
      if (!granted) {
        say2('The extension is not allowed on x.com, so it cannot run there.', h('button', { type: 'button', textContent: 'Allow x.com', onclick: async () => {
          let ok = false; try { ok = await ext.permissions.request({ origins: ORIGINS }); } catch { /* refused */ }
          if (ok && tab) { try { await ext.tabs.reload(tab.id); } catch { /* gone */ } }
          hereCheck();
        } }));
        return;
      }
      if (!tab || !/^https:\/\/(x|twitter)\.com(\/|$)/.test(tab.url || '')) { say2('Open x.com to see whether it is running there.'); return; }
      const boot = (await ext.storage.local.get('xmcBoot').catch(() => ({}))).xmcBoot;
      const reply = await withTimeout(Promise.resolve(ext.tabs.sendMessage(tab.id, { type: 'xmc-ping' })).catch(() => null), 1500);
      if (reply && reply.off) say2('Switched off: turn Enabled on to use it on ' + here + '.');
      else if (reply && reply.ok) say2('Running on ' + here + ' (version ' + reply.version + ')' + (reply.failed ? '; columns gave up here: ' + reply.failed : reply.columns ? '' : '; X\u2019s own page is showing'));
      else say2('Not running on ' + here + '. ' + (boot ? 'It last started on x.com at ' + new Date(boot.at).toLocaleTimeString() + ' (version ' + boot.version + '), so it can run here; this tab was probably open before the extension was loaded.' : 'It has never started on x.com since it was loaded.'), h('button', { type: 'button', textContent: 'Reload the tab', onclick: async () => { try { await ext.tabs.reload(tab.id); } catch { /* gone */ } setTimeout(hereCheck, 3500); } }));
    } catch (e) { say2('Could not check this tab (' + ((e && e.message) || e) + ').'); }
  }

  function control(it) {
    const id = 'opt-' + it.key;
    let el;
    if (it.type === 'bool') {
      el = h('input', { type: 'checkbox', id, checked: !!settings[it.key] });
      el.addEventListener('change', () => {
        persist({ [it.key]: el.checked });
      });
    } else if (it.type === 'select') {
      el = h('select', { id }, ...it.options.map(([val, label]) => h('option', { value: val, textContent: label, selected: settings[it.key] === val })));
      el.addEventListener('change', () => persist({ [it.key]: el.value }));
    } else if (it.type === 'number') {
      el = h('input', { type: 'number', id, min: it.min, max: it.max, value: settings[it.key] });
      el.addEventListener('change', () => { const n = S.normalize({ [it.key]: Number(el.value) })[it.key]; el.value = n; persist({ [it.key]: n }); });
    } else if (it.type === 'textarea') {
      el = h('textarea', { id, value: settings[it.key], spellcheck: false });
      el.addEventListener('change', () => persist({ [it.key]: el.value }));
    } else {
      el = h('input', { type: 'text', id, value: settings[it.key], spellcheck: false });
      el.addEventListener('change', () => persist({ [it.key]: el.value }));
    }
    return el;
  }

  // The sidebar items are whatever X's sidebar offers right now (the extension notes them as it sees them),
  // so anything X adds later, e.g. "Creator Studio", can be hidden without an update.
  function navBlock() {
    const wrap = h('div', { className: 'navlist' }, h('h3', { textContent: 'Sidebar items' }));
    const items = settings.navItems || [];
    wrap.append(h('p', { className: 'muted', textContent: items.length
      ? 'Tick the ones you want hidden. This is what your sidebar offers right now.'
      : 'Open x.com once and the items in your sidebar will be listed here.' }));
    for (const it of items) {
      const cb = h('input', { type: 'checkbox', checked: (settings.hiddenNav || []).includes(it.key) });
      cb.addEventListener('change', () => {
        const set = new Set(settings.hiddenNav || []);
        if (cb.checked) set.add(it.key); else set.delete(it.key);
        persist({ hiddenNav: [...set] });
      });
      wrap.append(h('label', { className: 'navrow' }, cb, h('span', { textContent: 'Hide \u201c' + it.label + '\u201d' }), h('span', { className: 'muted', textContent: it.key })));
    }
    return wrap;
  }
  function refreshNav() {
    const old = document.querySelector('.navlist');
    if (old) old.replaceWith(navBlock());
  }

  // What worked and what did not the last time this extension ran on x.com: written there (see publishFeatures in main.js), read here.
  const FEATURE_LABELS = { timeline: 'Timeline data from X', like: 'Like', bookmark: 'Bookmark', repost: 'Repost and quote', comments: 'Comments', 'comment actions': 'Like and bookmark on a comment', translate: 'Translate' };
  const PROBE_LABELS = { homeLink: 'Home link in X’s menu', tabs: 'X’s tab bar (a count)', timeLink: 'Link on a post’s time', like: 'Like button', repost: 'Repost button', bookmark: 'Bookmark button', reply: 'Reply button', text: 'Post text' };
  const STATE_TEXT = { working: 'Working', failing: 'Failing', off: 'Switched off for a few minutes', unseen: 'Not used yet' };
  function statusBlock() {
    const wrap = h('div', { className: 'statusblock' }, h('h3', { textContent: 'What is working on x.com' }));
    const body = h('div', {});
    wrap.append(body, h('p', { className: 'muted', textContent: 'This is what the extension saw the last time it ran on x.com. A button that fails three times in a row is switched off for a few minutes and says why when pressed; “Save sample” in a post’s ... menu on x.com keeps what is needed to fix it.' }));
    const when = (ms) => (ms ? new Date(ms).toLocaleString() : 'never');
    const draw = (rep) => {
      if (!rep) { body.replaceChildren(h('p', { className: 'muted', textContent: 'Nothing yet: open x.com with the columns on and come back.' })); return; }
      const rows = [];
      const row = (name, state, detail) => rows.push(h('tr', { className: 'st-' + state }, h('th', { scope: 'row', textContent: name }), h('td', { textContent: STATE_TEXT[state] || state }), h('td', { className: 'muted', textContent: detail || '' })));
      for (const [k, label] of Object.entries(FEATURE_LABELS)) { const e = (rep.features || {})[k]; row(label, e ? e.state : 'unseen', e ? (e.ok + ' worked, ' + e.fail + ' failed' + (e.why && e.state !== 'working' ? ': ' + e.why : '')) : ''); }
      const pl = rep.placed || {};
      row('Menu beside the columns', pl.menu || 'unseen', pl.menuGone || '');
      row('Right panel beside the columns', pl.sidebar || 'unseen', '');
      const ign = Object.keys((rep.parse || {}).ignoredOps || {});
      row('Posts under names not read as timelines', ign.length ? 'failing' : 'working', ign.length ? ign.slice(0, 6).join(', ') : 'none seen');
      const pr = rep.probe;
      if (pr) for (const [k, label] of Object.entries(PROBE_LABELS)) { const v = pr[k]; row('On X’s page: ' + label, v ? 'working' : 'failing', typeof v === 'number' ? String(v) : v ? 'found' : 'not found'); }
      const ps = rep.parse || {};
      body.replaceChildren(
        h('table', { className: 'status' }, h('tbody', {}, ...rows)),
        h('p', { className: 'muted', textContent: 'Version ' + (rep.version || '?') + ', last updated ' + when(rep.at) + (rep.failedOpen ? '. Columns gave up on ' + rep.failedOpen.route + ': ' + rep.failedOpen.why : '') + '. The parser read ' + (ps.tweets || 0) + ' of ' + (ps.tweetItems || 0) + ' posts X sent.' }));
    };
    const read = async () => {
      let v = null;
      try { v = storage ? (await storage.get('xmcFeatures')).xmcFeatures : JSON.parse(localStorage.getItem('xmc.features') || 'null'); } catch { v = null; }
      draw(v);
    };
    read();
    if (storage && ext.storage.onChanged) ext.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.xmcFeatures) draw(ch.xmcFeatures.newValue); });
    else window.addEventListener('storage', (e) => { if (e.key === 'xmc.features') read(); });
    return wrap;
  }

  // the memory behind "Posts I've already read\"
  function readingBlock() {
    const summary = h('p', { className: 'muted', id: 'read-summary' });
    const show = () => { summary.textContent = readCount ? readCount + ' posts remembered as read. Only their numbers are kept, on this device.' : 'No posts remembered yet.'; };
    show();
    const clear = h('button', { type: 'button', id: 'read-clear', textContent: 'Forget which posts I\u2019ve read' });
    clear.addEventListener('click', () => {
      readCount = 0; show();
      if (storage) storage.set({ seenPosts: [] }).catch(() => {}); else { try { localStorage.removeItem('xmc.seen'); } catch { /* ignore */ } }
      say('Forgot which posts you have read.');
    });
    summary.refresh = show;
    return h('div', { className: 'readblock' }, summary, h('div', { className: 'row' }, clear));
  }

  // what a saved file will actually be called, updated as the settings change
  function downloadExample(section) {
    const el = h('p', { className: 'muted dlexample' });
    const show = () => {
      const base = { account: 'someone', name: 'Some One', tweetId: '1790000000000000000', hash: 'AbCdEf', createdAt: Date.now() };
      const path = (ext, serial) => 'Downloads/' + XMCLogic.buildDownloadPath(settings, Object.assign({}, base, { ext, serial }));
      el.textContent = 'Saved as: ' + path('jpg', 1) + '   \u00b7   ' + path('mp4', 2);
    };
    show();
    section.addEventListener('change', () => setTimeout(show, 0)); // after the setting itself has been saved
    return el;
  }

  // A browser can only save inside its download folder: say so, rather than quietly doing something else
  function wireFolderHint() {
    const input = document.getElementById('opt-dlFolder');
    if (!input) return;
    const hint = h('div', { className: 'help warn', hidden: true });
    const help = input.closest('.item').querySelector('.help');
    if (help) help.after(hint); else input.closest('.item').firstChild.append(hint);
    const show = () => {
      const abs = XMCLogic.isAbsolutePath(input.value);
      const last = input.value.replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
      hint.hidden = !abs;
      if (abs) hint.textContent = 'A browser can\u2019t save outside its download folder, so this saves into a folder called \u201c' + last + '\u201d there. To save somewhere else, tick \u201cAsk me where to save each file\u201d below.';
    };
    input.addEventListener('input', show);
    show();
  }

  // starting points: each sets a handful of settings and leaves the rest alone. The box ticked is the one that matches what is
  // set now; "Custom" is the one picked when none does.
  let customPicked = false; // ("Custom" chosen by hand while the settings still match a preset: it stays ticked until a preset is picked)
  function presetsBlock() {
    const wrap = h('div', { className: 'presets' });
    const current = customPicked ? undefined : S.PRESETS.find((p) => S.presetApplies(p, settings));
    const row = (id, label, blurb, on, apply) => {
      const box = h('input', { type: 'radio', name: 'preset', id: 'preset-' + id, checked: on }); // (one of them: radio buttons, not boxes)
      box.addEventListener('change', () => { customPicked = !apply; if (apply) apply(); else refreshPresets(); });
      return h('div', { className: 'item bool' }, box,
        h('div', {}, h('label', { className: 'name', htmlFor: 'preset-' + id, textContent: label }), blurb ? h('div', { className: 'help', textContent: blurb }) : null));
    };
    for (const p of S.PRESETS) wrap.append(row(p.id, p.label, p.blurb, current === p, () => { persist(Object.assign({}, p.once, p.set)); build(); }));
    wrap.append(row('custom', 'Custom', '', !current, null));
    return wrap;
  }
  function refreshPresets() {
    const old = document.querySelector('.presets');
    if (old) old.replaceWith(presetsBlock());
  }

  // ---- what has been changed, and the search ----
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const changedKeys = () => [...document.querySelectorAll('.item[data-key]')].map((el) => el.dataset.key).filter((k) => !same(settings[k], S.DEFAULTS[k]));
  function refreshMarks() { // a dot and a Reset under every setting that is not at its default, and the count beside the search
    let n = 0;
    for (const el of document.querySelectorAll('.item[data-key]')) {
      const on = !same(settings[el.dataset.key], S.DEFAULTS[el.dataset.key]);
      el.classList.toggle('changed', on);
      const chg = el.querySelector('.chg');
      if (chg && chg.hidden === on) chg.hidden = !on;
      if (on) n++;
    }
    const c = $('#changed-count'); if (c && c.textContent !== String(n)) c.textContent = String(n);
    applyFind();
  }
  function resetItem(it) {
    const def = JSON.parse(JSON.stringify(S.DEFAULTS[it.key]));
    settings[it.key] = def;
    const el = document.getElementById('opt-' + it.key);
    if (el) { if (el.type === 'checkbox') el.checked = !!def; else el.value = def; }
    if (storage) storage.remove(it.key).catch((e) => say('Could not save: ' + e));
    else { try { localStorage.setItem('xmc.settings', JSON.stringify(S.diff(settings).set)); } catch { /* ignore */ } }
    setTimeout(refreshPresets, 0);
    refreshMarks();
    say('\u201c' + it.label + '\u201d is back to its default.');
  }
  function applyFind() {
    const box = $('#opt-search'), only = $('#only-changed');
    if (!box) return;
    const words = box.value.trim().toLowerCase().split(/\s+/).filter(Boolean), onlyChanged = !!only && only.checked, filtering = words.length > 0 || onlyChanged;
    let shown = 0;
    for (const sec of document.querySelectorAll('section[data-nav]')) {
      const title = (sec.dataset.nav || '').toLowerCase(), titleHit = words.length > 0 && words.every((w) => title.includes(w)) && !onlyChanged;
      let any = false;
      for (const it of sec.querySelectorAll('.item[data-key]')) {
        const hit = (!words.length || titleHit || words.every((w) => it.dataset.find.includes(w))) && (!onlyChanged || it.classList.contains('changed'));
        if (it.hidden === hit) it.hidden = !hit;
        if (hit) { any = true; shown++; }
      }
      for (const blk of sec.querySelectorAll('.presets, .navlist, .readblock, .dlexample, .statusblock, .keysblock')) blk.hidden = filtering && !titleHit; // (the extras that belong to a section show only when the section itself is what was asked for)
      sec.hidden = filtering && !any && !titleHit;
    }
    for (const a of document.querySelectorAll('#nav a')) { const target = document.getElementById(a.getAttribute('href').slice(1)); a.hidden = !!target && target.hidden; }
    document.body.classList.toggle('finding', filtering);
    if (POPUP) for (const b of document.querySelectorAll('#sections h2 > button.fold')) b.setAttribute('aria-expanded', String(filtering ? !b.closest('section').hidden : b.closest('section').classList.contains('open')));
    const st = $('#find-status');
    if (st) st.textContent = !filtering ? '' : shown ? shown + (shown === 1 ? ' setting' : ' settings') : 'No settings match.';
  }
  function wireFind() {
    const box = $('#opt-search'), only = $('#only-changed');
    box.addEventListener('input', applyFind);
    only.addEventListener('change', applyFind);
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape' && box.value) { e.preventDefault(); box.value = ''; applyFind(); } });
    document.addEventListener('keydown', (e) => { // "/" jumps to the search, as on most sites
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(input|textarea|select)$/i.test((e.target || {}).tagName || '')) { e.preventDefault(); box.focus(); box.select(); }
    });
  }

  // In the panel each section is a heading that unfolds (one at a time, and the last one left open is open next time); while there is a
  // search, every section with a match is open.
  const OPEN_KEY = 'xmc.popupOpen';
  function nestSections() {
    let last = ''; try { last = localStorage.getItem(OPEN_KEY) || ''; } catch { /* storage blocked */ }
    if (/^#sec-[\w-]+$/.test(location.hash)) last = location.hash.slice(1); // (asked for: "Mute words" opens that section)
    for (const sec of document.querySelectorAll('#sections section[data-nav]')) {
      const head = sec.querySelector('h2');
      if (!head || sec.querySelector('h2 > button.fold')) continue;
      const btn = h('button', { type: 'button', className: 'fold', ariaExpanded: 'false' }, h('span', { textContent: sec.dataset.nav }), h('span', { className: 'chev', textContent: '\u203a' }));
      btn.setAttribute('aria-expanded', 'false');
      btn.addEventListener('click', () => setOpen(sec, !sec.classList.contains('open')));
      head.replaceChildren(btn);
      if (sec.id === last) setOpen(sec, true, true);
    }
  }
  function setOpen(sec, open, quiet) {
    if (open) for (const other of document.querySelectorAll('#sections section.open')) if (other !== sec) setOpen(other, false, true); // (one at a time)
    sec.classList.toggle('open', open);
    const btn = sec.querySelector('h2 > button.fold'); if (btn) btn.setAttribute('aria-expanded', String(open));
    if (!quiet) { try { localStorage.setItem(OPEN_KEY, open ? sec.id : ''); } catch { /* storage blocked */ } if (open) sec.scrollIntoView({ block: 'nearest' }); }
  }

  function build() {
    const host = $('#sections');
    host.replaceChildren();
    for (const sec of S.SCHEMA) {
      const section = h('section', { id: 'sec-' + sec.id });
      section.dataset.nav = sec.title;
      section.append(h('h2', { textContent: sec.title }));
      if (sec.blurb) section.append(h('p', { className: 'blurb', textContent: sec.blurb }));
      for (const it of sec.items) {
        if (it.hidden) continue; // kept as a setting, not offered
        const c = control(it);
        const label = h('label', { className: 'name', htmlFor: 'opt-' + it.key, textContent: it.label },
          it.native ? h('span', { className: 'native-tag', title: 'Restyles X’s own pages, so it depends on X’s current layout', textContent: 'X page' }) : null);
        const reset = h('button', { type: 'button', className: 'reset', textContent: 'Reset', title: 'Back to the default', 'aria-label': 'Reset \u201c' + it.label + '\u201d to its default' });
        reset.addEventListener('click', () => resetItem(it));
        const changed = h('div', { className: 'chg', hidden: true }, h('span', { className: 'dot', 'aria-hidden': 'true' }), h('span', { textContent: 'Changed from the default' }), reset);
        const text = h('div', {}, label, it.help ? h('div', { className: 'help', textContent: it.help }) : null, changed);
        const row = it.type === 'bool' ? h('div', { className: 'item bool' }, c, text) : h('div', { className: 'item' }, text, c);
        row.dataset.key = it.key;
        row.dataset.find = [it.label, it.help || '', it.key, ...(it.options ? it.options.map((o) => o[1]) : [])].join(' ').toLowerCase(); // what the search looks in
        section.append(row);
      }
      if (sec.custom === 'presets') section.append(presetsBlock());
      if (sec.custom === 'nav') section.append(navBlock());
      if (sec.custom === 'reading') section.append(readingBlock());
      if (sec.custom === 'status') section.append(statusBlock());
      if (sec.custom === 'keys') section.append(keysBlock());
      if (sec.id === 'downloads') section.append(downloadExample(section));
      host.append(section);
    }
    wireFolderHint();
    if (POPUP) nestSections();
    const nav = $('#nav');
    nav.replaceChildren(...[...document.querySelectorAll('section[data-nav]')].map((s) => {
      const a = h('a', { href: '#' + s.id, textContent: s.dataset.nav });
      return a;
    }));
    refreshMarks(); // (after the links exist: it hides the ones whose section the search has taken out)
  }

  // The keys of a post's panel: what each does and the key it has now; press a row's key to choose another (Backspace puts the default back).
  function keysBlock() {
    const wrap = h('div', { className: 'keysblock' });
    const rows = h('div', { className: 'keyrows' });
    const msg = h('p', { className: 'keymsg', role: 'status' });
    const mineNow = () => { try { const v = JSON.parse(settings.keyMap || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
    const labelOf = (act) => (S.PANEL_KEY_ACTIONS.find(([a]) => a === act) || [])[1] || act;
    function assign(act, key) { // key null: back to the default
      const want = key || S.PANEL_KEY_DEFAULTS[act];
      const clash = Object.entries(S.panelKeyMap(settings.keyMap)).find(([a, k]) => a !== act && k === want);
      if (clash) { msg.textContent = S.keyLabel(want) + ' is already ' + labelOf(clash[0]) + '. Change that one first.'; return false; }
      const mine = mineNow();
      if (!key || key === S.PANEL_KEY_DEFAULTS[act]) delete mine[act]; else mine[act] = key;
      persist({ keyMap: Object.keys(mine).length ? JSON.stringify(mine) : '' });
      msg.textContent = '';
      return true;
    }
    function listen(act, btn) {
      btn.textContent = 'Press a key'; btn.classList.add('listening'); msg.textContent = '';
      const stop = () => { document.removeEventListener('keydown', on, true); btn.removeEventListener('blur', stop); draw(); };
      function on(e) {
        if (/^(Shift|Control|Alt|Meta|CapsLock|Tab)$/.test(e.key)) return;
        e.preventDefault(); e.stopPropagation();
        if (e.key === 'Escape') { stop(); return; }
        if (e.key === 'Backspace' || e.key === 'Delete') { if (assign(act, null)) stop(); return; }
        const k = e.key.toLowerCase();
        if (e.ctrlKey || e.altKey || e.metaKey || !S.okKey(k) || (k === 'enter' && act !== 'open')) { msg.textContent = 'A letter, a number or a punctuation mark, on its own (Enter is only for opening a post).'; return; }
        if (assign(act, k)) stop(); // (a key taken by another action: it says so and waits for another)
      }
      document.addEventListener('keydown', on, true);
      btn.addEventListener('blur', stop);
    }
    function draw() {
      const km = S.panelKeyMap(settings.keyMap);
      rows.replaceChildren(...S.PANEL_KEY_ACTIONS.map(([act, label]) => {
        const key = km[act];
        const btn = h('button', { type: 'button', className: 'kbtn', textContent: key ? S.keyLabel(key) : 'none', title: 'Press, then the key you want', 'aria-label': label + ': ' + (key ? S.keyLabel(key) : 'no key') + '. Press to choose another.' });
        btn.addEventListener('click', () => listen(act, btn));
        const reset = key === S.PANEL_KEY_DEFAULTS[act] ? h('span', { className: 'kmark' }) : h('button', { type: 'button', className: 'reset', textContent: 'Reset', 'aria-label': 'Put the key for ' + label + ' back to ' + S.keyLabel(S.PANEL_KEY_DEFAULTS[act]), onclick: () => { assign(act, null); draw(); } });
        return h('div', { className: 'keyrow' }, h('span', { className: 'kwhat', textContent: label }), btn, reset);
      }));
    }
    draw();
    wrap.append(h('p', { className: 'muted', textContent: 'The key for each, in a post\u2019s panel and in the picture viewer. Press a key to choose another; Backspace puts the default back.' }), rows, msg,
      h('p', { className: 'keyfixed', textContent: 'Always: \u2190 \u2192 through the pictures and then the posts, Shift with them for posts only, Enter to open the picture in a panel, Esc to close. The letters A, C, E, Q, S and W are ones Vimium leaves alone.' }));
    return wrap;
  }

  function renderHistory() {
    const list = $('#history-list');
    if (!list) return; // (the panel has no download history)
    $('#history-summary').textContent = history.length
      ? `${history.length} post${history.length === 1 ? '' : 's'} with saved media. Stored on this device only.`
      : 'Nothing downloaded yet.';
    list.hidden = !history.length;
    list.replaceChildren(...history.slice(0, 300).map((e) => h('li', {},
      h('a', { href: `https://x.com/${encodeURIComponent(e.handle)}/status/${encodeURIComponent(e.id)}`, textContent: '@' + e.handle + ' — ' + e.id, target: '_blank', rel: 'noopener' }),
      h('span', { className: 'muted', textContent: `${e.n} file${e.n === 1 ? '' : 's'} · ${new Date(e.at).toLocaleString()}` }))));
  }

  // highlight the section being read
  function watchScroll() {
    const links = [...document.querySelectorAll('#nav a')];
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) for (const a of links) a.classList.toggle('on', a.getAttribute('href') === '#' + en.target.id);
    }, { rootMargin: '-20% 0px -70% 0px' });
    document.querySelectorAll('section[data-nav]').forEach((s) => io.observe(s));
  }

  async function init() {
    await load();
    build();
    document.querySelectorAll('section[data-nav]').forEach((s, i) => { if (!s.id) s.id = 'sec-extra-' + i; });
    $('#nav').replaceChildren(...[...document.querySelectorAll('section[data-nav]')].map((s) => h('a', { href: '#' + s.id, textContent: s.dataset.nav })));
    renderHistory();
    watchScroll();
    wireFind();
    const sup = $('#support');
    const bits = [];
    if (XMCMeta.donate) bits.push(h('a', { href: XMCMeta.donate, textContent: 'Support', target: '_blank', rel: 'noopener' }));
    if (XMCMeta.repo) bits.push(document.createTextNode(bits.length ? ' \u00b7 ' : ''), h('a', { href: XMCMeta.repo, textContent: 'Source & issues', target: '_blank', rel: 'noopener' }));
    if (bits.length) { sup.replaceChildren(...bits); sup.hidden = false; }

    const on = (sel, type, fn) => { const el = $(sel); if (el) el.addEventListener(type, fn); }; // (the panel has no history or backup buttons)
    on('#history-clear', 'click', () => {
      history = [];
      if (storage) storage.set({ dlHistory: [] }); 
      renderHistory(); say('Download history cleared.');
    });
    on('#export', 'click', () => {
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'multi-column-for-x-settings.json' });
      document.body.append(a); a.click(); a.remove();
    });
    on('#import', 'change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const next = S.normalize(JSON.parse(await file.text()));
        persist(next); build(); say('Settings imported.');
      } catch { say('That file is not a settings export.'); }
      e.target.value = '';
    });
    on('#reset', 'click', () => {
      if (!confirm('Put every setting back to its default?')) return;
      persist(S.normalize()); build(); say('All settings reset.');
    });
    if (!FRAMED && ext && ext.tabs && ext.permissions) hereCheck(); // (the toolbar panel and the settings page; the gear's panel has no tabs API)
    { // the master switch: the page is dimmed under it while it is off, and nothing else changes
      const sw = $('#opt-enabled');
      if (sw) {
        const show = () => { sw.checked = settings.enabled !== false; document.body.classList.toggle('off', !sw.checked); };
        show();
        sw.addEventListener('change', () => { persist({ enabled: sw.checked }); show(); });
      }
    }
    on('#open-full', 'click', () => { // the whole page, in a tab (the panel closes as it opens)
      if (ext) ext.runtime.openOptionsPage().then(() => { if (FRAMED) toParent('settings-close'); else window.close(); }, () => {}); else window.open('options.html', '_blank');
    });
    if (FRAMED) {
      const close = $('#close-panel'); close.hidden = false; close.addEventListener('click', () => toParent('settings-close'));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.defaultPrevented && !$('#opt-search').value) toParent('settings-close'); }); // (Esc clears a search first)
      toParent('settings-ready');
    }
    if (storage && ext.storage.onChanged) {
      ext.storage.onChanged.addListener((ch, area) => {
        if (area !== 'local') return;
        if (ch.dlHistory) { history = ch.dlHistory.newValue || []; renderHistory(); }
        if (ch.seenPosts) { readCount = (ch.seenPosts.newValue || []).length; const sm = $('#read-summary'); if (sm && sm.refresh) sm.refresh(); }
        if (ch.navItems) { settings.navItems = ch.navItems.newValue || []; refreshNav(); }
        if (ch.hiddenNav) settings.hiddenNav = ch.hiddenNav.newValue || [];
        if (ch.enabled) { settings.enabled = ch.enabled.newValue !== false; const sw = $('#opt-enabled'); if (sw) { sw.checked = settings.enabled; document.body.classList.toggle('off', !sw.checked); } } // (turned on or off from another of these pages)
      });
    }
  }
  init();
})();
