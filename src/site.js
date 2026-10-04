// Tweaks to X's own interface (sidebar, logo, side boxes, custom CSS). Almost all of it is CSS driven by
// classes on <html>; the rules live in styles.css. Anything that depends on X's current markup is
// best-effort: if X changes a selector, that one tweak quietly stops applying and nothing else breaks.
var XMCSite = (function () {
  'use strict';

  // boolean settings that map 1:1 to an <html> class of the same name, e.g. html.xmc-hideTrending
  const FLAGS = ['hideTrending', 'hideWhoToFollow', 'hideTopics', 'hideDiscoverMore', 'hidePremiumPromo', 'hideDmDrawer', 'hideGrokDrawer', 'hideVerifiedTabs',
    'hideSidebar', 'hideTweetButton', 'systemFont', 'reducedInteraction', 'hideViews', 'hideBookmarkBtn', 'hideShareBtn'];

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

  // things React may redraw, so they are re-applied now and then
  function refresh() {
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
    refresh();
  }

  // what the sidebar currently offers: [{key: link, label}]
  function sidebarItems() {
    const out = [];
    const nav = document.querySelector('header[role="banner"]');
    if (!nav) return out;
    for (const a of nav.querySelectorAll('nav a[href]')) {
      const key = a.getAttribute('href');
      if (!key || key[0] !== '/' || a.matches('[data-testid="SideNav_NewTweet_Button"]')) continue;
      const label = (a.textContent || a.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!label || out.some((i) => i.key === key)) continue;
      out.push({ key, label });
    }
    return out;
  }

  return { apply, refresh, sidebarItems, BIRD };
})();
