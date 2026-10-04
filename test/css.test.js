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
