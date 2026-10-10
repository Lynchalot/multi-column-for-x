'use strict';
// Turns the plain screenshots into headline slides for the Firefox Add-ons page: a short headline, a few plain outcomes, and the
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
// so these are the ones to replace (own/<same name>.png).
const SLIDES = [
  { file: '01-columns', feed: true, title: 'Your feed, in columns', bullets: ['Two to eight columns, fitted to your window', 'New posts wait behind a button, so nothing jumps while you read'] },
  { file: '08-reels', title: 'Scroll like TikTok', bullets: ['One post at a time, scrolled up and down', 'Videos play with sound and loop', 'Shift + wheel or the arrow keys move to the next post'] },
  { file: '02-post-panel', title: 'Open a post without losing your place', bullets: ['The picture large, the comments beside it', 'Like, bookmark and reply to posts and to comments', 'Esc closes it and you are exactly where you were'] },
  { file: '09-reply-tools', title: 'Reply with pictures and emoji', bullets: ['Pictures, GIFs and emoji from the comment box', 'Reply to the post or to any comment, in the panel'] },
  { file: '10-keys', title: 'Browse with your keyboard', bullets: ['Arrow keys step through pictures, then posts', 'A to like, S to bookmark, E to download, C to comment', 'The keyboard button lists every key, and you can change them'] },
  { file: '03-photo-viewer', title: 'Photos and video, done properly', bullets: ['Open photos in a viewer, with Download and Copy link', 'Original-size photos and the best video quality, one click', 'Point at a video for a muted preview'] },
  { file: '11-media-wall', feed: true, title: 'A wall of pictures and video', bullets: ['Media only, in as many columns as fit', 'Menu folded to icons, side panel slid away', 'Videos play muted as you scroll'] },
  { file: '04-filters', feed: true, title: 'Show only what you came for', bullets: ['Following by default, “For you” hidden', 'Posts, reposts, quotes or media only', 'Mute words and accounts, read posts fade away'] },
  { file: '05-more-room', feed: true, title: 'More room when you want it', bullets: ['Fold the menu to icons, slide the side panel away', 'The columns grow into the space', 'Alt+[ and Alt+] from the keyboard'] },
  { file: '12-start', title: 'Start the way you like', bullets: ['Pick a starting point: Just columns, Calm, Media wall or Reels', 'Change anything later; most changes apply as you make them', 'Nothing leaves your browser'] },
];

// the slide colours: a deep blue running up to X's blue, white headline, a paler blue for the lines under it
const PALETTE = { from: '#0a2540', mid: '#0e4276', to: '#1478c4', head: '#ffffff', text: '#cfe6fa', edge: 'rgba(255,255,255,.14)' };

const html = (title, bullets, img) => `<!doctype html><meta charset="utf-8"><style>
  *{box-sizing:border-box;margin:0}
  body{width:1280px;height:800px;overflow:hidden;font-family:'Liberation Sans',Arial,sans-serif;color:${PALETTE.head};background:linear-gradient(160deg,${PALETTE.from} 0%,${PALETTE.mid} 58%,${PALETTE.to} 100%);position:relative}
  h1{position:absolute;left:56px;top:34px;font-size:56px;line-height:64px;font-weight:700;letter-spacing:-0.5px}
  ul{position:absolute;left:56px;top:108px;list-style:none;font-size:25px;line-height:34px;font-weight:700;color:${PALETTE.text}}
  li:before{content:'–';display:inline-block;width:30px}
  .shot{position:absolute;left:50%;top:${bullets.length > 2 ? 232 : 198}px;width:1060px;transform:translateX(-50%);border-radius:14px 14px 0 0;box-shadow:0 0 0 1px ${PALETTE.edge},0 18px 60px rgba(0,0,0,.5);display:block}
</style><h1>${title}</h1><ul>${bullets.map((b) => `<li>${b}</li>`).join('')}</ul><img class="shot" src="${img}">`;

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
