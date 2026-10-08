// An audit of what can be pressed: is every target at least 24 by 24 CSS px (WCAG 2.2, 2.5.8, with its two exceptions for a target that has
// room around it and for a link inside a sentence), and does every one have a name a screen reader can say (4.1.2)?
// Runs inside the page, over the extension's own elements only (X's are X's). Returns what fails, as short strings.
'use strict';

const OURS = '#xmc-root, #xmc-sidetab, #xmc-lightbox, #xmc-toast, [data-xmc-logo], [data-xmc-nav], #xmc-pill';

function auditInPage(scope) {
  const PRESSABLE = 'button, a[href], [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [role="switch"], input:not([type="hidden"]), select, textarea, summary, [tabindex="0"]';
  const root = scope ? document.querySelectorAll(scope) : [document.body];
  const all = [];
  for (const r of root) for (const el of [r, ...r.querySelectorAll(PRESSABLE)]) if (el.matches && el.matches(PRESSABLE) && !all.includes(el)) all.push(el);
  const shown = (el) => {
    if (el.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0;
  };
  const targets = all.filter(shown);
  const text = (el) => {
    const parts = [];
    const walk = (n) => {
      if (n.nodeType === 3) { parts.push(n.nodeValue); return; }
      if (n.nodeType !== 1) return;
      const cs = getComputedStyle(n); if (cs.display === 'none' || cs.visibility === 'hidden' || n.closest('svg')) return;
      if (n.tagName === 'IMG') { if (n.alt) parts.push(n.alt); return; }
      n.childNodes.forEach(walk);
    };
    el.childNodes.forEach(walk);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  };
  const nameOf = (el) => {
    const by = el.getAttribute('aria-labelledby');
    if (by) { const t = by.split(/\s+/).map((id) => (document.getElementById(id) || {}).textContent || '').join(' ').trim(); if (t) return t; }
    const al = (el.getAttribute('aria-label') || '').trim(); if (al) return al;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      if (el.id) { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l && l.textContent.trim()) return l.textContent.trim(); }
      const wrap = el.closest('label'); if (wrap && wrap.textContent.trim()) return wrap.textContent.trim();
      if (el.placeholder && el.type !== 'checkbox') return el.placeholder; // (a placeholder is a weak name, but a name)
    }
    const t = text(el); if (t) return t;
    const im = el.querySelector('img[alt]:not([alt=""])'); if (im) return im.alt;
    return (el.getAttribute('title') || '').trim();
  };
  const desc = (el) => { const id = el.id ? '#' + el.id : ''; const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 2).join('.'); return el.tagName.toLowerCase() + id + (cls ? '.' + cls : '') + (el.getAttribute('data-xmc-logo') ? '[logo]' : '') + (el.tagName === 'A' && el.getAttribute('href') ? ' -> ' + el.getAttribute('href').slice(0, 40) : ''); };
  const inSentence = (el) => el.tagName === 'A' && getComputedStyle(el).display === 'inline' && !!el.closest('.xmc-text, .xmc-qtext, .xmc-rbody, .xmc-pctx-text, .xmc-pbio, .xmc-profile p, .help, .muted, .blurb, p, li');
  const rects = targets.map((el) => el.getBoundingClientRect());
  const small = [], unnamed = [];
  targets.forEach((el, i) => {
    const b = rects[i];
    if (!nameOf(el)) unnamed.push(desc(el));
    if (b.width >= 24 && b.height >= 24) return;
    if (inSentence(el)) return;
    // the exception: a 24 px circle on its centre touches no other target
    const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
    const crowded = rects.some((o, j) => j !== i && !(targets[j].contains(targets[i]) || targets[i].contains(targets[j])) && o.right > cx - 12 && o.left < cx + 12 && o.bottom > cy - 12 && o.top < cy + 12);
    if (crowded || b.width < 14 || b.height < 14) small.push(desc(el) + ' ' + Math.round(b.width) + 'x' + Math.round(b.height) + (crowded ? ' (crowded)' : ''));
  });
  return { checked: targets.length, small, unnamed };
}

module.exports = { OURS, auditInPage };
