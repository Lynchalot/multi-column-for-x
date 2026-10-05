// Drives the real extension scripts in a real (headless) Chrome against a stand-in x.com. Each test is a thing that broke once.
// Run: npm run test:e2e   (needs Chrome; set XMC_BROWSER to a browser binary otherwise; skipped when none is found)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./harness.js');

let env = null;
test.before(async () => { env = await setup({ pages: 40 }); });
test.after(async () => { if (env) await env.teardown(); });

// wrap a test: skip without a browser, give the page, and fail on any script error the page logged
function browserTest(name, fn, timeout = 60000) {
  test(name, { timeout }, async (t) => {
    if (!env) return t.skip('no Chrome found (set XMC_BROWSER)');
    await fn(env, t);
  });
}
async function checked(h, fn) {
  try { await fn(); } finally { await h.close(); }
  assert.deepEqual(h.errors, [], 'the page logged script errors');
}

browserTest('home: columns draw, and the Columns button says what it does', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    assert.ok((await page.locator('.xmc-col').count()) >= 2, 'several columns at 1700px');
    assert.equal((await page.locator('#xmc-pill').innerText()).trim(), 'Turn Columns Off');
    await page.locator('#xmc-pill').click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('xmc-on'));
    assert.equal((await page.locator('#xmc-pill').innerText()).trim(), 'Turn Columns On');
    await page.locator('#xmc-pill').click();
    await page.waitForFunction(() => document.documentElement.classList.contains('xmc-on'));
  });
});

browserTest('loading keeps ahead of fast scrolling and the feed is never wiped', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    await e.ready(h.page);
    const r = await h.page.evaluate(async () => {
      const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
      const sc = document.querySelector('.xmc-scroller');
      let prev = 0, wiped = false, blank = 0;
      for (let k = 0; k < 40; k++) {
        sc.scrollTop += 900; await sleep(250);
        const n = window.__xmc.view.cards.length;
        if (n < prev || window.__xmc.view.version < 0) wiped = true;
        prev = n;
        const base = sc.getBoundingClientRect().top - sc.scrollTop;
        const shortest = Math.min(...[...document.querySelectorAll('.xmc-col')].map((c) => c.getBoundingClientRect().bottom - base));
        if (shortest < sc.scrollTop + sc.clientHeight) blank++;
      }
      return { cards: prev, wiped, blank };
    });
    assert.ok(r.cards >= 100, `drew ${r.cards} cards`);
    assert.equal(r.wiped, false, 'the columns were wiped while scrolling');
    assert.equal(r.blank, 0, 'blank space showed under a column');
  }, 90000);
}, 90000);

browserTest('comments for several posts load one after another, and scrolling meanwhile does not wipe the columns', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const r = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
      const cards = [...document.querySelectorAll('.xmc-card')].slice(0, 3);
      cards.forEach((c) => c.querySelector('[data-act="reply"]').click());
      const sc = document.querySelector('.xmc-scroller');
      const before = window.__xmc.view.cards.length; let wiped = false;
      for (let k = 0; k < 14; k++) { sc.scrollTop += 300; await sleep(60); if (window.__xmc.view.cards.length < before) wiped = true; }
      for (let i = 0; i < 160 && !cards.every((c) => c.querySelector('.xmc-ritem')); i++) await sleep(100);
      return { replies: cards.map((c) => c.querySelectorAll('.xmc-ritem').length), path: location.pathname, wiped, copy: !!document.getElementById('xmc-sidefreeze') };
    });
    assert.deepEqual(r.replies, [6, 6, 6]);
    assert.equal(r.path, '/home/', 'the page went back to the feed');
    assert.equal(r.wiped, false);
    await h.page.waitForFunction(() => !document.getElementById('xmc-sidefreeze'), null, { timeout: 5000 });
  });
});

browserTest('window resize: columns follow, and a fixed number gives way on a narrow window', async (e) => {
  const auto = await e.open('/home/', { width: 2000 });
  await checked(auto, async () => {
    await e.ready(auto.page);
    const cols = async () => auto.page.locator('.xmc-col').count();
    const wide = await cols();
    await auto.page.setViewportSize({ width: 1100, height: 900 });
    await auto.page.waitForFunction((n) => document.querySelectorAll('.xmc-col').length < n, wide);
    assert.equal(await cols(), 1);
  });
  const fixed = await e.open('/home/', { width: 2600, settings: { v: 8, cols: 5 } });
  await checked(fixed, async () => {
    await e.ready(fixed.page);
    const cols = () => fixed.page.locator('.xmc-col').count();
    const wide = await cols();
    await fixed.page.setViewportSize({ width: 1300, height: 900 });
    await fixed.page.waitForFunction((n) => document.querySelectorAll('.xmc-col').length < n, wide);
    assert.ok((await cols()) < wide, 'a fixed 5 squeezed into a narrow window');
    assert.equal(await fixed.page.evaluate(() => window.__xmc.settings.cols), 5, 'the number you chose is kept');
  });
});

browserTest('the right sidebar holds still when X moves its wrappers', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const r = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
      const side = document.querySelector('[data-testid="sidebarColumn"]');
      const wrap = document.createElement('div'), inner = document.createElement('div'), box = document.createElement('div');
      box.style.height = '100px'; inner.append(box); wrap.append(inner); side.prepend(wrap);
      const top = () => Math.round(box.getBoundingClientRect().top - side.getBoundingClientRect().top);
      const out = {};
      await sleep(700);
      for (const [name, el, css] of [['relative', wrap, 'position:relative;top:300px'], ['margin', wrap, 'margin-top:400px'], ['fixed', inner, 'position:fixed;top:-5000px'], ['transform', inner, 'transform:translateY(-900px)'], ['sticky', inner, 'position:sticky;top:-700px']]) {
        wrap.style.cssText = ''; inner.style.cssText = ''; el.style.cssText = css; await sleep(80); out[name] = top();
      }
      return out;
    });
    for (const [k, v] of Object.entries(r)) assert.equal(v, 0, `${k} moved the sidebar's contents by ${v}px`);
  });
});

browserTest('Following: Popular / Recent switch works even when X closes its menu on the click', async (e) => {
  const h = await e.open('/menu/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const ids = () => page.evaluate(() => window.__xmc.view.cards.slice(0, 2).map((t) => Number(t.id)));
    await page.evaluate(() => { window.__strict = true; });
    await page.locator('.xmc-tabs button', { hasText: 'Following' }).click();
    await page.waitForTimeout(1200);
    await page.locator('.xmc-tabs button', { hasText: 'Following' }).click(); // already there: X opens its menu, ours takes over
    await page.locator('.xmc-menu button', { hasText: 'Popular' }).click();
    await page.waitForFunction(() => window.__xmc.view.cards.length && Number(window.__xmc.view.cards[0].id) >= 94000, null, { timeout: 15000 });
    assert.ok((await ids())[0] >= 94000, 'Popular feed shown');
    assert.ok((await page.evaluate(() => window.__strictClosed)) > 0, 'the test X did close its menu');
    await page.locator('.xmc-tabs button', { hasText: 'Following' }).click();
    await page.locator('.xmc-menu button', { hasText: 'Recent' }).click();
    await page.waitForFunction(() => window.__xmc.view.cards.length && Number(window.__xmc.view.cards[0].id) < 94000, null, { timeout: 5000 });
  });
});

browserTest('profile Videos / Photos buttons drive X\'s own switch', async (e) => {
  const h = await e.open('/user/media/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const chips = () => page.locator('.xmc-bar2 .xmc-chip:visible').allInnerTexts();
    assert.deepEqual(await chips(), ['Videos', 'Photos']);
    await page.locator('.xmc-bar2 .xmc-chip:visible', { hasText: 'Photos' }).click();
    await page.waitForFunction(() => window.__xmc.view.cards.length && Number(window.__xmc.view.cards[0].id) >= 99000, null, { timeout: 15000 });
    await page.waitForFunction(() => /Photos/.test((document.querySelector('.xmc-tabs .on') || {}).textContent || ''), null, { timeout: 5000 });
  });
});

browserTest('Grok sits beside Chat, and the open chat panel is cut out of the columns', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForFunction(() => document.querySelector('[data-xmc-grok]') && document.querySelector('[data-xmc-dm]'), null, { timeout: 8000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const g = document.querySelector('[data-xmc-grok]').getBoundingClientRect(), c = document.querySelector('[data-xmc-dm]').getBoundingClientRect();
      return { left: g.right <= c.left, sameRow: Math.abs(g.bottom - c.bottom) <= 2 };
    });
    assert.deepEqual(r, { left: true, sameRow: true });
    await page.evaluate(() => { const d = document.getElementById('drawer'); d.style.width = '420px'; d.style.height = '520px'; const w = document.querySelector('[data-xmc-dm]'); w.style.width = '420px'; w.style.height = '520px'; });
    await page.waitForFunction(() => document.getElementById('xmc-root').style.clipPath, null, { timeout: 4000 });
  });
});

browserTest('a post\'s own page: Download and Copy link buttons, and fewer buttons under replies', async (e) => {
  const h = await e.open('/user/status/90001/');
  await checked(h, async () => {
    const { page } = h;
    await page.waitForFunction(() => document.querySelectorAll('.xmc-nat').length === 4, null, { timeout: 15000 });
    const r = await page.evaluate(() => {
      const vis = (el) => !!el && el.getBoundingClientRect().width > 0;
      return [...document.querySelectorAll('article')].map((a) => ({ tab: a.getAttribute('tabindex'), dl: vis(a.querySelector('.xmc-nat .dl')), bookmark: vis(a.querySelector('[data-testid="bookmark"]')), grok: vis(a.querySelector('[aria-label*="Grok"]')) }));
    });
    assert.deepEqual(r[0], { tab: '-1', dl: true, bookmark: true, grok: true }, 'the post itself keeps its buttons and gains Download (it has a photo)');
    for (const reply of r.slice(1)) assert.deepEqual(reply, { tab: '0', dl: false, bookmark: false, grok: false });
  });
});

browserTest('Explore is X\'s own page until you ask for columns', async (e) => {
  const h = await e.open('/explore/');
  await checked(h, async () => {
    const { page } = h;
    await page.waitForFunction(() => document.getElementById('xmc-pill') && !document.getElementById('xmc-pill').hidden, null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('xmc-on')), false);
    assert.equal((await page.locator('#xmc-pill').innerText()).trim(), 'Turn Columns On');
    await page.locator('#xmc-pill').click();
    await e.ready(page);
  });
});

browserTest('a page with no timeline data falls back to X\'s own page instead of waiting for ever', async (e) => {
  const h = await e.open('/nofeed/');
  await checked(h, async () => {
    const { page } = h;
    await page.waitForFunction(() => document.getElementById('xmc-pill') && document.getElementById('xmc-pill').dataset.text === 'Turn Columns Off', null, { timeout: 8000 });
    await page.waitForFunction(() => !document.documentElement.classList.contains('xmc-on'), null, { timeout: 20000 });
    assert.equal((await page.locator('#xmc-pill').innerText()).trim(), 'Turn Columns On');
  }, 40000);
}, 60000);

browserTest('Translate post opens the post instead of translating inside the columns', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    const r = await page.evaluate(async () => {
      const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelector('.xmc-translate'));
      const t = window.__xmc.view.cards.find((x) => x.el === c);
      c.querySelector('.xmc-translate').click();
      await new Promise((x) => setTimeout(x, 400));
      return { opened: window.__opened, expected: t.url, path: location.pathname, visit: !!window.__xmc.state.peek };
    });
    assert.equal(r.opened.length, 1);
    assert.ok(r.opened[0].endsWith(r.expected));
    assert.equal(r.path, '/home/');
    assert.equal(r.visit, false);
  });
});

browserTest('the settings page has no leftovers', async (e) => {
  const h = await e.open('/ext/options.html');
  await checked(h, async () => {
    await h.page.waitForSelector('#sec-columns');
    const text = await h.page.locator('body').innerText();
    for (const gone of [/aria2/i, /Outline around/i, /end of every file name/i, /Nothing you do here/i, /Each one is separate/]) assert.doesNotMatch(text, gone);
    assert.equal((await h.page.locator('#support a').first().innerText()).trim(), 'Support');
  });
});
