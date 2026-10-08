const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// X's own page is scrolled by the extension (to make X load more posts and to find posts for actions).
// X sizes <html> and <body> to the window, so overflow:hidden/clip on either one clamps the page and
// freezes it: nothing can scroll it, even a script. That broke loading more and comments once.
test('the stylesheet never stops the page itself from scrolling', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const bad = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const targetsPage = selector.split(',').some((s) => /(^|\s)(html|body)(\.[\w-]+)*\s*$/.test(s.trim()) || /(^|\s)(html|body)(\.[\w-]+)*\s*(::|:)/.test(s.trim()));
    if (targetsPage && /overflow(-[xy])?\s*:\s*(hidden|clip)/.test(body)) bad.push(selector.trim());
  }
  assert.deepEqual(bad, [], 'these rules would freeze X’s page: ' + bad.join(' | '));
});

test('the page scrollbar is hidden (not disabled) while columns are showing', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  assert.match(css, /html\.xmc-on[^{]*\{[^}]*scrollbar-width:\s*none/);
});

// Motion is there to explain, never to make anyone wait: nothing animated may take longer than a fifth of a second, except the side
// panels folding and unfolding (marked by --xmc-ease), which may take 0.3s so that they glide. (The spinner turns for as long as
// something is loading, so it is exempt.)
test('motion is short: no animation or transition over 0.2s', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles.css'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
  const long = [];
  for (const line of css.split('\n')) {
    if (!/(animation|transition)\s*:/.test(line) || /xmc-spin/.test(line)) continue;
    const limit = /--xmc-ease/.test(line) ? 0.3 : 0.2;
    for (const m of line.matchAll(/(?:^|[\s,])(\d*\.?\d+)s\b/g)) if (Number(m[1]) > limit) long.push(line.trim().slice(0, 80));
  }
  for (const m of js.matchAll(/transition = '([^']*)'/g)) for (const d of m[1].matchAll(/(\d*\.?\d+)s\b/g)) if (Number(d[1]) > 0.2) long.push(m[1]);
  assert.deepEqual(long, []);
});
