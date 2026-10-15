// Tweaks to X's own interface (sidebar, logo, side boxes, custom CSS). Almost all of it is CSS driven by
// classes on <html>; the rules live in styles.css. Anything that depends on X's current markup is
// best-effort: if X changes a selector, that one tweak quietly stops applying and nothing else breaks.
var XMCSite = (function () {
  'use strict';

  const THEME_BASE = ['--xmc-bg', '--xmc-solid', '--xmc-fg'], THEME_EXTRA = ['--xmc-muted', '--xmc-border', '--xmc-accent', '--xmc-on-accent', '--xmc-like', '--xmc-repost']; // (what a theme sets; THEME_BASE is what X's page gives when there is none)
  // boolean settings that map 1:1 to an <html> class of the same name, e.g. html.xmc-hideTrending
  const FLAGS = ['hideTrending', 'hideWhoToFollow', 'hideTopics', 'hideDiscoverMore', 'hidePremiumPromo', 'hideDmDrawer', 'hideGrokDrawer', 'hideVerifiedTabs',
    'hideSidebar', 'hideTweetButton', 'tidyReplies', 'systemFont', 'reducedInteraction', 'hideViews', 'hideBookmarkBtn', 'hideShareBtn'];

  // the classic bird, drawn on a 24x24 canvas
  const BIRD = 'M23.643 4.937c-.835.37-1.732.62-2.675.733.962-.576 1.7-1.49 2.048-2.578-.9.534-1.897.922-2.958 1.13-.85-.904-2.06-1.47-3.4-1.47-2.572 0-4.658 2.086-4.658 4.66 0 .364.042.718.12 1.06-3.873-.195-7.304-2.05-9.602-4.868-.4.69-.63 1.49-.63 2.342 0 1.616.823 3.043 2.072 3.878-.764-.025-1.482-.234-2.11-.583v.06c0 2.257 1.605 4.14 3.737 4.568-.392.106-.803.162-1.227.162-.3 0-.593-.028-.877-.082.593 1.85 2.313 3.198 4.352 3.234-1.595 1.25-3.604 1.995-5.786 1.995-.376 0-.747-.022-1.112-.065 2.062 1.323 4.51 2.093 7.14 2.093 8.57 0 13.255-7.098 13.255-13.254 0-.2-.005-.402-.014-.602.91-.658 1.7-1.477 2.323-2.41z';
  const SVGNS = 'http://www.w3.org/2000/svg';
  // Where X draws its logo. Found by position in the page (the sidebar's <h1> link), not by what the
  // drawing looks like, because X redraws its logo from time to time.
  const LOGO_SVGS = 'header[role="banner"] h1 svg, header[role="banner"] a[aria-label="X"] svg, header[role="banner"] a[aria-label="Twitter"] svg';
  const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#1d9bf0" d="${BIRD}"/></svg>`);

  let current = null;
  let cssEl = null;
  let navCssEl = null;
  let titleObserver = null;

  function fixTitle() {
    if (!current || current.branding !== 'twitter') return;
    const t = document.title;
    const n = t.replace(/ \/ X$/, ' / Twitter').replace(/ on X: /, ' on Twitter: ').replace(/^X$/, 'Twitter');
    if (n !== t) document.title = n;
  }

  function swapLogo(twitter) {
    for (const svg of document.querySelectorAll(LOGO_SVGS)) {
      let bird = svg.querySelector('path[data-xmc-bird]');
      if (twitter) {
        if (!bird) {
          bird = document.createElementNS(SVGNS, 'path');
          bird.setAttribute('d', BIRD);
          bird.setAttribute('data-xmc-bird', '');
          bird.style.fill = '#1d9bf0';
          svg.append(bird);
        }
        svg.setAttribute('viewBox', '0 0 24 24');
        for (const el of svg.children) if (el !== bird && el.style.display !== 'none') el.style.display = 'none';
      } else if (bird) {
        bird.remove();
        for (const el of svg.children) el.style.display = '';
      }
    }
  }

  // X blurs sensitive pictures with one rule in its own stylesheet (a 30px blur) and lays a notice over them. Found by that rule, it
  // can be switched off (Show) or the picture removed (Hide), on every page that is X's own: a post's page, a profile, search.
  let sensitiveEl = null, nativeSheet = null, blurSelector = null;
  function findBlurSelector() {
    const style = document.getElementById('react-native-stylesheet');
    const sheet = style && style.sheet;
    if (!sheet) return null;
    if (sheet !== nativeSheet) { nativeSheet = sheet; blurSelector = null; }
    if (blurSelector) return blurSelector;
    try {
      for (const rule of sheet.cssRules) {
        const m = rule instanceof CSSStyleRule && /blur\((\d+)px\)/.exec(rule.style.filter || '');
        if (m && Number(m[1]) >= 20) { blurSelector = rule.selectorText; break; }
      }
    } catch { /* not readable yet */ }
    return blurSelector;
  }
  function syncSensitive() {
    if (!current) return;
    const sel = current.nsfw === 'blur' ? null : findBlurSelector();
    const css = !sel ? '' : current.nsfw === 'show'
      ? sel + ' { filter: none !important; }\n' + sel + ' + div { display: none !important; }'
      : sel + ', ' + sel + ' + div { display: none !important; }';
    if (!sensitiveEl) { sensitiveEl = document.createElement('style'); sensitiveEl.id = 'xmc-sensitive-css'; document.head.append(sensitiveEl); }
    if (sensitiveEl.textContent !== css) sensitiveEl.textContent = css;
  }

  // ---- the colour theme on X's own pages ----
  // X draws its colours with one-declaration rules in its own stylesheet, and several rules often compete for one element (a base `color: black` that a later
  // `color: white` overrides). Every property that has one of X's colours in it somewhere (src/logic.js, XMCLogic.xTheme) is repeated, in X's order, in a style
  // element of ours with the theme's colours in place of X's: all the rules that set that property, not only the ones with a colour of X's, or the base would
  // win over what X puts over it. They have X's own priority and come after X's in the page, so what wins on X wins here, an inline colour still wins, and the
  // theme's colours are what show. X adds rules as it draws new things, so the stylesheets are counted four times a second and the repeats made again when the
  // count changes. Not seen on real X: what it left alone is in the diagnostics (`xTheme.unmapped`).
  let xThemeEl = null, xSig = '', xTimer = 0, xStats = null, xBuiltAt = 0;
  const xLook = () => {
    const c = XMCLogic.xTheme.parseColour(document.body && document.body.style.backgroundColor); // (X sets its page colour on <body> itself; the inline value is not touched by a stylesheet)
    if (c) return (c.r + c.g + c.b) / 3 > 127 ? 'light' : 'dark';
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  };
  const xSheets = () => { const out = []; for (const sh of document.styleSheets) { const n = sh.ownerNode; if (n && n.tagName === 'STYLE' && !/^xmc-/.test(n.id || '')) out.push(sh); } return out; };
  const xRuleCount = (sheets) => { let n = 0; for (const sh of sheets) { try { n += sh.cssRules.length; } catch { /* not readable */ } } return n; };
  const COLOURISH = /color|^background|^border|^outline|shadow|^fill$|^stroke$|decoration|caret|column-rule/; // (properties that can hold a colour; the longhands, as a style lists them)
  // X's style rules as a list of { sel, at, decls: [[property, recoloured value, priority, changed]] }: the declarations that could hold a colour, in X's order
  function readRules(rules, look, th, out, stats, at) {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        const decls = [];
        for (let i = 0; i < rule.style.length; i++) {
          const p = rule.style[i];
          if (!COLOURISH.test(p)) continue;
          const v = rule.style.getPropertyValue(p);
          if (!v) continue; // (a longhand of a shorthand with var() in it has no value to repeat)
          const nv = XMCLogic.xTheme.recolourValue(v, look, th, stats.unmapped);
          decls.push([p, nv, rule.style.getPropertyPriority(p), nv !== v]);
        }
        if (decls.length) out.push({ sel: rule.selectorText, at, decls });
      } else if ((rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) && rule.cssRules) {
        readRules(rule.cssRules, look, th, out, stats, at + (rule instanceof CSSMediaRule ? '@media ' : '@supports ') + rule.conditionText + '\u0001');
      }
    }
  }
  // the CSS for those: only the properties that changed somewhere, every rule's declaration of each, grouped again under their @media or @supports in the order they came
  function writeRules(list) {
    const changed = new Set();
    for (const r of list) for (const d of r.decls) if (d[3]) changed.add(d[0]);
    const lines = []; let rules = 0, open = '';
    const close = (to) => { // the at-rules open now and the ones wanted: close what is not wanted, open what is missing
      const have = open ? open.split('\u0001').slice(0, -1) : [], want = to ? to.split('\u0001').slice(0, -1) : [];
      let k = 0; while (k < have.length && k < want.length && have[k] === want[k]) k++;
      for (let j = have.length; j > k; j--) lines.push('}');
      for (let j = k; j < want.length; j++) lines.push(want[j] + ' {');
      open = to;
    };
    for (const r of list) {
      const keep = r.decls.filter((d) => changed.has(d[0]));
      if (!keep.length) continue;
      close(r.at);
      lines.push(r.sel + ' { ' + keep.map((d) => d[0] + ': ' + d[1] + (d[2] ? ' !' + d[2] : '')).join('; ') + ' }');
      rules++;
    }
    close('');
    return { css: lines, rules, props: changed.size };
  }
  function syncNativeTheme() {
    const th = current && current.themeNative ? XMCSettings.themeOf(current.theme) : null;
    if (!th) { if (xThemeEl) { xThemeEl.remove(); xThemeEl = null; } xSig = ''; xStats = null; return; }
    const look = xLook(), sheets = xSheets(), sig = look + '|' + th.id + '|' + xRuleCount(sheets);
    if (sig === xSig && xThemeEl && xThemeEl.isConnected) return;
    if (xThemeEl && xThemeEl.isConnected && Date.now() - xBuiltAt < 800) return; // (X adds rules in bursts: the repeats are made once the burst has slowed)
    xSig = sig; xBuiltAt = Date.now();
    const list = [], stats = { unmapped: {} };
    for (const sh of sheets) { try { readRules(sh.cssRules, look, th, list, stats, ''); } catch { /* a sheet that cannot be read */ } }
    const w = writeRules(list);
    w.css.push(':root { color-scheme: ' + (th.dark ? 'dark' : 'light') + ' !important; }', 'html, body { background-color: ' + th.bg + ' !important; }');
    if (!xThemeEl) { xThemeEl = document.createElement('style'); xThemeEl.id = 'xmc-xtheme-css'; }
    if (!xThemeEl.isConnected || xThemeEl.nextElementSibling) document.head.append(xThemeEl); // (last in the page, so it comes after every rule of X's)
    const css = w.css.join('\n');
    if (xThemeEl.textContent !== css) xThemeEl.textContent = css;
    const top = Object.entries(stats.unmapped).sort((a, b) => b[1] - a[1]).slice(0, 12);
    xStats = { look, theme: th.id, sheets: sheets.length, rules: w.rules, props: w.props, unmapped: top.map(([k, n]) => 'rgb(' + k + ') x' + n) };
  }
  function stopNativeTheme() { clearInterval(xTimer); xTimer = 0; if (xThemeEl) { xThemeEl.remove(); xThemeEl = null; } xSig = ''; const early = document.getElementById('xmc-early-bg'); if (early) early.remove(); }
  const themeReport = () => xStats;

  // things React may redraw, so they are re-applied now and then
  function refresh() {
    syncSensitive();
    syncNativeTheme();
    if (!current) return;
    const twitter = current.branding === 'twitter';
    swapLogo(twitter);
    if (twitter) {
      for (const sel of ['[data-testid="SideNav_NewTweet_Button"]', '[data-testid="tweetButton"]', '[data-testid="tweetButtonInline"]']) {
        for (const b of document.querySelectorAll(sel)) {
          for (const sp of b.querySelectorAll('span')) {
            if (sp.children.length === 0 && /^Post( all)?$/.test(sp.textContent)) sp.textContent = sp.textContent.replace('Post', 'Tweet');
          }
        }
      }
      if (!document.getElementById('xmc-favicon') || document.querySelectorAll('link[rel~="icon"]').length > 1) {
        document.querySelectorAll('link[rel~="icon"]').forEach((l) => l.remove());
        const l = document.createElement('link');
        l.id = 'xmc-favicon'; l.rel = 'icon'; l.type = 'image/svg+xml'; l.href = FAVICON;
        document.head.append(l);
      }
      fixTitle();
    }
  }

  const cssString = (s) => String(s).replace(/[\\"]/g, '\\$&');
  // sidebar entries the person chose to hide, by their link (the list comes from what the sidebar actually shows)
  function navCss(keys) {
    return keys.map((k) => `html header[role="banner"] a[href="${cssString(k)}"] { display: none !important; }`).join('\n');
  }

  function apply(s) {
    current = s;
    const cl = document.documentElement.classList;
    for (const k of FLAGS) cl.toggle('xmc-' + k, !!s[k]);
    cl.toggle('xmc-nocounts', !s.counts);
    cl.toggle('xmc-twitter', s.branding === 'twitter');
    for (const v of ['hide', 'logo']) cl.toggle('xmc-blue-' + v, s.blueBadge === v);
    { // a colour theme: the classes the stylesheet keys on, and its custom properties on <html> (the columns and the toast get theirs from main.js)
      const th = XMCSettings.themeOf(s.theme), tv = XMCSettings.themeVars(s.theme), st = document.documentElement.style;
      cl.toggle('xmc-themed', !!th); cl.toggle('xmc-theme-dark', !!th && th.dark); cl.toggle('xmc-theme-light', !!th && !th.dark);
      for (const k of THEME_EXTRA) { if (tv) st.setProperty(k, tv[k]); else st.removeProperty(k); }
      if (tv) for (const k of THEME_BASE) st.setProperty(k, tv[k]); // (without a theme main.js takes these from X's page)
    }
    cl.toggle('xmc-navfont-normal', s.navFont === 'normal');
    for (const v of ['compact', 'comfortable']) cl.toggle('xmc-navdens-' + v, s.navDensity === v);
    for (const v of ['show', 'blur', 'hide']) cl.toggle('xmc-nsfw-' + v, s.nsfw === v);

    if (!cssEl) { cssEl = document.createElement('style'); cssEl.id = 'xmc-custom-css'; document.head.append(cssEl); }
    if (cssEl.textContent !== s.customCss) cssEl.textContent = s.customCss;
    if (!navCssEl) { navCssEl = document.createElement('style'); navCssEl.id = 'xmc-nav-css'; document.head.append(navCssEl); }
    const nc = navCss(s.hiddenNav || []);
    if (navCssEl.textContent !== nc) navCssEl.textContent = nc;

    if (!titleObserver) {
      const t = document.querySelector('title');
      if (t) { titleObserver = new MutationObserver(fixTitle); titleObserver.observe(t, { childList: true, characterData: true, subtree: true }); }
    }
    { // the theme on X's own pages: the stylesheet is read again as X adds to it; the page's colour is kept in a note so hook.js can paint it from the first moment
      const th = s.themeNative ? XMCSettings.themeOf(s.theme) : null;
      if (th) { if (!xTimer) xTimer = setInterval(syncNativeTheme, 250); } else { clearInterval(xTimer); xTimer = 0; }
      try { if (th) localStorage.setItem('xmcThemeBg', th.bg + ' ' + (th.dark ? 'dark' : 'light')); else localStorage.removeItem('xmcThemeBg'); } catch { /* storage blocked */ }
      const early = document.getElementById('xmc-early-bg'); if (early && !th) early.remove(); // (turned off on this page: not left to the next load)
    }
    refresh();
  }

  // what the sidebar currently offers: [{key: link, label}]
  function sidebarItems() {
    const out = [];
    const nav = document.querySelector('header[role="banner"]');
    if (!nav) return out;
    for (const a of nav.querySelectorAll('nav a[href]:not([data-xmc-nav])')) {
      const key = a.getAttribute('href');
      if (!key || key[0] !== '/' || a.matches('[data-testid="SideNav_NewTweet_Button"]')) continue;
      const label = (a.textContent || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').replace(/^\d{1,3}\+?(?=\D)|(?<=\D)\d{1,3}\+?$/, '').trim().slice(0, 60); // (X draws an unread count inside the link, so its text reads "1Chat": the count is not part of the name)
      if (!label || out.some((i) => i.key === key)) continue;
      out.push({ key, label });
    }
    return out;
  }

  return { apply, refresh, sidebarItems, stopNativeTheme, themeReport, BIRD };
})();
