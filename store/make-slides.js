'use strict';
// Turns the six plain screenshots into headline slides for the Firefox Add-ons page: a short headline, a few plain outcomes, and the
// screen below it running off the bottom edge. (The page's own thumbnails are small; a headline says what to look at.)
//   XMC_BROWSER=/path/to/chrome node store/make-slides.js        ->  store/screenshots/slides/01.png ... 06.png (1280x800)
// Run `node store/make-screenshots.js` first. To use a shot of your own, save it as store/screenshots/own/<same name>.png (e.g. own/01-columns.png)
// and run this again; the generator never touches that folder. Any shape works, 1920x1200 or 1600x1000 (16:10) looks best.
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright-core');

const DIR = path.join(__dirname, 'screenshots');
const OUT = path.join(DIR, 'slides');
const SLIDES = [
  ['01-columns', 'Your feed, in columns', ['Use the whole screen: two to eight columns, automatic or your choice', 'New posts wait behind a button, so nothing jumps while you read']],
  ['02-post-panel', 'Open a post without losing your place', ['The picture large, the comments beside it', 'Like, bookmark and reply to posts and to comments', 'Esc closes it and you are exactly where you were']],
  ['03-photo-viewer', 'Photos and video, done properly', ['Open photos in a viewer, with Download and Copy link', 'Original-size photos and the best video quality, one click', 'Point at a video for a muted preview']],
  ['04-filters', 'Show only what you came for', ['Following by default, “For you” hidden', 'Posts, reposts, quotes or media only', 'Mute words and accounts, read posts fade away']],
  ['05-more-room', 'More room when you want it', ['Fold the menu to icons, slide the side panel away', 'The columns grow into the space', 'Alt+[ and Alt+] from the keyboard']],
  ['07-settings-panel', 'Settings without leaving the page', ['Open them from the gear in the bar or the toolbar button', 'Each section folds out of a list, and search finds any setting', 'Changes apply as you make them']],
  ['06-settings', 'You decide, and it applies as you go', ['Presets: Just columns, Calm, Media wall', 'Hide Trending, Who to follow, Premium boxes', 'Most changes apply straight away, nothing leaves your browser']],
];

const html = (title, bullets, img) => `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:1280px;height:800px;overflow:hidden;font-family:'Liberation Sans',Arial,sans-serif;color:#fff;background:linear-gradient(160deg,#1d9bf0 0%,#1478c4 55%,#0f4f8a 100%);position:relative}
  h1{position:absolute;left:56px;top:34px;font-size:56px;line-height:64px;font-weight:700;letter-spacing:-0.5px}
  ul{position:absolute;left:56px;top:108px;list-style:none;font-size:25px;line-height:34px;font-weight:700;opacity:.96}
  li:before{content:'–';display:inline-block;width:30px}
  .shot{position:absolute;left:50%;top:${bullets.length > 2 ? 232 : 198}px;width:1060px;transform:translateX(-50%);border-radius:14px 14px 0 0;box-shadow:0 18px 60px rgba(0,0,0,.45);display:block}
</style><h1>${title}</h1><ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul><img class="shot" src="${img}">`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.XMC_BROWSER, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  let n = 1;
  for (const [file, title, bullets] of SLIDES) {
    const own = path.join(DIR, 'own', file + '.png'); // your own shot of the same name, if there is one, wins over the generated one
    const src = fs.existsSync(own) ? own : path.join(DIR, file + '.png');
    if (src === own) console.log('using your own', file);
    const img = 'data:image/png;base64,' + fs.readFileSync(src).toString('base64');
    await page.setContent(html(title, bullets, img));
    await page.waitForTimeout(150);
    const out = path.join(OUT, String(n).padStart(2, '0') + '-' + file.replace(/^\d+-/, '') + '.png');
    await page.screenshot({ path: out });
    console.log(out);
    n++;
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
