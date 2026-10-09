// A sample of what X sends and of the markup this extension presses, with the words taken out, for whoever has to fix a change in X's pages.
// The structure stays (the names of the fields, their types, the ids and the kinds of entry), the words, names and addresses do not.
// "Save sample" in a post's ... menu writes it to a file; nothing is sent anywhere. See test/fixtures/real/README.md.
var XMCSample = (() => {
  'use strict';
  // strings that are the shape of the data, not its content: kept as they are
  const ENUM_KEYS = /^(__typename|itemType|entryType|cursorType|displayType|type|result_type|component|element|conversationSection|reason|contentType|content_type|state|status|lang|source_type|kind)$/;
  const ID_KEYS = /(^|_)(id|ids|rest_id|id_str|key)$|_id_str$|^(entryId|sortIndex|cursor|value)$/;
  const CDN = /^https:\/\/(pbs|video|abs|ton)\.twimg\.com\//;
  const PUBLIC_URL_KEYS = /^(media_url_https|image_url|profile_image_url_https|profile_banner_url|url)$/;
  const filler = (s) => { const n = Array.from(s).length; return Array.from('lorem ipsum dolor sit amet, consectetur adipiscing elit '.repeat(Math.ceil(n / 8) + 1)).slice(0, n).join(''); };

  function sanitizeJson(node, key) {
    if (Array.isArray(node)) return node.map((x) => sanitizeJson(x, key));
    if (node && typeof node === 'object') { const out = {}; for (const k of Object.keys(node)) out[k] = sanitizeJson(node[k], k); return out; }
    if (typeof node !== 'string') return node; // numbers, booleans and null say how X shapes its data and carry nothing of anyone's
    key = key || '';
    if (/^\d{3,}$/.test(node)) return node; // an id: a public post's or account's number
    if (ENUM_KEYS.test(key) && node.length <= 60 && !/\s/.test(node)) return node;
    if (ID_KEYS.test(key) && node.length <= 120 && !/\s/.test(node)) return node.replace(/[A-Za-z0-9+/=_-]{24,}/g, (m) => 'x'.repeat(m.length)); // (a cursor is long and opaque: its length is kept, not its contents)
    if (/^[A-Za-z]+-\d+/.test(node) && node.length <= 80) return node; // an entry's id: tweet-123, cursor-bottom-456
    if (CDN.test(node) && (PUBLIC_URL_KEYS.test(key) || /media|image|profile|video/i.test(key))) return node.split('?')[0];
    if (/^\w{3} \w{3} \d{1,2} \d{2}:\d{2}:\d{2} [+-]\d{4} \d{4}$/.test(node)) return node; // a date in X's form
    if (/^(en|[a-z]{2}(-[A-Za-z]{2,4})?)$/.test(node) && /lang/i.test(key)) return node;
    return filler(node);
  }

  // markup: the tags and attributes stay, words and addresses go, except a short label on a button or link (those are what a control is found by)
  // An address with no handle in it: the path of X's own pages as it is, a profile's first segment as 'user', numbers as 1, no query.
  const OWN_PAGES = /^(home|explore|notifications|messages|i|search|settings|compose|jobs|grok|lists|bookmarks|communities|premium|tos|privacy|login|logout|signup|hashtag|intent|share|account)$/;
  function cleanHref(v) {
    const m = /^(https?:\/\/[^/]+)?(\/[^?#]*)?/.exec(v) || [];
    const segs = (m[2] || '').split('/').filter(Boolean).map((x) => x.replace(/\d+/g, '1'));
    if (segs.length && !OWN_PAGES.test(segs[0])) segs[0] = 'user';
    return (m[1] || '') + (segs.length ? '/' + segs.join('/') : (m[2] || ''));
  }

  function sanitizeMarkup(el, keepLabels = true) {
    const clone = el.cloneNode(true);
    const walk = (n) => {
      if (n.nodeType === 3) {
        const t = n.nodeValue, up = n.parentElement;
        // a label is kept on a button or a tab, and on a link of the menu or the tab bar: not on any other link (a post's author is a link) and never
        // where a person's name or handle sits
        const inControl = up && up.closest('button, [role="button"], [role="tab"], nav a, [role="tablist"] a');
        const aboutAPerson = up && up.closest('[data-testid="User-Name"], [data-testid^="UserAvatar"], [data-testid="UserCell"], [data-testid="UserDescription"], [data-testid^="UserProfile"]');
        n.nodeValue = keepLabels && inControl && !aboutAPerson && t.length <= 24 && !/@/.test(t) ? t : (t.trim() ? '⟨' + t.trim().length + '⟩' : t);
        return;
      }
      if (n.nodeType !== 1) return;
      for (const a of [...n.attributes]) {
        const v = a.value;
        if (a.name === 'href') n.setAttribute('href', cleanHref(v));
        else if (a.name === 'src' || a.name === 'srcset' || a.name === 'poster') n.removeAttribute(a.name);
        else if (a.name === 'style') n.setAttribute('style', v.replace(/url\([^)]*\)/g, 'url()'));
        else if (a.name === 'data-testid') n.setAttribute(a.name, v.replace(/^(UserAvatar-Container-).+$/, '$1user').replace(/^\d{4,}(?=-)/, '1')); // (some test ids carry a handle or a user's number)
        else if (/^(aria-label|title|alt|placeholder|value|aria-describedby|aria-labelledby)$/.test(a.name) && !(keepLabels && v.length <= 40 && !/\d{4,}/.test(v) && !/@/.test(v))) n.setAttribute(a.name, '⟨' + v.length + '⟩');
      }
      if (n.tagName && n.tagName.toLowerCase() === 'svg') { n.replaceChildren(); return; }
      for (const c of [...n.childNodes]) walk(c);
    };
    walk(clone);
    return clone.outerHTML;
  }

  const api = { sanitizeJson, sanitizeMarkup };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
