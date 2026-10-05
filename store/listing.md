# Add-on listing (addons.mozilla.org): copy and paste from here

**Name:** Multi-Column for X

**Summary (max 250 characters):**
Your X (Twitter) timeline in multiple columns, with in-card video, filters and media download button.

**Description:** (the first 250 characters matter most; Markdown: bold, lists and links work)
Read X in as many columns as your screen can hold. Multi-Column for X turns the single narrow feed into a smooth, scrolling wall of posts you can actually scan, with video that plays in the post, one-click media downloads, filters, and comments that open right inside the post.

**Why you might want it**
- **Use the whole screen.** Columns fit your window and keep a comfortable width. Shrink the window and columns drop away, down to one.
- **Nothing jumps around.** New posts wait behind a "N new" button instead of shoving your feed down. Posts and profiles open in a new tab, so you never lose your place.
- **Smooth.** Posts load ahead of you as you scroll, and photos are ready by the time you get there.

**What's in it**
- Video and GIFs play in the post (a video you started pauses when you scroll it away). Photos open in a viewer with Download and Copy link.
- **Download** original-size photos and the best-quality video in one click, with your own folder and file-name pattern.
- **Comments** open inside the post, sorted by relevance, newest or most liked, and you can reply from there.
- **Filters:** Following by default, hide "For you", only accounts you follow, mute words and accounts, show or hide reposts, quotes and replies, NSFW blur or hide.
- Profile **Videos / Photos** and Following's **Popular / Recent** work from the top bar.
- **Reading options (all off by default):** a separate column count for each page, hide or fade posts you've already read, one card when several people repost the same post.
- **Tidy-ups:** hide Trending, Who to follow, Topics and Premium boxes, adjust the sidebar, use the bird logo and "Tweet" wording, custom CSS.

**Private by design**
No data collected. No analytics, no accounts, no remote code. Everything stays in your browser. Open source (MIT): https://github.com/Lynchalot/multi-column-for-x

**Good to know**
It works with what X's own page already loads, so if X redesigns something, a small piece may need an update: report it on GitHub and it gets fixed. Press the Columns button in X's left menu to switch back to X's normal feed at any time.

Not affiliated with, endorsed by, or sponsored by X Corp.

**Release notes (version 0.9.2):**
First release. Columns on Home, Search, Lists, Bookmarks and profiles; video in the post; comments inside the post; one-click media downloads; filters; a settings page.

**Screenshot captions** (upload 4 or 5, 1280x800, in this order; `store/frame-screenshots.sh` sizes them):
1. Your feed in five columns, using the whole screen.
2. Comments open inside the post: sort by relevance, newest or most liked, and reply right there.
3. Photos open in a viewer with one-click Download and Copy link.
4. Filter by posts, reposts, quotes or media; switch a profile between Videos and Photos.
5. Every setting on one page: filters, sidebar, downloads and more.

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
- `src/hook.js` (content script, world MAIN, document_start): wraps `fetch`/`XMLHttpRequest` on x.com only to receive a copy of the timeline JSON that x.com's own code already downloads (posted to the extension with `window.postMessage`). It never changes a request or a response. It also stops videos in x.com's own hidden timeline from playing while the extension's columns are covering it (`HTMLMediaElement.prototype.play` is wrapped for videos inside x.com's primary column only), and forwards Escape/arrow keys to the extension's image viewer.
- `src/main.js` and `src/parse.js`: turn that JSON into cards drawn by the extension. Like, repost, bookmark and reply are performed by dispatching clicks on x.com's own (hidden) buttons; the extension does not call x.com's API itself.
- To keep loading more posts the extension scrolls x.com's own (hidden) copy of the page, which makes x.com request the next page itself; and it keeps x.com's sidebars in place with CSS and inline styles.
- To show a post's comments the extension clicks x.com's own link to that post (on x.com's hidden copy of the timeline), so that x.com fetches the conversation; it reads it from the same JSON and goes back.
- While that happens a static copy of x.com's right sidebar is shown (cloned DOM, inert) so the sidebar doesn't flicker.
- `background.js`: saves media with the `downloads` API (only URLs on https://pbs.twimg.com and https://video.twimg.com are accepted).

Permissions: `storage` (settings and download history, local only), `downloads` (the Download button), host access to x.com / twitter.com (the site it enhances) and pbs.twimg.com / video.twimg.com (the media files).

Everything user-visible in the options page is generated from `src/settings.js`.

**Screenshots to take (1280x800 or larger, PNG):**
1. Home in 4-5 columns (hero shot).
2. A card's comments open, sorted Most liked.
3. The image viewer with Download / Copy link.
4. The settings page (Algorithmic content + Downloads).
5. A narrow window: top bar wrapping, 1-2 columns.
Use public posts only; blur or crop anything personal (your own account name, DMs, notifications).

**Icon:** store/icon-128.png (the extension itself ships icons/icon.svg).
