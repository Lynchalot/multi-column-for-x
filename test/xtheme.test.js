const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/logic.js');
const S = require('../src/settings.js');
const T = L.xTheme;
const mocha = S.THEMES.find((t) => t.id === 'catppuccin-mocha'), latte = S.THEMES.find((t) => t.id === 'catppuccin-latte');

test('colours as X writes them are read: rgba with two decimals, hex of three to eight digits, the space syntax, a percent alpha', () => {
  assert.deepEqual(T.parseColour('rgba(0,0,0,1.00)'), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(T.parseColour('rgb(231, 233, 234)'), { r: 231, g: 233, b: 234, a: 1 });
  assert.deepEqual(T.parseColour('rgb(231 233 234 / 40%)'), { r: 231, g: 233, b: 234, a: 0.4 });
  assert.deepEqual(T.parseColour('#16181C'), { r: 22, g: 24, b: 28, a: 1 });
  assert.deepEqual(T.parseColour('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(T.parseColour('#00000080'), { r: 0, g: 0, b: 0, a: 0.5 });
  assert.equal(T.parseColour('var(--x)'), null);
  assert.equal(T.parseColour('transparent'), null);
  assert.equal(T.parseColour(''), null);
});

test('X’s black look: its colours become the theme’s by role, the alpha stays, and what is not X’s is left alone', () => {
  const r = (v) => T.recolourValue(v, 'dark', mocha);
  assert.equal(r('rgba(0,0,0,1.00)'), 'rgb(30, 30, 46)', 'background');
  assert.equal(r('rgba(22,24,28,1.00)'), 'rgb(49, 50, 68)', 'cards');
  assert.equal(r('rgba(47,51,54,1.00)'), 'rgb(69, 71, 90)', 'lines');
  assert.equal(r('rgba(231,233,234,1.00)'), 'rgb(205, 214, 244)', 'text');
  assert.equal(r('rgba(113,118,123,1.00)'), 'rgb(166, 173, 200)', 'quiet text');
  assert.equal(r('rgba(231,233,234,0.1)'), 'rgba(205, 214, 244, 0.1)', 'a hover wash keeps its alpha');
  assert.equal(r('rgba(239,243,244,1.00)'), 'rgb(205, 214, 244)', 'a white pill takes the text colour');
  assert.equal(r('rgba(15,20,25,1.00)'), 'rgb(30, 30, 46)', 'and its words the background');
  assert.equal(r('rgba(29,155,240,1.00)'), 'rgb(137, 180, 250)', 'the accent');
  assert.equal(r('rgba(30,155,241,1.00)'), 'rgb(137, 180, 250)', 'a unit or two off still is');
  assert.equal(r('rgba(255,255,255,1.00)'), 'rgba(255,255,255,1.00)', 'white over a picture is white');
  assert.equal(r('rgba(12,200,40,1.00)'), 'rgba(12,200,40,1.00)');
  assert.equal(r('0px 0px 0px 1px rgba(47,51,54,1.00), 0 2px 4px rgba(0,0,0,0.2)'), '0px 0px 0px 1px rgb(69, 71, 90), 0 2px 4px rgba(30, 30, 46, 0.2)', 'every colour in a shadow');
  assert.equal(r('linear-gradient(rgba(0,0,0,0), rgba(0,0,0,1.00))'), 'linear-gradient(rgba(30, 30, 46, 0), rgb(30, 30, 46))');
  assert.equal(r('none'), 'none');
  assert.equal(r('var(--x)'), 'var(--x)');
});

test('X’s white look: white is the background, the dark text is the theme’s text, the same colours in either theme', () => {
  assert.equal(T.recolourValue('rgba(255,255,255,1.00)', 'light', latte), 'rgb(239, 241, 245)');
  assert.equal(T.recolourValue('rgba(255,255,255,1.00)', 'light', mocha), 'rgb(30, 30, 46)', 'a dark theme on X’s white page');
  assert.equal(T.recolourValue('rgba(15,20,25,1.00)', 'light', mocha), 'rgb(205, 214, 244)');
  assert.equal(T.recolourValue('rgba(239,243,244,1.00)', 'light', latte), 'rgb(' + [1, 3, 5].map((i) => parseInt(latte.line.slice(i, i + 2), 16)).join(', ') + ')', 'lines');
});

test('every theme: nothing it paints is taken for X’s own colour (so rules made again are not made over), and the text keeps its contrast on the background and the cards', () => {
  const lum = (rgb) => { const c = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (const th of S.THEMES) {
    for (const look of ['dark', 'light']) {
      for (const slot of Object.keys(T.LOOKS[look])) {
        const to = T.themeRole(slot, th);
        assert.ok(to && to.length === 3, th.id + ' ' + slot);
      }
    }
    assert.ok(ratio(rgbOf(th.fg), rgbOf(th.bg)) >= 7, th.id + ' text on the background');
    assert.ok(ratio(rgbOf(th.fg), rgbOf(th.card)) >= 4.5, th.id + ' text on a card');
    assert.ok(ratio(rgbOf(th.muted), rgbOf(th.card)) >= 3, th.id + ' quiet text on a card');
  }
});
