// Options page: built entirely from XMCSettings.SCHEMA, so a new setting needs no work here.
(() => {
  'use strict';
  const S = XMCSettings;
  const ext = typeof browser !== 'undefined' && browser.runtime && browser.runtime.id ? browser : null;
  const storage = ext && ext.storage && ext.storage.local;
  let settings = S.normalize();
  let history = [];

  const $ = (sel) => document.querySelector(sel);
  const h = (tag, props, ...kids) => { const n = Object.assign(document.createElement(tag), props || {}); n.append(...kids.filter(Boolean)); return n; };
  const say = (msg) => { $('#status').textContent = msg; };

  async function load() {
    let v;
    try { v = storage ? await storage.get(null) : JSON.parse(localStorage.getItem('xmc.settings') || '{}'); } catch { v = {}; }
    settings = S.normalize(v);
    history = Array.isArray(v.dlHistory) ? v.dlHistory : [];
  }
  function persist(partial) {
    Object.assign(settings, partial);
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
        const text = h('div', {}, label, it.help ? h('div', { className: 'help', textContent: it.help }) : null);
        section.append(it.type === 'bool' ? h('div', { className: 'item bool' }, c, text) : h('div', { className: 'item' }, text, c));
      }
      if (sec.custom === 'nav') section.append(navBlock());
      if (sec.id === 'downloads') section.append(downloadExample(section));
      host.append(section);
    }
    wireFolderHint();
    const nav = $('#nav');
    nav.replaceChildren(...[...document.querySelectorAll('section[data-nav]')].map((s) => {
      const a = h('a', { href: '#' + s.id, textContent: s.dataset.nav });
      return a;
    }));
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
        if (ch.navItems) { settings.navItems = ch.navItems.newValue || []; refreshNav(); }
        if (ch.hiddenNav) settings.hiddenNav = ch.hiddenNav.newValue || [];
      });
    }
  }
  init();
})();
