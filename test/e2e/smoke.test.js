// Drives the real extension scripts in a real (headless) Chrome against a stand-in x.com. Each test is a thing that broke once.
// Run: npm run test:e2e   (needs Chrome; set XMC_BROWSER to a browser binary otherwise; skipped when none is found)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./harness.js');
const { OURS, auditInPage } = require('./a11y.js');
const Parse = require('../../src/parse.js');
const Logic = require('../../src/logic.js');

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
    // (the comments are shown the moment X answers; the hidden page steps back a moment later, so the address is waited for, not read at once)
    await page.waitForFunction(() => location.pathname === '/home/', null, { timeout: 5000 }).catch(() => {});
    assert.equal(await page.evaluate(() => location.pathname), '/home/', 'the page went back to the feed (it was at ' + r.path + ' when the last comments arrived)');
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

// X's Grok panel, open, is nearly as tall as the window and sits under #layers: it must be on top of the columns (and of the open post), not under them
browserTest('an open Grok panel is on top of the columns and of an open post', async (e) => {
  const h = await e.open('/home/', { height: 1100 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const drawer = () => page.evaluate(() => {
      const d = document.querySelector('#layers [data-testid="GrokDrawer"]');
      const r = d.getBoundingClientRect(), pts = [[0.5, 0.2], [0.5, 0.5], [0.5, 0.85]].map(([fx, fy]) => document.elementFromPoint(r.left + r.width * fx, r.top + r.height * fy));
      return { tall: Math.round(r.height), on: pts.map((el) => !!el && d.contains(el)) };
    });
    // (no hide setting: it is the open panel, with its own Grok label inside, as on X)
    await page.evaluate(() => {
      const w = document.createElement('div');
      w.innerHTML = '<div data-testid="GrokDrawer" style="position:fixed;right:0;top:16px;width:420px;height:calc(100vh - 32px);background:#111;color:#fff;padding:12px"><div aria-label="Grok" role="heading">Grok</div><p>what does this mean</p></div>';
      document.getElementById('layers').append(w.firstChild);
    });
    await page.waitForFunction(() => document.querySelector('#layers [data-testid="GrokDrawer"]').matches('[data-xmc-grok]'), null, { timeout: 1500 }); // (found at once, not at the next slow pass)
    await page.waitForTimeout(900); // (a pass of the columns' own timer)
    let r = await drawer();
    assert.ok(r.tall > 820, 'the panel is taller than the old size cap: ' + r.tall);
    assert.deepEqual(r.on, [true, true, true], 'the columns are not painted over the open panel');
    await page.locator('.xmc-card').first().click(); // the post's panel opens over the columns
    await page.waitForSelector('.xmc-view', { timeout: 8000 });
    await page.waitForTimeout(1500);
    r = await drawer();
    assert.deepEqual(r.on, [true, true, true], 'nor the open post');
    await page.evaluate(() => document.querySelector('#layers [data-testid="GrokDrawer"]').remove());
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('xmc-drawer-up') || getComputedStyle(document.getElementById('layers')).zIndex === '40'), false, 'the lift is gone with the panel');
  });
});

browserTest('an open panel kept in X\'s own page (not under #layers) is on top too', async (e) => {
  const h = await e.open('/home/', { height: 1100 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForFunction(() => document.querySelector('[data-xmc-grok]') && document.querySelector('[data-xmc-dm]'), null, { timeout: 8000 });
    await page.evaluate(() => { const d = document.getElementById('drawer'); d.style.cssText = 'position:fixed;right:0;top:16px;width:420px;height:calc(100vh - 32px);background:#111;display:block'; d.querySelectorAll('[data-xmc-dm], [data-xmc-grok]').forEach((w) => { w.style.height = '120px'; }); });
    await page.waitForFunction(() => document.getElementById('drawer').hasAttribute('data-xmc-up'), null, { timeout: 4000 });
    const on = await page.evaluate(() => { const r = document.getElementById('drawer').getBoundingClientRect(); return [0.3, 0.6, 0.9].map((fy) => document.elementFromPoint(r.left + 380, r.top + r.height * fy) === document.getElementById('drawer')); });
    assert.deepEqual(on, [true, true, true]);
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

browserTest('Translate post on a card opens that post\'s panel, not a new tab', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    await page.evaluate(() => [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelector('.xmc-translate')).querySelector('.xmc-translate').click());
    await page.waitForSelector('.xmc-view .xmc-vpanel');
    assert.deepEqual(await page.evaluate(() => window.__opened), []);
  });
});

browserTest('the panel and the photo viewer work from the keyboard: Tab stays inside, Enter opens a photo, Esc gives the focus back', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    // open a post's panel from a focused button, as a keyboard user would
    await page.evaluate(() => { const b = document.querySelector('.xmc-card .xmc-translate'); b.id = 'xmc-test-opener'; b.focus(); });
    await page.keyboard.press('Enter');
    await page.waitForSelector('.xmc-view .xmc-vpanel');
    const dlg = await page.evaluate(() => { const v = document.querySelector('.xmc-view'); return { role: v.getAttribute('role'), modal: v.getAttribute('aria-modal'), label: v.getAttribute('aria-label') }; });
    assert.equal(dlg.role, 'dialog'); assert.equal(dlg.modal, 'true'); assert.match(dlg.label, /^Post by /);
    // Tab many times: the focus never leaves the panel
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(i % 7 === 6 ? 'Shift+Tab' : 'Tab');
      assert.ok(await page.evaluate(() => !!document.activeElement.closest('.xmc-view')), 'focus left the panel on press ' + i);
    }
    // a photo can be opened with Enter, and Esc closes only the viewer, giving the focus back to the photo
    const hasPhoto = await page.evaluate(() => { const p = document.querySelector('.xmc-view [data-lb]'); if (p) p.focus(); return !!p; });
    if (hasPhoto) {
      await page.keyboard.press('Enter');
      await page.waitForSelector('#xmc-lightbox');
      assert.equal(await page.evaluate(() => document.getElementById('xmc-lightbox').getAttribute('role')), 'dialog');
      await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => !!document.activeElement.closest('#xmc-lightbox')), 'Tab left the viewer');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('xmc-lightbox'));
      assert.ok(await page.evaluate(() => !!document.querySelector('.xmc-view')), 'the panel stayed open');
    }
    await page.evaluate(() => document.querySelector('.xmc-vclose').focus());
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.xmc-view:not(.xmc-out)'));
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'xmc-test-opener', 'the focus went back to where it was');
  });
});

browserTest('a photo on a card opens from the keyboard and Esc returns the focus to it', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { const p = document.querySelector('.xmc-card [data-lb]'); p.id = 'xmc-test-photo'; p.focus(); });
    await page.keyboard.press('Enter');
    await page.waitForSelector('#xmc-lightbox');
    assert.ok(await page.evaluate(() => !!document.activeElement.closest('#xmc-lightbox')), 'focus moved into the viewer');
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => !!document.activeElement.closest('#xmc-lightbox')), 'Tab left the viewer'); }
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('xmc-lightbox'));
    assert.equal(await page.evaluate(() => document.activeElement.id), 'xmc-test-photo');
  });
});

browserTest('a post with several pictures shows one at a time in the panel, with arrows and a dot for each', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    // (the stand-in's answer for this post has one picture and replaces the feed's three when it arrives: held back, so that a slow machine
    // is not asked to be quicker than it)
    await page.route('**/TweetDetail**', async (route) => { await new Promise((r) => setTimeout(r, 8000)); await route.continue().catch(() => {}); });
    const open = await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelectorAll('[data-lb]').length === 3); c.querySelector('a.xmc-time').click(); return true; });
    assert.ok(open);
    await page.waitForSelector('.xmc-view .xmc-vmediapane.xmc-car');
    const st = () => page.evaluate(() => { const pane = document.querySelector('.xmc-view .xmc-vmediapane'); return { shown: [...pane.querySelectorAll(':scope > .xmc-vm')].map((x) => !x.hidden), dots: [...pane.querySelectorAll('.xmc-dots i')].map((d) => d.classList.contains('on')), prev: !pane.querySelector('.xmc-cnav.prev').hidden, next: !pane.querySelector('.xmc-cnav.next').hidden }; });
    let a = await st();
    assert.deepEqual(a.shown, [true, false, false]); assert.deepEqual(a.dots, [true, false, false]); assert.equal(a.prev, false); assert.equal(a.next, true);
    await page.locator('.xmc-view .xmc-cnav.next').click();
    a = await st(); assert.deepEqual(a.shown, [false, true, false]); assert.deepEqual(a.dots, [false, true, false]); assert.equal(a.prev, true); assert.equal(a.next, true);
    // the arrow keys step the pictures while the focus is in them, and the posts anywhere else
    await page.evaluate(() => document.querySelector('.xmc-view .xmc-vm img').closest('.xmc-vmediapane').querySelector('.xmc-vm:not([hidden]) img').focus());
    await page.keyboard.press('ArrowRight');
    a = await st(); assert.deepEqual(a.shown, [false, false, true]); assert.equal(a.next, false);
    // (the arrows now go through the pictures and on to the posts: past the last picture is the next post, and back from its first is this one)
    const label = await page.evaluate(() => document.querySelector('.xmc-view').getAttribute('aria-label'));
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((l) => document.querySelector('.xmc-view') && document.querySelector('.xmc-view').getAttribute('aria-label') !== l, label, { timeout: 5000 });
    await page.keyboard.press('ArrowLeft');
    await page.waitForFunction((l) => document.querySelector('.xmc-view') && document.querySelector('.xmc-view').getAttribute('aria-label') === l && document.querySelector('.xmc-view .xmc-vmediapane.xmc-car'), label, { timeout: 5000 });
    await page.locator('.xmc-view .xmc-cnav.next').click(); await page.locator('.xmc-view .xmc-cnav.next').click();
    assert.deepEqual((await st()).shown, [false, false, true]);
    // the wheel flicks between the pictures, and the sides of a picture step too; the middle opens it full size
    await page.locator('.xmc-view .xmc-cnav.prev').click(); await page.locator('.xmc-view .xmc-cnav.prev').click();
    assert.deepEqual((await st()).shown, [true, false, false]);
    const box = await page.locator('.xmc-view .xmc-vm:not([hidden]) img').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => document.querySelectorAll('.xmc-view .xmc-dots i')[1].classList.contains('on'));
    await page.waitForTimeout(450);
    await page.mouse.wheel(0, -120);
    await page.waitForFunction(() => document.querySelectorAll('.xmc-view .xmc-dots i')[0].classList.contains('on'));
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height / 2); // right side: next
    assert.deepEqual((await st()).shown, [false, true, false]);
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height / 2); // left side: back
    assert.deepEqual((await st()).shown, [true, false, false]);
    await page.mouse.click(box.x + box.width * 0.1, box.y + box.height / 2); // nowhere to go: opens the picture
    await page.waitForSelector('#xmc-lightbox');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('xmc-lightbox'));
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // the middle: opens it
    await page.waitForSelector('#xmc-lightbox');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('xmc-lightbox'));
    await page.locator('.xmc-view .xmc-cnav.next').click(); await page.locator('.xmc-view .xmc-cnav.next').click();
    await page.evaluate(() => document.querySelector('.xmc-view .xmc-vm:not([hidden]) img').focus());
    // the picture shown is the one the viewer opens
    await page.keyboard.press('Enter');
    await page.waitForSelector('#xmc-lightbox');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('xmc-lightbox'));
    // the backdrop is at Instagram's level
    const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.xmc-view')).backgroundColor);
    assert.match(bg, /rgba\(0, 0, 0, 0\.7\)/);
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
    assert.ok(r.gone > r.cards * 0.2, `only ${r.gone} of ${r.cards} posts were recycled`); // (how many are far enough away depends on how far the loading got)
    assert.ok(r.nodes0 - r.nodes1 > r.gone * 15, `nodes ${r.nodes0} -> ${r.nodes1} with ${r.gone} posts recycled`); // (a card is dozens of nodes; how many of the page's nodes that is depends on how far the loading got, so it is per post recycled, not a share of the page)
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
  const h = await e.open('/home/', { settings: { v: 8, seen: 'hide', hintSeen: true } }); // (the first-run tip is six lines tall and would take room that reading needs)
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

browserTest('on a very slow connection the tab you switched to is still shown when its feed finally arrives (after we had stopped waiting)', async (e) => {
  const h = await e.open('/home/', { settings: { v: 8, hideForYou: false, keepFollowing: false } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(2500);
    await page.evaluate(() => { window.__delay = 14500; });
    const before = await page.evaluate(() => window.__xmc.view.feedKey);
    await page.locator('.xmc-bar button', { hasText: 'For you' }).first().click();
    await page.waitForFunction((k) => window.__xmc.view.feedKey && window.__xmc.view.feedKey !== k && !document.getElementById('xmc-root').classList.contains('xmc-switching'), before, { timeout: 40000 });
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

browserTest('the settings page offers starting points as radio buttons (one picked), and one applies', async (e) => {
  const h = await e.open('/ext/options.html');
  await checked(h, async () => {
    const { page } = h;
    await page.waitForSelector('#sec-presets #preset-calm');
    assert.equal(await page.locator('#sec-presets input[type=radio]').count(), 4, 'three presets and Custom');
    await page.locator('#preset-calm').check();
    await page.waitForFunction(() => document.getElementById('preset-calm').checked && !document.getElementById('preset-custom').checked);
    assert.equal(await page.locator('#opt-onlyFollowed').isChecked(), true);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xmc.settings')));
    assert.equal(saved.onlyFollowed, true);
    await page.locator('#preset-plain').check();
    await page.waitForFunction(() => document.getElementById('preset-plain').checked && !document.getElementById('preset-calm').checked);
    assert.equal(await page.locator('#opt-onlyFollowed').isChecked(), false);
    await page.locator('#preset-media').check(); // Media wall is picked and stays picked (it used to fall back to the first preset that still matched)
    await page.waitForFunction(() => document.getElementById('preset-media').checked && !document.getElementById('preset-plain').checked && !document.getElementById('preset-calm').checked);
    assert.equal(await page.locator('#opt-maxAutoCols').inputValue(), '8');
    assert.equal(await page.locator('#opt-autoplayVideo').inputValue(), 'muted');
    await page.locator('#preset-calm').check(); // and Calm takes the wall away again
    await page.waitForFunction(() => document.getElementById('preset-calm').checked && !document.getElementById('preset-media').checked);
    assert.equal(await page.locator('#opt-maxAutoCols').inputValue(), '5');
    await page.locator('#preset-custom').check(); // Custom can be chosen by hand, and changes nothing
    await page.waitForFunction(() => document.getElementById('preset-custom').checked && !document.getElementById('preset-calm').checked);
    assert.equal(await page.locator('#opt-onlyFollowed').isChecked(), true, 'the settings are as they were');
    await page.locator('#preset-plain').check();
    await page.waitForFunction(() => document.getElementById('preset-plain').checked && !document.getElementById('preset-custom').checked);
    await page.locator('#opt-hideTrending').check(); // now it matches none of them
    await page.waitForFunction(() => document.getElementById('preset-custom').checked && !document.getElementById('preset-plain').checked);
  });
});

browserTest('the gear opens the settings in a panel over the page (no new tab); a change in it applies at once; Esc, the Close button, the gear and a press outside put it away', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const tabs = () => page.context().pages().length;
    const before = tabs();
    const frameOf = () => page.frames().find((f) => /popup\.html/.test(f.url()));
    await page.locator('.xmc-gear').click();
    await page.waitForSelector('#xmc-settings iframe');
    await page.waitForFunction(() => { const f = document.querySelector('#xmc-settings iframe'); return f && f.contentDocument && f.contentDocument.querySelector('#sections section h2 button.fold'); }, null, { timeout: 8000 });
    assert.equal(tabs(), before, 'no new tab');
    const box = await page.evaluate(() => { const r = document.getElementById('xmc-settings').getBoundingClientRect(); return { right: Math.round(innerWidth - r.right), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; });
    assert.ok(box.w >= 400 && box.h >= 500 && box.top < 80 && box.right < 40, 'a panel at the top right: ' + JSON.stringify(box));
    const f = frameOf();
    assert.ok(f, 'the settings page is in the frame');
    await f.locator('#sections h2 button.fold', { hasText: 'Algorithmic content' }).click();
    await f.locator('#opt-onlyFollowed').check();
    await page.waitForFunction(() => window.__xmc.settings.onlyFollowed === true, null, { timeout: 5000 });
    // Esc with the keyboard in the panel
    await page.keyboard.press('Escape');
    await page.waitForSelector('#xmc-settings', { state: 'detached', timeout: 4000 });
    // the gear again opens it, and again puts it away
    await page.locator('.xmc-gear').click(); await page.waitForSelector('#xmc-settings iframe');
    await page.locator('.xmc-gear').click({ force: true }); // (the gear is under the backdrop now: the press is outside the panel too)
    await page.waitForSelector('#xmc-settings', { state: 'detached', timeout: 4000 });
    // the Close button in the panel
    await page.locator('.xmc-gear').click(); await page.waitForSelector('#xmc-settings iframe');
    await page.waitForFunction(() => { const f = document.querySelector('#xmc-settings iframe'); return f && f.contentDocument && f.contentDocument.querySelector('#close-panel') && !f.contentDocument.querySelector('#close-panel').hidden; }, null, { timeout: 8000 });
    await frameOf().locator('#close-panel').click();
    await page.waitForSelector('#xmc-settings', { state: 'detached', timeout: 4000 });
    // a press on the page outside it
    await page.locator('.xmc-gear').click(); await page.waitForSelector('#xmc-settings iframe');
    await page.mouse.click(300, 600);
    await page.waitForSelector('#xmc-settings', { state: 'detached', timeout: 4000 });
    assert.equal(tabs(), before, 'and still no new tab');
  });
}, 90000);

browserTest('with the settings panel open, the menu, the columns and the right panel stay exactly where they are (it lies over them; the pin check does not take it for a broken pin)', async (e) => {
  const h = await e.open('/home/', { width: 1900, height: 900, settings: { v: 10, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1500);
    const look = () => page.evaluate(() => {
      const r = document.getElementById('xmc-root'), raw = window.__xmc.diagnostics();
      const d = { navFallback: /"navFallback":true/.test(raw), sideFallback: /"sideFallback":true/.test(raw) };
      return { left: r.style.left, right: r.style.right, cols: document.querySelectorAll('.xmc-col').length, colw: Math.round(document.querySelector('.xmc-col').getBoundingClientRect().width), root: Math.round(r.getBoundingClientRect().width), navFallback: d.navFallback, sideFallback: d.sideFallback, pinnedNav: document.querySelector('header[role="banner"]').dataset.xmcStyle !== undefined, pinnedSide: document.querySelector('[data-testid="sidebarColumn"]').dataset.xmcStyle !== undefined };
    });
    const before = await look();
    assert.equal(before.navFallback, false); assert.equal(before.sideFallback, false);
    await page.locator('.xmc-gear').click();
    await page.waitForSelector('#xmc-settings iframe');
    await page.waitForTimeout(4500); // (the pin check looks every half second and gives up after three misses)
    const during = await look();
    assert.deepEqual(during, before, 'nothing moved or resized while the panel was open');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#xmc-settings', { state: 'detached' });
    await page.waitForTimeout(800);
    assert.deepEqual(await look(), before, 'and nothing after it closed');
  });
}, 90000);

browserTest('if the settings panel does not come up, the settings page opens in a tab as before', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.route('**/ext/popup.html**', (r) => r.abort());
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    await page.locator('.xmc-gear').click();
    await page.waitForFunction(() => window.__opened.length === 1, null, { timeout: 8000 });
    assert.match(await page.evaluate(() => window.__opened[0]), /options\.html/);
    assert.equal(await page.locator('#xmc-settings').count(), 0, 'the empty panel is gone');
  });
}, 60000);

browserTest('the panel can be opened at a section (Mute words opens Muting & filtering)', async (e) => {
  const h = await e.open('/ext/popup.html?framed=1&theme=dark#sec-muting', { width: 440, height: 600 });
  await checked(h, async () => {
    const { page } = h;
    await page.waitForSelector('#sections section.open');
    assert.equal(await page.locator('#sections section.open').getAttribute('id'), 'sec-muting');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark', 'in X\'s colours');
  });
});

browserTest('the toolbar button\'s panel has the settings in sections that fold out, one at a time, and a search that opens the ones with a match', async (e) => {
  const h = await e.open('/ext/popup.html', { width: 440, height: 600 });
  await checked(h, async () => {
    const { page } = h;
    await page.waitForSelector('#sections section h2 button.fold');
    const folds = await page.locator('#sections h2 button.fold').allInnerTexts();
    assert.ok(folds.length >= 9, 'a heading for each section: ' + folds.join(' | '));
    assert.ok(folds.some((t) => /Presets/.test(t)) && folds.some((t) => /Home timeline/.test(t)) && folds.some((t) => /Posts/.test(t)), 'the sections of the settings page: ' + folds.join(' | '));
    assert.equal(await page.locator('#sections section.open').count(), 0, 'all folded to begin with');
    assert.equal(await page.locator('#opt-onlyFollowed').isVisible(), false, 'and what is inside them is not in the way');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('nav#nav')).display), 'none', 'no side list: the headings are the list');
    await page.locator('#sections h2 button.fold', { hasText: 'Algorithmic content' }).click();
    await page.waitForSelector('#opt-onlyFollowed', { state: 'visible' });
    assert.equal(await page.locator('#sections h2 button.fold[aria-expanded="true"]').count(), 1);
    await page.locator('#opt-onlyFollowed').check();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('xmc.settings')));
    assert.equal(saved.onlyFollowed, true, 'a change in the panel is saved as on the settings page');
    await page.locator('#sections h2 button.fold', { hasText: 'Home timeline' }).click(); // another one: the first folds
    await page.waitForSelector('#opt-onlyFollowed', { state: 'hidden' });
    assert.equal(await page.locator('#sections section.open').count(), 1, 'one open at a time');
    // the search: every section with a match is open, and folds back when it is cleared
    await page.locator('#opt-search').fill('trending');
    await page.waitForFunction(() => [...document.querySelectorAll('#sections .item[data-key]')].some((i) => !i.hidden && i.offsetHeight > 0 && /trending/i.test(i.textContent)), null, { timeout: 4000 });
    assert.ok((await page.locator('#sections section:not([hidden])').count()) >= 1);
    await page.locator('#opt-search').fill('');
    await page.waitForFunction(() => document.querySelectorAll('#sections section.open').length === 1 && !document.body.classList.contains('finding'));
    // the one left open is open next time
    await page.reload();
    await page.waitForSelector('#sections section.open h2 button.fold');
    assert.match(await page.locator('#sections section.open h2 button.fold').innerText(), /Home timeline/);
    assert.equal(await page.locator('#open-full').count(), 1, 'a way to the whole page');
    // what is pressed in it is big enough and has a name
    const audit = await page.evaluate((fn) => (0, eval)('(' + fn + ')')('body'), auditInPage.toString());
    assert.deepEqual({ small: audit.small, unnamed: audit.unnamed }, { small: [], unnamed: [] }, 'targets in the panel: ' + JSON.stringify(audit));
  });
});

browserTest('a list page: the list\'s name is in the tab title and at the left of the top bar; the scrollbar is the normal width', async (e) => {
  const h = await e.open('/i/lists/123/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForFunction(() => document.title === 'Psyop / X', null, { timeout: 8000 });
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
    // Followers is underlined while the pointer is on it, as on X
    await page.locator('.xmc-profile a', { hasText: '34 Followers' }).hover();
    assert.match(await page.evaluate(() => getComputedStyle([...document.querySelectorAll('.xmc-profile a')].find((x) => /Followers/.test(x.textContent))).textDecorationLine), /underline/);
    // a link inside X's own pages opens as it does elsewhere here (a new tab)
    const opened = h.page.context().waitForEvent('page');
    await page.locator('.xmc-profile a', { hasText: '34 Followers' }).click();
    assert.match((await opened).url(), /\/user7\/verified_followers$/);
    // pointing at Joined marks it for the underline (whatever :hover does), and pressing it brings X's popup up under it, not where X's hidden header is
    await page.locator('.xmc-profile [role="button"]', { hasText: 'Joined' }).hover();
    assert.equal(await page.evaluate(() => !!document.querySelector('.xmc-profile [data-xmc-hover]')), true, 'marked while pointed at');
    await page.locator('.xmc-profile [role="button"]', { hasText: 'Joined' }).click();
    await page.waitForSelector('[data-testid="aboutpop"]', { timeout: 5000 });
    await page.waitForFunction(() => { const p = document.querySelector('[data-testid="aboutpop"]'), j = [...document.querySelectorAll('.xmc-profile [role="button"]')].find((x) => /Joined/.test(x.textContent)); if (!p || !j) return false; const a = p.getBoundingClientRect(), b = j.getBoundingClientRect(); return Math.abs(a.left - b.left) < 20 && a.top >= b.bottom - 2 && a.top < b.bottom + 40; }, null, { timeout: 4000 });
    await page.mouse.click(5, 5); await page.evaluate(() => document.querySelectorAll('#layers > *').forEach((x) => x.remove()));
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

browserTest('a profile\'s header stays up while X\'s hidden page is away on a post (comments, translating, liking), instead of going and not coming back', async (e) => {
  const h = await e.open('/user7/', { width: 1900, height: 900, settings: { v: 9, commentsIn: 'card', hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForSelector('.xmc-profile.xmc-native:not([hidden])', { timeout: 8000 });
    await page.route('**/TweetDetail**', async (route) => { await new Promise((r) => setTimeout(r, 1800)); await route.continue().catch(() => {}); }); // (X takes a moment, as it does)
    const seen = await page.evaluate(async () => {
      const log = { samples: 0, onPost: 0, hidden: 0, gone: 0, emptied: 0 };
      const card = [...document.querySelectorAll('.xmc-card')].find((c) => c.querySelector('[data-act="reply"]'));
      card.querySelector('[data-act="reply"]').click(); // X's hidden page goes to the post to fetch its comments
      for (let i = 0; i < 110; i++) {
        await new Promise((r) => setTimeout(r, 25));
        log.samples++;
        if (/\/status\//.test(location.pathname)) log.onPost++;
        const p = document.querySelector('.xmc-profile');
        if (!p || !p.isConnected) log.gone++; else { if (p.hidden) log.hidden++; if (!p.querySelector('[data-testid="UserName"]')) log.emptied++; }
      }
      return log;
    });
    assert.ok(seen.onPost > 20, 'the hidden page really was on the post for a while: ' + seen.onPost + ' of ' + seen.samples);
    assert.deepEqual({ gone: seen.gone, hidden: seen.hidden, emptied: seen.emptied }, { gone: 0, hidden: 0, emptied: 0 }, 'the header was missing or hidden during the visit: ' + JSON.stringify(seen));
    await page.waitForTimeout(1500);
    assert.equal(await page.locator('.xmc-profile.xmc-native:not([hidden]) [data-testid="UserName"]').count(), 1, 'and it is still there once the hidden page is back');
  });
}, 90000);

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
    assert.ok((await page.locator('.xmc-vside .xmc-text').first().innerText()).includes(id), 'its words'); // (the first: the comments may already be there on a slow machine)
    assert.equal(await page.locator('.xmc-vside [data-act="like"]').count(), 1, 'its actions');
    await page.waitForSelector('.xmc-vside .xmc-cbox', { timeout: 20000 }); // and its comments box
    assert.deepEqual(await page.evaluate(() => window.__opened), [], 'no new tab');
    // like from the panel presses X's real button and shows on the card too
    await page.locator('.xmc-vside [data-act="like"]').click();
    await page.waitForFunction((i) => (window.__actions || []).includes('liked:' + i), id, { timeout: 15000 });
    assert.equal(await page.evaluate((i) => window.__xmc.view.cards.find((t) => t.id === i).el.querySelector('.xmc-actions [data-act="like"]').classList.contains('on'), id), true, 'the card shows it too');
    // Shift and an arrow key go to the next post (the arrow alone goes through the post's pictures first)
    await page.keyboard.press('Shift+ArrowRight');
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
    await page.route(/TweetDetail/, async (r) => { await new Promise((x) => setTimeout(x, 1200)); await r.continue(); }); // (X is slow to answer)
    await card.scrollIntoViewIfNeeded();
    await card.locator(':scope > .xmc-text').click();
    await page.waitForSelector('.xmc-vside .xmc-head');
    const place = () => page.evaluate(() => { const s = document.querySelector('.xmc-view:not(.xmc-out) .xmc-vside'); return { top: s.querySelector('.xmc-head').offsetTop - s.offsetTop - s.scrollTop, ctx: s.querySelectorAll('.xmc-vctx .xmc-pctx').length }; });
    const first = await place();
    assert.equal(first.ctx, 0, 'the post it answers has not arrived yet');
    assert.equal(await page.locator('.xmc-vctx-sk').count(), 1, 'room is kept for it');
    await page.waitForSelector('.xmc-vside .xmc-cbox', { timeout: 25000 });
    assert.match(await page.locator('.xmc-vctx .xmc-pctx').first().innerText(), /tweet 555555/);
    assert.ok(Math.abs((await place()).top - first.top) <= 14, 'the post\'s own words hardly moved when what it answers arrived above them: ' + first.top + ' -> ' + (await place()).top);
    assert.equal(await page.locator('.xmc-vctx-sk').count(), 0, 'the placeholder is gone');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => location.pathname === '/user6/with_replies/', null, { timeout: 15000 });
  });
}, 90000);

browserTest('first run: a short tip says what you can do, and "Got it" keeps it away for good', async (e) => {
  const h = await e.open('/home/', { settings: { hintSeen: false } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForSelector('.xmc-hint:not([hidden])', { timeout: 8000 });
    const tip = await page.locator('.xmc-hint').innerText();
    for (const line of ['Click a post to open it, or press Enter to open the first one.', 'Esc closes posts and the arrow keys move between posts.', 'Point at a picture to like, repost or save it.', 'Move between opened pictures with your mouse scroll wheel.', 'Settings are under the gear in the upper right.', 'Support us here.']) assert.ok(tip.includes(line), line + ' in: ' + tip);
    assert.equal(await page.locator('.xmc-hint li').count(), 6, 'six lines');
    const look = await page.evaluate(() => { const hint = document.querySelector('.xmc-hint'), r = hint.getBoundingClientRect(), u = hint.querySelector('ul').getBoundingClientRect(), a = hint.querySelector('a'); return { align: getComputedStyle(hint).textAlign, off: Math.round(Math.abs((u.left + u.right) / 2 - (r.left + r.right) / 2)), href: a.href, target: a.target, rel: a.rel }; });
    assert.equal(look.align, 'center');
    assert.ok(look.off <= 2, 'the list is in the middle of the bar: ' + look.off);
    assert.deepEqual({ href: look.href, target: look.target, rel: look.rel }, { href: 'https://ko-fi.com/falsehamartia', target: '_blank', rel: 'noopener noreferrer' });
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
    await page.waitForFunction(() => history.state && history.state.xmcView, null, { timeout: 15000 }); // at once, or the moment a background visit that was running has ended
    await page.goBack();
    await page.waitForFunction(() => !document.querySelector('.xmc-view'), null, { timeout: 5000 });
    await page.waitForFunction(() => location.pathname === '/home/' && !window.__xmc.state.peek, null, { timeout: 20000 }); // (a visit that was under way finishes its own way back first)
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
    await page.evaluate(() => { const back = history.back.bind(history); window.__backs = 0; history.back = () => { if (location.pathname === '/home/') window.__backs++; setTimeout(back, 2500); }; });
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
  const off = await e.open('/user/status/90001/', { settings: { v: 9, skipAgeCheck: false } });
  await checked(off, async () => {
    await off.page.waitForTimeout(2500);
    assert.deepEqual(await flags(off), { age: true, other: true }, 'untouched when switched off');
  });
  const on = await e.open('/user/status/90001/');
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
    await page.waitForFunction(() => !window.__xmc.state.peek, null, { timeout: 40000 }); // (a short list shows its end at once, so a further page may be on its way)
    await page.waitForTimeout(3500);
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
    await page.route('**/TweetDetail**', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue().catch(() => {}); }); // (X takes a moment, as it does: the visit lasts long enough to be looked at on a busy machine)
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text').click());
    await page.waitForFunction(() => !!window.__xmc.state.peek && /status/.test(location.pathname), null, { timeout: 15000, polling: 'raf' });
    const during = await page.evaluate(() => { const c = document.getElementById('xmc-navfreeze'); if (!c) return null; const r = c.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), visible: getComputedStyle(c).visibility }; });
    assert.ok(during, 'a still copy of the menu is showing');
    assert.deepEqual([during.left, during.top], before, 'in the same place');
    assert.equal(during.visible, 'visible');
    assert.equal(await page.evaluate(() => document.getElementById('xmc-navfreeze').innerText.includes('Turn Columns')), false, 'our button is not copied into the still menu');
    assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('xmc-pill')).visibility), 'visible', 'our button stays');
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

browserTest('the open post blurs what is behind it a little; it can be switched off, and switches itself off if frames stall', async (e) => {
  const filter = (page) => page.evaluate(() => getComputedStyle(document.querySelector('.xmc-view')).backdropFilter);
  const open = (page) => page.evaluate(() => window.__xmc.view.cards.find((x) => x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text, :scope .xmc-media').click());
  const on = await e.open('/home/', { width: 1300, height: 800 });
  await checked(on, async () => {
    await e.ready(on.page); await on.page.waitForTimeout(800);
    await open(on.page); await on.page.waitForSelector('.xmc-view');
    assert.match(await filter(on.page), /blur\(3px\)/);
  });
  const off = await e.open('/home/', { width: 1300, height: 800, settings: { v: 9, blurBehind: false } });
  await checked(off, async () => {
    await e.ready(off.page); await off.page.waitForTimeout(800);
    await open(off.page); await off.page.waitForSelector('.xmc-view');
    assert.equal(await filter(off.page), 'none');
  });
  const slow = await e.open('/home/', { width: 1300, height: 800 });
  await checked(slow, async () => {
    await e.ready(slow.page); await slow.page.waitForTimeout(800);
    await slow.page.evaluate(() => { const busy = (ms) => { const t = performance.now(); while (performance.now() - t < ms); }; setTimeout(() => busy(220), 150); setTimeout(() => busy(220), 500); });
    await open(slow.page); await slow.page.waitForSelector('.xmc-view');
    await slow.page.waitForFunction(() => !document.querySelector('#xmc-root').classList.contains('xmc-blur'), null, { timeout: 4000 });
    assert.equal(await filter(slow.page), 'none', 'blur dropped for the session');
  });
});

browserTest('comments show the moment they arrive, not after the hidden page has gone back (which can take seconds)', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1500);
    await page.evaluate(() => { const back = history.back.bind(history); history.back = () => { setTimeout(back, 3000); }; });
    const t0 = Date.now();
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text').click());
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-ritem', { timeout: 30000 });
    const took = Date.now() - t0;
    assert.ok(took < 2200, 'comments took ' + took + 'ms with a Back that takes 3000ms');
    const times = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).commentTimes);
    assert.equal(times.length, 1, 'the diagnostics say where the time went');
    for (const k of ['queueMs', 'findMs', 'openMs', 'answerMs', 'totalMs']) assert.equal(typeof times[0][k], 'number', k);
    assert.equal(await page.evaluate(() => !!window.__xmc.state.peek), true, 'the visit was still finishing behind them');
    await page.waitForFunction(() => !window.__xmc.state.peek && location.pathname === '/home/', null, { timeout: 20000 });
  });
}, 90000);

browserTest('a post\'s ... menu has Copy diagnostics (just the details, no page opened) next to Report a problem', async (e) => {
  const h = await e.open('/home/', { settings: { v: 10, hintSeen: true } }); // (the first-run tip appearing a moment after the first posts would move the card under the press)
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    await page.locator('.xmc-card .xmc-moreBtn').first().click({ force: true });
    await page.waitForSelector('.xmc-menu button'); // (the menu is drawn a moment after the press)
    const items = await page.locator('.xmc-menu button').allInnerTexts();
    assert.ok(items.includes('Copy diagnostics') && items.includes('Report a problem'), items.join(' | '));
    await page.locator('.xmc-menu button', { hasText: 'Copy diagnostics' }).click();
    await page.waitForSelector('#xmc-toast');
    assert.deepEqual(await page.evaluate(() => window.__opened), [], 'no tab opened');
  });
});

browserTest('the diagnostics carry a log of what happened (panels, visits, Backs, pins) and say so when X\'s own page shows through', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text').click());
    await page.waitForSelector('.xmc-vside .xmc-ritem', { timeout: 25000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => JSON.parse(window.__xmc.diagnostics()).trace.some((x) => x[1] === 'thaw'), null, { timeout: 20000 });
    const trace = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).trace);
    const got = trace.map((x) => x[1]);
    for (const k of ['panel-open', 'visit', 'freeze', 'thaw', 'back', 'panel-close']) assert.ok(got.includes(k), k + ' in ' + got.join(','));
    const opened = trace.find((x) => x[1] === 'panel-open')[0];
    assert.deepEqual(trace.filter((x) => x[1] === 'LEAK' && x[0] > opened), [], 'nothing showed through once a post was open');
    await page.addStyleTag({ content: 'html.xmc-on [data-testid="primaryColumn"] { opacity: 1 !important; }' });
    await page.waitForFunction(() => JSON.parse(window.__xmc.diagnostics()).trace.some((x) => x[1] === 'LEAK' && /timeline/.test(x[2])), null, { timeout: 5000 });
  });
}, 90000);

browserTest('if X ignores the link press, the comments still load (X\'s router is asked instead), and the page comes back to the timeline', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.__ignoreLinks = 1000; });
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text').click());
    await page.waitForSelector('.xmc-vside .xmc-ritem', { timeout: 30000 });
    assert.ok((await page.evaluate(() => window.__ignored)) >= 2, 'X did ignore the presses');
    await page.waitForFunction(() => !window.__xmc.state.peek && location.pathname === '/home/', null, { timeout: 20000 });
    const times = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).commentTimes);
    assert.equal(times[times.length - 1].how, 'router');
  });
}, 90000);

browserTest('a post X never draws in its hidden list still gets its comments, through X\'s router, in seconds not tens of seconds', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.__neverMount = true; });
    await page.waitForFunction(() => !document.querySelector('[data-testid="primaryColumn"] article'), null, { timeout: 5000 });
    const t0 = Date.now();
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text').click());
    await page.waitForSelector('.xmc-vside .xmc-ritem', { timeout: 30000 });
    assert.ok(Date.now() - t0 < 12000, 'comments took ' + (Date.now() - t0) + 'ms');
    await page.waitForFunction(() => !window.__xmc.state.peek && location.pathname === '/home/', null, { timeout: 20000 });
    const times = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).commentTimes);
    assert.equal(times[times.length - 1].how, 'router');
  });
}, 90000);

browserTest('when X puts a "see all comments" button at the foot of the conversation, the next page is asked for through it', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.__needButton = true; });
    await page.evaluate(() => { const t = window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected); t.counts.reply = 500; t.el.querySelector(':scope > .xmc-text').click(); }); // (a post with far more replies than the first page)
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-ritem', { timeout: 25000 });
    const items = () => page.locator('.xmc-view:not(.xmc-out) .xmc-vside .xmc-ritem').count();
    const first = await items();
    await page.evaluate(() => { const s = document.querySelector('.xmc-view:not(.xmc-out) .xmc-vside'); s.scrollTop = s.scrollHeight; });
    await page.waitForFunction((n) => document.querySelectorAll('.xmc-view:not(.xmc-out) .xmc-vside .xmc-ritem').length > n, first, { timeout: 30000 });
    assert.ok((await page.evaluate(() => window.__btn)) >= 1, 'X\'s button was pressed');
    assert.match(JSON.stringify(await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).moreProbe)), /See all comments/);
  });
}, 90000);

browserTest('when X sends nothing more, the panel says so and offers the rest on X, instead of a spinner that never ends', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.__noPages = true; });
    await page.evaluate(() => { const t = window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected); t.counts.reply = 500; t.el.querySelector(':scope > .xmc-text').click(); }); // (a post with far more replies than the first page)
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-ritem', { timeout: 25000 });
    await page.evaluate(() => { const s = document.querySelector('.xmc-view:not(.xmc-out) .xmc-vside'); s.scrollTop = s.scrollHeight; });
    await page.waitForFunction(() => /See all comments on X/.test(document.querySelector('.xmc-view:not(.xmc-out) .xmc-rmore').innerText), null, { timeout: 40000 });
    assert.equal(await page.locator('.xmc-view .xmc-rmore .xmc-spin, .xmc-view .xmc-rmore svg.spin').count(), 0, 'no spinner left');
  });
}, 90000);

browserTest('opening a post whose video is playing hands the video over to the panel: the one behind stops, the panel\'s plays from the same place', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { // a player stood in for (this browser can't decode the test videos): what matters is who is asked to play and from where
      const st = new WeakMap(), ct = new WeakMap(), proto = HTMLMediaElement.prototype;
      Object.defineProperty(proto, 'paused', { get() { return st.has(this) ? st.get(this) : true; }, configurable: true });
      Object.defineProperty(proto, 'currentTime', { get() { return ct.get(this) || 0; }, set(x) { ct.set(this, x); }, configurable: true });
      proto.play = function () { st.set(this, false); return Promise.resolve(); };
      proto.pause = function () { st.set(this, true); this.dispatchEvent(new Event('pause')); };
    });
    const card = await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelector('video:not([data-gif])')); c.id = 'xmc-test-vcard'; const v = c.querySelector('video'); v.currentTime = 5; v.play(); return true; });
    assert.ok(card);
    await page.evaluate(() => document.querySelector('#xmc-test-vcard a.xmc-time').click());
    await page.waitForSelector('.xmc-view .xmc-vmediapane video');
    const r = await page.evaluate(() => ({ behind: document.querySelector('#xmc-test-vcard video').paused, panel: document.querySelector('.xmc-view .xmc-vmediapane video').paused, at: document.querySelector('.xmc-view .xmc-vmediapane video').currentTime }));
    assert.deepEqual(r, { behind: true, panel: false, at: 5 });
  });
});

browserTest('a quoted post inside a card opens in the panel, not a new tab, and its comments load', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    const id = await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelector('.xmc-quote[data-href]')); const q = c.querySelector('.xmc-quote[data-href]'); q.click(); return q.dataset.href; });
    assert.ok(id);
    await page.waitForSelector('.xmc-view .xmc-vpanel');
    assert.deepEqual(await page.evaluate(() => window.__opened), [], 'no new tab');
    await page.waitForSelector('.xmc-vside .xmc-ritem', { timeout: 30000 });
  });
}, 90000);

browserTest('the panel has no "Open conversation" button; its time is a link to the post on X, and so is a comment\'s', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text').click());
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-ritem', { timeout: 25000 });
    assert.equal(await page.locator('.xmc-view:not(.xmc-out) .xmc-vside').getByText('Open conversation').count(), 0);
    const hrefs = await page.evaluate(() => ({ post: document.querySelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-head a.xmc-time').href, target: document.querySelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-head a.xmc-time').target, comment: document.querySelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-ritem a.xmc-rtime').href }));
    assert.match(hrefs.post, /\/status\/\d+$/); assert.equal(hrefs.target, '_blank'); assert.match(hrefs.comment, /\/status\/\d+$/);
  });
}, 90000);

browserTest('when every comment the post has is already shown, there is no "loading more" line at all', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const t = window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected); t.counts.reply = 1; t.el.querySelector(':scope > .xmc-text').click(); });
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-ritem', { timeout: 25000 });
    assert.equal(await page.locator('.xmc-view:not(.xmc-out) .xmc-rmore').count(), 0);
  });
}, 90000);

browserTest('in the panel a picture is set on a blurred copy of itself, so a smaller picture leaves no dead black', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelectorAll('[data-lb]').length === 3); c.querySelector('a.xmc-time').click(); });
    await page.waitForSelector('.xmc-view .xmc-vmediapane.xmc-car');
    const r = await page.evaluate(() => { const s = document.querySelector('.xmc-view .xmc-vm:not([hidden])'); const b = getComputedStyle(s, '::before'); return { bg: b.backgroundImage, filter: b.filter, content: b.content }; });
    assert.match(r.bg, /url\(/); assert.match(r.filter, /blur/);
  });
});

browserTest('in the panel a picture is scaled to the width of its pane, as it is on the feed, not left at its own smaller size', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    // pictures whose own size is small: 200 x 150
    await page.route(/\/img\/m\d+[0-9]\.svg/, (route) => route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="#369"/></svg>' }));
    await page.reload();
    await e.ready(page);
    await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelectorAll('[data-lb]').length === 1); c.querySelector('a.xmc-time').click(); });
    await page.waitForSelector('.xmc-view .xmc-vmediapane img');
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => { const pane = document.querySelector('.xmc-view .xmc-vmediapane').getBoundingClientRect(), im = document.querySelector('.xmc-view .xmc-vmediapane img'); return { pane: Math.round(pane.width), img: Math.round(im.getBoundingClientRect().width), natural: im.naturalWidth }; });
    assert.ok(r.img >= r.pane * 0.95, 'the picture is ' + r.img + 'px (its own size ' + r.natural + ') in a pane of ' + r.pane + 'px');
  });
});

browserTest('a quoted post\'s picture and a comment\'s picture have their height before they have loaded, so nothing moves when they arrive', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await page.route('**/img/**', () => { /* never answered: no picture arrives */ });
    await page.reload();
    await e.ready(page);
    await page.waitForTimeout(800);
    const q = await page.evaluate(() => [...document.querySelectorAll('.xmc-card .xmc-qmedia')].map((i) => Math.round(i.getBoundingClientRect().height)));
    assert.ok(q.length > 0 && q.every((x) => x >= 60), 'quote pictures are ' + q.join(',') + 'px high before loading');
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text').click());
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-ritem', { timeout: 25000 });
    const r = await page.evaluate(() => [...document.querySelectorAll('.xmc-view:not(.xmc-out) .xmc-vside .xmc-rmedia')].map((i) => Math.round(i.getBoundingClientRect().height)));
    assert.ok(r.length > 0 && r.every((x) => x >= 40), 'comment pictures are ' + r.join(',') + 'px high before loading');
  });
}, 90000);

browserTest('a picture in a comment keeps its shape: never stretched to fill the box it is limited to', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected).el.querySelector(':scope > .xmc-text').click());
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-rmedia', { timeout: 25000 });
    await page.waitForFunction(() => [...document.querySelectorAll('.xmc-vside .xmc-rmedia')].every((i) => i.complete && i.naturalWidth), null, { timeout: 8000 });
    const r = await page.evaluate(() => [...document.querySelectorAll('.xmc-vside .xmc-rmedia')].map((i) => { return { box: i.offsetWidth / i.offsetHeight, own: 800 / 600, h: i.offsetHeight }; })); // (the stand-in says its comment picture is 800 by 600; offset sizes, as a blurred picture is also scaled up)
    assert.ok(r.length > 0);
    for (const x of r) { assert.ok(Math.abs(x.box - x.own) / x.own < 0.04, 'shown at ' + x.box.toFixed(2) + ':1 but the picture is ' + x.own.toFixed(2) + ':1 (X says 800 by 600)'); assert.ok(x.h <= 142, 'no taller than its limit: ' + x.h); }
  });
}, 90000);

browserTest('the button X puts at the foot of a conversation for hidden replies ("Show probable spam") is never pressed, and is named in the diagnostics', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850, settings: { v: 9, fetchContext: false } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { window.__noPages = true; window.__spamCell = true; });
    await page.evaluate(() => { const t = window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected); t.counts.reply = 500; t.el.querySelector(':scope > .xmc-text').click(); });
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-ritem', { timeout: 25000 });
    await page.evaluate(() => { const s = document.querySelector('.xmc-view:not(.xmc-out) .xmc-vside'); s.scrollTop = s.scrollHeight; });
    await page.waitForFunction(() => /See all comments on X/.test(document.querySelector('.xmc-view:not(.xmc-out) .xmc-rmore').innerText), null, { timeout: 40000 });
    assert.equal(await page.evaluate(() => window.__spam || 0), 0, 'the spam button was pressed');
    assert.match(JSON.stringify(await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).moreProbe)), /Show probable spam/);
  });
}, 90000);

browserTest('a quoted post opened in the panel can be liked: X\'s own button is pressed on that post\'s own page', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    const id = await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelector('.xmc-quote[data-href]')); const q = c.querySelector('.xmc-quote[data-href]'); q.click(); return q.dataset.href.split('/').pop(); });
    await page.waitForSelector('.xmc-view .xmc-vpanel');
    await page.locator('.xmc-view .xmc-vside [data-act="like"]').first().click();
    await page.waitForFunction((i) => (window.__actions || []).includes('liked:' + i), id, { timeout: 30000 });
  });
}, 90000);

browserTest('the rows of icons line up from card to card, and a narrow card never cuts its counts off', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 900, settings: { v: 9, cols: 5 } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.xmc-card')].filter((c) => c.getClientRects().length).map((c) => {
        const a = c.querySelector('.xmc-actions'), card = c.getBoundingClientRect(), share = a.querySelector('[data-act="share"]').getBoundingClientRect();
        return { share: Math.round(share.left - card.left), media: !!c.querySelector('[data-act="download"]'), over: a.scrollWidth > a.clientWidth + 1, quote: !!c.querySelector('.xmc-qlink'), w: Math.round(card.width) };
      });
      return rows;
    });
    assert.ok(r.length > 6);
    const withMedia = r.filter((x) => x.media && !x.quote).map((x) => x.share), without = r.filter((x) => !x.media && !x.quote).map((x) => x.share);
    assert.ok(withMedia.length && without.length, 'both kinds of card are on screen');
    assert.ok(Math.max(...withMedia, ...without) - Math.min(...withMedia, ...without) <= 8, 'the link icon is in the same place on every card (to within the width of the digits in the counts): ' + [...withMedia, ...without].join(','));
    assert.equal(r.filter((x) => x.over).length, 0, 'a row is wider than its card');
    assert.ok(r.some((x) => x.quote), 'a card with a quote count is on screen');
  });
}, 90000);

browserTest('in the panel the "More from" heading looks like the "Comments" heading, and the picture keeps a visible ring when the keyboard is on it', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 900 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelectorAll('[data-lb]').length === 1); c.querySelector('a.xmc-time').click(); });
    await page.waitForSelector('.xmc-view .xmc-vpanel');
    await page.waitForTimeout(700);
    const col = await page.evaluate(() => { const m = document.querySelector('.xmc-view .xmc-more-head'), c = document.querySelector('.xmc-view .xmc-rhead b'); return m && c ? [getComputedStyle(m).color, getComputedStyle(c).color] : null; });
    if (col) assert.equal(col[0], col[1], 'the two headings are the same colour');
    for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement.tagName === 'IMG')) break; }
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'IMG', 'Tab reached the picture');
    assert.notEqual(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'none', 'the picture shows where the keyboard is');
  });
}, 90000);

browserTest('the logo at the top of the menu folds it to icons (the names fade, the columns take the room) and unfolds it again; no extra button takes a row', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForSelector('header[role="banner"] h1 a[data-xmc-logo]', { timeout: 10000 });
    const geo = () => page.evaluate(() => { const r = document.getElementById('xmc-root'); const links = [...document.querySelectorAll('header nav a[href]')].filter((a) => getComputedStyle(a).display !== 'none'); return { left: parseFloat(r.style.left), linksRight: Math.max(...links.map((a) => a.getBoundingClientRect().right)), homeLabel: getComputedStyle(document.querySelector('[data-testid="AppTabBar_Home_Link"] > div > div:nth-child(2)')).opacity, tweetW: Math.round(document.querySelector('[data-testid="SideNav_NewTweet_Button"]').getBoundingClientRect().width), hdrRight: Math.round(document.querySelector('header[role="banner"]').getBoundingClientRect().right) }; });
    const lg = await page.evaluate(() => { const a = document.querySelector('header[role="banner"] h1 a'); return { role: a.getAttribute('role'), expanded: a.getAttribute('aria-expanded'), label: a.getAttribute('aria-label'), title: a.title, extra: !!document.querySelector('[data-xmc-menu]'), navFirst: ([...document.querySelectorAll('header nav a[href]')].map((x) => (x.textContent || '').trim()).find(Boolean) || '') }; });
    assert.deepEqual({ role: lg.role, expanded: lg.expanded, label: lg.label, extra: lg.extra }, { role: 'button', expanded: 'true', label: 'Fold the menu to icons', extra: false });
    assert.match(lg.title, /Alt\+\[/);
    assert.equal(lg.navFirst, 'Home', 'the first row of the menu is Home: nothing was added above it');
    const full = await geo();
    assert.equal(full.homeLabel, '1');
    await page.locator('header[role="banner"] h1 a').click();
    assert.equal(await page.evaluate(() => location.pathname), '/home/', 'pressing the logo did not leave the page');
    await page.waitForFunction(() => document.documentElement.classList.contains('xmc-rail') && !document.documentElement.classList.contains('xmc-panelanim'), null, { timeout: 5000 });
    const rail = await geo();
    assert.equal(rail.homeLabel, '0', 'names are gone');
    assert.ok(rail.left < full.left - 40, 'the columns start further left: ' + full.left + ' -> ' + rail.left);
    assert.ok(Math.abs(rail.left - (rail.linksRight + 20)) <= 10, 'and just clear of the icons: ' + rail.left + ' vs ' + (rail.linksRight + 20));
    assert.ok(rail.tweetW <= 52, 'the Post button is round: ' + rail.tweetW);
    const overhang = await page.evaluate(() => { const hd = document.querySelector('header[role="banner"]'), x = parseFloat(document.getElementById('xmc-root').style.left) + 30, el = document.elementFromPoint(x, 400); return { shownTo: Math.round(hd.getBoundingClientRect().right - parseFloat(hd.style.getPropertyValue('--xmc-clip'))), cols: !!(el && el.closest('#xmc-root')) }; });
    assert.ok(overhang.shownTo <= rail.left, 'the part of the menu that shows ends before the columns: ' + overhang.shownTo + ' vs ' + rail.left);
    assert.equal(overhang.cols, true, 'and a press just inside the columns reaches them, not the menu\'s box');
    assert.equal(await page.evaluate(() => document.querySelector('header[role="banner"] h1 a').getAttribute('aria-expanded')), 'false');
    assert.equal(await page.evaluate(() => window.__xmc.settings.leftPanel), 'rail', 'remembered');
    await page.keyboard.press('Alt+BracketLeft'); // and back, from the keyboard
    await page.waitForFunction(() => !document.documentElement.classList.contains('xmc-rail') && !document.documentElement.classList.contains('xmc-panelanim'), null, { timeout: 5000 });
    const back = await geo();
    assert.equal(back.homeLabel, '1');
    assert.ok(Math.abs(back.left - full.left) <= 8, 'the columns are back where they were: ' + full.left + ' vs ' + back.left);
  });
}, 90000);

browserTest('the menu folds by the words of its names, whatever the markup round them; and a menu that will not fold says so', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForSelector('header[role="banner"] h1 a[data-xmc-logo]', { timeout: 10000 });
    // X may nest its links differently from the stand-in: here every link is spans, with the name one box inside another
    await page.evaluate(() => {
      for (const a of document.querySelectorAll('header nav a[href]:not([data-testid="SideNav_NewTweet_Button"])')) {
        const svg = a.querySelector('svg'), word = a.textContent.trim();
        if (!svg || !word) continue;
        a.replaceChildren();
        const w = document.createElement('span'); w.style.cssText = 'display:inline-flex;align-items:center;padding:12px';
        const ic = document.createElement('span'); ic.append(svg);
        const t = document.createElement('span'); t.style.marginLeft = '20px';
        const b = document.createElement('b'); b.textContent = word; t.append(b); w.append(ic, t); a.append(w);
      }
    });
    await page.waitForFunction(() => document.querySelectorAll('header [data-xmc-label]').length >= 5, null, { timeout: 8000 });
    await page.locator('header[role="banner"] h1 a').click();
    await page.waitForFunction(() => document.documentElement.classList.contains('xmc-rail') && !document.documentElement.classList.contains('xmc-panelanim'), null, { timeout: 5000 });
    const r = await page.evaluate(() => ({ shown: [...document.querySelectorAll('header [data-xmc-label]')].filter((x) => x.getBoundingClientRect().width > 1).length, hdrRight: Math.round(document.querySelector('header[role="banner"]').getBoundingClientRect().right - parseFloat(document.querySelector('header[role="banner"]').style.getPropertyValue('--xmc-clip'))), left: parseFloat(document.getElementById('xmc-root').style.left), probe: JSON.parse(window.__xmc.diagnostics()).panels }));
    assert.equal(r.shown, 0, 'no name is left showing');
    assert.ok(r.hdrRight <= r.left, 'and what shows of the menu ends before the columns: ' + r.hdrRight + ' vs ' + r.left);
    assert.equal(r.probe.failed, null);
    assert.match(r.probe.linkShape, /\*\(b"/, 'the diagnostics outline a link, with the name marked: ' + r.probe.linkShape);
    assert.equal(r.probe.namesStillShowing, 0);
    // a menu whose names stay put (here pinned open by force) is reported, once, rather than left looking broken
    await page.locator('header[role="banner"] h1 a').click();
    await page.waitForFunction(() => !document.documentElement.classList.contains('xmc-rail') && !document.documentElement.classList.contains('xmc-panelanim'), null, { timeout: 5000 });
    await page.evaluate(() => { for (const x of document.querySelectorAll('header [data-xmc-label]')) { x.style.setProperty('max-width', 'none', 'important'); x.style.setProperty('opacity', '1', 'important'); x.style.setProperty('margin-left', '20px', 'important'); } });
    await page.locator('header[role="banner"] h1 a').click();
    await page.waitForFunction(() => /would not fold/.test((document.getElementById('xmc-toast') || {}).textContent || ''), null, { timeout: 5000 });
    const bad = await page.evaluate(() => { const d = JSON.parse(window.__xmc.diagnostics()); return { failed: d.panels.failed, trace: d.trace.some((x) => /rail FAILED/.test(JSON.stringify(x))) }; });
    assert.ok(bad.failed && bad.failed.width > bad.failed.expected + 30, JSON.stringify(bad));
    assert.equal(bad.trace, true, 'and the trace has it');
  });
}, 90000);

browserTest('the event log survives a reload, is capped, and goes when it is switched off', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const first = await page.evaluate(() => { const d = JSON.parse(window.__xmc.diagnostics()); window.dispatchEvent(new Event('pagehide')); return d.log.thisLoad; }); // (the page going away writes the log)
    await page.reload();
    await e.ready(page);
    const d = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()));
    assert.notEqual(d.log.thisLoad, first);
    assert.ok(d.log.earlier.some((l) => l.includes(' ' + first + ' load home v')), 'the earlier load is there: ' + JSON.stringify(d.log.earlier.slice(-4)));
    assert.ok(d.log.earlier.some((l) => l.includes(' ' + first + ' pagehide')), 'and its end');
    assert.match(d.log.earlier[0], /^\d\d\/\d\d \d\d:\d\d:\d\d /, 'with the time it happened');
    // never more than 300 entries
    await page.evaluate(() => { const v = JSON.stringify(Array.from({ length: 500 }, (_, i) => [Date.now() - 1000 + i, 'zzz', 'filler', String(i)])); localStorage.setItem('xmc.log', v); window.dispatchEvent(new StorageEvent('storage', { key: 'xmc.log', newValue: v })); }); // (as another tab's write would arrive)
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xmc.log')).length), 300);
  });
  const off = await e.open('/home/', { settings: { keepLog: false } });
  await checked(off, async () => {
    const { page } = off;
    await e.ready(page);
    await page.evaluate(() => { localStorage.setItem('xmc.log', JSON.stringify([[Date.now(), 'old', 'load', '/home/']])); });
    await page.reload(); // (it is read at the start, found switched off, and deleted)
    await e.ready(page);
    await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    assert.equal(await page.evaluate(() => localStorage.getItem('xmc.log')), null, 'nothing kept, and what was there is deleted');
    const d = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()));
    assert.equal(d.log.kept, false);
    assert.deepEqual(d.log.earlier, []);
  });
}, 90000);

// records, from the very start of a page load, when the start-up classes come and go, and what the browser is animating at that moment
const WATCH_START = () => {
  window.__boot = { first: [], boot: [], inflight: [] };
  let wasFirst = false, wasBoot = false;
  new MutationObserver(() => {
    const cols = document.querySelector('.xmc-cols'), isFirst = !!cols && cols.classList.contains('xmc-first'), isBoot = document.documentElement.classList.contains('xmc-boot');
    if (isFirst && !wasFirst) window.__boot.first.push([...document.querySelectorAll('.xmc-col')].map((c) => getComputedStyle(c).animationName + '@' + getComputedStyle(c).animationDelay));
    if (isBoot && !wasBoot) { const hd = document.querySelector('header[role="banner"]'); window.__boot.boot.push(hd ? getComputedStyle(hd).animationName : 'no header'); }
    wasFirst = isFirst; wasBoot = isBoot;
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });
};

browserTest('start-up: the columns settle in one after another once per page load, and not at all for reduced motion', async (e) => {
  const h = await e.open('/home/', { width: 1900, height: 850, settings: { v: 9, cols: 4 } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.context().addInitScript(WATCH_START);
    await page.reload();
    await e.ready(page);
    await page.waitForFunction(() => !document.querySelector('.xmc-cols').classList.contains('xmc-first'), null, { timeout: 3000 }); // taken off again by itself
    const b = await page.evaluate(() => window.__boot.first);
    assert.equal(b.length, 1, 'once: ' + JSON.stringify(b));
    assert.deepEqual(b[0].slice(0, 4), ['xmc-settle@0s', 'xmc-settle@0.012s', 'xmc-settle@0.024s', 'xmc-settle@0.036s'], 'each column a little after the one before');
    // switching what is shown fades the whole block as before, and does not start it over
    await page.evaluate(() => { document.querySelector('.xmc-showbtn').click(); document.querySelectorAll('.xmc-menu button')[1].click(); });
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => window.__boot.first.length), 1, 'not again');
    const log = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).trace.filter((x) => x[1] === 'first-draw'));
    assert.equal(log.length, 1, 'the time of the first draw is in the log');
    assert.match(log[0][2], /^\d+ ms after the page began$/);
    // for people who ask for less motion there is none
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    await e.ready(page);
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => window.__boot.first);
    assert.ok(r.every((x) => x.every((n) => /^none@/.test(n))), 'no animation: ' + JSON.stringify(r));
  });
}, 90000);

browserTest('start-up: when X\'s page is let through, its menu and sidebar fade in over 0.1 s rather than appear at once', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.context().addInitScript(WATCH_START);
    await page.evaluate(() => localStorage.setItem('xmcVeil', location.pathname)); // as the last visit left it
    await page.reload();
    await e.ready(page);
    await page.waitForTimeout(500);
    const b = await page.evaluate(() => window.__boot.boot);
    assert.deepEqual(b, ['xmc-fade'], 'the menu is fading when the veil lifts: ' + JSON.stringify(b));
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('xmc-boot')), false, 'and it is taken off again');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('header[role="banner"]')).visibility), 'visible');
  });
}, 90000);

browserTest('text size: the posts and the panel follow it, live, and the top bar does not', async (e) => {
  const big = await e.open('/home/', { width: 1700, height: 850, settings: { v: 9, textSize: 'large' } });
  await checked(big, async () => {
    const { page } = big;
    await e.ready(page);
    const px = () => page.evaluate(() => ({ card: parseFloat(getComputedStyle(document.querySelector('.xmc-card')).fontSize), text: parseFloat(getComputedStyle(document.querySelector('.xmc-card .xmc-text')).fontSize), chip: parseFloat(getComputedStyle(document.querySelector('.xmc-bar .xmc-chip, .xmc-bar .xmc-showlabel')).fontSize) }));
    const large = await px();
    assert.ok(Math.abs(large.card - 15 * 1.15) < 0.05, 'cards at 115%: ' + large.card);
    const h0 = await page.evaluate(() => Math.round(document.querySelector('.xmc-card').getBoundingClientRect().height));
    // live, as the settings page would change it
    await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'xmc.settings', newValue: JSON.stringify({ v: 9, textSize: 'xlarge' }) })));
    await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.querySelector('.xmc-card')).fontSize) - 15 * 1.3) < 0.05, null, { timeout: 4000 });
    const xl = await px();
    assert.equal(xl.chip, large.chip, 'the top bar keeps its size');
    await page.waitForTimeout(600);
    const h1 = await page.evaluate(() => Math.round(document.querySelector('.xmc-card').getBoundingClientRect().height));
    assert.ok(h1 > h0 - 2, 'a card is not shorter with bigger text: ' + h0 + ' -> ' + h1);
    // the panel too
    await page.evaluate(() => document.querySelector('.xmc-card .xmc-text').click());
    await page.waitForSelector('.xmc-view .xmc-vside .xmc-text', { timeout: 8000 });
    const panel = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.xmc-vside .xmc-text')).fontSize));
    assert.ok(panel > 22, 'panel text scaled too: ' + panel);
  });
}, 90000);

browserTest('settings page: search narrows the list, a changed setting is marked, and Reset puts it back', async (e) => {
  const o = await e.open('/ext/options.html');
  await checked(o, async () => {
    const { page } = o;
    await page.waitForSelector('#opt-cols');
    const vis = () => page.evaluate(() => [...document.querySelectorAll('.item[data-key]')].filter((x) => !x.hidden).map((x) => x.dataset.key));
    const status = () => page.locator('#find-status').innerText();
    const all = await vis();
    assert.ok(all.length > 30, 'a long list: ' + all.length);
    await page.keyboard.press('/');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'opt-search', '/ goes to the search');
    await page.keyboard.type('download');
    const d = await vis();
    assert.ok(d.includes('dlFolder') && !d.includes('cols') && d.length < all.length / 2, 'only the matching ones: ' + d.length + ' of ' + all.length);
    assert.equal(await page.evaluate(() => document.getElementById('sec-columns').hidden), true, 'a section with none left goes');
    assert.equal(await page.evaluate(() => document.querySelector('#nav a[href="#sec-columns"]').hidden), true, 'and its link');
    assert.match(await status(), /^\d+ settings?$/);
    await page.fill('#opt-search', 'save folder'); // words in any order
    assert.ok((await vis()).includes('dlFolder'));
    await page.fill('#opt-search', 'zzzzqq');
    assert.equal((await vis()).length, 0);
    assert.match(await status(), /No settings match/);
    await page.keyboard.press('Escape');
    assert.equal(await page.inputValue('#opt-search'), '', 'Esc clears it');
    assert.equal((await vis()).length, all.length, 'and the whole list is back');
    // a changed setting is marked, counted, listed on its own, and can be put back
    assert.equal(await page.locator('#changed-count').innerText(), '0');
    await page.locator('#opt-cols').fill('3');
    await page.keyboard.press('Tab');
    await page.waitForSelector('.item[data-key="cols"] .chg:not([hidden])', { timeout: 3000 });
    assert.equal(await page.locator('#changed-count').innerText(), '1');
    await page.check('#only-changed');
    assert.deepEqual(await vis(), ['cols'], 'only the changed one');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('xmc.settings')).cols), 3);
    await page.locator('.item[data-key="cols"] button.reset').click();
    assert.equal(await page.inputValue('#opt-cols'), '0', 'the box shows the default again');
    assert.equal(await page.locator('#changed-count').innerText(), '0');
    assert.equal(await page.evaluate(() => 'cols' in JSON.parse(localStorage.getItem('xmc.settings') || '{}')), false, 'and it is no longer stored');
    assert.deepEqual(await vis(), [], 'nothing changed, so nothing listed');
    await page.uncheck('#only-changed');
    assert.equal((await vis()).length, all.length);
  });
}, 90000);

browserTest('everything that can be pressed is at least 24 px each way and has a name a screen reader can say', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 9, hintSeen: false, navBookmarks: true, navLikes: true, navLists: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    // (cards and the tip fade and grow in for a moment: a slower machine measured a 23.6 px link in the middle of it. Wait until nothing that ends is still moving.)
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running' || (a.effect && a.effect.getComputedTiming().iterations === Infinity)), null, { timeout: 10000 });
    await page.waitForTimeout(600);
    const audit = async (state, scope = OURS) => {
      const r = await page.evaluate(auditInPage, scope);
      assert.ok(r.checked > 10, state + ': ' + r.checked + ' things looked at');
      assert.deepEqual({ small: r.small, unnamed: r.unnamed }, { small: [], unnamed: [] }, state);
    };
    await audit('the feed');
    // several pictures in the panel. (The stand-in's answer for this post has one picture, so the arrows would be there only until it
    // arrives: it is held back for a few seconds so that they can be looked at.)
    await page.route('**/TweetDetail**', async (route) => { await new Promise((r) => setTimeout(r, 4000)); await route.continue().catch(() => {}); });
    await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelectorAll('[data-lb]').length === 3); c.querySelector('a.xmc-time').click(); });
    await page.waitForSelector('.xmc-view .xmc-vmediapane.xmc-car', { timeout: 10000 });
    await page.waitForTimeout(400);
    await audit('the pictures in the panel');
    await page.unroute('**/TweetDetail**');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.xmc-view:not(.xmc-out)') && !window.__xmc.state.peek && location.pathname === '/home/', null, { timeout: 15000 }); // (the visit for the comments is over, so the next post opens as the first did)
    await page.evaluate(() => document.querySelector('.xmc-showbtn').click());
    await audit('the filter menu');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Alt+BracketLeft'); await page.waitForTimeout(600);
    await audit('folded to icons');
    await page.keyboard.press('Alt+BracketLeft'); await page.waitForTimeout(600);
    // the panel, with its comments
    await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelector('[data-lb]') && x.querySelector(':scope > .xmc-text')); c.querySelector(':scope > .xmc-text').click(); });
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-ritem', { timeout: 25000 });
    await page.waitForTimeout(500);
    await audit('the post panel and its comments');
    await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.querySelector('.xmc-view:not(.xmc-out)'));
    // the viewer
    await page.evaluate(() => document.querySelector('.xmc-card [data-lb]').focus());
    await page.keyboard.press('Enter');
    await page.waitForSelector('#xmc-lightbox');
    await audit('the photo viewer');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('xmc-lightbox'), null, { timeout: 5000 }); // (closed, before the next post is opened)
  });
  const prof = await e.open('/user7/', { width: 1700, height: 900 });
  await checked(prof, async () => {
    await e.ready(prof.page);
    await prof.page.waitForSelector('.xmc-profile.xmc-native', { timeout: 8000 });
    const r = await prof.page.evaluate(auditInPage, OURS);
    assert.deepEqual({ small: r.small, unnamed: r.unnamed }, { small: [], unnamed: [] }, 'a profile header');
  });
  const opt = await e.open('/ext/options.html', { width: 1280, height: 900 });
  await checked(opt, async () => {
    await opt.page.waitForSelector('#opt-cols');
    const r = await opt.page.evaluate(auditInPage, null);
    assert.ok(r.checked > 60);
    assert.deepEqual({ small: r.small, unnamed: r.unnamed }, { small: [], unnamed: [] }, 'the settings page');
  });
}, 120000);

// A stand-in for the browser's own extension API (browser.storage.local and friends), kept in the page's localStorage so it survives a reload.
// The other tests run the scripts as plain page scripts; this makes them take the path they take in Firefox, where the settings, the read-posts
// list and the log live in storage.local and every change is announced by storage.onChanged.
const FAKE_EXT = (seed) => {
  const KEY = '__fake_ext_storage';
  if (seed && localStorage.getItem(KEY) === null) localStorage.setItem(KEY, JSON.stringify(seed));
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
  const write = (o) => localStorage.setItem(KEY, JSON.stringify(o));
  const listeners = [];
  const pick = (all, keys) => { if (keys == null) return JSON.parse(JSON.stringify(all)); const ks = typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys); const out = {}; for (const k of ks) if (k in all) out[k] = JSON.parse(JSON.stringify(all[k])); return out; };
  const fire = (ch) => setTimeout(() => listeners.forEach((fn) => fn(ch, 'local')), 0);
  window.browser = {
    runtime: { id: 'fake@test', getManifest: () => ({ version: '9.9.9' }), sendMessage: async () => ({ ok: true }) },
    storage: {
      onChanged: { addListener: (fn) => listeners.push(fn) },
      local: {
        get: async (keys) => pick(read(), keys),
        set: async (obj) => { const all = read(), ch = {}; for (const [k, v] of Object.entries(obj)) { ch[k] = { oldValue: all[k], newValue: JSON.parse(JSON.stringify(v)) }; all[k] = JSON.parse(JSON.stringify(v)); } write(all); fire(ch); },
        remove: async (keys) => { const all = read(), ch = {}; for (const k of [].concat(keys)) if (k in all) { ch[k] = { oldValue: all[k] }; delete all[k]; } write(all); fire(ch); },
      },
    },
  };
  window.__stored = () => read();
};

browserTest('with the browser\'s own storage API: settings load from it, change live, reset when removed, and the log is kept there', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await page.context().addInitScript(FAKE_EXT, { v: 9, hintSeen: true, textSize: 'large' });
    await page.reload();
    await e.ready(page);
    const size = () => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.xmc-card')).fontSize));
    assert.ok(Math.abs(await size() - 17.25) < 0.05, 'read from storage.local: ' + await size());
    // the settings page (another context) writes: it applies at once
    await page.evaluate(() => window.browser.storage.local.set({ textSize: 'xlarge' }));
    await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.querySelector('.xmc-card')).fontSize) - 19.5) < 0.05, null, { timeout: 4000 });
    // Reset on the settings page removes the key: the default is back
    await page.evaluate(() => window.browser.storage.local.remove('textSize'));
    await page.waitForFunction(() => Math.abs(parseFloat(getComputedStyle(document.querySelector('.xmc-card')).fontSize) - 15) < 0.05, null, { timeout: 4000 });
    // what the page itself changes is saved there, and only what differs from the default
    await page.evaluate(() => document.querySelector('.xmc-nsfw').click());
    await page.waitForFunction(() => 'nsfw' in window.__stored(), null, { timeout: 4000 });
    const kept = await page.evaluate(() => window.__stored());
    assert.ok(!('textSize' in kept), 'the default is not stored');
    assert.ok(!('xmcLog' in kept) || Array.isArray(kept.xmcLog));
    // the log: written when the page goes away, found again after a reload, and never mistaken for a setting
    const first = await page.evaluate(() => { window.dispatchEvent(new Event('pagehide')); return JSON.parse(window.__xmc.diagnostics()).log.thisLoad; });
    await page.waitForFunction(() => Array.isArray(window.__stored().xmcLog) && window.__stored().xmcLog.length > 3, null, { timeout: 4000 });
    assert.equal(await page.evaluate(() => 'xmcLog' in window.__xmc.settings), false, 'the log is not a setting');
    await page.reload();
    await e.ready(page);
    const d = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()));
    assert.ok(d.log.earlier.some((l) => l.includes(' ' + first + ' load home v9.9.9')), 'the earlier load is read back from storage.local: ' + JSON.stringify(d.log.earlier.slice(-3)));
    assert.equal(d.version, '9.9.9');
    // switching the log off removes it from storage
    await page.evaluate(() => window.browser.storage.local.set({ keepLog: false }));
    await page.waitForFunction(() => !('xmcLog' in window.__stored()), null, { timeout: 4000 });
  });
}, 90000);

browserTest('the settings page with the browser\'s own storage API: a change is saved, marked, and Reset takes the key out of storage', async (e) => {
  const o = await e.open('/ext/options.html');
  await checked(o, async () => {
    const { page } = o;
    await page.context().addInitScript(FAKE_EXT, { v: 9, cols: 3, xmcLog: [[Date.now(), 'abc', 'load', 'home']] });
    await page.reload();
    await page.waitForSelector('#opt-cols');
    assert.equal(await page.inputValue('#opt-cols'), '3', 'read from storage.local');
    assert.equal(await page.locator('#changed-count').innerText(), '1');
    await page.locator('#opt-cols').fill('5'); await page.keyboard.press('Tab');
    await page.waitForFunction(() => window.__stored().cols === 5, null, { timeout: 3000 });
    await page.selectOption('#opt-textSize', 'large');
    await page.waitForFunction(() => window.__stored().textSize === 'large', null, { timeout: 3000 });
    const count = (n) => page.waitForFunction((x) => document.getElementById('changed-count').textContent === x, String(n), { timeout: 3000 }); // (marked a moment after it is saved)
    await count(2);
    await page.locator('.item[data-key="cols"] button.reset').click();
    await page.waitForFunction(() => !('cols' in window.__stored()), null, { timeout: 3000 });
    assert.equal(await page.inputValue('#opt-cols'), '0');
    await count(1);
    // a write from a page of x.com (the log) does not upset it
    await page.evaluate(() => window.browser.storage.local.set({ xmcLog: [[Date.now(), 'def', 'load', 'home']] }));
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#changed-count').innerText(), '1');
  });
}, 90000);

browserTest('the Columns pill stays where it is while X\'s hidden page is away on a post (comments, translating, liking), instead of vanishing and coming back', async (e) => {
  const h = await e.open('/home/', { settings: { v: 9, commentsIn: 'card', hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForFunction(() => { const p = document.getElementById('xmc-pill'); return p && !p.hidden; }, null, { timeout: 5000 });
    await page.route('**/TweetDetail**', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue().catch(() => {}); }); // (X takes a moment, as it does: the hidden page stays on the post)
    const seen = await page.evaluate(async () => {
      const pill = document.getElementById('xmc-pill'), log = { samples: 0, hidden: 0, onPost: 0, texts: new Set(), gone: 0 };
      const card = [...document.querySelectorAll('.xmc-card')].find((c) => c.querySelector('[data-act="reply"]'));
      card.querySelector('[data-act="reply"]').click(); // X's hidden page goes to the post to fetch its comments
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => setTimeout(r, 25));
        log.samples++;
        if (/\/status\//.test(location.pathname)) log.onPost++;
        if (pill.hidden || getComputedStyle(pill).display === 'none') log.hidden++;
        if (!pill.isConnected) log.gone++;
        log.texts.add((pill.textContent || '').trim());
      }
      return Object.assign(log, { texts: [...log.texts] });
    });
    assert.ok(seen.onPost > 20, 'the hidden page really was on the post for a while: ' + seen.onPost + ' of ' + seen.samples);
    assert.deepEqual({ hidden: seen.hidden, gone: seen.gone }, { hidden: 0, gone: 0 }, 'the pill was hidden for ' + seen.hidden + ' of ' + seen.samples + ' looks');
    assert.deepEqual(seen.texts, ['Turn Columns Off']);
  });
  // and on a post's own page, which X shows as itself, there is none
  const post = await e.open('/user/status/90001/');
  await checked(post, async () => {
    await post.page.waitForTimeout(1200);
    assert.equal(await post.page.evaluate(() => { const p = document.getElementById('xmc-pill'); return !p || p.hidden || getComputedStyle(p).display === 'none'; }), true);
  });
}, 90000);

browserTest('a post X has already translated on its own page is shown translated in the panel, with Show original, with no visit to X', async (e) => {
  const h = await e.open('/home/', { settings: { v: 9, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    // X's hidden page translates the post (this is what its own markup looks like once it has: the words changed, "Translated from", "Show original").
    // The stand-in redraws its posts as the page scrolls, so the change is made again until it has been taken.
    const id = await page.evaluate(() => {
      const mark = () => {
        for (const x of document.querySelectorAll('article[data-testid="tweet"]')) {
          const l = x.querySelector('a[href*="/status/"]'), c = l && window.__xmc.view.cards.find((k) => k.lang === 'ja' && l.getAttribute('href').endsWith('/status/' + k.id));
          if (!c || x.querySelector('.fake-xl')) continue;
          x.querySelector('[data-testid="tweetText"]').textContent = 'Words that X translated';
          const n = document.createElement('div'); n.className = 'fake-xl'; n.innerHTML = '<span>Translated from Japanese</span> <div role="button">Show original</div>'; x.append(n);
          window.__xlId = c.id;
        }
      };
      mark(); window.__xlTimer = setInterval(mark, 100);
      return window.__xlId;
    });
    await page.waitForFunction(() => { const p = JSON.parse(window.__xmc.diagnostics()).autoTranslate; return p && p.taken >= 1; }, null, { timeout: 6000 });
    await page.evaluate(() => clearInterval(window.__xlTimer));
    const taken = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).autoTranslate.ids);
    assert.ok(taken.length >= 1);
    const pick = await page.evaluate((ids) => ids.find((i) => { const c = window.__xmc.view.cards.find((k) => k.id === i); return c && c.el && c.el.isConnected && c.el.querySelector('.xmc-translate'); }), taken);
    assert.ok(pick, 'one of them has its card on screen: ' + taken.join(','));
    await page.evaluate((i) => { window.__xmc.view.cards.find((c) => c.id === i).el.querySelector('.xmc-translate').click(); }, pick);
    const side = '.xmc-view:not(.xmc-out) .xmc-vside';
    await page.waitForSelector(side + ' .xmc-xlate:not([hidden])', { timeout: 8000 });
    const shown = await page.locator(side + ' .xmc-xlate').first().innerText();
    assert.match(shown, /Translated from Japanese[\s\S]*Words that X translated/);
    assert.equal(await page.locator(side + ' > .xmc-translate').first().innerText(), 'Show original', 'as on X');
    assert.equal(await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).translateTimes.length), 0, 'no visit was made to translate it');
  });
  // switched off, nothing is taken
  const off = await e.open('/home/', { settings: { v: 9, hintSeen: true, autoTranslate: false } });
  await checked(off, async () => {
    await e.ready(off.page);
    await off.page.waitForTimeout(2500);
    assert.equal(await off.page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).autoTranslate), null);
  });
}, 90000);

// the foreign-language post (the stand-in marks every seventh post as Japanese) whose card has a Translate button, and a way to count the visits made for it
const XL = {
  card: () => { const t = window.__xmc.view.cards.find((c) => c.lang === 'ja' && c.el && c.el.isConnected && c.el.querySelector('.xmc-translate')); return t ? t.id : null; },
};

browserTest('pointing at Translate starts it before you press it, in the one visit that fetches the comments; then pressing shows it at once', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 9, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const id = await page.evaluate(XL.card);
    assert.ok(id, 'a foreign-language post with a button');
    const btn = page.locator('.xmc-card:has(a.xmc-time[href$="/status/' + id + '"]) .xmc-translate');
    await btn.scrollIntoViewIfNeeded();
    await btn.hover();
    // nothing has been pressed: no panel, yet X's hidden page goes to the post
    await page.waitForFunction((i) => JSON.parse(window.__xmc.diagnostics()).trace.some((x) => x[1] === 'visit' && x[2].startsWith('start ' + i)), id, { timeout: 5000 });
    assert.equal(await page.evaluate(() => !!document.querySelector('.xmc-view')), false, 'no panel: the button has not been pressed');
    await page.waitForFunction((i) => { const d = JSON.parse(window.__xmc.diagnostics()).translateTimes; return d.some((x) => x.id === i && x.ok); }, id, { timeout: 15000 });
    const z = await page.evaluate((i) => JSON.parse(window.__xmc.diagnostics()).translateTimes.find((x) => x.id === i), id);
    assert.deepEqual({ via: z.via, warm: z.warm }, { via: 'comments', warm: true }, JSON.stringify(z));
    // now the press: the panel opens with it already translated, and its comments are there from the same visit
    await btn.click();
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-xlate:not([hidden])', { timeout: 4000 });
    assert.equal(await page.locator('.xmc-view:not(.xmc-out) .xmc-vside > .xmc-translate').first().innerText(), 'Show original');
    await page.waitForTimeout(1500);
    assert.equal(await page.evaluate((i) => JSON.parse(window.__xmc.diagnostics()).trace.filter((x) => x[1] === 'visit' && x[2].startsWith('start ' + i)).length, id), 1, 'one visit in all: the comments and the translation came together');
  });
}, 90000);

browserTest('passing the pointer over Translate without stopping starts nothing', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 9, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const id = await page.evaluate(XL.card);
    const btn = page.locator('.xmc-card:has(a.xmc-time[href$="/status/' + id + '"]) .xmc-translate');
    await btn.scrollIntoViewIfNeeded();
    const b = await btn.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.move(b.x + b.width / 2, b.y - 80); // away again within a moment
    await page.waitForTimeout(900);
    assert.equal(await page.evaluate((i) => JSON.parse(window.__xmc.diagnostics()).trace.filter((x) => x[1] === 'visit' && x[2].startsWith('start ' + i)).length, id), 0, 'no visit');
  });
}, 90000);

browserTest('pressing Translate while the one begun by pointing at it is still on its way waits for that, and makes no second visit', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 9, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.route('**/TweetDetail**', async (route) => { await new Promise((r) => setTimeout(r, 1500)); await route.continue().catch(() => {}); }); // (X takes a moment)
    const id = await page.evaluate(XL.card);
    const btn = page.locator('.xmc-card:has(a.xmc-time[href$="/status/' + id + '"]) .xmc-translate');
    await btn.scrollIntoViewIfNeeded();
    await btn.hover();
    await page.waitForFunction((i) => JSON.parse(window.__xmc.diagnostics()).trace.some((x) => x[1] === 'visit' && x[2].startsWith('start ' + i)), id, { timeout: 5000 });
    await btn.click(); // still on its way
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-xlate:not([hidden])', { timeout: 20000 });
    assert.equal(await page.evaluate((i) => JSON.parse(window.__xmc.diagnostics()).trace.filter((x) => x[1] === 'visit' && x[2].startsWith('start ' + i)).length, id), 1, 'one visit');
  });
}, 90000);

browserTest('over a post the cursor is the ordinary arrow; the hand is for links and buttons only', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 9, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const c = await page.evaluate(() => {
      const card = document.querySelector('.xmc-card'), cur = (el) => getComputedStyle(el).cursor;
      return { card: cur(card), words: cur(card.querySelector('.xmc-text')), head: cur(card.querySelector('.xmc-head')), name: cur(card.querySelector('a.xmc-name')), time: cur(card.querySelector('a.xmc-time')), like: cur(card.querySelector('[data-act="like"]')), reply: cur(card.querySelector('[data-act="reply"]')) };
    });
    assert.deepEqual({ card: c.card, words: c.words, head: c.head }, { card: 'default', words: 'default', head: 'default' }, 'arrow over the post itself');
    assert.deepEqual({ name: c.name, time: c.time, like: c.like, reply: c.reply }, { name: 'pointer', time: 'pointer', like: 'pointer', reply: 'pointer' }, 'hand over links and buttons');
    // and it is still clickable: pressing the words opens the panel
    await page.locator('.xmc-card:has(.xmc-media) .xmc-text').first().click();
    await page.waitForSelector('.xmc-view', { timeout: 8000 });
  });
}, 90000);

browserTest('folded to icons, the columns start by the icons even when the links in X\'s menu stay as wide as they were', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForSelector('header[role="banner"] h1 a[data-xmc-logo]', { timeout: 10000 });
    // as seen on X: each link is as wide as the whole menu (stretched, or holding room for a name that is hidden), so its box does not shrink with its icon
    await page.evaluate(() => { for (const a of document.querySelectorAll('header nav a[href]')) a.style.setProperty('min-width', '240px'); });
    await page.waitForTimeout(300);
    const left = () => page.evaluate(() => parseFloat(document.getElementById('xmc-root').style.left));
    const full = await left();
    await page.locator('header[role="banner"] h1 a').click();
    await page.waitForFunction(() => document.documentElement.classList.contains('xmc-rail') && !document.documentElement.classList.contains('xmc-panelanim'), null, { timeout: 5000 });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => { const hd = document.querySelector('header[role="banner"]').getBoundingClientRect(); const probe = JSON.parse(window.__xmc.diagnostics()).panels; return { left: parseFloat(document.getElementById('xmc-root').style.left), hdrRight: Math.round(hd.right), failed: probe.failed, widest: probe.widestLinks }; });
    assert.ok(r.left < full - 100, 'the columns moved left to take the room: ' + full + ' -> ' + r.left + ' (widest boxes: ' + r.widest + ')');
    assert.ok(r.left < 140, 'and start by the icons, not by the widest box: ' + r.left);
    assert.equal(r.failed, null, 'the names are gone, so it is not reported as unable to fold');
    // pressing the columns' left edge reaches the columns, not an overhanging link
    const hit = await page.evaluate((x) => { const el = document.elementFromPoint(x, 400); return !!(el && el.closest('#xmc-root')); }, Math.round(r.left + 30));
    assert.equal(hit, true, 'a press just inside the columns lands on them');
  });
}, 90000);

browserTest('folded to icons, the icons stay where they are and in view when X\'s menu sits at the right of a wide header (as it does on a wide window), and the empty part of the header catches no presses', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForSelector('header[role="banner"] h1 a[data-xmc-logo]', { timeout: 10000 });
    // X's header takes the free room at the left of the page and keeps its menu against its right edge, in a box of its own width
    await page.evaluate(() => {
      const hd = document.querySelector('header[role="banner"]');
      hd.dataset.xmcStyle = 'position:fixed;left:200px;top:0;bottom:0;width:700px;display:flex;flex-direction:column;align-items:flex-end';
      hd.querySelector('nav').style.width = '260px';
      window.dispatchEvent(new Event('resize'));
    });
    await page.waitForTimeout(900);
    const look = () => page.evaluate(() => {
      const hd = document.querySelector('header[role="banner"]');
      const svgs = [...hd.querySelectorAll('nav a[href] svg')].filter((s) => s.getBoundingClientRect().width);
      const b = svgs[0].getBoundingClientRect(), rootLeft = parseFloat(document.getElementById('xmc-root').style.left);
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2), beside = document.elementFromPoint(rootLeft + 30, 500);
      return { iconLeft: Math.round(b.left), iconRight: Math.round(b.right), rootLeft, iconHit: !!(hit && hd.contains(hit)), besideIsColumns: !!(beside && beside.closest('#xmc-root')), seen: JSON.parse(window.__xmc.diagnostics()).panels.menuGone };
    });
    const full = await look();
    assert.ok(full.iconLeft >= 0 && full.iconHit, 'with the names, the icons are in view: ' + JSON.stringify(full));
    await page.locator('header[role="banner"] h1 a').click();
    await page.waitForFunction(() => document.documentElement.classList.contains('xmc-rail') && !document.documentElement.classList.contains('xmc-panelanim'), null, { timeout: 5000 });
    await page.waitForTimeout(700);
    const rail = await look();
    assert.ok(rail.iconLeft >= 0 && rail.iconRight <= rail.rootLeft, 'folded, the icons are in view and before the columns: ' + JSON.stringify(rail));
    assert.equal(rail.iconHit, true, 'and nothing else is on top of them: ' + JSON.stringify(rail));
    assert.equal(rail.besideIsColumns, true, 'a press just inside the columns reaches them, not the empty part of the header: ' + JSON.stringify(rail));
    await page.waitForTimeout(2500);
    const later = await look();
    assert.deepEqual({ iconLeft: later.iconLeft, iconHit: later.iconHit, seen: later.seen }, { iconLeft: rail.iconLeft, iconHit: true, seen: null }, 'and it stays, with nothing to repair: ' + JSON.stringify(later));
  });
}, 90000);

browserTest('while X\'s hidden page is away on a post, the still copy that stands in for a folded menu is folded too (no names showing, no wider than the icons)', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850, settings: { v: 9, commentsIn: 'card', hintSeen: true, leftPanel: 'rail' } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForFunction(() => document.documentElement.classList.contains('xmc-rail') && !document.documentElement.classList.contains('xmc-panelanim'), null, { timeout: 8000 });
    await page.waitForTimeout(600);
    await page.route('**/TweetDetail**', async (route) => { await new Promise((r) => setTimeout(r, 2500)); await route.continue().catch(() => {}); });
    await page.evaluate(() => { const card = [...document.querySelectorAll('.xmc-card')].find((c) => c.querySelector('[data-act="reply"]')); card.querySelector('[data-act="reply"]').click(); });
    await page.waitForSelector('#xmc-navfreeze', { timeout: 5000 });
    const r = await page.evaluate(() => {
      const copy = document.getElementById('xmc-navfreeze'), real = document.querySelector('header[role="banner"]');
      const labels = [...copy.querySelectorAll('[data-xmc-label]')];
      const post = copy.querySelector('[data-xmc-tid="SideNav_NewTweet_Button"]');
      return { labels: labels.length, showing: labels.filter((x) => x.getBoundingClientRect().width > 1 && Number(getComputedStyle(x).opacity) > 0.05).length,
        copyRight: Math.round(copy.getBoundingClientRect().right), realRight: Math.round(real.getBoundingClientRect().right), rootLeft: parseFloat(document.getElementById('xmc-root').style.left),
        clip: getComputedStyle(copy).clipPath, copyClipped: Math.round(copy.getBoundingClientRect().right - parseFloat(copy.style.getPropertyValue('--xmc-clip'))), post: post ? Math.round(post.getBoundingClientRect().width) : null };
    });
    assert.ok(r.labels > 0, 'the copy has the names to fold');
    assert.equal(r.showing, 0, 'no name shows in the copy: ' + JSON.stringify(r));
    assert.equal(r.copyRight, r.realRight, 'and the copy is where the real menu is: ' + JSON.stringify(r));
    assert.notEqual(r.clip, 'none', 'and is clipped to the icons as the real one is: ' + JSON.stringify(r));
    assert.ok(r.copyClipped <= r.rootLeft, 'so it ends before the columns do: ' + JSON.stringify(r));
    if (r.post !== null) assert.ok(r.post <= 52, 'the Post button is round in the copy: ' + r.post);
  });
}, 90000);

browserTest('if the menu is not showing (hidden, clipped, covered) it is pinned again within a second or two, then again without the clip, and the diagnostics say what was found', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850, settings: { v: 9, hintSeen: true, leftPanel: 'rail' } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForFunction(() => document.documentElement.classList.contains('xmc-rail') && !document.documentElement.classList.contains('xmc-panelanim'), null, { timeout: 8000 });
    await page.waitForTimeout(1200);
    const seen = () => page.evaluate(() => { const hd = document.querySelector('header[role="banner"]'); const a = [...hd.querySelectorAll('nav a[href]')].find((x) => x.querySelector('svg')); const b = a.querySelector('svg').getBoundingClientRect(); const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!(hit && hd.contains(hit)); });
    assert.equal(await seen(), true, 'to begin with, the menu is there');
    // 1: something on its inline style hides it (X rewriting it): pinning again puts X's own style back, and ours on top
    await page.evaluate(() => document.querySelector('header[role="banner"]').style.setProperty('visibility', 'hidden', 'important'));
    await page.waitForFunction(() => { const hd = document.querySelector('header[role="banner"]'); return getComputedStyle(hd).visibility !== 'hidden'; }, null, { timeout: 6000 });
    assert.equal(await seen(), true, 'back after one repair');
    // 2: a rule that only the clip-free pin gets round (the clip stands in for the thing that went wrong on X)
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const st = document.createElement('style'); st.id = 'zz-test-rule'; st.textContent = 'html.xmc-rail:not(.xmc-noclip) header[role="banner"][data-xmc-style] { visibility: hidden !important; }'; document.head.append(st); });
    await page.waitForFunction(() => document.documentElement.classList.contains('xmc-noclip'), null, { timeout: 8000 });
    await page.waitForTimeout(400);
    assert.equal(await seen(), true, 'back after the second, without the clip');
    const d = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()));
    assert.ok(d.panels.menuGone && /visibility:hidden/.test(d.panels.menuGone.why), 'the diagnostics say what was found: ' + JSON.stringify(d.panels.menuGone));
    assert.ok(JSON.stringify(d.trace).includes('menu gone'), 'and the trace has it');
  });
}, 90000);

browserTest('Bookmarks, Likes and Lists made while X shows its menu as icons alone get their names once X shows them (and the other way about)', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850, settings: { v: 10, hintSeen: true, navBookmarks: true, navLikes: true, navLists: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const words = () => page.evaluate(() => [...document.querySelectorAll('header [data-xmc-nav]')].map((a) => a.textContent.trim()));
    await page.waitForFunction(() => document.querySelectorAll('header [data-xmc-nav]').length === 3, null, { timeout: 8000 });
    assert.deepEqual(await words(), ['Bookmarks', 'Likes', 'Lists']);
    // X's compact layout: its links lose their names (as they do in a narrow window); the entries of ours are made again, without
    await page.evaluate(() => {
      window.__zzLabels = [];
      for (const a of document.querySelectorAll('header nav a[href]:not([data-xmc-nav])')) for (const l of a.querySelectorAll('div[dir="ltr"]')) { window.__zzLabels.push([l.parentElement, l, l.nextSibling]); l.remove(); }
    });
    await page.waitForFunction(() => { const x = [...document.querySelectorAll('header [data-xmc-nav]')]; return x.length === 3 && x.every((a) => !a.textContent.trim()); }, null, { timeout: 8000 });
    // and X comes back with room: its names return, and so must theirs
    await page.evaluate(() => { for (const [parent, l, next] of window.__zzLabels) parent.insertBefore(l, next && next.parentNode === parent ? next : null); });
    await page.waitForFunction(() => { const x = [...document.querySelectorAll('header [data-xmc-nav]')].map((a) => a.textContent.trim()); return x.join() === 'Bookmarks,Likes,Lists'; }, null, { timeout: 8000 });
    assert.deepEqual(await words(), ['Bookmarks', 'Likes', 'Lists']);
  });
}, 90000);

browserTest('a video taken full screen stays full screen when the window grows (the columns are laid out again after it, not under it)', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850, settings: { v: 10, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const cols = () => page.evaluate(() => document.querySelectorAll('.xmc-col').length);
    const before = await cols();
    await page.evaluate(() => { const v = document.querySelector('.xmc-card video'); v.scrollIntoView({ block: 'center' }); window.__zzv = v; });
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(async () => { await window.__zzv.requestFullscreen(); return document.fullscreenElement === window.__zzv; }), true, 'in full screen');
    await page.setViewportSize({ width: 2300, height: 900 }); // (the window grows to the whole screen: more room for columns)
    await page.waitForTimeout(1800);
    const during = await page.evaluate(() => ({ fs: document.fullscreenElement === window.__zzv, connected: window.__zzv.isConnected }));
    assert.deepEqual(during, { fs: true, connected: true }, 'still full screen, and the video was not moved');
    assert.equal(await cols(), before, 'the columns are left alone meanwhile');
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction((n) => document.querySelectorAll('.xmc-col').length > n, before, { timeout: 5000 });
  });
}, 90000);

const keysTest = (init) => async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true }, init });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    // what Vimium does when what it last clicked is not inside something that scrolls: it scrolls the page itself (here, X's hidden page)
    await page.evaluate(() => {
      let lastG = 0;
      const fr = document.createElement('iframe'); fr.style.display = 'none'; document.body.append(fr); // (the page's own scroll calls: in Firefox the extension's are a separate thing, here they are the same window's)
      const by = (x, y) => fr.contentWindow.scrollBy.call(window, x, y), to = (x, y) => fr.contentWindow.scrollTo.call(window, x, y);
      document.addEventListener('keydown', (ev) => {
        const k = ev.key, d = document.documentElement;
        if (k === 'j') by(0, 60); else if (k === 'k') by(0, -60);
        else if (k === 'd') by(0, innerHeight / 2); else if (k === 'u') by(0, -innerHeight / 2);
        else if (k === 'G') to(0, d.scrollHeight);
        else if (k === 'g') { if (Date.now() - lastG < 500) to(0, 0); lastG = Date.now(); }
        else if (k === 'Escape') by(0, 300); // (X putting its own page back where it was: not a key's doing)
      }, true);
      document.activeElement && document.activeElement.blur();
    });
    const top = () => page.evaluate(() => document.querySelector('.xmc-scroller').scrollTop);
    // (X's page is left alone for a while once the posts are in, and keeps some room at its top and bottom: "up" and "down" have somewhere to go)
    const settle = () => page.waitForFunction(() => { const w = window.__zzIdle = window.__zzIdle || { y: -1, at: Date.now() }; if (Math.round(window.scrollY) !== w.y) { w.y = Math.round(window.scrollY); w.at = Date.now(); } const max = document.documentElement.scrollHeight - innerHeight; return Date.now() - w.at > 2800 && window.scrollY >= 60 && window.scrollY <= max - 60 && max > 300; }, null, { timeout: 30000, polling: 200 });
    for (let i = 0; i < 3; i++) {
      await settle();
      const before = await top();
      await page.keyboard.press('j'); await page.waitForTimeout(300);
      assert.ok((await top()) - before >= 50, 'j ' + (i + 1) + ': the columns moved: ' + before + ' -> ' + (await top()));
    }
    await settle();
    const t1 = await top();
    await page.keyboard.press('k'); await page.waitForTimeout(300);
    assert.ok(t1 - (await top()) >= 50, 'k moves them back up');
    await settle();
    const t2 = await top();
    await page.keyboard.press('d'); await page.waitForTimeout(300);
    assert.ok((await top()) - t2 >= 300, 'd moves them half a screen down: ' + t2 + ' -> ' + (await top()));
    await settle();
    await page.keyboard.press('Escape'); await page.waitForTimeout(400); // (Esc is not a scroll key: whatever X does to its page is left to it)
    const t3 = await top();
    await settle();
    await page.keyboard.press('u'); await page.waitForTimeout(300);
    assert.ok(t3 - (await top()) >= 300, 'u moves them half a screen up');
    await settle();
    const tg = await top();
    await page.keyboard.press('G'); await page.waitForTimeout(500);
    assert.ok((await top()) - tg >= 1500, 'G goes to the end (more posts load as it arrives): ' + tg + ' -> ' + (await top()));
    await settle();
    await page.keyboard.press('g'); await page.waitForTimeout(100); await page.keyboard.press('g'); await page.waitForTimeout(500);
    assert.ok((await top()) <= 5, 'gg goes to the top: ' + (await top()));
    // and a key typed into a box is the box's
    const before = await top();
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'zz-box'; i.style.cssText = 'position:fixed;left:5px;bottom:5px;z-index:99999'; document.body.append(i); i.focus(); });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), 'zz-box', 'the box has the keyboard');
    await page.keyboard.type('jjjdd'); await page.waitForTimeout(400);
    const after = await top();
    assert.equal(after, before, 'typing in a box moves nothing: ' + before + ' -> ' + after);
  });
};
browserTest('keys that scroll the page behind the columns (Vimium: j k d u gg G) scroll the columns, wherever the last click was', keysTest(null), 120000);
// Gecko moves a page whose root is overflow:hidden (which X's is, under the columns) without firing a scroll event on it, so the extension looks at where the page is, too.
browserTest('the same keys scroll the columns in a browser that fires no scroll event on the page itself', keysTest(() => {
  const add = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (t, ...rest) { if (t === 'scroll' && this === window) return undefined; return add.call(this, t, ...rest); };
}), 120000);

browserTest('"Save sample for the developer" writes a file with the shape of what X sent and the markup of the buttons, without the words, and the file passes the checks real samples get', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(3500); // (X's hidden page has posts mounted, and the first probe has run)
    await page.locator('.xmc-card .xmc-moreBtn').first().click({ force: true });
    await page.waitForSelector('.xmc-menu button');
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 10000 }), page.locator('.xmc-menu button', { hasText: 'Save sample for the developer' }).click()]);
    const sample = JSON.parse(require('node:fs').readFileSync(await download.path(), 'utf8'));
    assert.equal(sample.kind, 'multi-column-for-x sample');
    assert.match(download.suggestedFilename(), /^multi-column-for-x-sample-\d{4}-\d\d-\d\d\.json$/);
    assert.ok(Object.keys(sample.ops).some((op) => /Timeline/.test(op)), 'a timeline: ' + Object.keys(sample.ops));
    for (const k of ['like', 'repost', 'bookmark', 'reply']) assert.ok(sample.controls[k], k + ' markup');
    const text = JSON.stringify(sample);
    assert.ok(!/\[HomeLatestTimeline\] tweet/.test(text), 'the stand-in\'s post text is not in it');
    // the same checks the samples in test/fixtures/real get
    for (const [op, { url, json }] of Object.entries(sample.ops)) { const r = Parse.parseResponse(json, url + '?variables=%7B%7D'); if (r) assert.ok(r.items.length > 0, op + ' reads'); }
    for (const [kind, html] of Object.entries(sample.controls)) if (Logic.CONTROLS[kind]) assert.ok(Logic.CONTROLS[kind].some((id) => html.includes('data-testid="' + id + '"')), kind + ' is found by its test id in the markup');
    assert.ok(sample.probe && sample.probe.like && sample.probe.homeLink, 'the probe is in it: ' + JSON.stringify(sample.probe));
  });
}, 90000);

browserTest('the markup in a sample keeps the labels of buttons, the menu and the tabs and nothing that names a person (a post\'s author is a link, a test id carries a handle)', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const out = await page.evaluate(() => {
      const d = document.createElement('div');
      d.innerHTML = '<article data-testid="tweet">'
        + '<div data-testid="UserAvatar-Container-zedexample"><a href="/zedexample" role="link"><img alt="" src="https://pbs.twimg.com/profile_images/1/x.jpg"></a></div>'
        + '<div data-testid="User-Name"><div><a href="/zedexample" role="link"><span>Zed Example</span></a></div><div><a href="/zedexample" role="link"><span>@zedexample</span></a><span>·</span><a href="/zedexample/status/123456789" role="link"><time>16h</time></a></div></div>'
        + '<div role="group" aria-label="68 replies, 115 reposts, 1K likes"><button data-testid="reply" aria-label="68 Replies. Reply"><span>68</span></button><button data-testid="like" aria-label="Follow @zedexample"><span>Like</span></button><button aria-label="Share post"></button></div>'
        + '<nav><a href="/home"><span>Home</span></a><a href="/zedexample" aria-label="Profile"><span>Profile</span></a></nav>'
        + '<div role="tablist"><a role="tab" href="/home"><span>For you</span></a></div>'
        + '</article>';
      return XMCSample.sanitizeMarkup(d);
    });
    assert.ok(!/zed|example/i.test(out), 'no name, no handle: ' + out.slice(0, 600));
    assert.ok(!/UserAvatar-Container-\w*zed/i.test(out) && /UserAvatar-Container-user/.test(out), 'the avatar\'s test id keeps its kind, not the handle');
    for (const kept of ['data-testid="reply"', 'aria-label="68 Replies. Reply"', '>68<', '>Like<', 'aria-label="Share post"', '>Home<', '>Profile<', '>For you<']) assert.ok(out.includes(kept), 'kept: ' + kept);
    assert.ok(!/Follow @/.test(out), 'a label with a handle in it is not kept');
  });
}, 60000);

browserTest('the master switch off (the setting and the note kept for the hook): nothing is drawn, changed or recorded, and X\'s page stays X\'s', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true, enabled: false }, init: () => { localStorage.setItem('xmcOff', '1'); localStorage.setItem('xmcVeil', '/home'); } });
  await checked(h, async () => {
    const { page } = h;
    await page.waitForTimeout(3500);
    const seen = await page.evaluate(() => {
      const col = document.querySelector('[data-testid="primaryColumn"]'), cs = col && getComputedStyle(col);
      return { root: !!document.getElementById('xmc-root'), pill: !!document.getElementById('xmc-pill'), on: document.documentElement.classList.contains('xmc-on'), veil: document.documentElement.classList.contains('xmc-veil'),
        hook: !!window.__xmcHook, api: !!window.__xmc, xVisible: !!cs && cs.visibility === 'visible' && Number(cs.opacity) > 0, cards: document.querySelectorAll('.xmc-card').length, art: document.querySelectorAll('article').length };
    });
    assert.deepEqual({ ...seen, art: seen.art > 0 }, { root: false, pill: false, on: false, veil: false, hook: false, api: false, xVisible: true, cards: 0, art: true }, JSON.stringify(seen));
  });
}, 60000);

browserTest('the master switch is off but the note kept for the hook says on (switched off while no X tab was open): the page is let go before anything is drawn, and the note is brought up to date', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true, enabled: false } });
  await checked(h, async () => {
    const { page } = h;
    await page.waitForFunction(() => localStorage.getItem('xmcOff') === '1', null, { timeout: 8000 });
    await page.waitForTimeout(1500);
    const seen = await page.evaluate(() => ({ root: !!document.getElementById('xmc-root'), on: document.documentElement.classList.contains('xmc-on'), veil: document.documentElement.classList.contains('xmc-veil'), cards: document.querySelectorAll('.xmc-card').length }));
    assert.deepEqual(seen, { root: false, on: false, veil: false, cards: 0 });
  });
}, 60000);

browserTest('turning the master switch off and on from a settings page puts this tab back to X\'s and then back to columns (the tab reloads each time)', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const set = (value) => page.evaluate((v) => { localStorage.setItem('xmc.settings', JSON.stringify(v)); window.dispatchEvent(new StorageEvent('storage', { key: 'xmc.settings', newValue: JSON.stringify(v) })); }, value);
    await Promise.all([page.waitForEvent('load', { timeout: 15000 }), set({ v: 10, hintSeen: true, enabled: false })]);
    await page.waitForTimeout(2500);
    assert.deepEqual(await page.evaluate(() => ({ root: !!document.getElementById('xmc-root'), on: document.documentElement.classList.contains('xmc-on'), note: localStorage.getItem('xmcOff'), hook: !!window.__xmcHook })), { root: false, on: false, note: '1', hook: false }, 'off: X\'s own page');
    await Promise.all([page.waitForEvent('load', { timeout: 15000 }), set({ v: 10, hintSeen: true })]);
    await e.ready(page);
    assert.deepEqual(await page.evaluate(() => ({ on: document.documentElement.classList.contains('xmc-on'), note: localStorage.getItem('xmcOff') })), { on: true, note: null }, 'on again: columns');
  });
}, 90000);

browserTest('a post closed and opened again while its comments are still queued behind another request gets its comments, not "Closed before it loaded"', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true, commentsIn: 'panel' } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    let n = 0;
    await page.route('**/TweetDetail**', async (route) => { n++; if (n === 1) await new Promise((r) => setTimeout(r, 4000)); await route.continue().catch(() => {}); });
    const open = async (i) => { await page.locator('.xmc-card .xmc-text').nth(i).click(); await page.waitForFunction(() => !!document.querySelector('.xmc-view'), null, { timeout: 5000 }); };
    await open(0); await page.keyboard.press('Escape'); // the first request is under way and slow
    await page.waitForFunction(() => !document.querySelector('.xmc-view'), null, { timeout: 5000 });
    await open(1); await page.keyboard.press('Escape'); // this one waits behind it, and its panel goes
    await page.waitForFunction(() => !document.querySelector('.xmc-view'), null, { timeout: 5000 });
    await open(1); // asked for again: the same request, wanted again
    await page.waitForFunction(() => document.querySelectorAll('.xmc-view .xmc-ritem').length >= 1, null, { timeout: 25000 });
    assert.ok(!/Closed before it loaded/.test(await page.evaluate(() => document.querySelector('.xmc-view').innerText)), 'no failure shown');
  });
}, 90000);

browserTest('in a post\'s panel the arrow keys walk the pictures and then the posts (Shift: the posts only), and A S W E Q C like, bookmark, repost, download, copy the link and comment', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true, commentsIn: 'panel' } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const openMulti = () => page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelectorAll('[data-lb]').length === 3); c.querySelector('.xmc-text').click(); });
    await openMulti();
    await page.waitForSelector('.xmc-view .xmc-car');
    const where = () => page.evaluate(() => ({ title: document.querySelector('.xmc-view').getAttribute('aria-label'), pic: [...document.querySelectorAll('.xmc-view .xmc-car .xmc-dots i')].findIndex((d) => d.classList.contains('on')) }));
    const first = await where();
    assert.equal(first.pic, 0);
    await page.keyboard.press('ArrowRight'); assert.equal((await where()).pic, 1, 'the next picture');
    await page.keyboard.press('ArrowRight'); assert.equal((await where()).pic, 2, 'and the one after');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction((t) => document.querySelector('.xmc-view') && document.querySelector('.xmc-view').getAttribute('aria-label') !== t, first.title, { timeout: 4000 });
    const second = await where();
    assert.notEqual(second.title, first.title, 'past the last picture: the next post');
    await page.keyboard.press('Shift+ArrowLeft');
    await page.waitForFunction((t) => document.querySelector('.xmc-view') && document.querySelector('.xmc-view').getAttribute('aria-label') === t, first.title, { timeout: 4000 });
    assert.equal((await where()).pic, 0, 'Shift and an arrow: the post, whatever picture it was on');
    // the letters: the stand-in\'s own page records what its buttons were pressed to do
    const acts = () => page.evaluate(() => Array.from(window.__actions || []));
    const before = (await acts()).length;
    await page.keyboard.press('a');
    await page.waitForFunction((n) => Array.from(window.__actions || []).slice(n).some((x) => /^liked:/.test(x)), before, { timeout: 15000 });
    assert.equal(await page.evaluate(() => document.querySelector('.xmc-view .xmc-actions [data-act="like"]').classList.contains('on')), true, 'A: liked, and the heart shows it');
    await page.keyboard.press('s');
    assert.equal(await page.evaluate(() => document.querySelector('.xmc-view .xmc-actions [data-act="bookmark"]').classList.contains('on')), true, 'S: bookmarked');
    await page.keyboard.press('q');
    await page.waitForFunction(() => /Link copied|Couldn.t copy/.test(document.getElementById('xmc-toast').textContent), null, { timeout: 4000 });
    await page.keyboard.press('e');
    await page.waitForFunction(() => /Downloading|Nothing to download|Download failed/.test(document.getElementById('xmc-toast').textContent), null, { timeout: 4000 });
    await page.keyboard.press('w');
    await page.waitForFunction(() => document.querySelector('.xmc-view .xmc-actions [data-act="repost"]').classList.contains('on') || /posted|Repost|Undo/.test(document.getElementById('xmc-toast').textContent), null, { timeout: 8000 });
    // comment: the box has the keyboard; letters typed there are letters; Esc leaves the box and the panel stays
    await page.keyboard.press('c');
    assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.className), 'xmc-cbox', 'C: the comment box');
    const liked = (await acts()).filter((x) => /^liked:/.test(x)).length;
    await page.keyboard.type('asweq');
    assert.equal(await page.evaluate(() => document.activeElement.value), 'asweq', 'typed as letters');
    assert.equal((await acts()).filter((x) => /^liked:/.test(x)).length, liked, 'and not as shortcuts');
    await page.keyboard.press('Escape');
    assert.equal(await page.evaluate(() => !!document.querySelector('.xmc-view') && document.activeElement.className !== 'xmc-cbox'), true, 'Esc leaves the box, the panel stays');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.xmc-view'), null, { timeout: 4000 });
  });
}, 120000);

browserTest('the keys can be remapped in Settings, Keyboard (press a row, press a key; no two actions share one), and the panel, its tooltips and its legend follow', async (e) => {
  const o = await e.open('/ext/options.html');
  await checked(o, async () => {
    const page = o.page;
    await page.waitForSelector('#sec-keys .keyrow');
    const row = (label) => page.locator('#sec-keys .keyrow', { hasText: label });
    assert.equal((await row('Like').locator('.kbtn').innerText()).trim(), 'A');
    await row('Like').locator('.kbtn').click();
    await page.keyboard.press('f');
    await page.waitForFunction(() => /like[^a-z]+f/.test(localStorage.getItem('xmc.settings') || ''));
    assert.equal((await row('Like').locator('.kbtn').innerText()).trim(), 'F');
    await row('Bookmark').locator('.kbtn').click();
    await page.keyboard.press('f'); // taken
    assert.match(await page.locator('#sec-keys .keymsg').innerText(), /F is already Like/);
    assert.equal((await row('Bookmark').locator('.kbtn').innerText()).trim(), 'Press a key', 'still waiting for another');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => [...document.querySelectorAll('#sec-keys .keyrow')].find((r) => /Bookmark/.test(r.textContent)).querySelector('.kbtn').textContent.trim() === 'S');
    await row('Like').locator('button.reset').click();
    assert.equal((await row('Like').locator('.kbtn').innerText()).trim(), 'A');
    assert.ok(!/keyMap|"like"/.test(await page.evaluate(() => localStorage.getItem('xmc.settings') || '')), 'the default is not kept as a choice');
  });
}, 60000);

browserTest('in the panel a remapped key does what the old one did, the tooltips and the legend show the keys in use, and the legend\'s button opens it', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true, keyMap: JSON.stringify({ like: 'f', bookmark: 'g' }) } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { document.querySelector('.xmc-card .xmc-text').click(); });
    await page.waitForSelector('.xmc-view');
    assert.match(await page.locator('.xmc-view .xmc-actions [data-act="like"]').getAttribute('title'), /\(F\)/);
    assert.match(await page.locator('.xmc-view .xmc-actions [data-act="bookmark"]').getAttribute('title'), /\(G\)/);
    const n = await page.evaluate(() => Array.from(window.__actions || []).length);
    await page.keyboard.press('a'); await page.waitForTimeout(800); // the old key: nothing
    assert.equal(await page.evaluate(() => Array.from(window.__actions || []).length), n);
    await page.keyboard.press('f');
    await page.waitForFunction((k) => Array.from(window.__actions || []).slice(k).some((x) => /^liked:/.test(x)), n, { timeout: 15000 });
    await page.locator('.xmc-vkeys').click();
    const legend = await page.locator('.xmc-keylegend').innerText();
    assert.match(legend, /F\s+Like/); assert.match(legend, /G\s+Bookmark/); assert.match(legend, /Q\s+Copy link/); assert.match(legend, /Pictures, then posts/); assert.match(legend, /Shift/);
    await page.mouse.click(300, 300); // anywhere else: it goes
    await page.waitForFunction(() => !document.querySelector('.xmc-keylegend'));
  });
}, 90000);

browserTest('the keys are pointed out once, the first time a post\'s panel opens (a toast with a way to change them), and not again', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true, keysHintSeen: false } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { document.querySelector('.xmc-card .xmc-text').click(); });
    await page.waitForFunction(() => /Keys here:.*A like.*S bookmark/.test((document.getElementById('xmc-toast') || {}).textContent || ''), null, { timeout: 6000 });
    assert.equal(await page.locator('#xmc-toast .xmc-undo').innerText(), 'Change');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('xmc.settings'))).keysHintSeen, true);
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.xmc-view'));
    await page.evaluate(() => { document.getElementById('xmc-toast').hidden = true; document.querySelectorAll('.xmc-card .xmc-text')[1].click(); });
    await page.waitForSelector('.xmc-view'); await page.waitForTimeout(1800);
    assert.ok(!(await page.evaluate(() => { const t = document.getElementById('xmc-toast'); return !t.hidden && /Keys here/.test(t.textContent); })), 'not a second time');
  });
}, 60000);

browserTest('from the feed, Enter opens the first post in view (and the arrows carry on from there); on a button or in a box it is theirs; the key can be moved', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    await page.keyboard.press('Enter');
    await page.waitForSelector('.xmc-view');
    const first = await page.evaluate(() => document.querySelector('.xmc-view').getAttribute('aria-label'));
    const wantFirst = await page.evaluate(() => { const w = window.__xmc.view.cards[0]; return 'Post by ' + w.author.name; });
    assert.equal(first, wantFirst, 'the first post on the page');
    await page.keyboard.press('Shift+ArrowRight');
    await page.waitForFunction((t) => document.querySelector('.xmc-view') && document.querySelector('.xmc-view').getAttribute('aria-label') !== t, first, { timeout: 4000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.xmc-view'));
    // scrolled down: the first one in view, not the first on the page
    await page.evaluate(() => { document.querySelector('.xmc-scroller').scrollTop = 2400; });
    await page.waitForTimeout(800);
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    await page.keyboard.press('Enter');
    await page.waitForSelector('.xmc-view');
    assert.notEqual(await page.evaluate(() => document.querySelector('.xmc-view').getAttribute('aria-label')), first, 'a post further down');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.xmc-view'));
    // Enter on a button is the button\'s
    await page.locator('.xmc-gear').focus();
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.xmc-view').count(), 0, 'no panel from a focused button');
  });
}, 90000);

browserTest('the feed key can be another key, and then Enter does nothing there', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true, keyMap: JSON.stringify({ open: 'o' }) } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
    await page.keyboard.press('Enter'); await page.waitForTimeout(700);
    assert.equal(await page.locator('.xmc-view').count(), 0);
    await page.keyboard.press('o');
    await page.waitForSelector('.xmc-view');
  });
}, 60000);

browserTest('the panel\'s keys are off when the setting is off (the arrows still walk, the letters do nothing)', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true, panelKeys: false } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { document.querySelector('.xmc-card .xmc-text').click(); });
    await page.waitForSelector('.xmc-view');
    const n = await page.evaluate(() => Array.from(window.__actions || []).length);
    await page.keyboard.press('a'); await page.keyboard.press('s'); await page.waitForTimeout(1500);
    assert.equal(await page.evaluate(() => Array.from(window.__actions || []).length), n, 'nothing pressed');
    assert.ok(!(await page.evaluate(() => document.querySelector('.xmc-view .xmc-actions [data-act="like"]').title)).includes('(A)'), 'and no key in the tooltips');
  });
}, 60000);

browserTest('in the picture viewer the same letters act on its post: E downloads the picture showing, A likes, Q copies the link, C opens the comment box', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true, commentsIn: 'panel' } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelectorAll('[data-lb]').length === 3); c.querySelectorAll('[data-lb]')[1].click(); });
    await page.waitForSelector('#xmc-lightbox');
    const before = await page.evaluate(() => Array.from(window.__actions || []).length);
    await page.keyboard.press('a');
    await page.waitForFunction((n) => Array.from(window.__actions || []).slice(n).some((x) => /^liked:/.test(x)), before, { timeout: 15000 });
    await page.keyboard.press('e');
    await page.waitForFunction(() => /Downloading/.test(document.getElementById('xmc-toast').textContent), null, { timeout: 4000 });
    await page.keyboard.press('q');
    await page.waitForFunction(() => /Link copied|Couldn.t copy/.test(document.getElementById('xmc-toast').textContent), null, { timeout: 4000 });
    await page.keyboard.press('c');
    await page.waitForSelector('.xmc-view');
    await page.waitForFunction(() => !document.getElementById('xmc-lightbox'), null, { timeout: 3000 });
    await page.waitForFunction(() => document.activeElement && document.activeElement.className === 'xmc-cbox', null, { timeout: 8000 });
  });
}, 90000);

browserTest('a Like whose button X no longer has fails soft: the heart goes back, the press says what was not found, after three the one button is switched off, and the settings page shows it', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true, commentsIn: 'card' } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    // X renames its Like button (its test id): the stand-in's posts are changed as they are drawn
    await page.evaluate(() => { setInterval(() => document.querySelectorAll('article [data-testid="like"], article [data-testid="unlike"]').forEach((b) => b.setAttribute('data-testid', 'zz-renamed')), 30); });
    await page.waitForTimeout(300);
    const toastText = () => page.evaluate(() => document.getElementById('xmc-toast').textContent);
    const like = () => page.locator('.xmc-card [data-act="like"]').first();
    const liked = () => like().evaluate((b) => b.classList.contains('on') || b.getAttribute('aria-pressed') === 'true');
    const before = await liked();
    for (let i = 0; i < 3; i++) {
      await like().click();
      await page.waitForFunction(() => /couldn.t find X.s Like button/i.test(document.getElementById('xmc-toast').textContent), null, { timeout: 8000 });
      await page.waitForTimeout(250);
      assert.equal(await liked(), before, 'the heart went back (press ' + (i + 1) + ')');
      await page.evaluate(() => { document.getElementById('xmc-toast').hidden = true; });
    }
    await page.waitForFunction(() => document.getElementById('xmc-root').classList.contains('xmc-off-like'), null, { timeout: 3000 });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.xmc-card [data-act="like"]')).opacity), '0.35', 'the Like button is dimmed');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.xmc-card [data-act="bookmark"]')).opacity), '1', 'the others are not');
    await like().click();
    await page.waitForFunction(() => /switched off for a few minutes/.test(document.getElementById('xmc-toast').textContent), null, { timeout: 4000 });
    assert.match(await toastText(), /zz-renamed|data-testid="like"|not found on X/, 'it says what was looked for: ' + await toastText());
    // and the report is in the diagnostics and, a few seconds on, on the settings page (which reads it from where it was written)
    const diag = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).features.features.like);
    assert.equal(diag.state, 'off'); assert.ok(diag.fail >= 3);
    const opts = await page.context().newPage();
    await page.waitForFunction(() => !!localStorage.getItem('xmc.features'), null, { timeout: 12000 });
    await opts.goto(new URL('/ext/options.html', page.url()).href);
    await opts.waitForSelector('table.status', { timeout: 8000 });
    await opts.waitForFunction(() => { const r = [...document.querySelectorAll('table.status tr')].find((x) => /^Like/.test(x.textContent)); return r && /Switched off/.test(r.textContent); }, null, { timeout: 20000 }); // (written at most every five seconds)
    await opts.close();
  });
}, 90000);

browserTest('a Like that X already shows as liked (the page and the extension had drifted apart) is not a missing button: nothing is counted against Like', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    // X's own copy of every post says "liked" (the unlike button), while the extension thinks none is
    await page.evaluate(() => { setInterval(() => document.querySelectorAll('article [data-testid="like"]').forEach((b) => b.setAttribute('data-testid', 'unlike')), 30); });
    await page.waitForTimeout(300);
    for (let i = 0; i < 4; i++) {
      await page.locator('.xmc-card [data-act="like"]').nth(i).click();
      await page.waitForTimeout(700);
    }
    const f = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).features.features.like);
    assert.equal(f.fail, 0, 'no failure counted: ' + JSON.stringify(f));
    assert.equal(await page.evaluate(() => document.getElementById('xmc-root').classList.contains('xmc-off-like')), false, 'Like is not switched off');
  });
}, 60000);

browserTest('when X sends posts that cannot be read, the columns fail open after ten seconds: X\'s own page, a line saying why, and a Report button', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    // the posts arrive without the part that holds their words and counts (a change in X's shape)
    await page.route('**/i/api/graphql/**', async (route) => {
      const res = await route.fetch();
      let body = await res.text();
      try { const j = JSON.parse(body); const strip = (n) => { if (Array.isArray(n)) n.forEach(strip); else if (n && typeof n === 'object') { if (n.rest_id && n.legacy) delete n.legacy; for (const k of Object.keys(n)) strip(n[k]); } }; strip(j); body = JSON.stringify(j); } catch { /* not JSON */ }
      await route.fulfill({ response: res, body });
    });
    await page.reload();
    await page.waitForFunction(() => /none could be read/.test((document.getElementById('xmc-toast') || {}).textContent || ''), null, { timeout: 30000 });
    assert.match(await page.evaluate(() => document.getElementById('xmc-toast').textContent), /Columns stopped working here, so X.s own page is showing\. X sent \d+ posts and none could be read \(noLegacy/);
    await page.waitForFunction(() => !document.documentElement.classList.contains('xmc-on'), null, { timeout: 3000 }); // (the columns are off: X's page shows)
    assert.match(await page.locator('#xmc-pill').innerText(), /Turn Columns On/);
    assert.match(await page.locator('#xmc-pill').getAttribute('title'), /none could be read/, 'the pill says why too');
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    await page.locator('#xmc-toast .xmc-undo', { hasText: 'Report' }).click();
    await page.waitForFunction(() => window.__opened.length === 1, null, { timeout: 4000 });
    assert.match(await page.evaluate(() => window.__opened[0]), /issues\/new/);
  });
}, 90000);

browserTest('when the script keeps stopping with an error in the steps that draw the columns, they fail open too', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { Object.defineProperty(window.__xmc.view, 'cards', { get() { throw new Error('boom'); }, configurable: true }); });
    await page.waitForFunction(() => /keeps stopping with an error/.test((document.getElementById('xmc-toast') || {}).textContent || ''), null, { timeout: 15000 });
    await page.waitForFunction(() => !document.documentElement.classList.contains('xmc-on'), null, { timeout: 3000 }); // (X's own page is showing)
    h.errors.length = 0; // (the errors are the point)
  });
}, 60000);

browserTest('the logo folds the menu from the keyboard too, and goes back to being a link to Home when the columns are off', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const logo = 'header[role="banner"] h1 a';
    await page.waitForSelector(logo + '[data-xmc-logo]', { timeout: 10000 });
    await page.focus(logo);
    await page.keyboard.press(' ');
    await page.waitForFunction(() => document.documentElement.classList.contains('xmc-rail'), null, { timeout: 5000 });
    assert.equal(await page.evaluate(() => location.pathname), '/home/');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.documentElement.classList.contains('xmc-rail') && !document.documentElement.classList.contains('xmc-panelanim'), null, { timeout: 5000 });
    // columns off: the logo is X's own again (a link home), and presses reach X's page
    await page.locator('#xmc-pill').click();
    await page.waitForFunction((sel) => { const a = document.querySelector(sel); return a && !a.dataset.xmcLogo && !a.hasAttribute('role') && !a.hasAttribute('aria-expanded'); }, logo, { timeout: 5000 });
    assert.equal(await page.evaluate((sel) => document.querySelector(sel).getAttribute('href'), logo), '/home');
  });
}, 90000);

browserTest('in the full-size viewer the wheel steps between the pictures, one step for each flick, and does not scroll the columns', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 9, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelectorAll('[data-lb]').length === 3); c.querySelectorAll('[data-lb]')[0].click(); });
    await page.waitForSelector('#xmc-lightbox');
    const state = () => page.evaluate(() => ({ src: document.querySelector('#xmc-lightbox img').src.split('/').pop().split('?')[0], prevHidden: document.querySelector('#xmc-lightbox .xmc-lb-nav.prev').hidden, nextHidden: document.querySelector('#xmc-lightbox .xmc-lb-nav.next').hidden, top: document.querySelector('.xmc-scroller').scrollTop }));
    const first = await state();
    assert.equal(first.prevHidden, true);
    await page.mouse.move(850, 450);
    const flick = async (dy, test, arg) => { for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, dy); try { await page.waitForFunction(test, arg, { timeout: 900 }); return; } catch { /* not taken yet (a slow machine, a viewer still opening) */ } } throw new Error('the wheel did nothing'); };
    await flick(120, (s) => document.querySelector('#xmc-lightbox img').src.split('/').pop().split('?')[0] !== s, first.src);
    const second = await state();
    assert.equal(second.prevHidden, false, 'one step forward');
    await page.mouse.wheel(0, 120); await page.mouse.wheel(0, 120); // the rest of a burst: no more steps
    await page.waitForTimeout(150);
    assert.equal((await state()).src, second.src, 'a burst is one flick');
    await page.waitForTimeout(450);
    await flick(120, (s) => document.querySelector('#xmc-lightbox img').src.split('/').pop().split('?')[0] !== s, second.src);
    assert.equal((await state()).nextHidden, true, 'the last picture');
    await page.waitForTimeout(450);
    await flick(-120, (s) => document.querySelector('#xmc-lightbox img').src.split('/').pop().split('?')[0] === s, second.src); // and back
    assert.equal((await state()).top, first.top, 'the columns behind did not scroll');
  });
}, 90000);

// Firefox sends a notch of a mouse wheel as lines (deltaMode 1, a deltaY of 3), not as the 100 pixels Chrome does: a step is a step in either.
browserTest('in the full-size viewer a wheel notch counted in lines (as Firefox sends it) steps between the pictures too', async (e) => {
  const h = await e.open('/home/', { width: 1700, height: 900, settings: { v: 10, hintSeen: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { const c = [...document.querySelectorAll('.xmc-card')].find((x) => x.querySelectorAll('[data-lb]').length === 3); c.querySelectorAll('[data-lb]')[0].click(); });
    await page.waitForSelector('#xmc-lightbox');
    const src = () => page.evaluate(() => document.querySelector('#xmc-lightbox img').src.split('/').pop().split('?')[0]);
    const first = await src();
    await page.waitForTimeout(500);
    await page.evaluate(() => document.getElementById('xmc-lightbox').dispatchEvent(new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, bubbles: true, cancelable: true })));
    await page.waitForFunction((s) => document.querySelector('#xmc-lightbox img').src.split('/').pop().split('?')[0] !== s, first, { timeout: 3000 });
    const second = await src();
    await page.waitForTimeout(500);
    await page.evaluate(() => document.getElementById('xmc-lightbox').dispatchEvent(new WheelEvent('wheel', { deltaY: -3, deltaMode: 1, bubbles: true, cancelable: true })));
    await page.waitForFunction((s) => document.querySelector('#xmc-lightbox img').src.split('/').pop().split('?')[0] === s, first, { timeout: 3000 });
    assert.notEqual(second, first);
  });
}, 90000);

browserTest('the right panel slides away behind a tab on its edge, the columns take its room, and the tab brings it back', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForSelector('#xmc-sidetab:not([hidden])', { timeout: 10000 });
    const geo = () => page.evaluate(() => { const r = document.getElementById('xmc-root'), sd = document.querySelector('[data-testid="sidebarColumn"]'), tab = document.getElementById('xmc-sidetab').getBoundingClientRect(); return { right: parseFloat(r.style.right), sideLeft: Math.round(sd.getBoundingClientRect().left), vis: getComputedStyle(sd).visibility, tabRight: Math.round(innerWidth - tab.right), cols: document.querySelectorAll('.xmc-col').length, w: innerWidth }; });
    const shown = await geo();
    assert.ok(shown.sideLeft < shown.w - 100 && shown.vis === 'visible');
    assert.ok(Math.abs(shown.tabRight - (shown.w - shown.sideLeft - 1)) <= 12, 'the tab is on the panel\'s inner edge: ' + shown.tabRight + ' vs ' + (shown.w - shown.sideLeft));
    await page.locator('#xmc-sidetab').click();
    await page.waitForFunction(() => document.documentElement.classList.contains('xmc-sidehide') && !document.documentElement.classList.contains('xmc-panelanim'), null, { timeout: 5000 });
    await page.waitForTimeout(500); await page.waitForFunction(() => !document.querySelector('.xmc-cols.xmc-fade'), null, { timeout: 3000 }); // (the posts are laid out again behind a short fade)
    const away = await geo();
    assert.ok(away.sideLeft >= away.w, 'the panel is off the edge: ' + away.sideLeft);
    assert.equal(away.vis, 'hidden');
    assert.ok(away.right <= 110 && away.right < shown.right - 100, 'the columns reach nearly to the edge: ' + shown.right + ' -> ' + away.right);
    assert.ok(away.tabRight <= 2, 'the tab is on the window\'s edge');
    assert.equal(await page.evaluate(() => document.getElementById('xmc-sidetab').dataset.away), '1');
    assert.ok(away.cols >= shown.cols, 'never fewer columns for more room: ' + shown.cols + ' -> ' + away.cols);
    assert.equal(await page.evaluate(() => document.querySelectorAll('.xmc-cols.xmc-fade').length), 0, 'no fade left on');
    await page.keyboard.press('Alt+BracketRight');
    await page.waitForFunction(() => !document.documentElement.classList.contains('xmc-sidehide') && !document.documentElement.classList.contains('xmc-panelanim'), null, { timeout: 5000 });
    const again = await geo();
    assert.ok(again.sideLeft < again.w - 100 && again.vis === 'visible', 'the panel is back');
    assert.ok(Math.abs(again.right - shown.right) <= 6, 'and the columns are where they were');
  });
}, 90000);

browserTest('what was chosen is there on arrival, with no slide, and the settings page offers both', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850, settings: { v: 9, leftPanel: 'rail', rightPanel: 'hidden' } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForFunction(() => document.documentElement.classList.contains('xmc-rail') && document.documentElement.classList.contains('xmc-sidehide'), null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('xmc-panelanim')), false, 'no slide on arrival');
    assert.ok((await page.evaluate(() => parseFloat(document.getElementById('xmc-root').style.left))) < 150, 'the columns start by the rail');
  });
  const o = await e.open('/ext/options.html');
  await checked(o, async () => {
    await o.page.waitForSelector('#opt-leftPanel');
    assert.equal(await o.page.locator('#opt-leftPanel option').count(), 2);
    assert.equal(await o.page.locator('#opt-rightPanel option').count(), 2);
  });
}, 90000);

browserTest('a video: pressing on its preview turns the sound on, and the speaker button over it turns it on and off', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.evaluate(() => { const v = document.querySelector('.xmc-card video:not([data-gif])'); let paused = true, ct = 7; Object.defineProperty(v, 'paused', { get: () => paused }); Object.defineProperty(v, 'currentTime', { get: () => ct, set: (x) => { ct = x; } }); v.play = () => { paused = false; return Promise.resolve(); }; v.pause = () => { paused = true; v.dispatchEvent(new Event('pause')); }; v.muted = true; });
    const vid = page.locator('.xmc-card video:not([data-gif])').first();
    await vid.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    await vid.hover();
    await page.waitForFunction(() => { const v = document.querySelector('.xmc-card video:not([data-gif])'); return !v.paused && v.muted; }, null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => document.querySelector('.xmc-card video:not([data-gif])').controls), false, 'no native controls while it only previews');
    await vid.click({ position: { x: 20, y: 20 } });
    await page.waitForFunction(() => document.querySelector('.xmc-card video:not([data-gif])').controls === true, null, { timeout: 3000 }); // and they are back after the press
    // the player's own controls may read that press as "pause": it is undone
    await page.evaluate(() => document.querySelector('.xmc-card video:not([data-gif])').pause());
    assert.deepEqual(await page.evaluate(() => { const v = document.querySelector('.xmc-card video:not([data-gif])'); return { playing: !v.paused, muted: v.muted, from: v.currentTime }; }), { playing: true, muted: false, from: 7 }, 'pressing the preview turns the sound on and carries on from where it was (7 s), and keeps it playing');
    // the speaker button: off, then on
    const snd = () => page.evaluate(() => { const v = document.querySelector('.xmc-card video:not([data-gif])'); const b = v.closest('.xmc-media').querySelector('.xmc-snd'); return { muted: v.muted, on: b.classList.contains('on') }; });
    assert.deepEqual(await snd(), { muted: false, on: true });
    await page.evaluate(() => document.querySelector('.xmc-card video:not([data-gif])').closest('.xmc-media').querySelector('.xmc-snd').click());
    assert.deepEqual(await snd(), { muted: true, on: false });
    await page.evaluate(() => document.querySelector('.xmc-card video:not([data-gif])').closest('.xmc-media').querySelector('.xmc-snd').click());
    assert.deepEqual(await snd(), { muted: false, on: true });
  });
});

browserTest('comments in the panel keep coming as you scroll down, added below without moving what you are reading, until X has no more', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850, settings: { v: 9, fetchContext: false } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1200);
    await page.evaluate(() => { const t = window.__xmc.view.cards.find((x) => x.counts.reply > 0 && x.el && x.el.isConnected); t.counts.reply = 500; t.el.querySelector(':scope > .xmc-text').click(); }); // (a post with far more replies than the first page)
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-ritem', { timeout: 25000 });
    const items = () => page.locator('.xmc-view:not(.xmc-out) .xmc-vside .xmc-ritem').count();
    const first = await items();
    assert.equal(await page.locator('.xmc-rmore').count(), 1, 'a "more" line at the end while X has more');
    const mark = await page.evaluate(() => { const s = document.querySelector('.xmc-view:not(.xmc-out) .xmc-vside'); const it = s.querySelectorAll('.xmc-ritem')[1]; return { it: it.textContent.slice(0, 40), y: Math.round(it.getBoundingClientRect().top - s.querySelector('.xmc-text').getBoundingClientRect().top) }; }); // (its place relative to the post's words: unaffected by scrolling)
    // scroll to the end of the list: the next pages arrive
    for (let i = 0; i < 12 && (await page.locator('.xmc-rmore').count()); i++) {
      await page.evaluate(() => { const s = document.querySelector('.xmc-view:not(.xmc-out) .xmc-vside'); s.scrollTop = s.scrollHeight; });
      await page.waitForTimeout(1500);
    }
    await page.waitForFunction(() => !document.querySelector('.xmc-rmore'), null, { timeout: 30000 });
    const after = await page.evaluate((m) => { const s = document.querySelector('.xmc-view:not(.xmc-out) .xmc-vside'); const it = [...s.querySelectorAll('.xmc-ritem')].find((x) => x.textContent.slice(0, 40) === m.it); return Math.round(it.getBoundingClientRect().top - s.querySelector('.xmc-text').getBoundingClientRect().top); }, mark);
    assert.equal(after, mark.y, 'a comment already on screen did not move');
    assert.equal(first, 6, 'the first page');
    assert.equal(await items(), first + 8, 'two more pages of four');
    const text = await page.locator('.xmc-view:not(.xmc-out) .xmc-vside').innerText();
    assert.ok(text.includes('Page 2 reply 1') && text.includes('Page 3 reply 4'), 'the later pages are there');
    assert.equal(text.split('Page 2 reply 1').length, 2, 'and not twice');
    await page.waitForFunction(() => !window.__xmc.state.peek && location.pathname === '/home/', null, { timeout: 20000 });
    await page.waitForFunction(() => !document.documentElement.classList.contains('xmc-onpost'), null, { timeout: 5000 }); // (cleared by the next tick)
  });
}, 120000);

browserTest('on a narrow bar the controls fold into one menu button (Show, Columns, Sensitive media, Settings); on a wide one they stay as they are', async (e) => {
  const narrow = await e.open('/home/', { width: 1000, height: 800 });
  await checked(narrow, async () => {
    const { page } = narrow;
    await e.ready(page);
    const vis = (sel) => page.evaluate((q) => { const el = document.querySelector(q); return !!el && getComputedStyle(el).display !== 'none' && el.getBoundingClientRect().width > 0; }, sel);
    const width = await page.evaluate(() => Math.round(document.querySelector('.xmc-bar1').getBoundingClientRect().width));
    assert.ok(width <= 560, 'the bar is narrow here: ' + width);
    assert.equal(await vis('.xmc-menubtn'), true, 'the menu button shows');
    for (const sel of ['.xmc-colbtn', '.xmc-nsfw', '.xmc-gear']) assert.equal(await vis(sel), false, sel + ' is folded away');
    assert.equal(await vis('.xmc-refresh'), true, 'refresh (with its "N new") stays');
    await page.locator('.xmc-menubtn').click();
    const items = await page.locator('.xmc-menu button').allInnerTexts();
    assert.ok(items.some((x) => /^Columns:/.test(x)) && items.some((x) => /^Sensitive media:/.test(x)) && items.includes('Settings'), items.join(' | '));
    await page.locator('.xmc-menu button', { hasText: 'Columns:' }).click();
    assert.ok((await page.locator('.xmc-menu button').allInnerTexts()).some((x) => /Auto/.test(x)), 'the columns list opens from the menu');
    await page.keyboard.press('Escape');
    await page.locator('.xmc-menubtn').click();
    await page.locator('.xmc-menu button', { hasText: 'Sensitive media:' }).click();
    assert.equal(await page.evaluate(() => window.__xmc.settings.nsfw), 'show', 'cycled from blurred');
  });
  const wide = await e.open('/home/', { width: 1700, height: 800 });
  await checked(wide, async () => {
    await e.ready(wide.page);
    assert.equal(await wide.page.evaluate(() => getComputedStyle(document.querySelector('.xmc-menubtn')).display), 'none');
    assert.equal(await wide.page.evaluate(() => getComputedStyle(document.querySelector('.xmc-gear')).display !== 'none'), true);
  });
});

browserTest('Translate post on a card opens the panel and translates there (X\'s own button, read off its page); Show original brings the words back', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
    const id = await page.evaluate(() => { const t = window.__xmc.view.cards.find((x) => x.lang === 'ja' && x.el && x.el.isConnected && x.el.querySelector('.xmc-translate')); t.el.querySelector('.xmc-translate').click(); return t.id; });
    const side = '.xmc-view:not(.xmc-out) .xmc-vside';
    await page.waitForSelector(side + ' .xmc-xlate:not([hidden])', { timeout: 30000 });
    assert.match(await page.locator(side + ' .xmc-xlate').innerText(), /Translated from Japanese[\s\S]*Translated: Post /);
    const times = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).translateTimes);
    assert.equal(times.length, 1, 'where the time went is in the diagnostics');
    const z = times[0];
    assert.ok(z.ok && z.control <= z.translated && z.translated <= z.total, 'in order: ' + JSON.stringify(z));
    assert.equal(z.via, 'comments', 'done in the visit that loads the comments, not a second one: ' + JSON.stringify(z));
    assert.equal(await page.locator(side + ' > .xmc-text:not(.xmc-xlate)').first().isHidden(), true, 'the original is out of the way');
    assert.equal((await page.locator(side + ' > .xmc-translate').innerText()).trim(), 'Show original');
    await page.locator(side + ' > .xmc-translate').click();
    assert.equal(await page.locator(side + ' > .xmc-text:not(.xmc-xlate)').first().isVisible(), true, 'the original is back');
    await page.locator(side + ' > .xmc-translate').click();
    assert.equal(await page.locator(side + ' .xmc-xlate').isVisible(), true, 'and the translation again, without asking X again');
    assert.equal(await page.evaluate(() => window.__xl), 1, 'X was asked once');
    assert.deepEqual(await page.evaluate(() => window.__opened), [], 'no tab opened');
    await page.waitForFunction(() => !window.__xmc.state.peek && location.pathname === '/home/', null, { timeout: 20000 });
    assert.ok(id);
  });
}, 120000);

browserTest('translation works when X is in another interface language (its button and its "translated from" line are not in English)', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.__xlFrench = true; });
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.lang === 'ja' && x.el && x.el.isConnected && x.el.querySelector('.xmc-translate')).el.querySelector('.xmc-translate').click());
    const side = '.xmc-view:not(.xmc-out) .xmc-vside';
    await page.waitForSelector(side + ' .xmc-xlate:not([hidden])', { timeout: 30000 });
    const text = await page.locator(side + ' .xmc-xlate').innerText();
    assert.match(text, /^Translated\s*\n?Traduit : Post /, text);
    assert.equal((await page.locator(side + ' > .xmc-translate').innerText()).trim(), 'Show original');
  });
}, 120000);

browserTest('Translate waits for X to draw its Translate control (it appears a moment after the post opens)', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.__xlLate = 2500; });
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.lang === 'ja' && x.el && x.el.isConnected && x.el.querySelector('.xmc-translate')).el.querySelector('.xmc-translate').click());
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-xlate:not([hidden])', { timeout: 30000 });
  });
}, 120000);

browserTest('Translate also finds X\'s control when it is worded "Show translation"', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.__xlShow = true; window.__xlNoise = true; }); // (with other plain buttons about, so position alone cannot pick it)
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.lang === 'ja' && x.el && x.el.isConnected && x.el.querySelector('.xmc-translate')).el.querySelector('.xmc-translate').click());
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-xlate:not([hidden])', { timeout: 30000 });
  });
}, 120000);

browserTest('the translated post says "Translated from Spanish" once, not the post\'s words again, when X\'s line has no separators', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.__xlReal = true; });
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.lang === 'ja' && x.el && x.el.isConnected && x.el.querySelector('.xmc-translate')).el.querySelector('.xmc-translate').click());
    await page.waitForSelector('.xmc-view:not(.xmc-out) .xmc-vside .xmc-xlate:not([hidden])', { timeout: 30000 });
    assert.equal((await page.locator('.xmc-view:not(.xmc-out) .xmc-vside .xmc-xlfrom').innerText()).trim(), 'Translated from Spanish');
  });
}, 120000);

browserTest('when X offers no translation, the button says so and then opens the post on X', async (e) => {
  const h = await e.open('/home/', { width: 1500, height: 850 });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForTimeout(1000);
    await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; window.__noTranslate = true; });
    await page.evaluate(() => window.__xmc.view.cards.find((x) => x.lang === 'ja' && x.el && x.el.isConnected && x.el.querySelector('.xmc-translate')).el.querySelector('.xmc-translate').click());
    const btn = '.xmc-view:not(.xmc-out) .xmc-vside > .xmc-translate';
    await page.waitForFunction((b) => document.querySelector(b) && document.querySelector(b).textContent === 'Try translating again', btn, { timeout: 30000 }); // the first failure offers another go
    await page.locator(btn).click();
    await page.waitForFunction((b) => document.querySelector(b) && document.querySelector(b).textContent === 'Translate on X', btn, { timeout: 30000 });
    assert.deepEqual(await page.evaluate(() => window.__opened), [], 'nothing opened by itself');
    await page.locator(btn).click();
    assert.equal((await page.evaluate(() => window.__opened)).length, 1, 'now it opens the post');
  });
}, 120000);

browserTest('Bookmarks, Likes and Lists can be added to X\'s left menu (under History), each a link that loads that page', async (e) => {
  const none = await e.open('/home/');
  await checked(none, async () => {
    await e.ready(none.page);
    await none.page.waitForTimeout(800);
    assert.equal(await none.page.locator('[data-xmc-nav]').count(), 0, 'nothing added by default');
  });
  const h = await e.open('/home/', { settings: { v: 9, navBookmarks: true, navLikes: true, navLists: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForFunction(() => document.querySelectorAll('[data-xmc-nav]').length === 3, null, { timeout: 8000 });
    const got = await page.evaluate(() => [...document.querySelectorAll('[data-xmc-nav]')].map((a) => [a.getAttribute('href'), a.textContent.trim()]));
    assert.deepEqual(got, [['/i/bookmarks', 'Bookmarks'], ['/user1/likes', 'Likes'], ['/user1/lists', 'Lists']]);
    // pointing at one of them draws the same pill as X's own entries (X draws that from script, which a copy does not get)
    await page.locator('[data-xmc-nav="navLikes"]').hover();
    await page.waitForFunction(() => { const d = document.querySelector('[data-xmc-nav="navLikes"] > div') || document.querySelector('[data-xmc-nav="navLikes"]'); return d && getComputedStyle(d).backgroundColor !== 'rgba(0, 0, 0, 0)' && getComputedStyle(d).backgroundColor !== 'transparent'; }, null, { timeout: 3000 });
    const order = await page.evaluate(() => [...document.querySelectorAll('header nav a')].filter((a) => getComputedStyle(a).display !== 'none').map((a) => a.getAttribute('href')));
    assert.ok(order.indexOf('/i/bookmarks') < order.indexOf('/user1/likes') && order.indexOf('/user1/likes') < order.indexOf('/user1/lists'), order.join(' '));
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('header nav a')].filter((a) => !a.dataset.xmcNav && /History/.test(a.textContent) && getComputedStyle(a).display !== 'none').length), 0, 'X\'s History is hidden: Bookmarks and Likes are in its place');
    assert.equal(await page.evaluate(() => { const v = [...document.querySelectorAll('header nav a')].filter((a) => getComputedStyle(a).display !== 'none').map((a) => a.textContent.trim()); return v.indexOf('Explore') + 1 === v.indexOf('Bookmarks') || v.indexOf('Grok') + 1 === v.indexOf('Bookmarks'); }), true, 'in History\'s old place');
    assert.equal(await page.locator('[data-xmc-nav]').count(), 3, 'no duplicates after a few passes');
    await page.evaluate(() => { window.__xmc.settings.navLikes = false; });
    await page.waitForFunction(() => [...document.querySelectorAll('header nav a')].some((a) => !a.dataset.xmcNav && /History/.test(a.textContent) && getComputedStyle(a).display !== 'none'), null, { timeout: 8000 }); // Likes off: History is back
    await page.evaluate(() => { window.__xmc.settings.navLikes = true; });
    await page.waitForFunction(() => document.querySelectorAll('[data-xmc-nav]').length === 3 && ![...document.querySelectorAll('header nav a')].some((a) => !a.dataset.xmcNav && /History/.test(a.textContent) && getComputedStyle(a).display !== 'none'), null, { timeout: 8000 });
    const req = page.waitForRequest((r) => /\/user1\/likes$/.test(r.url()), { timeout: 8000 });
    await page.locator('[data-xmc-nav="navLikes"]').click();
    await req;
  });
});

browserTest('with only Bookmarks added (not Likes), X\'s History stays', async (e) => {
  const h = await e.open('/home/', { settings: { v: 9, navBookmarks: true } });
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    await page.waitForFunction(() => document.querySelectorAll('[data-xmc-nav]').length === 1, null, { timeout: 8000 });
    assert.equal(await page.evaluate(() => [...document.querySelectorAll('header nav a')].filter((a) => !a.dataset.xmcNav && /History/.test(a.textContent) && getComputedStyle(a).display !== 'none').length), 1);
  });
});

browserTest('over a see-through page (a wallpaper or theme) the cards get a stronger tint so they can still be seen', async (e) => {
  const h = await e.open('/home/');
  await checked(h, async () => {
    const { page } = h;
    await e.ready(page);
    const alpha = () => page.evaluate(() => { const c = getComputedStyle(document.querySelector('.xmc-card')).backgroundColor; const m = /\/\s*([\d.]+)\s*\)/.exec(c) || /rgba\([^)]*,\s*([\d.]+)\s*\)/.exec(c); return m ? Number(m[1]) : 1; });
    const solid = await alpha();
    await page.evaluate(() => { document.body.style.background = 'transparent'; document.documentElement.style.background = 'transparent'; });
    await page.waitForFunction(() => document.getElementById('xmc-root').classList.contains('xmc-seethru'), null, { timeout: 5000 });
    await page.waitForTimeout(400); // (the tint fades in over 0.12s)
    assert.ok((await alpha()) > solid + 0.03, 'stronger than on a plain page');
    const info = await page.evaluate(() => JSON.parse(window.__xmc.diagnostics()).theme);
    assert.equal(info.seeThrough, true);
    assert.ok(info.cardBg && info.fg, 'the diagnostics say what the theme is');
  });
});

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
    assert.match(await page.locator('.xmc-menu button').first().innerText(), /\u2713\s+Auto \(\d+ columns?\)/, 'Auto first, and ticked');
    await page.locator('.xmc-menu button', { hasText: /^[\s\u2713\u2002\u2003]*3 columns$/ }).click();
    await page.waitForFunction(() => document.querySelectorAll('.xmc-col').length === 3);
    assert.equal((await page.locator('.xmc-colbtn').innerText()).trim(), '3');
    await page.locator('.xmc-colbtn').click();
    assert.match(await page.locator('.xmc-menu button', { hasText: /^[\s\u2713\u2002\u2003]*3 columns$/ }).innerText(), /\u2713/, 'the current one is ticked');
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
    await page.waitForSelector('.xmc-view .xmc-morefrom .xmc-more-tile');
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
