'use strict';
// Turns the plain screenshots into headline slides for the Firefox Add-ons page: a short headline, a few plain lines beside it, and the
// screen below it running off the bottom edge. (The page's own thumbnails are small; a headline says what to look at.)
//   XMC_BROWSER=/path/to/chrome node store/make-slides.js        ->  store/screenshots/slides/01-columns.png ... 10-start.png (1280x800)
// Run `node store/make-screenshots.js` first. To use a shot of your own, save it as store/screenshots/own/<same name>.png (e.g. own/01-columns.png)
// and run this again; the generator never touches that folder. Any shape works, 1920x1200 or 1600x1000 (16:10) looks best.
const path = require('node:path');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');

const DIR = path.join(__dirname, 'screenshots');
const OUT = path.join(DIR, 'slides');
// feed: true marks a shot of the feed itself. The stand-in feed is invented posts on generated art; a real one from X is better there,
// so these are the ones to replace (own/<same name>.png). The wording is plain on purpose: the people reading it want a good extension, not an explanation.
const SLIDES = [
  { file: '01-columns', feed: true, title: 'Your feed in columns', bullets: ['See far more at once, using your whole screen', 'Automatically fits your screen - big or small', 'Hide Trending, Who to follow and Premium boxes'] },
  { file: '08-reels', title: 'Doomscroll with style', bullets: ['One post at a time, full screen', 'Videos play with sound and loop', 'Move to the next post with your mouse wheel or arrow keys'] },
  { file: '02-post-panel', title: 'Open a post without losing your place', bullets: ['Pictures and comments side by side', 'Like, bookmark and reply, even to comments', 'Close it and you\u2019re back exactly where you were'] },
  { file: '11-media-wall', title: 'Every picture, in a gallery', bullets: ['Every photo and video in rows, edge to edge', 'Switch between Columns and Gallery any time', 'Open a post, or start Reels from any picture'] },
  { file: '10-keys', title: 'Browse with your keyboard', bullets: ['Scroll, like and open posts without the mouse', 'Choose a ready-made set of keys, or use none', 'Change any key to whatever you like'] },
  { file: '13-themes', title: 'Fourteen colour themes', bullets: ['Catppuccin, Gruvbox, Ros\u00e9 Pine, Dracula, Tokyo Night, Nord and more', 'Dark or light, whichever suits you', 'Or keep X\u2019s own colours'] },
  { file: '03-photo-viewer', title: 'Photos and video, done properly', bullets: ['Open photos and videos big, with dedicated Download and Copy Link buttons', 'Full-size photos and the best video, one click', 'Hover over a video for a quiet preview'] },
];

// the slide colours: near-black blue running up to a mid navy, white headline, a paler tint for the lines beside it, a light blue for the dots
const PALETTE = { from: '#090f1a', mid: '#12233b', to: '#1d3f68', head: '#ffffff', text: '#d3deec', dot: '#6cb6ff', edge: 'rgba(255,255,255,.14)' };

// the headline on the left, the lines on the right, the screen as large as the width allows, running off the bottom edge
const html = (title, bullets, img) => `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:1280px;height:800px;overflow:hidden;font-family:'Liberation Sans',Arial,sans-serif;color:${PALETTE.head};background:linear-gradient(160deg,${PALETTE.from} 0%,${PALETTE.mid} 58%,${PALETTE.to} 100%);position:relative}
  .head{position:absolute;left:56px;right:56px;top:26px;height:152px;display:flex;align-items:center;gap:40px}
  h1{flex:0 0 470px;text-wrap:balance;font-size:48px;line-height:54px;font-weight:700;letter-spacing:-0.5px}
  ul{flex:1;list-style:none;font-size:24px;line-height:31px;font-weight:700;color:${PALETTE.text}}
  li{position:relative;padding-left:26px;margin:5px 0}
  li:before{content:'';position:absolute;left:0;top:11px;width:10px;height:10px;border-radius:50%;background:${PALETTE.dot}}
  .shot{position:absolute;left:56px;top:196px;width:1168px;border-radius:14px 14px 0 0;box-shadow:0 0 0 1px ${PALETTE.edge},0 18px 60px rgba(0,0,0,.5);display:block}
</style><div class="head"><h1>${title}</h1><ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul></div><img class="shot" src="${img}">`;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.XMC_BROWSER, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  fs.readdirSync(OUT).filter((f) => /\.png$/.test(f)).forEach((f) => fs.unlinkSync(path.join(OUT, f))); // (the set changes; old numbers must not linger)
  let n = 1;
  for (const { file, title, bullets, feed } of SLIDES) {
    const own = path.join(DIR, 'own', file + '.png'); // your own shot of the same name, if there is one, wins over the generated one
    const src = fs.existsSync(own) ? own : path.join(DIR, file + '.png');
    if (src === own) console.log('using your own', file);
    else if (feed) console.log('stand-in feed shot:', file, '(replace with own/' + file + '.png)');
    const img = 'data:image/png;base64,' + fs.readFileSync(src).toString('base64');
    await page.setContent(html(title, bullets, img));
    await page.waitForTimeout(150);
    const out = path.join(OUT, String(n).padStart(2, '0') + '-' + file.replace(/^\d+-/, '') + '.png');
    await page.screenshot({ path: out });
    execFileSync('convert', [out, '-strip', 'PNG24:' + out]); // plain 8-bit sRGB, no alpha, no embedded profile
    console.log(out);
    n++;
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
