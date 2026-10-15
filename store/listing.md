# Add-on listing (addons.mozilla.org): copy and paste from here

**Name:** Multi-Column for X (Twitter)
(The owner's choice: many people still search for "Twitter". The listing is at https://addons.mozilla.org/en-US/firefox/addon/multi-column-for-x/ and the owner looks after it. `manifest.json` still says "Multi-Column for X".)


**Summary (max 250 characters):**
Your X (Twitter) feed in columns that fill the whole screen. Open posts beside their comments, scroll Reels-style, save photos and videos in one click, and keep the algorithm out of the way.

**Description:** (the first 250 characters matter most; Markdown: bold, lists and links work)
Your X feed, spread across your whole screen. Multi-Column for X turns X (Twitter) into a wall of columns you can actually scan, opens posts beside their comments so you never lose your place, and keeps the algorithm out of the way.

**Features:**

- **Columns that fit your screen.** See far more at once, from one column to eight. New posts wait behind a button instead of shoving your feed down while you read.
- **Open a post without losing your place.** The picture sits big next to the comments. Like, bookmark, reply and translate right there, then close it and you're back where you were.
- **Reels, if you want them.** One post at a time, full screen, like TikTok. Videos play with sound and loop, and posts you've already seen are skipped.
- **Photo galleries.** A profile's Media tab as a wall of pictures, edge to edge.
- **Save in one click.** Full-size photos and the best-quality video, into the folder you choose.
- **Browse with your keyboard.** Scroll, like, bookmark and open posts without the mouse. Pick a ready-made set of keys, or change any of them.
- **Fourteen colour themes.** Catppuccin, Gruvbox, Rosé Pine, Dracula, Tokyo Night, Nord and more, dark or light. Or keep X's own colours.
- **Your feed, your rules.** Start on Following with "For you" tucked away. Mute words and accounts, hide reposts or replies, blur sensitive pictures, and hide Trending, Who to follow and Premium.
- **And more.** Search your Likes (X has no search there), followers and following as a grid, a bigger text size if you want one.

**Ready in a minute**

A welcome page asks how you'd like to start (just columns, calm, a media wall or Reels), which keys and which colours. Change anything later from the gear in the top bar.

**Good to know**

- Firefox asks once whether it may run on x.com. Say yes and you're set.
- One press of the Columns button in X's left menu takes you back to normal X.
- It needs a window wide enough for two columns, and it doesn't run on phones.
- If X changes its site, something may stop working until an update. Tell us on GitHub and it gets fixed.
- For adults only: an optional setting, off by default, skips X's age-check prompt.

**Private by design**

No data collected. No tracking, no accounts, no remote code. Everything stays in your browser. Open source (MIT): https://github.com/Lynchalot/multi-column-for-x

X and Twitter are trademarks of X Corp. This add-on is not affiliated with, endorsed by, or sponsored by X Corp.

**Release notes (current version):**
Your X feed in columns, posts that open beside their comments, Reels, a gallery for photos, one-click downloads, keyboard keys, fourteen colour themes and a welcome page to set it all up.

**Screenshots** (upload the headline slides in `store/screenshots/slides/`, in this order; `node store/make-screenshots.js` then `node store/make-slides.js` makes them: 1280x800. All seven are real shots of X (public posts; the owner's own profile at the foot of X's menu is blurred out: `store/own-shots.json` names the sources, the blurred places and the cut, `node store/prepare-own.js <folder>` makes `store/screenshots/own/*.png`, and `make-slides.js` uses those in place of the generated shot of the same name; a slide with no entry there falls back to a generated shot with invented accounts and posts). The plain shots are in `store/screenshots/` if you want any without a headline; the wording is in `SLIDES` in `store/make-slides.js`. The Chrome Web Store takes five: use 1, 2, 3, 4 and 7):
1. `01-columns.png` Your feed in columns.
2. `02-reels.png` Doomscroll with style: one post at a time, with the rail of buttons on the picture.
3. `03-post-panel.png` Open a post without losing your place.
4. `04-media-wall.png` Every picture, in a gallery.
5. `05-keys.png` Browse with your keyboard.
6. `06-themes.png` Fourteen colour themes (three of them side by side: cats, paintings and a light one).
7. `07-photo-viewer.png` Photos and video, done properly: the viewer with Download and Copy link.
(Not in the slides, still in `store/screenshots/`: the filters, the room, the starting points (the welcome page), the settings page and the settings in a panel.)

**Support link ("Support" / contributions field):** https://ko-fi.com/falsehamartia
**Homepage:** https://github.com/Lynchalot/multi-column-for-x
**Support site:** https://github.com/Lynchalot/multi-column-for-x/issues

**Categories:** Social & Communication; Appearance
**Tags:** twitter, x, columns, multi-column, tweetdeck, timeline, social media, layout, feed, chronological, media download, video, filters
(Naming TweetDeck is descriptive use of someone else's mark, as "for Twitter" is. Strike it if you would rather not.)
**License:** MIT
**Privacy policy:** paste the text of PRIVACY.md into the privacy-policy field (or link to it once the repository is public)
**Compatibility:** tick Firefox for desktop; untick Firefox for Android (the layout is built for wide screens)

**Notes to reviewer** (paste this):
There is no build step, no minification and no obfuscation: the uploaded files are the source (also at the repository above). No remote code, no network requests of its own, no analytics.

What it does, and why each piece exists:
- `src/hook.js` (content script, world MAIN, document_start): wraps `fetch`/`XMLHttpRequest` on x.com only to receive a copy of the timeline JSON that x.com's own code already downloads (posted to the extension with `window.postMessage`). It never changes a request or a response. It also stops videos in x.com's own hidden timeline from playing while the extension's columns are covering it (`HTMLMediaElement.prototype.play` is wrapped for videos inside x.com's primary column only), forwards Escape/arrow keys to the extension's image viewer, and, from document_start, hides x.com's own timeline, menu and sidebar (a CSS class) on a page where the columns were showing last time, until the extension has started (six seconds at most).
- **One thing in `src/hook.js` does change x.com's behaviour, and only in the user's own browser:** the option "Skip X's age check on sensitive media" (off by default and marked "18+ only"; the welcome page that opens on install offers it as an unticked box with a line saying who should leave it off, and it is in the settings under Posts) sets x.com's own client-side feature flag `rweb_age_assurance_flow_enabled` to false: in x.com's initial state object before its app reads it, and by wrapping the `featureSwitches.isTrue` lookup in x.com's React props. No request is changed or made; x.com then shows its older "sensitive content" notice instead of the age-verification flow. (This is the same flag that the published add-on "Control Panel for Twitter" turns off.) The extension keeps this choice, and the address of the page the columns last showed on, as two small values in x.com's page `localStorage` so this script can read them at once at document_start; they hold no account or post information.
- `src/main.js` and `src/parse.js`: turn that JSON into cards drawn by the extension. Like, repost, bookmark and reply are performed by dispatching clicks on x.com's own (hidden) buttons; the extension does not call x.com's API itself.
- To keep loading more posts the extension scrolls x.com's own (hidden) copy of the page, which makes x.com request the next page itself; and it keeps x.com's sidebars in place with CSS and inline styles. Folding them is more of the same: CSS classes on the page's root element, and one button that is a copy of one of x.com's own menu links.
- To show a post's comments the extension clicks x.com's own link to that post (on x.com's hidden copy of the timeline), so that x.com fetches the conversation; it reads it from the same JSON and goes back.
- While that happens a static copy of x.com's right sidebar and left menu is shown (cloned DOM, inert) so they don't flicker. More comments (as you scroll the panel) are fetched the same way: x.com's hidden page is taken to the post and scrolled, and x.com loads its next page itself. If x.com ignores the link press, the extension asks x.com's own router to go to the post (`history.pushState` plus a `popstate` event on x.com's page); nothing is requested from x.com differently.
- Translation: the extension presses x.com's own "Translate post" button on the post's page and shows the translated words it finds there; it does not use any other service.
- Pressing a button in a copy of a profile's header presses x.com's own button; for the "Joined" line, x.com's popup (which x.com draws in its own layer) has its position moved with inline styles so it sits under the button. A post's translation, or its comments, are asked for by taking x.com's hidden page to the post and pressing x.com's own controls, as above; if the post is not in x.com's list the same router request is used. While a video previews, its native controls are switched off (the `controls` property) and switched on again after.
- The options "Add Bookmarks / Likes / Lists to X's left menu" insert links (cloned from one of x.com's own menu links) to x.com's own pages; pressing one loads that page.
- Pressing a button on a profile's header card presses x.com's own button in its real header (found by its place, then by its test id or label). "Unfollow" presses x.com's own Following button once and, if x.com asks, its own confirmation; x.com's menus and dialogs that open from such a press are shown by raising x.com's own `#layers` element above the columns (a CSS class), and are not copied or changed.
- Colour themes on x.com's own pages: `src/site.js` reads x.com's own inline stylesheet (`CSSStyleSheet.cssRules` of the page's own `<style>` elements, nothing is fetched) and adds one `<style>` element of its own that repeats the rules which have x.com's colours with the chosen theme's colours. `src/hook.js` adds a `<style>` with the page's background colour from a note kept in x.com's `localStorage` (`xmcThemeBg`), so the page does not flash. The option "Use the theme on X's own pages" turns it off.
- `background.js`: saves media with the `downloads` API (only URLs on https://pbs.twimg.com and https://video.twimg.com are accepted).

Permissions: `storage` (settings, download history and a short event log for Copy diagnostics that can be switched off; local only), `downloads` (the Download button), host access to x.com / twitter.com (the site it enhances) and pbs.twimg.com / video.twimg.com (the media files).

Everything user-visible in the options page is generated from `src/settings.js`.

`popup.html` is the toolbar button's panel (the same generator as the options page, in a narrow layout). It and the files it loads are listed in `web_accessible_resources` for x.com and twitter.com only, because the gear in the columns' bar shows it in a frame over the page; it grants x.com's own scripts nothing but the ability to load those pages (they hold no secrets: the settings live in `storage.local`, which only the extension can read). If the frame does not load, the options page opens in a tab instead. The framed page tells its parent two things ("settings-ready", "settings-close") with `postMessage` to `*`: the messages hold no data, and the receiving side accepts them only from that frame's own window. Every `message` listener in the extension checks `event.source`. The tip shown on first run has one link, to the Ko-fi page, opened in a new tab only when pressed.

**Screenshots:** `store/screenshots/slides/` (made by `node store/make-screenshots.js` then `node store/make-slides.js`; the first needs ImageMagick and the dev dependencies). The seven headline slides are screenshots of public posts on x.com with the extension running (the owner's own profile blurred out); the plain shots in `store/screenshots/` come from the test stand-in for x.com, with invented people and generated pictures.

**Icon:** store/icon-128.png (the extension itself ships icons/icon.svg).
