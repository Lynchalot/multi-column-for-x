// Runs inside the page (manifest "world": "MAIN") at document_start.
// It only *observes*: when X's own code downloads timeline data, a copy is handed to the extension via
// window.postMessage. It never changes a request or a response, and sends nothing anywhere itself.
// The one thing it changes, and only when the setting "Skip X's age check" is on, is X's own client-side feature flag for its
// age-verification flow (the same flag Control Panel for Twitter turns off); nothing is requested from X differently.
(() => {
  'use strict';
  if (window.__xmcHook) return;
  window.__xmcHook = true;

  const GRAPHQL = /\/i\/api\/graphql\/[^/]+\/[A-Za-z0-9_]+/;
  const KEEP = 6; // the extension script loads a little later; remember recent responses so it can catch up
  const recent = [];

  // reqBody: the request's own body. X sends some timelines (Home) as POST with the paging cursor in the body,
  // not in the address, so the extension needs it to tell "next page" from "fresh first page".
  function emit(url, body, reqBody) {
    const msg = { source: 'xmc', url, body, reqBody: typeof reqBody === 'string' ? reqBody.slice(0, 30000) : '' };
    recent.push(msg);
    if (recent.length > KEEP) recent.shift();
    try { window.postMessage(msg, window.location.origin); } catch { /* structured clone failure: ignore */ }
  }

  window.addEventListener('message', (e) => {
    if (e.source === window && e.data && e.data.source === 'xmc-ready') {
      for (const msg of recent) window.postMessage(msg, window.location.origin);
    }
  });

  // "Skip X's age check": X's page decides whether to ask for age verification from a feature flag it keeps in its React props
  let skipAge = false, ageTimer = 0, ageTries = 0;
  function featureSwitches() {
    try {
      const first = document.querySelector('#react-root') && document.querySelector('#react-root').firstElementChild;
      const key = first && Object.keys(first).find((k) => k.startsWith('__reactProps'));
      const props = key && first[key].children && first[key].children.props && first[key].children.props.children && first[key].children.props.children.props;
      return props && props.contextProviderProps && props.contextProviderProps.featureSwitches;
    } catch { return null; }
  }
  function syncAge() {
    const fs = featureSwitches();
    if (!fs || typeof fs.isTrue !== 'function') return false;
    if (skipAge && !fs.__xmcIsTrue) {
      const orig = fs.isTrue;
      fs.__xmcIsTrue = orig;
      fs.isTrue = function (flag) { return flag === 'rweb_age_assurance_flow_enabled' ? false : orig.apply(this, arguments); };
    } else if (!skipAge && fs.__xmcIsTrue) { fs.isTrue = fs.__xmcIsTrue; delete fs.__xmcIsTrue; }
    return true;
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== 'xmc-flags') return;
    skipAge = !!e.data.skipAge;
    ageTries = 0;
    clearInterval(ageTimer);
    // X builds its page a moment after this script runs: keep trying for a while, then check now and then (X may rebuild it)
    ageTimer = setInterval(() => { ageTries++; if (syncAge() && ageTries > 40) { clearInterval(ageTimer); ageTimer = setInterval(syncAge, 5000); } }, 250);
  });

  // While the columns cover X's page, X's own (hidden) timeline must not start videos: they'd stream and decode for nothing.
  // Videos anywhere else (our own cards, X's media viewer, a post's own page) play normally.
  const nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    try {
      if (document.documentElement.classList.contains('xmc-on') && this.closest && this.closest('[data-testid="primaryColumn"]')) {
        this.pause();
        return Promise.resolve();
      }
    } catch { /* fall through to the real thing */ }
    return nativePlay.apply(this, arguments);
  };

  // While the extension's image viewer is open, take Escape and the arrow keys *before* X's own
  // handlers see them (X swallows them), and pass them on to the extension.
  window.addEventListener('keydown', (e) => {
    if (!document.documentElement.classList.contains('xmc-viewer')) return;
    if (e.key === 'Escape' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.stopImmediatePropagation();
      e.preventDefault();
      window.postMessage({ source: 'xmc-key', key: e.key }, window.location.origin);
    }
  }, true);

  // a failed timeline request (rate limit, server error) is told to the extension so it can say so
  function fail(url, res) {
    try {
      window.postMessage({ source: 'xmc-fail', url, status: res.status, reset: Number(res.headers && res.headers.get('x-rate-limit-reset')) || 0 }, window.location.origin);
    } catch { /* ignore */ }
  }

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    let bodyText = Promise.resolve('');
    try {
      const req = args[0], init = args[1];
      if (init && typeof init.body === 'string') bodyText = Promise.resolve(init.body);
      else if (req && typeof req === 'object' && typeof req.clone === 'function' && req.method && req.method !== 'GET') bodyText = req.clone().text().catch(() => '');
    } catch { /* ignore */ }
    const p = origFetch.apply(this, args);
    try {
      const req = args[0];
      const url = typeof req === 'string' ? req : (req && req.url) || String(req);
      if (GRAPHQL.test(url)) {
        p.then((res) => {
          if (!res) return;
          if (res.ok) Promise.all([res.clone().json(), bodyText]).then(([j, b]) => emit(url, j, b)).catch(() => {});
          else fail(url, res);
        }).catch(() => {});
      }
    } catch { /* never interfere with the page */ }
    return p;
  };

  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (body) {
    try { this.__xmcBody = typeof body === 'string' ? body : ''; } catch { /* ignore */ }
    return origSend.call(this, body);
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      const u = String(url);
      if (GRAPHQL.test(u)) {
        this.addEventListener('load', () => {
          try {
            if (this.status === 200 && (this.responseType === '' || this.responseType === 'text')) emit(u, JSON.parse(this.responseText), this.__xmcBody);
            else if (this.status === 200 && this.responseType === 'json' && this.response) emit(u, this.response, this.__xmcBody);
            else if (this.status >= 400) fail(u, { status: this.status, headers: { get: (h) => this.getResponseHeader(h) } });
          } catch { /* not JSON */ }
        });
      }
    } catch { /* ignore */ }
    return origOpen.call(this, method, url, ...rest);
  };
})();
