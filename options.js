// Options page: built entirely from XMCSettings.SCHEMA, so a new setting needs no work here.
(() => {
  'use strict';
  const S = XMCSettings;
  const ext = typeof browser !== 'undefined' && browser.runtime && browser.runtime.id ? browser : null;
  const storage = ext && ext.storage && ext.storage.local;
  let settings = S.normalize();
  let history = [];
  let readCount = 0; // posts remembered as read (only their ids, on this device)

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

  // the memory behind "Posts I've already read"
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
  function presetsBlock() {
    const wrap = h('div', { className: 'presets' });
    const current = S.PRESETS.find((p) => S.presetApplies(p, settings));
    const row = (id, label, blurb, on, apply) => {
      const box = h('input', { type: 'radio', name: 'preset', id: 'preset-' + id, checked: on }); // (one of them: radio buttons, not boxes)
      box.addEventListener('change', () => { if (apply) apply(); else refreshPresets(); });
      return h('div', { className: 'item bool' }, box,
        h('div', {}, h('label', { className: 'name', htmlFor: 'preset-' + id, textContent: label }), blurb ? h('div', { className: 'help', textContent: blurb }) : null));
    };
    for (const p of S.PRESETS) wrap.append(row(p.id, p.label, p.blurb, current === p, () => { persist(p.set); build(); }));
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
      for (const blk of sec.querySelectorAll('.presets, .navlist, .readblock, .dlexample')) blk.hidden = filtering && !titleHit; // (the extras that belong to a section show only when the section itself is what was asked for)
      sec.hidden = filtering && !any && !titleHit;
    }
    for (const a of document.querySelectorAll('#nav a')) { const target = document.getElementById(a.getAttribute('href').slice(1)); a.hidden = !!target && target.hidden; }
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
      if (sec.id === 'downloads') section.append(downloadExample(section));
      host.append(section);
    }
    wireFolderHint();
    const nav = $('#nav');
    nav.replaceChildren(...[...document.querySelectorAll('section[data-nav]')].map((s) => {
      const a = h('a', { href: '#' + s.id, textContent: s.dataset.nav });
      return a;
    }));
    refreshMarks(); // (after the links exist: it hides the ones whose section the search has taken out)
  }

  function renderHistory() {
    const list = $('#history-list');
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

    $('#history-clear').addEventListener('click', () => {
      history = [];
      if (storage) storage.set({ dlHistory: [] }); 
      renderHistory(); say('Download history cleared.');
    });
    $('#export').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(settings, null, 2)], { type: 'application/json' });
      const a = h('a', { href: URL.createObjectURL(blob), download: 'multi-column-for-x-settings.json' });
      document.body.append(a); a.click(); a.remove();
    });
    $('#import').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const next = S.normalize(JSON.parse(await file.text()));
        persist(next); build(); say('Settings imported.');
      } catch { say('That file is not a settings export.'); }
      e.target.value = '';
    });
    $('#reset').addEventListener('click', () => {
      if (!confirm('Put every setting back to its default?')) return;
      persist(S.normalize()); build(); say('All settings reset.');
    });
    if (storage && ext.storage.onChanged) {
      ext.storage.onChanged.addListener((ch, area) => {
        if (area !== 'local') return;
        if (ch.dlHistory) { history = ch.dlHistory.newValue || []; renderHistory(); }
        if (ch.seenPosts) { readCount = (ch.seenPosts.newValue || []).length; const sm = $('#read-summary'); if (sm && sm.refresh) sm.refresh(); }
        if (ch.navItems) { settings.navItems = ch.navItems.newValue || []; refreshNav(); }
        if (ch.hiddenNav) settings.hiddenNav = ch.hiddenNav.newValue || [];
      });
    }
  }
  init();
})();
