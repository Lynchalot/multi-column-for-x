# Add-on listing (addons.mozilla.org): copy and paste from here

**Name:** Multi-Column for X

**Summary (max 250 characters):**
Your X (Twitter) timeline in multiple columns, with in-card video, filters and media download button.

**Description:** (the first 250 characters matter most; Markdown: bold, lists and links work)
Read X in as many columns as your screen can hold. Multi-Column for X turns the single narrow feed into a smooth, scrolling wall of posts you can actually scan, with video that plays in the post, one-click media downloads, filters, and a panel that opens any post with its picture large and its comments beside it.

**Why you might want it**
- **Use the whole screen.** Columns fit your window and keep a comfortable width. Shrink the window and columns drop away, down to one.
- **Nothing jumps around.** New posts wait behind a "N new" button instead of shoving your feed down. A post opens in a panel over the columns (Esc closes it and you are exactly where you were), so you never lose your place.
- **Smooth.** Posts load ahead of you as you scroll, and photos are ready by the time you get there.

**What's in it**
- Video and GIFs play in the post (a video you started pauses when you scroll it away). Pointing at a video plays it muted; pressing it plays it from the start with sound; a speaker button turns sound on or off. Photos open in a viewer with Download and Copy link.
- **Download** original-size photos and the best-quality video in one click, with your own folder and file-name pattern.
- **Post panel:** the picture large on one side, the words, actions and comments on the other (like an image viewer); several pictures show one at a time with arrows and dots (the wheel and the sides of a picture flick between them), a quoted post opens in the panel too, comments load as you scroll, can be sorted by relevance, newest or most liked, and you can like, bookmark and reply to them, open a comment in the same panel, and translate posts and comments with X's own translation.
- **Filters:** Following by default, hide "For you", only accounts you follow, mute words and accounts, show or hide reposts, quotes and replies, NSFW blur or hide.
- Profile **Videos / Photos** and Following's **Popular / Recent** work from the top bar.
- **Reading options (all off by default):** a separate column count for each page, hide or fade posts you've already read, one card when several people repost the same post.
- **More room:** a menu button folds X's left menu to icons, and a tab on the edge slides the right panel away; the columns widen into the space (Alt+[ and Alt+]).
- **Tidy-ups:** hide Trending, Who to follow, Topics and Premium boxes, adjust the sidebar, add Bookmarks, Likes and Lists to X's left menu, use the bird logo and "Tweet" wording, custom CSS.
- **Sensitive media:** blur, show or hide it, on the columns and on X's own pages. An option (on by default) turns off X's own age-verification flag in your browser, so X shows its older "sensitive content" notice instead of asking for verification; switch it off in the settings if you would rather keep X's check.

**Private by design**
No data collected. No analytics, no accounts, no remote code. Everything stays in your browser. Open source (MIT): https://github.com/Lynchalot/multi-column-for-x

**Good to know**
It works with what X's own page already loads, so if X redesigns something, a small piece may need an update: report it on GitHub and it gets fixed. Press the Columns button in X's left menu to switch back to X's normal feed at any time.

Not affiliated with, endorsed by, or sponsored by X Corp.

**Release notes (current version):**
Columns on Home, Search, Lists, Bookmarks and profiles; a post panel with its picture, comments (loading as you scroll), like, bookmark, reply and translate; video in the post; one-click media downloads; filters; sensitive-media handling; Bookmarks, Likes and Lists in the left menu; a menu for narrow windows; a settings page.

**Screenshot captions** (upload in this order; `node store/make-screenshots.js` makes them: 1280x800, invented accounts and posts, nothing from X):
1. `01-columns.png` Your feed in columns, using the whole screen.
2. `02-post-panel.png` A post open in the panel: its picture large, comments beside it, reply and like right there.
3. `03-photo-viewer.png` Photos open in a viewer with one-click Download and Copy link.
4. `04-filters.png` Filter by posts, reposts, quotes or media.
5. `05-more-room.png` Fold the menu to icons and slide the side panel away: five columns.
6. `06-settings.png` Every setting on one page: filters, sidebar, downloads and more.

**Support link ("Support" / contributions field):** https://ko-fi.com/falsehamartia
**Homepage:** https://github.com/Lynchalot/multi-column-for-x
**Support site:** https://github.com/Lynchalot/multi-column-for-x/issues

**Categories:** Social & Communication; Appearance
**Tags:** twitter, x, columns, multi-column, timeline, media download, video, filters, layout
**License:** MIT
**Privacy policy:** paste the text of PRIVACY.md into the privacy-policy field (or link to it once the repository is public)
**Compatibility:** tick Firefox for desktop; untick Firefox for Android (the layout is built for wide screens)

**Notes to reviewer** (paste this):
There is no build step, no minification and no obfuscation: the uploaded files are the source (also at the repository above). No remote code, no network requests of its own, no analytics.

What it does, and why each piece exists:
- `src/hook.js` (content script, world MAIN, document_start): wraps `fetch`/`XMLHttpRequest` on x.com only to receive a copy of the timeline JSON that x.com's own code already downloads (posted to the extension with `window.postMessage`). It never changes a request or a response. It also stops videos in x.com's own hidden timeline from playing while the extension's columns are covering it (`HTMLMediaElement.prototype.play` is wrapped for videos inside x.com's primary column only), forwards Escape/arrow keys to the extension's image viewer, and, from document_start, hides x.com's own timeline, menu and sidebar (a CSS class) on a page where the columns were showing last time, until the extension has started (six seconds at most).
- **One thing in `src/hook.js` does change x.com's behaviour, and only in the user's own browser:** the option "Skip X's age check on sensitive media" (on by default, can be turned off in the settings) sets x.com's own client-side feature flag `rweb_age_assurance_flow_enabled` to false: in x.com's initial state object before its app reads it, and by wrapping the `featureSwitches.isTrue` lookup in x.com's React props. No request is changed or made; x.com then shows its older "sensitive content" notice instead of the age-verification flow. (This is the same flag that the published add-on "Control Panel for Twitter" turns off.) The extension keeps this choice, and the address of the page the columns last showed on, as two small values in x.com's page `localStorage` so this script can read them at once at document_start; they hold no account or post information.
- `src/main.js` and `src/parse.js`: turn that JSON into cards drawn by the extension. Like, repost, bookmark and reply are performed by dispatching clicks on x.com's own (hidden) buttons; the extension does not call x.com's API itself.
- To keep loading more posts the extension scrolls x.com's own (hidden) copy of the page, which makes x.com request the next page itself; and it keeps x.com's sidebars in place with CSS and inline styles. Folding them is more of the same: CSS classes on the page's root element, and one button that is a copy of one of x.com's own menu links.
- To show a post's comments the extension clicks x.com's own link to that post (on x.com's hidden copy of the timeline), so that x.com fetches the conversation; it reads it from the same JSON and goes back.
- While that happens a static copy of x.com's right sidebar and left menu is shown (cloned DOM, inert) so they don't flicker. More comments (as you scroll the panel) are fetched the same way: x.com's hidden page is taken to the post and scrolled, and x.com loads its next page itself. If x.com ignores the link press, the extension asks x.com's own router to go to the post (`history.pushState` plus a `popstate` event on x.com's page); nothing is requested from x.com differently.
- Translation: the extension presses x.com's own "Translate post" button on the post's page and shows the translated words it finds there; it does not use any other service.
- Pressing a button in a copy of a profile's header presses x.com's own button; for the "Joined" line, x.com's popup (which x.com draws in its own layer) has its position moved with inline styles so it sits under the button. A post's translation, or its comments, are asked for by taking x.com's hidden page to the post and pressing x.com's own controls, as above; if the post is not in x.com's list the same router request is used. While a video previews, its native controls are switched off (the `controls` property) and switched on again after.
- The options "Add Bookmarks / Likes / Lists to X's left menu" insert links (cloned from one of x.com's own menu links) to x.com's own pages; pressing one loads that page.
- `background.js`: saves media with the `downloads` API (only URLs on https://pbs.twimg.com and https://video.twimg.com are accepted).

Permissions: `storage` (settings, download history and a short event log for Copy diagnostics that can be switched off; local only), `downloads` (the Download button), host access to x.com / twitter.com (the site it enhances) and pbs.twimg.com / video.twimg.com (the media files).

Everything user-visible in the options page is generated from `src/settings.js`.

**Screenshots:** `store/screenshots/` (made by `node store/make-screenshots.js`, which needs ImageMagick and the dev dependencies). They use the test stand-in for x.com with invented people and generated pictures, so no real post, name or logo is shown. To add one of your own feed, take it with the window about 1600x1000, public posts only, blur your own name, and size it with `store/frame-screenshots.sh`.

**Icon:** store/icon-128.png (the extension itself ships icons/icon.svg).
