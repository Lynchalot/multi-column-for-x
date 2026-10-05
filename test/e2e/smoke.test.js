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
    await page.waitForFunction(() => document.querySelectorAll('.xmc-nat').length === 7, null, { timeout: 15000 });
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

browserTest('a long session: far-off posts give their nodes back, and nothing moves when they return', async (e) => {
  const h = await e.open('/home/', { height: 800 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    // scroll a long way down
    await page.evaluate(async () => {
      const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
      const sc = document.querySelector('.xmc-scroller');
      for (let k = 0; k < 90 && window.__xmc.view.cards.length < 420; k++) { sc.scrollTop = sc.scrollHeight; await sleep(300); }
    });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((x) => setTimeout(x, ms));
      const sc = document.querySelector('.xmc-scroller');
      const far = window.__xmc.view.cards.slice(0, 80).map((t) => t.el);
      const heights0 = far.map((el) => el.getBoundingClientRect().height);
      const nodes0 = document.getElementsByTagName('*').length;
      for (let i = 0; i < 12; i++) { window.__xmc.recycle(false); await sleep(30); }
      const nodes1 = document.getElementsByTagName('*').length;
      const drift = Math.max(...far.map((el, i) => Math.abs(el.getBoundingClientRect().height - heights0[i])));
      const gone = document.querySelectorAll('.xmc-card[data-recycled="1"]').length;
      const first = window.__xmc.view.cards[0].el;
      const firstGone = first.dataset.recycled === '1', firstEmpty = first.childNodes.length === 0;
      // back to the top: the first posts come back with their contents, and the page height is what it was
      sc.scrollTop = 0; await sleep(900);
      for (let i = 0; i < 12; i++) { window.__xmc.recycle(true); await sleep(30); }
      const back = far.slice(0, 10).map((el, i) => Math.abs(el.getBoundingClientRect().height - heights0[i]));
      return { cards: window.__xmc.view.cards.length, nodes0, nodes1, drift, gone, firstGone, firstEmpty,
        firstBack: first.dataset.recycled !== '1' && !!first.querySelector('.xmc-text'), backDrift: Math.max(...back) };
    });
    assert.ok(r.cards >= 300, `only ${r.cards} posts`);
    assert.ok(r.gone > 100, `only ${r.gone} posts were recycled`);
    assert.ok(r.nodes1 < r.nodes0 * 0.7, `nodes ${r.nodes0} -> ${r.nodes1}`);
    assert.ok(r.drift < 0.05, `a recycled post changed height by ${r.drift}px`);
    assert.ok(r.firstGone && r.firstEmpty, 'the first post, far above, was not recycled');
    assert.ok(r.firstBack, 'the first post did not come back');
    assert.ok(r.backDrift < 30, `a returned post is ${r.backDrift}px off its old height`);
  }, 120000);
}, 150000);

browserTest('the health check shows a warning in the top bar when things keep failing', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    assert.equal(await page.locator('.xmc-health').isVisible(), false, 'nothing to warn about yet');
    await page.evaluate(() => { for (let i = 0; i < 3; i++) window.__xmc.state.actionFails.push(Date.now()); });
    await page.waitForSelector('.xmc-health:not([hidden])', { timeout: 5000 });
    assert.match(await page.locator('.xmc-health').getAttribute('title'), /reach X.s buttons/);
    assert.deepEqual(await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).health), ['actions']);
    await page.evaluate(() => { window.__xmc.state.actionFails.length = 0; });
    await page.waitForSelector('.xmc-health', { state: 'hidden', timeout: 5000 });
  });
});

// ---- reading options ----
// the post numbers the stand-in sends on its first three pages (a repost is known by the post it reposts)
const FIRST_PAGE = Array.from({ length: 60 }, (_, g) => String((g % 20) % 8 === 5 ? 590000 - g : 90000 - g)); // g: place in the feed; every page has reposts at 5 and 13

const POST_SIZE_SHELVED = true; // see DENSITY_SHELVED in src/main.js
browserTest('post size: text only keeps pictures behind a click, compact fits more columns, the top-bar button cycles', async (e, t) => {
  if (POST_SIZE_SHELVED) return t.skip('post size is shelved');
  const normal = await e.open('/home/', { width: 2000 });
  const text = await e.open('/home/', { settings: { v: 8, density: 'text' } });
  const compact = await e.open('/home/', { settings: { v: 8, density: 'compact' }, width: 2000 });
  let normalCols = 0;
  await checked(normal, async () => {
    await e.ready(normal.page);
    normalCols = await normal.page.locator('.xmc-col').count();
    assert.equal(await normal.page.locator('.xmc-density').innerText(), 'Normal');
    await normal.page.locator('.xmc-density').click(); // normal -> compact
    await normal.page.waitForFunction(() => document.getElementById('xmc-root').classList.contains('xmc-compact'));
    assert.equal(await normal.page.evaluate(() => window.__xmc.settings.density), 'compact', 'what the button picked is the saved setting');
    assert.equal(await normal.page.locator('.xmc-density').innerText(), 'Compact');
    await normal.page.locator('.xmc-density').click(); // compact -> text
    await normal.page.waitForFunction(() => document.querySelector('.xmc-mediachip') && !document.querySelector('.xmc-media'));
  });
  await checked(text, async () => {
    await e.ready(text.page);
    assert.equal(await text.page.locator('.xmc-card .xmc-media').count(), 0, 'no picture or video drawn');
    assert.equal(await text.page.locator('.xmc-card video').count(), 0);
    const chips = await text.page.locator('.xmc-mediachip').count();
    assert.ok(chips >= 3, `${chips} cards with pictures show a label instead`);
    assert.match(await text.page.locator('.xmc-mediachip').first().innerText(), /photo|video|GIF/);
    const before = await text.page.locator('.xmc-card').first().evaluate((el) => el.getBoundingClientRect().height);
    const at = await text.page.evaluate(() => [...document.querySelectorAll('.xmc-card')].findIndex((c) => c.querySelector('.xmc-mediachip')));
    const card = text.page.locator('.xmc-card').nth(at); // by place, since it stops matching "has a label" once opened
    await card.locator('.xmc-mediachip').click();
    await text.page.waitForFunction(() => document.querySelector('.xmc-card .xmc-media'));
    assert.equal(await card.locator('.xmc-mediachip').count(), 0, 'the label gave way to the media');
    assert.ok(before > 0);
    assert.equal(await text.page.evaluate(() => location.pathname), '/home/', 'the click did not open the post');
  });
  await checked(compact, async () => {
    await e.ready(compact.page);
    assert.ok((await compact.page.locator('.xmc-col').count()) > normalCols, 'smaller posts, more columns');
    const w = await compact.page.locator('.xmc-card').first().evaluate((el) => el.getBoundingClientRect().width);
    assert.ok(w < 500, `compact cards are narrower (${Math.round(w)}px)`);
  });
});

browserTest('per-page layouts: a page keeps what you picked there, and the others are left alone', async (e) => {
  const cfg = { v: 8, cols: 4, perPageLayout: true, pageLayouts: { home: { cols: 2 } } };
  const wide = { width: 2400 }; // wide enough that a fixed four fits
  const home = await e.open('/home/', { settings: cfg, ...wide });
  const other = await e.open('/menu/', { settings: cfg, ...wide });
  const off = await e.open('/home/', { settings: { v: 8, cols: 4, pageLayouts: { home: { cols: 2 } } }, ...wide });
  await checked(home, async () => {
    await e.ready(home.page);
    assert.equal(await home.page.locator('.xmc-col').count(), 2, 'Home has its own two columns');
    await home.page.locator('.xmc-colgroup button', { hasText: '+' }).click();
    await home.page.waitForFunction(() => document.querySelectorAll('.xmc-col').length === 3);
    const s = await home.page.evaluate(() => ({ cols: window.__xmc.settings.cols, own: window.__xmc.settings.pageLayouts.home }));
    assert.equal(s.cols, 4, 'the global setting is untouched');
    assert.equal(s.own.cols, 3, 'the pick is kept for Home');
    const stored = await home.page.evaluate(() => JSON.parse(localStorage.getItem('xmc.settings')));
    assert.equal(stored.pageLayouts.home.cols, 3, 'and saved');
  });
  await checked(other, async () => {
    await e.ready(other.page);
    assert.equal(await other.page.locator('.xmc-col').count(), 4, 'another page follows the global setting');
  });
  await checked(off, async () => {
    await e.ready(off.page);
    assert.equal(await off.page.locator('.xmc-col').count(), 4, 'with the setting off, saved page layouts are ignored');
  });
});

browserTest('repost folding: several people reposting the same post make one card', async (e) => {
  const on = await e.open('/dupes/', { settings: { v: 8, collapseReposts: true } });
  const off = await e.open('/dupes/');
  await checked(off, async () => {
    await e.ready(off.page, 12);
    const dupes = await off.page.evaluate(() => { const ids = window.__xmc.view.cards.map((t) => t.id); return ids.length - new Set(ids).size; });
    assert.ok(dupes >= 1, 'without folding the same post is drawn twice (that is what the stand-in sends)');
  });
  await checked(on, async () => {
    await e.ready(on.page, 8);
    const r = await on.page.evaluate(() => {
      const ids = window.__xmc.view.cards.map((t) => t.id);
      const lines = [...document.querySelectorAll('.xmc-card > .xmc-ctx')].map((c) => c.innerText.trim());
      return { dupes: ids.length - new Set(ids).size, lines, reposts: window.__xmc.view.cards.filter((t) => t.repostedBy).length };
    });
    assert.equal(r.dupes, 0, 'no post is drawn twice');
    assert.ok(r.lines.length && r.lines.every((l) => /^User \d+ and User \d+ (reposted|retweeted)$/.test(l)), 'the card names both: ' + r.lines.join(' | '));
    assert.ok(r.reposts >= 1);
    const one = await on.page.locator('.xmc-card > .xmc-ctx').first().evaluate((el) => ({ h: el.getBoundingClientRect().height, sh: el.scrollWidth <= el.clientWidth + 1 }));
    assert.ok(one.h < 30 && one.sh, 'the line stays on one line');
  });
});

browserTest('read posts: hidden on the next visit (not while you read), counted, shown on request, faded on request', async (e) => {
  const h = await e.open('/home/', { settings: { v: 8, seen: 'hide' } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const before = await page.evaluate(() => window.__xmc.view.cards.length);
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('xmc.seen') || '[]').length >= 4; } catch { return false; } }, null, { timeout: 15000 });
    assert.ok((await page.evaluate(() => window.__xmc.view.cards.length)) >= before, 'what you read is not taken away while you are reading');
    const read = await page.evaluate(() => JSON.parse(localStorage.getItem('xmc.seen')));
    assert.ok(read.every((id) => /^\d+$/.test(id)), 'only post numbers are kept');
    await page.reload(); // a new visit
    await e.ready(page, 4);
    const r = await page.evaluate((ids) => ({ shown: window.__xmc.view.cards.map((t) => t.id), hidden: window.__xmc.view.hiddenSeen, btn: document.querySelector('.xmc-seenbtn').hidden ? '' : document.querySelector('.xmc-seenbtn').innerText }), read);
    assert.equal(r.shown.filter((id) => read.includes(id)).length, 0, 'the posts you read last time are gone');
    assert.ok(r.shown.length >= 4, 'the rest of the feed is there');
    assert.ok(r.hidden >= read.length - 1, 'and counted');
    assert.match(r.btn, /^\d+ hidden$/);
    await page.locator('.xmc-seenbtn').click();
    await page.waitForFunction((n) => window.__xmc.view.cards.length >= n && window.__xmc.view.cards.some((t) => t.id === '90000'), 4);
    assert.equal(await page.locator('.xmc-seenbtn').innerText(), 'Hide read');
    await page.locator('.xmc-seenbtn').click();
    await page.waitForFunction(() => !window.__xmc.view.cards.some((t) => t.id === '90000'));
  });
  const dim = await e.open('/home/', { settings: { v: 8, seen: 'dim' }, seen: FIRST_PAGE.slice(0, 10) });
  await checked(dim, async () => {
    await e.ready(dim.page, 12);
    const r = await dim.page.evaluate(() => ({ faded: [...document.querySelectorAll('.xmc-card.xmc-read')].length, kept: window.__xmc.view.cards.filter((t) => t.el.classList.contains('xmc-read')).map((t) => t.id) }));
    assert.ok(r.faded >= 7, `${r.faded} read posts are faded, not removed (the other kinds of post are on their own tab)`);
    assert.ok(r.kept.every((id) => FIRST_PAGE.slice(0, 10).includes(id)), 'and only the ones read');
  });
  const other = await e.open('/menu/', { settings: { v: 8, seen: 'hide' }, seen: FIRST_PAGE });
  await checked(other, async () => {
    await e.ready(other.page, 8);
    assert.ok(await other.page.evaluate(() => window.__xmc.view.cards.some((t) => t.id === '90000')), 'a profile is never filtered by what you have read');
  });
});

browserTest('read posts: when everything recent is read it says so and stops loading older ones; "keep loading" goes on', async (e) => {
  const h = await e.open('/home/', { settings: { v: 8, seen: 'hide' }, seen: FIRST_PAGE });
  await checked(h, async () => {
    const { page } = h;
    await page.waitForFunction(() => window.__xmc && window.__xmc.view.caughtUp, null, { timeout: 20000 });
    await page.waitForSelector('.xmc-scroller > .xmc-end:not([hidden])');
    assert.match(await page.locator('.xmc-scroller > .xmc-end:not([hidden])').innerText(), /caught up/);
    assert.equal(await page.evaluate(() => window.__xmc.view.cards.length), 0);
    await page.waitForTimeout(2500);
    const loaded = await page.evaluate(() => [...window.__xmc.state.feeds.values()].reduce((n, f) => n + f.items.length, 0));
    assert.ok(loaded <= 100, `it stopped asking X for older posts (${loaded} loaded)`);
    await page.locator('.xmc-endbtns button', { hasText: 'Keep loading' }).click();
    await page.waitForFunction(() => window.__xmc.view.cards.length >= 4, null, { timeout: 20000 });
    assert.ok(await page.evaluate(() => window.__xmc.view.cards.every((t) => Number(t.id) < 89941)), 'past the read ones, new posts show');
  });
});

browserTest('comment order is remembered between visits', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.locator('.xmc-card [data-act="reply"]').first().click();
    await page.waitForSelector('.xmc-rsort', { timeout: 20000 });
    assert.equal(await page.locator('.xmc-rsort').inputValue(), 'relevant');
    await page.locator('.xmc-rsort').selectOption('likes');
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('xmc.settings')).commentSort === 'likes'; } catch { return false; } });
    await page.reload();
    await e.ready(page);
    await page.locator('.xmc-card [data-act="reply"]').first().click();
    await page.waitForSelector('.xmc-rsort', { timeout: 20000 });
    assert.equal(await page.locator('.xmc-rsort').inputValue(), 'likes', 'the order picked last time is what comments open in');
  });
});

browserTest('the settings page offers the reading and layout options, and can forget what you have read', async (e) => {
  const h = await e.open('/ext/options.html', { seen: ['1', '2', '3'] });
  await checked(h, async () => {
    const { page } = h;
    await page.waitForSelector('#sec-reading');
    for (const id of ['opt-perPageLayout', 'opt-seen', 'opt-collapseReposts', 'opt-commentSort']) assert.equal(await page.locator('#' + id).count(), 1, id);
    for (const id of ['opt-hideGrokDrawer', 'opt-hideDmDrawer']) assert.equal(await page.locator('#' + id).count(), 1, id);
    assert.equal(await page.locator('#opt-density').count(), 0, 'post size is shelved: not offered');
    assert.equal(await page.locator('#opt-seen').inputValue(), 'off', 'off until asked for');
    assert.match(await page.locator('#read-summary').innerText(), /3 posts remembered/);
    await page.locator('#opt-seen').selectOption('hide');
    await page.locator('#read-clear').click();
    assert.match(await page.locator('#read-summary').innerText(), /No posts remembered/);
    assert.equal(await page.evaluate(() => localStorage.getItem('xmc.seen')), null, 'the list is gone');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xmc.settings')).seen), 'hide', 'and the choice you made stays');
  });
});

browserTest('a second copy of the script (after an extension update) replaces the first instead of drawing over it', async (e) => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', '..', 'src', 'main.js'), 'utf8');
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate((code) => { window.__xmcLoaded = false; (0, eval)(code); }, src);
    await page.waitForFunction(() => document.querySelectorAll('#xmc-root').length === 1, null, { timeout: 5000 });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('#xmc-root').count(), 1, 'two column overlays');
    assert.equal(await page.locator('#xmc-pill').count(), 1, 'two Columns buttons');
    assert.ok((await page.locator('.xmc-col').count()) >= 2, 'the newer copy draws the columns');
  });
});

browserTest('comments: the reply box is at the top, and a single comment can be liked and replied to', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.locator('.xmc-card [data-act="reply"]').first().click();
    await page.waitForSelector('.xmc-replies .xmc-ritem');
    const order = await page.evaluate(() => {
      const p = document.querySelector('.xmc-replies');
      return [...p.children].findIndex((c) => c.classList.contains('xmc-compose')) < [...p.children].findIndex((c) => c.classList.contains('xmc-ritem'));
    });
    assert.ok(order, 'the reply box comes before the comments');
    const ids = await page.evaluate(() => { const d = [...window.__xmc.state.details.values()][0]; return d.replies.map((r) => r.id); });

    // like
    const firstId = ids[0];
    await page.locator('.xmc-replies .xmc-rlike').first().click();
    await page.waitForFunction((id) => (window.__actions || []).includes('liked:' + id), firstId, { timeout: 15000 });
    await page.waitForFunction(() => !document.documentElement.classList.contains('xmc-acting') && location.pathname === '/home/', null, { timeout: 8000 });
    assert.ok(await page.locator('.xmc-replies .xmc-rlike').first().evaluate((b) => b.classList.contains('on')), 'the heart is filled');

    // reply to the second comment
    await page.locator('.xmc-replies .xmc-rreply').nth(1).click();
    const box = page.locator('.xmc-replies .xmc-inline textarea');
    await box.fill('hello there');
    await page.locator('.xmc-replies .xmc-inline .xmc-csend').click();
    await page.waitForFunction(() => (window.__replies || []).length === 1, null, { timeout: 20000 });
    const sent = await page.evaluate(() => window.__replies[0]);
    assert.deepEqual(sent, { to: ids[1], text: 'hello there' });
    await page.waitForFunction(() => location.pathname === '/home/', null, { timeout: 8000 });
  });
});

browserTest('the floating Grok and Chat buttons can be hidden', async (e) => {
  const h = await e.open('/home/', { settings: { v: 8, hideGrokDrawer: true, hideDmDrawer: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForFunction(() => document.querySelector('[data-xmc-grok]') && document.querySelector('[data-xmc-dm]'), null, { timeout: 8000 });
    const shown = await page.evaluate(() => ['grokb', 'dmb'].map((id) => document.getElementById(id).getBoundingClientRect().width > 0));
    assert.deepEqual(shown, [false, false]);
  });
});

browserTest('the floating Chat button is hidden even when X gives it a name we do not know', async (e) => {
  const h = await e.open('/home/', { settings: { v: 8, hideGrokDrawer: true, hideDmDrawer: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => {
      document.getElementById('dmb').setAttribute('aria-label', 'Open');
      for (const el of document.querySelectorAll('[data-xmc-dm]')) delete el.dataset.xmcDm;
    });
    await page.waitForFunction(() => document.getElementById('dmb').getBoundingClientRect().width === 0, null, { timeout: 8000 });
  });
});

browserTest('the floating Chat button is hidden when X keeps it under #layers', async (e) => {
  const h = await e.open('/home/', { settings: { v: 8, hideGrokDrawer: true, hideDmDrawer: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => {
      document.getElementById('dmb').parentElement.remove();
      document.getElementById('layers').insertAdjacentHTML('beforeend', '<div style="position:fixed;right:16px;bottom:90px;width:50px;height:50px"><button id="dmx" aria-label="Open" style="width:50px;height:50px">C</button></div>');
    });
    await page.waitForFunction(() => document.getElementById('dmx').getBoundingClientRect().width === 0, null, { timeout: 8000 });
    assert.ok(JSON.parse(await page.evaluate(() => window.__xmc.diagnostics())).floating, 'diagnostics list the floating things');
  });
});

browserTest('the floating Chat button is found by where it sits, even when nothing around it is position:fixed', async (e) => {
  const h = await e.open('/home/', { settings: { v: 8, hideGrokDrawer: true, hideDmDrawer: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => {
      document.getElementById('drawer').remove();
      // a full-screen click-through overlay holding a button that is only laid out in its corner (not fixed itself)
      document.getElementById('layers').insertAdjacentHTML('beforeend', '<div style="position:fixed;inset:0;pointer-events:none;z-index:50;display:flex;align-items:flex-end;justify-content:flex-end"><div style="margin:40px;pointer-events:auto"><button id="dmy" aria-label="Open" style="width:52px;height:52px">C</button></div></div>');
    });
    await page.waitForFunction(() => document.getElementById('dmy').getBoundingClientRect().width === 0, null, { timeout: 8000 });
    assert.ok(JSON.parse(await page.evaluate(() => window.__xmc.diagnostics())).corner, 'diagnostics list what is in the corner');
  });
});

browserTest('with X\'s right sidebar hidden, the floating Grok and Chat buttons get a strip of their own', async (e) => {
  const h = await e.open('/home/', { settings: { v: 8, hideSidebar: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForFunction(() => document.querySelector('[data-xmc-grok]') && document.querySelector('[data-xmc-dm]'), null, { timeout: 8000 });
    await page.waitForFunction(() => { const r = document.getElementById('xmc-root').getBoundingClientRect(); return innerWidth - r.right > 40; }, null, { timeout: 8000 });
    const r = await page.evaluate(() => {
      const root = document.getElementById('xmc-root').getBoundingClientRect();
      const btn = ['grokb', 'dmb'].map((id) => document.getElementById(id).getBoundingClientRect());
      return { clear: btn.every((b) => b.left >= root.right), stacked: Math.abs(btn[0].left - btn[1].left) < 5 };
    });
    assert.deepEqual(r, { clear: true, stacked: true }, 'the columns stop short of the buttons, which stay stacked');
  });
  const off = await e.open('/home/', { settings: { v: 8, hideSidebar: true, hideGrokDrawer: true, hideDmDrawer: true } });
  await checked(off, async () => {
    await e.ready(off.page);
    await off.page.waitForTimeout(1500);
    assert.equal(await off.page.evaluate(() => innerWidth - document.getElementById('xmc-root').getBoundingClientRect().right), 0, 'no strip when both are hidden');
  });
});

browserTest('a big page wrapper in the corner is never mistaken for a button (the columns stay whole)', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => {
      document.getElementById('drawer').remove();
      document.getElementById('react-root').insertAdjacentHTML('beforeend', '<div id="wrapall" style="position:fixed;inset:0;z-index:1"></div>');
    });
    await page.waitForTimeout(3500);
    assert.equal(await page.evaluate(() => document.getElementById('xmc-root').style.clipPath), '', 'no hole cut in the columns');
    assert.equal(await page.evaluate(() => document.getElementById('wrapall').hasAttribute('data-xmc-dm')), false);
  });
});
