# Multi-Column for X

Your X (Twitter) timeline in masonry columns — and the useful parts of **Control Panel for Twitter** and
**Media Harvest**, built in, so it's one extension instead of three. Works on Home, Search, Lists, Bookmarks, profiles
and, if you ask for it with the **Try columns** pill, Explore (which is left as X's own page, since it is mostly news and trends). To go back to the normal feed, press the **Columns** pill in X's left sidebar, or disable the extension.

## What you get
- **Columns** — automatic (about 500px wide each, never more than 5 by default; a narrower window drops columns down to one instead of squeezing them) or fixed 1–8.
- **Posts drawn by the extension**, from the data X already downloads. Nothing flickers when you like something, and
  switching views is instant however much is loaded (only what you can reach soon is drawn).
- **Nothing refreshes behind your back.** If X sends new posts while you read, a **↻ N new** button appears; you decide.
- **Endless scrolling that keeps going** — a spinner while X is slow, a note at the real end.
- **A clear top bar** — your tabs and the column controls on one line (it wraps on small windows instead of being cut off), and the
  *All / Tweets / Retweets / Quote Tweets / Media* views on a line below. A view only appears once the feed actually has
  something for it, so you never click an empty tab. A profile's **Media** tab sorts into **Photos / Videos** (GIFs count as videos). A **Columns** pill sits in X's left sidebar (styled like the Post button) and
  switches between columns and X's normal feed.
- **X's dropdown tabs work** — the profile Videos / Photos tab and Following's Popular / Recent show their choices in a menu of our
  own (and Videos / Photos as buttons under the tabs); each choice keeps its own feed.
- **Never lose your place** — posts and profiles open in a **new tab** by default. Prefer one tab? Pick "This tab" in settings and
  Back returns you to the exact spot in the feed.
- **Comments** — the speech-bubble button opens a post's replies inside the card (X's own page is opened out of sight to
  fetch them; your columns don't move). Order them **Relevant / Recent / Most liked**, and **write a comment right under the
  thread**: the extension types it into X's own reply box out of sight and presses Send, exactly as you would. If any step fails,
  X's reply box is left open with your text for you to finish.
- **Video and GIFs play in the card.** Photos open in a viewer (arrows, **Esc** closes it) with **Download** and **Copy link** buttons.
  Posts in other languages get a **Translate post** button that opens the post, where X translates it. **NSFW** button in the top bar:
  blur → show → hide those posts.
- **X's own sidebars are kept** (left nav, right search/trends), or hide the right one in settings. The floating Grok and
  Chat buttons stay, side by side in the corner. Hide any sidebar item (Creator Studio, Chat, Grok…) —
  the settings page lists whatever your sidebar actually shows.
- **Downloads** — original-size photos and the best video quality, saved into an **`X` folder inside Downloads** as
  `account-postnumber-1-twitter.jpg`, so you can always tell where a file came from. A browser extension can't write outside the
  browser's download folder, so for Pictures / Videos / Documents tick **Ask me where to save each file** (Firefox's own dialog,
  which remembers the last place). Settings: the folder, "own folder per account", the file-name pattern
  (`{account} {name} {tweetId} {serial} {hash} {date} {time} {datetime}`), a live example of the result, and a history that marks what you've saved.
- **One scrollbar** — X's own page scrollbar is hidden while columns are showing (the page itself still scrolls behind the scenes,
  which is how the extension makes X load more). The columns take keyboard focus, which helps Vimium-style scrolling.

### On X's own pages
On a post's own page the extension adds **Download** and **Copy link** buttons under the post and its replies, and hides the Bookmark
and Grok buttons under every reply (both switchable in Posts).

### Algorithmic content
One settings section for everything that chooses what you see: hide the **For you** tab, only posts from accounts you follow,
and separate switches for Trending, Who to follow, Topics, Discover more and Premium upsells.

### Control Panel features included
Following by default, hide *For you*, keep me on Following · Reposts / quotes / replies: show, **own tab**, or hide
(separately for Home, profiles, Lists) · only accounts I follow · mute words, accounts, and quotes of a post · hide quotes of
blocked/muted accounts · hide replies from paid-verified accounts · paid checkmark: show / bird / hide · hide view counts,
all counts, bookmark and share buttons · reduced-interaction mode · "Quotes" link · tweet source · Twitter name & logo
(bird, "Tweet", "Retweet", favicon, tab title) · hide Trending / Who to follow / Premium box / Verified tabs · sidebar font
and spacing · system font · custom CSS · Search opens on Latest · turn Home off.

Settings tagged **X page** restyle X's own pages with CSS, so they depend on X's current layout and may need a tweak when X
redesigns. Everything that changes *what's in the feed* does not.

### Not included
Dim theme (X removed it), redirect x.com → twitter.com (twitter.com now redirects back, so it would loop), account-location
info, age-verification bypass, fast-blocking, and anything inside X's Notifications page beyond hiding the link and the Verified tab.

## How it works
`src/hook.js` (runs in the page) watches the timeline responses X already downloads and hands a copy to the extension.
`src/parse.js` turns them into posts, `src/logic.js` decides what each view shows, `src/main.js` draws the columns and
`src/site.js` applies the sidebar/branding tweaks. Like / repost / bookmark / reply press X's own (hidden) buttons, so they
behave exactly as on X. No network requests of its own, no analytics. Permissions: `storage`, `downloads` (download button),
and x.com / twitter.com / X's media servers.

## Develop
```bash
npm test          # parser, filter, file-name and settings tests (node:test, no dependencies)
npm run test:e2e  # the extension in headless Chrome against a stand-in x.com (needs Chrome; `npm install` first)
npm run mock      # serve that stand-in x.com to look at by hand: http://127.0.0.1:8766/home/
npm run lint      # web-ext lint
npm run build     # zip for addons.mozilla.org
```
Try it in Zen/Firefox: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → `manifest.json`.
Permanent: submit the zip to addons.mozilla.org, or `npx web-ext sign --channel=unlisted` for a signed `.xpi` of your own.

## If it shows the normal feed instead of columns
Open the browser console on x.com and look for `[xmc]`. It lists which timeline requests it saw: `Seen: {}` means the page hook
didn't run; `Seen: {HomeTimeline: n}` with no posts means X changed its data format (fix `src/parse.js`; add a fixture to
`test/fixtures.js` first). Press **Turn Columns On** in X's left sidebar to try again. `window.__xmc` shows the live state.

If **Loading more** never finishes, or comments say they couldn't load, press **Copy diagnostics** (it appears on the spinner after
20 seconds, and in the comments panel). It copies a private snapshot — request names and counts, no post text — to paste when asking for help.

## Support
Free and open source (MIT). If it saves you time, you can [buy me a coffee on Ko-fi](https://ko-fi.com/falsehamartia). Bugs and ideas: [GitHub issues](https://github.com/Lynchalot/multi-column-for-x/issues).
