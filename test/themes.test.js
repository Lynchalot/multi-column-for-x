const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../src/settings.js');

const lum = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the colour themes: the ones from published palettes and Dark Academia, each with every colour the stylesheet reads', () => {
  assert.deepEqual(S.THEMES.map((t) => t.id), ['catppuccin-mocha', 'catppuccin-macchiato', 'catppuccin-frappe', 'catppuccin-latte', 'gruvbox-dark', 'gruvbox-light', 'rose-pine', 'rose-pine-dawn', 'dracula', 'tokyo-night', 'nord', 'everforest', 'kanagawa', 'dark-academia']);
  for (const t of S.THEMES) {
    for (const k of ['bg', 'fg', 'muted', 'line', 'card', 'accent', 'onAccent', 'like', 'repost']) assert.match(t[k], /^#[0-9a-f]{6}$/, t.id + ' ' + k);
    assert.equal(typeof t.dark, 'boolean');
    assert.equal(t.dark, lum(t.bg) < 0.4, t.id + ': dark says what the page colour says');
  }
  assert.equal(new Set(S.THEMES.map((t) => t.id)).size, S.THEMES.length);
});

test('every theme can be read: text, quiet text, the accent and the text on it', () => {
  for (const t of S.THEMES) {
    assert.ok(contrast(t.fg, t.bg) >= 7, t.id + ' text on the page ' + contrast(t.fg, t.bg).toFixed(2));
    assert.ok(contrast(t.muted, t.bg) >= 4.5, t.id + ' quiet text on the page ' + contrast(t.muted, t.bg).toFixed(2));
    assert.ok(contrast(t.onAccent, t.accent) >= 4.5, t.id + ' text on the accent ' + contrast(t.onAccent, t.accent).toFixed(2));
    for (const k of ['accent', 'like', 'repost']) assert.ok(contrast(t[k], t.bg) >= 2.9, // (the heart and the repost arrow are state colours; Latte's own green is 2.96)
       t.id + ' ' + k + ' on the page ' + contrast(t[k], t.bg).toFixed(2));
    assert.notEqual(t.card, t.bg, t.id + ': a card is a step off the page');
  }
});

test('the theme setting: X’s own colours unless one is chosen, and an unknown name is not one', () => {
  assert.equal(S.DEFAULTS.theme, 'x');
  const item = S.SCHEMA.flatMap((s) => s.items).find((i) => i.key === 'theme');
  assert.deepEqual(item.options.map((o) => o[0]), ['x'].concat(S.THEMES.map((t) => t.id)));
  assert.equal(S.normalize({ theme: 'gruvbox-dark' }).theme, 'gruvbox-dark');
  assert.equal(S.normalize({ theme: 'solarized' }).theme, 'x');
  assert.equal(S.themeVars('x'), null);
  assert.equal(S.themeOf('x'), null);
  const v = S.themeVars('catppuccin-mocha');
  assert.deepEqual(Object.keys(v).sort(), ['--xmc-accent', '--xmc-bg', '--xmc-border', '--xmc-fg', '--xmc-like', '--xmc-muted', '--xmc-on-accent', '--xmc-repost', '--xmc-solid']);
  assert.equal(v['--xmc-bg'], '#1e1e2e');
  assert.equal(v['--xmc-solid'], v['--xmc-bg']);
});
