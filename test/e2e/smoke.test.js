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
  const h = await e.open('/home/', { settings: { v: 9, commentsIn: 'card' } });
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
    await page.locator('.xmc-showbtn').click();
    assert.deepEqual((await page.locator('.xmc-menu button').allInnerTexts()).map((x) => x.replace(/[\u2713\s]+/, '')), ['Videos', 'Photos']);
    await page.locator('.xmc-menu button', { hasText: 'Photos' }).click();
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
    r.slice(1).forEach((reply, i) => assert.deepEqual(reply, { tab: '0', dl: i === 0, bookmark: false, grok: false }, 'only the reply with a picture (the first) gets Download'));
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
    assert.ok(r.nodes1 < r.nodes0 * 0.8, `nodes ${r.nodes0} -> ${r.nodes1}`);
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
    await home.page.locator('.xmc-colbtn').click();
    await home.page.locator('.xmc-menu button', { hasText: '3 columns' }).click();
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
  const h = await e.open('/home/', { settings: { v: 9, commentsIn: 'card' } });
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
  const h = await e.open('/home/', { settings: { v: 9, commentsIn: 'card' } });
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

browserTest('switching to a tab not seen yet keeps the old posts (dimmed) until the new feed arrives, and never falls back to X\'s page', async (e) => {
  const h = await e.open('/home/', { settings: { v: 8, hideForYou: false, keepFollowing: false } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(11000); // longer than the "no data" clock, which used to count from the page load
    await page.evaluate(() => { window.__delay = 2500; });
    const before = await page.evaluate(() => window.__xmc.view.feedKey);
    await page.locator('.xmc-bar button', { hasText: 'For you' }).first().click();
    await page.waitForTimeout(800);
    const mid = await page.evaluate(() => ({ cards: window.__xmc.view.cards.length, dim: document.getElementById('xmc-root').classList.contains('xmc-switching'), on: document.documentElement.classList.contains('xmc-on') }));
    assert.ok(mid.cards > 0 && mid.dim, 'the old posts stay on screen, dimmed, while the new feed loads');
    assert.ok(mid.on, 'columns are still showing');
    await page.waitForFunction((k) => window.__xmc.view.feedKey && window.__xmc.view.feedKey !== k && !document.getElementById('xmc-root').classList.contains('xmc-switching'), before, { timeout: 15000 });
    assert.ok(await page.evaluate(() => document.documentElement.classList.contains('xmc-on')), 'still columns, not X\'s page');
  });
}, 90000);

browserTest('a person\'s thread is one card with the rest folded under it (and ordinary cards when that is off)', async (e) => {
  const h = await e.open('/threads/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const ids = await page.evaluate(() => window.__xmc.view.cards.map((t) => t.id));
    assert.ok(ids.includes('89995'), 'the first post of the thread has a card');
    assert.ok(!ids.includes('89996') && !ids.includes('89997'), 'its replies to themselves do not have cards of their own');
    const toggle = page.locator('.xmc-thread-toggle').first();
    assert.equal((await toggle.innerText()).trim(), '2 more posts in this thread');
    assert.equal(await page.locator('.xmc-thread-list').first().isVisible(), false);
    await toggle.click();
    assert.equal(await page.locator('.xmc-thread-list').first().locator('.xmc-tpost').count(), 2);
    assert.equal(await page.evaluate(() => location.pathname), '/threads/', 'opening the thread does not leave the page');
    await toggle.click();
    assert.equal(await page.locator('.xmc-thread-list').first().isVisible(), false);
  });
  const off = await e.open('/threads/', { settings: { v: 8, foldThreads: false } });
  await checked(off, async () => {
    await e.ready(off.page);
    const ids = await off.page.evaluate(() => window.__xmc.view.cards.map((t) => t.id));
    assert.ok(ids.includes('89996') && ids.includes('89997'), 'ordinary cards');
    assert.equal(await off.page.locator('.xmc-thread-toggle').count(), 0);
  });
});

browserTest('a single picture is trimmed to a sensible shape unless you ask for it in full', async (e) => {
  const cap = await e.open('/home/');
  await checked(cap, async () => {
    await e.ready(cap.page);
    const r = await cap.page.evaluate(() => { const b = document.querySelector('.xmc-media.single:has(img)'); return b ? { cls: b.classList.contains('xmc-cap'), max: getComputedStyle(b).maxHeight } : null; });
    assert.ok(r && r.cls && r.max !== 'none', 'trimmed by default');
  });
  const full = await e.open('/home/', { settings: { v: 8, tallPhotos: 'full' } });
  await checked(full, async () => {
    await e.ready(full.page);
    assert.equal(await full.page.evaluate(() => !!document.querySelector('.xmc-media.xmc-cap')), false);
  });
});

browserTest('the volume you set on a video is remembered for the next one', async (e) => {
  const h = await e.open('/home/', { settings: { v: 8, volume: 0.4, videoMuted: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const start = await page.evaluate(() => { const v = document.querySelector('.xmc-card video:not([data-gif])'); return v ? { volume: v.volume, muted: v.muted } : null; });
    assert.deepEqual(start, { volume: 0.4, muted: true }, 'starts the way it was left');
    const stored = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('xmc.settings')).volume; } catch { return null; } });
    await page.evaluate(() => { const v = document.querySelector('.xmc-card video:not([data-gif])'); v.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); v.volume = 0.7; v.muted = false; });
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('xmc.settings')).volume === 0.7; } catch { return false; } }, null, { timeout: 5000 });
    await page.waitForTimeout(2200); // the pointer is long gone: changes we make ourselves must not be saved
    await page.evaluate(() => { document.querySelector('.xmc-card video:not([data-gif])').volume = 0.2; });
    await page.waitForTimeout(500);
    assert.equal(await stored(), 0.7);
  });
});

browserTest('the settings page offers starting points as ticked boxes, and one applies', async (e) => {
  const h = await e.open('/ext/options.html');
  await checked(h, async () => {
    const { page } = h;
    await page.waitForSelector('#sec-presets #preset-calm');
    assert.equal(await page.locator('#sec-presets input[type=checkbox]').count(), 4, 'three presets and Custom');
    await page.locator('#preset-calm').check();
    await page.waitForFunction(() => document.getElementById('preset-calm').checked && !document.getElementById('preset-custom').checked);
    assert.equal(await page.locator('#opt-onlyFollowed').isChecked(), true);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xmc.settings')));
    assert.equal(saved.onlyFollowed, true);
    await page.locator('#preset-plain').check();
    await page.waitForFunction(() => document.getElementById('preset-plain').checked && !document.getElementById('preset-calm').checked);
    assert.equal(await page.locator('#opt-onlyFollowed').isChecked(), false);
    await page.locator('#opt-hideTrending').check(); // now it matches none of them
    await page.waitForFunction(() => document.getElementById('preset-custom').checked && !document.getElementById('preset-plain').checked);
  });
});

browserTest('a list page: the list\'s name is in the tab title and at the left of the top bar; the scrollbar is the normal width', async (e) => {
  const h = await e.open('/i/lists/123/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForFunction(() => document.title === 'Psyop / Twitter', null, { timeout: 8000 });
    assert.equal((await page.locator('.xmc-pagetitle').innerText()).trim(), 'Psyop');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.xmc-scroller')).scrollbarWidth), 'auto');
  });
});

browserTest('sensitive pictures in comments follow the sensitive-media setting', async (e) => {
  const open = async (settings) => {
    const h = await e.open('/home/', { settings: Object.assign({ v: 9, commentsIn: 'card' }, settings || {}) });
    await e.ready(h.page);
    await h.page.locator('.xmc-card [data-act="reply"]').first().click();
    await h.page.waitForSelector('.xmc-replies .xmc-ritem');
    return h;
  };
  const blur = await open();
  await checked(blur, async () => {
    assert.equal(await blur.page.locator('.xmc-rmedias.sensitive').count(), 1, 'blurred by default');
    await blur.page.locator('.xmc-rmedias.sensitive .xmc-reveal').click();
    assert.equal(await blur.page.locator('.xmc-rmedias.sensitive').count(), 0, 'one click shows it');
  });
  const hide = await open({ nsfw: 'hide' });
  await checked(hide, async () => {
    assert.equal(await hide.page.locator('.xmc-rmedias').count(), 0, 'the sensitive comment is left out');
    assert.equal(await hide.page.locator('.xmc-replies .xmc-ritem').count(), 5);
  });
});

browserTest('on X\'s own post page, "Sensitive media: Show" presses X\'s notice for you (and only then)', async (e) => {
  const gate = (h) => h.page.evaluate(() => window.__gate || 0);
  const normal = await e.open('/user/status/90001/');
  await checked(normal, async () => {
    await normal.page.waitForFunction(() => document.querySelectorAll('.xmc-nat').length === 7, null, { timeout: 15000 });
    await normal.page.waitForTimeout(2500);
    assert.equal(await gate(normal), 0);
  });
  const show = await e.open('/user/status/90001/', { settings: { v: 8, nsfw: 'show' } });
  await checked(show, async () => {
    await show.page.waitForFunction(() => window.__gate === 1, null, { timeout: 8000 });
    await show.page.waitForTimeout(2500);
    assert.equal(await gate(show), 1, 'pressed once, not over and over');
  });
});

browserTest('Grok\'s floating button lines up beside Chat\'s even when its wrapper is bigger than the button', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { const w = document.getElementById('grokb').parentElement; w.style.cssText = 'padding:0 0 34px 22px;'; });
    await page.waitForFunction(() => document.querySelector('[data-xmc-docked]'), null, { timeout: 8000 });
    await page.waitForFunction(() => {
      const g = document.getElementById('grokb').getBoundingClientRect(), c = document.getElementById('dmb').getBoundingClientRect();
      return Math.abs(g.bottom - c.bottom) <= 2 && Math.abs(g.right - (c.left - 12)) <= 2;
    }, null, { timeout: 8000 });
  });
});

browserTest('a profile\'s header (name, bio, counts) is shown above its posts, and its name stays in the top bar', async (e) => {
  const h = await e.open('/user5/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForSelector('.xmc-profile:not([hidden]) .xmc-pname');
    const text = await page.locator('.xmc-profile').innerText();
    for (const part of ['User Five', '@user5', 'Bio of user five', 'Valley Forge', 'Joined June 2008', '97 Following', '1.2K Followers']) assert.ok(text.includes(part), part + ' in: ' + text);
    assert.equal((await page.locator('.xmc-pagetitle').innerText()).trim(), 'User Five');
  });
  const off = await e.open('/user5/', { settings: { v: 8, profileHeader: false } });
  await checked(off, async () => {
    await e.ready(off.page);
    await off.page.waitForTimeout(1500);
    assert.equal(await off.page.locator('.xmc-profile:not([hidden])').count(), 0);
  });
});

browserTest('on a profile\'s Replies tab a reply shows the post it answers, in its own card', async (e) => {
  const h = await e.open('/user6/with_replies/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const ids = await page.evaluate(() => window.__xmc.view.cards.map((t) => t.id));
    assert.ok(ids.includes('89998'), 'the reply has a card');
    assert.ok(!ids.includes('789998'), 'the post it answers has no card of its own here');
    const card = page.locator('.xmc-card', { has: page.locator('.xmc-pctx') }).first();
    assert.equal(await card.locator('.xmc-pctx').count(), 2, 'the whole chain above it, not just one post');
    assert.match(await card.locator('.xmc-pctx').first().innerText(), /tweet 889998/, 'oldest first');
    assert.match(await card.locator('.xmc-pctx').nth(1).innerText(), /tweet 789998/);
    assert.equal(await card.locator('.xmc-reply').count(), 0, 'no separate "Replying to" line');
    assert.equal(await card.locator('.xmc-pctx .xmc-media img').count(), 1, 'its picture is shown too, as on X');
  });
});

browserTest('a profile\'s header is a copy of X\'s own: its links open, and its buttons press the real ones', async (e) => {
  const h = await e.open('/user7/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForSelector('.xmc-profile.xmc-native [data-testid="UserName"]', { timeout: 8000 });
    const text = await page.locator('.xmc-profile').innerText();
    for (const part of ['Seven Name', '@user7', 'Bio seven', 'example.org', 'Somewhere', 'Joined May 2010', '12 Following', '34 Followers', 'Following']) assert.ok(text.includes(part), part + ' in: ' + text);
    assert.equal(await page.locator('.xmc-profile img').count(), 2, 'the banner and the picture came along');
    assert.equal(await page.locator('.xmc-profile [id]').count(), 0, 'no duplicate ids');
    assert.equal((await page.locator('.xmc-pagetitle').innerText()).trim(), 'Seven Name');
    // a link inside X's own pages opens as it does elsewhere here (a new tab)
    const opened = h.page.context().waitForEvent('page');
    await page.locator('.xmc-profile a', { hasText: '34 Followers' }).click();
    assert.match((await opened).url(), /\/user7\/verified_followers$/);
    // a button presses X's real one
    await page.locator('.xmc-profile button').click();
    await page.waitForFunction(() => window.__follow === 1, null, { timeout: 8000 });
  });
});

browserTest('a profile\'s header is the first card of the first column, with the posts flowing beside it', async (e) => {
  const h = await e.open('/user7/', { width: 1900, height: 900 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForSelector('.xmc-profile.xmc-native', { timeout: 8000 });
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const head = document.querySelector('.xmc-profile').getBoundingClientRect();
      const cols = [...document.querySelectorAll('.xmc-col')];
      const first = cols[0].getBoundingClientRect(), second = cols[1].querySelector('.xmc-card').getBoundingClientRect();
      const under = cols[0].querySelector('.xmc-card').getBoundingClientRect();
      return { inFirst: cols[0].contains(document.querySelector('.xmc-profile')), atTopLeft: Math.abs(head.left - first.left) < 2 && Math.abs(head.top - first.top) < 2,
        besideIsLevel: Math.abs(second.top - head.top) < 4, firstPostBelow: under.top >= head.bottom, cols: cols.length };
    });
    assert.ok(r.cols >= 2, 'several columns');
    assert.deepEqual({ inFirst: r.inFirst, atTopLeft: r.atTopLeft, besideIsLevel: r.besideIsLevel, firstPostBelow: r.firstPostBelow }, { inFirst: true, atTopLeft: true, besideIsLevel: true, firstPostBelow: true });
  });
});

browserTest('the post a reply answers is set in the same size as the reply', async (e) => {
  const h = await e.open('/user6/with_replies/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const sizes = await page.evaluate(() => { const c = document.querySelector('.xmc-card:has(.xmc-pctx)'); return [getComputedStyle(c.querySelector('.xmc-pctx-text')).fontSize, getComputedStyle(c.querySelector(':scope > .xmc-text')).fontSize]; });
    assert.equal(sizes[0], sizes[1]);
  });
});

browserTest('a new set of posts fades up once, and the motion switches off for people who ask for less', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const started = await page.evaluate(() => { document.querySelector('.xmc-showbtn').click(); document.querySelectorAll('.xmc-menu button')[1].click(); return document.querySelector('.xmc-cols').classList.contains('xmc-enter'); });
    assert.equal(started, true);
    await page.waitForFunction(() => !document.querySelector('.xmc-cols').classList.contains('xmc-enter'), null, { timeout: 3000 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { document.querySelector('.xmc-showbtn').click(); document.querySelectorAll('.xmc-menu button')[0].click(); });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.xmc-cols')).animationName), 'none');
  });
});

browserTest('cards sit a little off the page, and "Card background: None" puts them back on it', async (e) => {
  const bg = (page) => page.evaluate(() => getComputedStyle(document.querySelector('.xmc-card')).backgroundColor);
  const raised = await e.open('/home/');
  await checked(raised, async () => {
    await e.ready(raised.page);
    assert.notEqual(await bg(raised.page), 'rgba(0, 0, 0, 0)', 'a tint');
    assert.notEqual(await raised.page.evaluate(() => getComputedStyle(document.querySelector('.xmc-card')).borderTopColor), 'rgba(0, 0, 0, 0)', 'and a hairline edge');
  });
  const flat = await e.open('/home/', { settings: { v: 8, cardStyle: 'flat' } });
  await checked(flat, async () => {
    await e.ready(flat.page);
    assert.equal(await bg(flat.page), 'rgba(0, 0, 0, 0)');
  });
});

browserTest('on X\'s own pages the sensitive-media setting works on X\'s blur itself: blur, show, or leave the picture out', async (e) => {
  const probe = (page) => page.evaluate(() => ({ filter: getComputedStyle(document.getElementById('blurred')).filter, picture: getComputedStyle(document.getElementById('blurred')).display, notice: getComputedStyle(document.getElementById('notice')).display }));
  const blur = await e.open('/user/status/90001/');
  await checked(blur, async () => {
    await blur.page.waitForFunction(() => document.querySelectorAll('.xmc-nat').length === 7, null, { timeout: 15000 });
    await blur.page.waitForTimeout(1500);
    assert.deepEqual(await probe(blur.page), { filter: 'blur(30px)', picture: 'block', notice: 'block' }, 'X\'s own blur stays');
  });
  const show = await e.open('/user/status/90001/', { settings: { v: 8, nsfw: 'show' } });
  await checked(show, async () => {
    await show.page.waitForFunction(() => getComputedStyle(document.getElementById('blurred')).filter === 'none', null, { timeout: 8000 });
    assert.deepEqual(await probe(show.page), { filter: 'none', picture: 'block', notice: 'none' }, 'unblurred, and X\'s notice gone');
  });
  const hide = await e.open('/user/status/90001/', { settings: { v: 8, nsfw: 'hide' } });
  await checked(hide, async () => {
    await hide.page.waitForFunction(() => getComputedStyle(document.getElementById('blurred')).display === 'none', null, { timeout: 8000 });
    assert.deepEqual(await probe(hide.page), { filter: 'blur(30px)', picture: 'none', notice: 'none' }, 'the picture and its notice are gone');
  });
});

browserTest('clicking a post opens it in a panel over the columns: pictures, words, actions and comments; Esc closes it and nothing moved', async (e) => {
  const h = await e.open('/home/', { width: 1600, height: 900 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    await page.evaluate(() => { document.querySelector('.xmc-scroller').scrollTop = 300; });
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => document.querySelector('.xmc-scroller').scrollTop);
    // a post with a picture: click its words
    const id = await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelector('.xmc-media img') && x.querySelector(':scope > .xmc-text')); const t = window.__xmc.view.cards.find((x) => x.el === c); c.querySelector(':scope > .xmc-text').click(); return t.id; });
    await page.waitForSelector('.xmc-view .xmc-vpanel');
    assert.equal(await page.locator('.xmc-vmediapane img').count() >= 1, true, 'its picture at full size');
    assert.ok((await page.locator('.xmc-vside .xmc-text').innerText()).includes(id), 'its words');
    assert.equal(await page.locator('.xmc-vside [data-act="like"]').count(), 1, 'its actions');
    await page.waitForSelector('.xmc-vside .xmc-cbox', { timeout: 20000 }); // and its comments box
    assert.deepEqual(await page.evaluate(() => window.__opened), [], 'no new tab');
    // like from the panel presses X's real button and shows on the card too
    await page.locator('.xmc-vside [data-act="like"]').click();
    await page.waitForFunction((i) => (window.__actions || []).includes('liked:' + i), id, { timeout: 15000 });
    assert.equal(await page.evaluate((i) => window.__xmc.view.cards.find((t) => t.id === i).el.querySelector('.xmc-actions [data-act="like"]').classList.contains('on'), id), true, 'the card shows it too');
    // the arrow keys go to the next post
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((i) => !document.querySelector('.xmc-vside .xmc-text') || !document.querySelector('.xmc-vside .xmc-text').innerText.includes(i), id);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.xmc-view'));
    assert.equal(await page.evaluate(() => document.querySelector('.xmc-scroller').scrollTop), before, 'the columns did not move');
    await page.waitForFunction(() => location.pathname === '/home/', null, { timeout: 15000 }); // X's hidden side finishes fetching comments and steps back
  });
}, 90000);

browserTest('pointing at a picture shows like, repost, save and download on it; they work', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const media = page.locator('.xmc-card .xmc-media:has(img):not(.sensitive)').first();
    const bar = media.locator('.xmc-hover');
    assert.equal(await bar.evaluate((b) => getComputedStyle(b).opacity), '0', 'hidden until you point');
    await media.hover();
    await page.waitForFunction((el) => getComputedStyle(el).opacity === '1', await bar.elementHandle());
    const id = await page.evaluate(() => { const m = document.querySelector('.xmc-card .xmc-media:hover'); return window.__xmc.view.cards.find((t) => t.el === m.closest('.xmc-card')).id; });
    await bar.locator('[data-act="bookmark"]').click();
    await page.waitForFunction((i) => (window.__actions || []).includes('bm:' + i), id, { timeout: 15000 });
    assert.equal(await page.locator('.xmc-viewer, #xmc-lightbox').count(), 0, 'pressing it did not open the picture');
  });
  const off = await e.open('/home/', { settings: { v: 9, hoverActions: false } });
  await checked(off, async () => {
    await e.ready(off.page);
    assert.equal(await off.page.locator('.xmc-hover').count(), 0);
  });
});

browserTest('a reply sent without the post it answers gets it looked up, out of sight, and the card shows it', async (e) => {
  const h = await e.open('/user6/with_replies/', { width: 1700, height: 900 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const card = () => page.locator('.xmc-card', { hasText: 'tweet 89995' }).first();
    await card().scrollIntoViewIfNeeded();
    assert.equal(await card().locator('.xmc-reply').count(), 1, 'at first only "Replying to"');
    await page.waitForFunction(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.textContent.includes('tweet 89995') && x.querySelector('.xmc-pctx')); return !!c && c.querySelector('.xmc-pctx').textContent.includes('tweet 555555'); }, null, { timeout: 30000 });
    await page.waitForFunction(() => location.pathname === '/user6/with_replies/', null, { timeout: 15000 });
    assert.equal(await card().locator('.xmc-reply').count(), 0);
  });
}, 90000);

browserTest('the post panel shows what a reply answers above it, once looked up with its comments', async (e) => {
  const h = await e.open('/user6/with_replies/', { width: 1700, height: 900, settings: { v: 9, fetchContext: false } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const card = page.locator('.xmc-card', { hasText: 'tweet 89995' }).first();
    await card.scrollIntoViewIfNeeded();
    await card.locator(':scope > .xmc-text').click();
    await page.waitForSelector('.xmc-vside .xmc-cbox', { timeout: 25000 });
    assert.match(await page.locator('.xmc-vctx .xmc-pctx').first().innerText(), /tweet 555555/);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => location.pathname === '/user6/with_replies/', null, { timeout: 15000 });
  });
}, 90000);

browserTest('first run: a one-line hint says what you can do, and "Got it" keeps it away for good', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForSelector('.xmc-hint:not([hidden])', { timeout: 8000 });
    assert.match(await page.locator('.xmc-hint').innerText(), /Click a post to open it/);
    await page.locator('.xmc-hint button').click();
    await page.waitForFunction(() => { try { return JSON.parse(localStorage.getItem('xmc.settings')).hintSeen === true; } catch { return false; } });
    await page.reload();
    await e.ready(page);
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('.xmc-hint:not([hidden])').count(), 0);
  });
});

browserTest('the comments button opens the post panel with the reply box ready', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.locator('.xmc-card [data-act="reply"]').first().click();
    await page.waitForSelector('.xmc-view .xmc-vside .xmc-cbox', { timeout: 25000 });
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('xmc-cbox')), true, 'the cursor is in the reply box');
    assert.equal(await page.locator('.xmc-card .xmc-replies').count(), 0, 'nothing opened inside the card');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => location.pathname === '/home/', null, { timeout: 15000 });
  });
}, 90000);

browserTest('the Following tab shows its Popular / Recent arrow from the start, the filter says "Posts only", and Report a problem opens the issue page', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    assert.ok((await page.locator('.xmc-bar1 button', { hasText: 'Following' }).first().innerText()).includes('▾'), 'the arrow is there before anyone has pressed the tab twice');
    assert.equal((await page.locator('.xmc-showbtn').innerText()).trim(), 'Show: Everything');
    await page.locator('.xmc-showbtn').click();
    assert.ok((await page.locator('.xmc-menu button').allInnerTexts()).some((x) => x.includes('Posts only')));
    await page.keyboard.press('Escape');
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    await page.evaluate(() => { document.querySelector('.xmc-card [data-act="more"]').click(); });
    await page.locator('.xmc-menu button', { hasText: 'Report a problem' }).click();
    assert.deepEqual(await page.evaluate(() => window.__opened), ['https://github.com/Lynchalot/multi-column-for-x/issues/new/choose']);
  });
});

browserTest('the Back button closes the post panel, and closing it by hand leaves no extra history behind', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const len0 = await page.evaluate(() => history.length);
    const open = () => page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelector(':scope > .xmc-text')); c.querySelector(':scope > .xmc-text').click(); });
    await open();
    await page.waitForSelector('.xmc-view .xmc-vpanel');
    assert.equal(await page.evaluate(() => history.state && history.state.xmcView), true);
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('.xmc-view'), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => location.pathname), '/home/', 'Back stayed on the page');
    await page.waitForTimeout(800);
    await open();
    await page.waitForSelector('.xmc-view .xmc-vpanel');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.xmc-view'), null, { timeout: 5000 });
    await page.waitForFunction(() => !(history.state && history.state.xmcView), null, { timeout: 15000 });
    await page.waitForFunction(() => location.pathname === '/home/', null, { timeout: 15000 });
    assert.ok((await page.evaluate(() => history.length)) <= len0 + 2, 'no pile of leftover entries');
  });
}, 90000);

browserTest('resting on a post starts loading its comments; pictures fade in from a tint', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const id = await page.evaluate(() => { const t = window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected); return t.id; });
    const card = page.locator('.xmc-card').filter({ has: page.locator(`a[href$="/status/${id}"]`) }).first();
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await card.locator(':scope > .xmc-text').hover();
    await page.waitForFunction((i) => window.__xmc.state.details.has(i), id, { timeout: 25000 });
    await page.waitForFunction(() => location.pathname === '/home/', null, { timeout: 15000 });
    await page.waitForFunction(() => !document.querySelector('.xmc-media.xmc-loading'), null, { timeout: 12000 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.xmc-media img')).opacity), '1');
  });
}, 90000);

browserTest('clicking a post while its comments are already being fetched in the background still opens the panel, loads the comments, and leaves X\'s own page hidden', async (e) => {
  const h = await e.open('/home/', { width: 1600, height: 900 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const id = await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).id);
    const card = page.locator('.xmc-card').filter({ has: page.locator(`a[href$="/status/${id}"]`) }).first();
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    await card.locator(':scope > .xmc-text').hover();
    await page.waitForFunction(() => !!window.__xmc.state.peek && /\/status\//.test(location.pathname), null, { timeout: 8000, polling: 'raf' }); // the background visit is on the post's page
    await page.evaluate((i) => { const c = window.__xmc.view.cards.find((x) => x.id === i).el; c.querySelector(':scope > .xmc-text').click(); }, id);
    await page.waitForSelector('.xmc-view .xmc-vpanel');
    await page.waitForSelector('.xmc-vside .xmc-ritem', { timeout: 25000 });
    await page.waitForFunction(() => location.pathname === '/home/' && !window.__xmc.state.peek, null, { timeout: 15000 });
    await page.waitForFunction(() => document.documentElement.classList.contains('xmc-on') && !document.documentElement.classList.contains('xmc-onpost'), null, { timeout: 5000 }); // columns showing again, not X's post page
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.xmc-view'), null, { timeout: 5000 });
    await page.waitForFunction(() => location.pathname === '/home/' && !(history.state && history.state.xmcView), null, { timeout: 15000 });
  });
}, 90000);

browserTest('closing the panel steps Back once even when the browser is slow to go back (it must not tidy up a second time and land on an older page)', async (e) => {
  const h = await e.open('/home/', { width: 1600, height: 900 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text').click());
    await page.waitForSelector('.xmc-vside .xmc-ritem', { timeout: 25000 });
    await page.waitForFunction(() => !window.__xmc.state.peek && location.pathname === '/home/', null, { timeout: 15000 });
    await page.evaluate(() => { const back = history.back.bind(history); window.__backs = 0; history.back = () => { window.__backs++; setTimeout(back, 2500); }; });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(6000);
    assert.equal(await page.evaluate(() => window.__backs), 1, 'one step back for the panel\'s own entry');
    assert.equal(await page.evaluate(() => location.pathname), '/home/');
  });
}, 90000);

browserTest('pressing a comment opens it in the panel like a post (its words, its replies, Back and Esc return to the post); pressing its picture opens it full size', async (e) => {
  const h = await e.open('/home/', { width: 1600, height: 900 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    const postText = await page.evaluate(() => { const t = window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected); t.el.querySelector(':scope > .xmc-text').click(); return t.id; });
    await page.waitForSelector('.xmc-vside .xmc-ritem', { timeout: 25000 });
    // a picture in a comment: reveal it, press it, it is full size
    await page.locator('.xmc-vside .xmc-rmedias .xmc-reveal').first().click();
    await page.locator('.xmc-vside .xmc-rmedias img').first().click();
    await page.waitForSelector('#xmc-lightbox');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#xmc-lightbox'));
    assert.equal(await page.locator('.xmc-vback').count(), 0, 'still the post');
    // bookmark a comment from the list: X's own button on it is pressed
    const row = page.locator('.xmc-vside .xmc-ritem', { hasText: 'Reply number 3 to the post' });
    await row.locator('.xmc-rmark').click();
    await page.waitForFunction(() => window.__bm === 1, null, { timeout: 25000 });
    await page.waitForFunction(() => location.pathname === '/home/' && !window.__xmc.state.peek, null, { timeout: 15000 });
    assert.equal(await row.locator('.xmc-rmark.on').count(), 1, 'shown as saved');
    // a comment's words: the comment opens
    await page.locator('.xmc-vside .xmc-ritem', { hasText: 'Reply number 2 to the post' }).locator('.xmc-text').click();
    await page.waitForSelector('.xmc-vback');
    const side = () => page.locator('.xmc-view:not(.xmc-out) .xmc-vside').innerText();
    assert.ok((await side()).includes('Reply number 2 to the post'), 'its words');
    await page.waitForSelector('.xmc-vside .xmc-ritem');
    assert.ok((await side()).includes('The author answers reply 2'), 'the replies to it');
    assert.equal(await page.locator('.xmc-view:not(.xmc-out) .xmc-vside .xmc-cbox').count(), 1, 'a box to reply to it');
    assert.equal(await page.locator('.xmc-view:not(.xmc-out) .xmc-vpanel').count(), 1, 'still one panel');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.xmc-vback'));
    assert.ok((await side()).includes('Reply number 3 to the post'), 'back on the post, comments still there');
    await page.locator('.xmc-vside .xmc-ritem', { hasText: 'Reply number 2 to the post' }).locator('.xmc-text').click();
    await page.locator('.xmc-vback').click();
    await page.waitForFunction(() => !document.querySelector('.xmc-vback'));
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.xmc-view'));
    assert.ok(postText);
  });
}, 90000);

browserTest('"Skip X\'s age check" turns off only X\'s age-verification flag, and puts it back when switched off', async (e) => {
  const flags = (h) => h.page.evaluate(() => ({ age: window.__fs.isTrue('rweb_age_assurance_flow_enabled'), other: window.__fs.isTrue('something_else') }));
  const off = await e.open('/user/status/90001/');
  await checked(off, async () => {
    await off.page.waitForTimeout(2500);
    assert.deepEqual(await flags(off), { age: true, other: true }, 'untouched by default');
  });
  const on = await e.open('/user/status/90001/', { settings: { v: 9, skipAgeCheck: true } });
  await checked(on, async () => {
    await on.page.waitForFunction(() => window.__fs.isTrue('rweb_age_assurance_flow_enabled') === false, null, { timeout: 8000 });
    assert.deepEqual(await flags(on), { age: false, other: true }, 'only that flag');
    assert.equal(await on.page.evaluate(() => localStorage.getItem('xmcSkipAge')), '1', 'remembered for the next page load');
    await on.page.reload();
    await on.page.waitForFunction(() => window.__INITIAL_STATE__.featureSwitch.defaultConfig.rweb_age_assurance_flow_enabled.value === false, null, { timeout: 8000 });
    assert.equal(await on.page.evaluate(() => window.__INITIAL_STATE__.featureSwitch.defaultConfig.other_flag.value), true, 'only that flag, in X\'s starting state too');
    await on.page.waitForFunction(() => window.__xmc && window.__xmc.state.ageFlag && window.__xmc.state.ageFlag.lookup, null, { timeout: 8000 });
    await on.page.evaluate(() => { window.__xmc.settings.skipAgeCheck = false; });
    await on.page.evaluate(() => window.postMessage({ source: 'xmc-flags', skipAge: false }, location.origin));
    await on.page.waitForFunction(() => window.__fs.isTrue('rweb_age_assurance_flow_enabled') === true, null, { timeout: 8000 });
  });
});

browserTest('reloading a page that showed columns never shows X\'s own timeline, menu or sidebar first', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForFunction(() => localStorage.getItem('xmcVeil') === '/home/', null, { timeout: 8000 });
    await page.context().addInitScript(() => {
      window.__seen = [];
      const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el); const r = el.getBoundingClientRect(); return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.02 && r.width > 20 && r.height > 20; };
      const frame = () => {
        if (!document.documentElement.classList.contains('xmc-on')) {
          for (const sel of ['[data-testid="primaryColumn"]', '[data-testid="sidebarColumn"]', 'header[role="banner"]']) if (vis(document.querySelector(sel))) window.__seen.push(sel);
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await page.reload();
    await e.ready(page);
    await page.waitForTimeout(500);
    assert.deepEqual(await page.evaluate(() => [...new Set(window.__seen)]), [], 'X\'s own page was drawn before the columns');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('xmc-veil')), false, 'the cover is lifted');
  });
});

browserTest('a text-only post\'s panel keeps its top and its words where they are while the comments arrive', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1000);
    await page.evaluate(() => { const t = window.__xmc.view.cards.find((x) => x.counts.reply > 0 && !x.media.length && !x.quoted && x.el && x.el.isConnected); t.el.querySelector(':scope > .xmc-text').click(); });
    await page.waitForSelector('.xmc-vpanel.single');
    const box = () => page.evaluate(() => { const r = document.querySelector('.xmc-vpanel').getBoundingClientRect(), w = document.querySelector('.xmc-vside .xmc-text').getBoundingClientRect(); return { top: Math.round(r.top), words: Math.round(w.top) }; });
    await page.waitForTimeout(250);
    const before = await box();
    await page.waitForSelector('.xmc-vside .xmc-ritem', { timeout: 25000 });
    await page.waitForTimeout(300);
    assert.deepEqual(await box(), before, 'the panel jumped when the comments arrived');
  });
}, 90000);

browserTest('stepping from a post into a comment and back never has two panels or two backdrops showing', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1000);
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.media.length && x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text').click());
    await page.waitForSelector('.xmc-vside .xmc-ritem', { timeout: 25000 });
    await page.evaluate(() => { window.__most = 0; window.__w = []; const f = () => { window.__most = Math.max(window.__most, document.querySelectorAll('.xmc-view').length); const p = document.querySelector('.xmc-vpanel'); if (p) window.__w.push(Math.round(p.getBoundingClientRect().width)); requestAnimationFrame(f); }; requestAnimationFrame(f); });
    await page.locator('.xmc-vside .xmc-ritem', { hasText: 'Reply number 2' }).locator('.xmc-text').click();
    await page.waitForSelector('.xmc-vback');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.xmc-vback'));
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__most), 1, 'two panels at once');
    assert.equal(await page.evaluate(() => new Set(window.__w).size), 1, 'the panel changed shape');
  });
}, 90000);

browserTest('a browser that is slow to go Back (seconds, as Zen can be) does not close the panel while its comments load', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const back = history.back.bind(history); history.back = () => { setTimeout(back, 2600); }; });
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text').click());
    await page.waitForSelector('.xmc-vside .xmc-ritem', { timeout: 30000 });
    await page.waitForTimeout(6000);
    assert.equal(await page.locator('.xmc-view:not(.xmc-out) .xmc-vpanel').count(), 1, 'the panel was closed by the browser answering our own Back');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('xmc-onpost')), false);
  });
}, 90000);

browserTest('while comments are fetched on X\'s hidden side, the menu and the sidebar stay on screen as they were (a still copy), then the real ones return', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    await page.waitForSelector('header[role="banner"][data-xmc-style]');
    const rect = () => page.evaluate(() => { const r = document.querySelector('header[role="banner"][data-xmc-style], #xmc-navfreeze').getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top)]; });
    const before = await rect();
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text').click());
    await page.waitForFunction(() => !!window.__xmc.state.peek && /status/.test(location.pathname), null, { timeout: 15000, polling: 'raf' });
    const during = await page.evaluate(() => { const c = document.getElementById('xmc-navfreeze'); if (!c) return null; const r = c.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), visible: getComputedStyle(c).visibility }; });
    assert.ok(during, 'a still copy of the menu is showing');
    assert.deepEqual([during.left, during.top], before, 'in the same place');
    assert.equal(during.visible, 'visible');
    await page.waitForFunction(() => !document.getElementById('xmc-navfreeze') && !document.documentElement.classList.contains('xmc-frozen'), null, { timeout: 25000 });
    await page.waitForSelector('header[role="banner"][data-xmc-style]', { timeout: 5000 });
    assert.deepEqual(await rect(), before, 'the real menu is back where it was');
  });
}, 90000);

browserTest('an open post sits over X\'s menu and sidebar, and they stay pinned, not coming and going, for as long as it is open', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    await page.waitForSelector('[data-testid="sidebarColumn"][data-xmc-style]');
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text').click());
    await page.waitForSelector('.xmc-vside .xmc-ritem', { timeout: 25000 });
    const over = () => page.evaluate(() => {
      const top = (sel) => { const el = document.querySelector(sel + '[data-xmc-style]'); if (!el) return 'unpinned'; const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 40); return hit && hit.closest('.xmc-view') ? 'under' : 'ABOVE: ' + (hit && hit.tagName); };
      return { side: top('[data-testid="sidebarColumn"]'), nav: top('header[role="banner"]'), pinned: document.documentElement.classList.contains('xmc-pinside') };
    });
    for (let i = 0; i < 9; i++) { // far longer than the pin check takes to give up
      const o = await over();
      assert.deepEqual(o, { side: 'under', nav: 'under', pinned: true }, 'at ' + i + 's: ' + JSON.stringify(o));
      await page.waitForTimeout(1000);
    }
  });
}, 90000);

browserTest('when X refuses the comments (rate limit), the panel says so, offers Try again, and the post still opens', async (e) => {
  const h = await e.open('/home/', { width: 1600, height: 900 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    let refuse = true;
    await page.route(/TweetDetail/, (r) => (refuse ? r.fulfill({ status: 429, contentType: 'application/json', body: '{}' }) : r.continue()));
    const id = await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).id);
    await page.evaluate((i) => window.__xmc.view.cards.find((x) => x.id === i).el.querySelector(':scope > .xmc-text').click(), id);
    await page.waitForSelector('.xmc-view .xmc-vpanel');
    await page.waitForFunction(() => /limiting how fast/.test((document.querySelector('.xmc-vside') || {}).textContent || ''), null, { timeout: 30000 });
    assert.equal(await page.locator('.xmc-vside .xmc-rbtn', { hasText: 'Try again' }).count(), 1);
    assert.equal(await page.evaluate(() => location.pathname), '/home/', 'X\'s own page left behind');
    refuse = false;
    await page.evaluate(() => { window.__xmc.state.detailFail = null; });
    await page.locator('.xmc-vside .xmc-rbtn', { hasText: 'Try again' }).click();
    await page.waitForSelector('.xmc-vside .xmc-ritem', { timeout: 25000 });
  });
}, 90000);

browserTest('"Age-restricted adult content" on X\'s own post page: Show leaves it alone, Don\'t show leaves the box out, and the post stays', async (e) => {
  const gate2 = (h) => h.page.evaluate(() => window.__gate2 || 0);
  const normal = await e.open('/user/status/90001/');
  await checked(normal, async () => {
    await normal.page.waitForFunction(() => document.querySelectorAll('.xmc-nat').length === 7, null, { timeout: 15000 });
    await normal.page.waitForTimeout(2000);
    assert.equal(await gate2(normal), 0, 'left alone by default');
  });
  const show = await e.open('/user/status/90001/', { settings: { v: 9, nsfw: 'show' } });
  await checked(show, async () => {
    await show.page.waitForFunction(() => window.__gate === 1, null, { timeout: 8000 }); // the ordinary sensitive notice is pressed
    await show.page.waitForTimeout(2500);
    assert.equal(await gate2(show), 0, 'the age gate is not pressed (it only opens X\'s "confirm your age" dialog)');
  });
  const hide = await e.open('/user/status/90001/', { settings: { v: 9, nsfw: 'hide' } });
  await checked(hide, async () => {
    await hide.page.waitForFunction(() => getComputedStyle(document.getElementById('agebox')).display === 'none', null, { timeout: 8000 });
    assert.equal(await gate2(hide), 0, 'not pressed');
    assert.equal(await hide.page.evaluate(() => !!document.querySelector('[data-testid="tweetText"]') && getComputedStyle(document.querySelector('[data-testid="tweetText"]')).display !== 'none'), true, 'the words are still there');
  });
});

browserTest('one button sets the number of columns: it shows the number, and a short list (Auto first) changes it', async (e) => {
  const h = await e.open('/home/', { width: 2400, height: 900 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const auto = Number((await page.locator('.xmc-colbtn').innerText()).trim());
    assert.ok(auto >= 2, 'it shows how many there are');
    await page.locator('.xmc-colbtn').click();
    assert.match(await page.locator('.xmc-menu button').first().innerText(), /\u2713\s+Auto \(\d+ now\)/, 'Auto first, and ticked');
    await page.locator('.xmc-menu button', { hasText: '3 columns' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.xmc-col').length === 3);
    assert.equal((await page.locator('.xmc-colbtn').innerText()).trim(), '3');
    await page.locator('.xmc-colbtn').click();
    assert.match(await page.locator('.xmc-menu button', { hasText: '3 columns' }).innerText(), /\u2713/, 'the current one is ticked');
    await page.locator('.xmc-menu button').first().click();
    await page.waitForFunction((n) => document.querySelectorAll('.xmc-col').length === n, auto);
  });
});

browserTest('while posts are on their way and there is blank space, grey placeholder cards show at the foot of each column', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { window.__delay = 4000; });
    await page.evaluate(async () => { const sc = document.querySelector('.xmc-scroller'); for (let i = 0; i < 60; i++) { sc.scrollTop += 2500; await new Promise((x) => setTimeout(x, 40)); } });
    await page.waitForSelector('.xmc-col > .xmc-ghost', { timeout: 15000 });
    assert.equal(await page.locator('.xmc-col > .xmc-ghost').count(), await page.locator('.xmc-col').count(), 'one per column');
    await page.waitForFunction(() => !document.querySelector('.xmc-ghost'), null, { timeout: 30000 });
  });
}, 90000);

browserTest('narrow window: the top bar stays on one row with icons only, and the view count goes', async (e) => {
  const h = await e.open('/home/', { width: 900, height: 800 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const r = await page.evaluate(() => {
      const bar = document.querySelector('.xmc-bar1'), btns = [...bar.children].filter((c) => !c.hidden && c.getBoundingClientRect().width);
      const mids = btns.map((c) => { const b = c.getBoundingClientRect(); return b.top + b.height / 2; });
      return { rows: Math.max(...mids) - Math.min(...mids) < 14 ? 1 : 2, showLabel: getComputedStyle(document.querySelector('.xmc-showlabel')).display, views: getComputedStyle(document.querySelector('.xmc-views')).display };
    });
    assert.deepEqual(r, { rows: 1, showLabel: 'none', views: 'none' });
  });
});

browserTest('short posts that are only words are set larger; posts with a picture are not', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const r = await page.evaluate(() => { const size = (c) => getComputedStyle(c.querySelector(':scope > .xmc-text')).fontSize; const words = [...document.querySelectorAll('.xmc-card')].find((c) => !c.querySelector('.xmc-media') && !c.querySelector('.xmc-quote')); const pic = [...document.querySelectorAll('.xmc-card')].find((c) => c.querySelector('.xmc-media')); return { words: size(words), pic: size(pic) }; });
    assert.equal(r.words, '20px'); assert.equal(r.pic, '15px');
  });
  const off = await e.open('/home/', { settings: { v: 9, bigText: false } });
  await checked(off, async () => {
    await e.ready(off.page);
    assert.equal(await off.page.locator('.xmc-text.big').count(), 0);
  });
});

browserTest('saving a post gives a toast with Undo, and Undo puts it back', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const id = await page.evaluate(() => { const t = window.__xmc.view.cards[0]; t.el.querySelector('[data-act="bookmark"]').click(); return t.id; });
    await page.waitForFunction((i) => (window.__actions || []).includes('bm:' + i), id, { timeout: 15000 });
    await page.waitForSelector('#xmc-toast:not([hidden]) .xmc-undo');
    assert.match(await page.locator('#xmc-toast').innerText(), /Saved to bookmarks/);
    await page.locator('#xmc-toast .xmc-undo').click();
    await page.waitForFunction((i) => (window.__actions || []).filter((a) => a === 'bm:' + i).length === 2, id, { timeout: 15000 });
    assert.equal(await page.evaluate((i) => window.__xmc.view.cards.find((t) => t.id === i).state.bookmarked, id), false);
    await page.waitForTimeout(600);
    assert.equal(await page.locator('#xmc-toast:not([hidden]) .xmc-undo').count(), 0, 'undoing does not offer another undo');
  });
});

browserTest('the post panel offers more from the same account, and a tile opens that post', async (e) => {
  const h = await e.open('/home/', { width: 1600, height: 900 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const id = await page.evaluate(() => { const count = {}; for (const x of window.__xmc.state.byId.values()) if (!x.repostedBy && !x.replyToId) count[x.author.handle] = (count[x.author.handle] || 0) + 1; const t = window.__xmc.view.cards.find((c) => count[c.author.handle] >= 3 && c.el); (t.el.querySelector(':scope > .xmc-text') || t.el.querySelector('.xmc-head')).click(); return t.id; });
    await page.waitForSelector('.xmc-view .xmc-more .xmc-more-tile');
    assert.match(await page.locator('.xmc-more-head').innerText(), /More from @user/);
    assert.ok((await page.locator('.xmc-more-tile').count()) >= 2);
    await page.locator('.xmc-more-tile').first().click();
    await page.waitForFunction((i) => !document.querySelector('.xmc-vside .xmc-text') || !document.querySelector('.xmc-vside .xmc-text').innerText.includes('tweet ' + i + ' '), id);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => location.pathname === '/home/', null, { timeout: 15000 });
  });
}, 90000);

browserTest('pointing at a video plays a muted preview, moving away stops it, pressing on it takes over', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    // this test browser can't decode H.264, so the player is stood in for: what matters is when play and pause are asked for
    await page.evaluate(() => { const v = document.querySelector('.xmc-card video:not([data-gif])'); let paused = true; Object.defineProperty(v, 'paused', { get: () => paused }); v.play = () => { paused = false; return Promise.resolve(); }; v.pause = () => { paused = true; }; });
    const vid = page.locator('.xmc-card video:not([data-gif])').first();
    await vid.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    await vid.hover();
    await page.waitForFunction(() => { const v = document.querySelector('.xmc-card video:not([data-gif])'); return !v.paused && v.muted; }, null, { timeout: 8000 });
    await page.mouse.move(5, 300);
    await page.waitForFunction(() => document.querySelector('.xmc-card video:not([data-gif])').paused, null, { timeout: 3000 });
    // pressing on a previewing video keeps it playing and gives it the sound you last chose
    await vid.hover();
    await page.waitForFunction(() => !document.querySelector('.xmc-card video:not([data-gif])').paused, null, { timeout: 8000 });
    await vid.click({ position: { x: 20, y: 20 } });
    assert.equal(await page.evaluate(() => { const v = document.querySelector('.xmc-card video:not([data-gif])'); return { playing: !v.paused, preview: v.dataset.preview || '' }; }).then((x) => JSON.stringify(x)), JSON.stringify({ playing: true, preview: '' }));
  });
});
