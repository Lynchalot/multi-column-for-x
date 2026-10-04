# Add-on listing (addons.mozilla.org): copy and paste from here

**Name:** Multi-Column for X

**Summary (max 250 characters):**
Your X (Twitter) timeline in multiple columns, with in-card video, filters and media download button.

**Description:**
Multi-Column for X turns the single narrow X feed into as many columns as your screen can hold.

Layout
- Automatic columns that keep a comfortable width: a narrower window shows fewer columns, down to one.
- Smooth, stable scrolling that keeps loading ahead of you. Nothing refreshes behind your back: new posts wait behind a "N new" button.
- Video and GIFs play in the card (a video you started pauses when you scroll it away); photos open in a viewer with Download and Copy link.
- Posts and profiles open in a new tab by default, so you never lose your place.
- Comments open inside the card, sortable by relevance, recency or likes, and you can reply from there.
- Profile Videos / Photos tabs and Following's Popular / Recent sort work from the top bar.

Timeline controls
- Following by default, hide "For you", only accounts you follow.
- Reposts, quotes and replies: show, own view, or hide.
- Mute words, accounts and quoted posts; hide replies from paid accounts; NSFW blur/hide.
- Hide Trending, Who to follow, Topics, Premium and more; sidebar tidy-up; Twitter name and logo; system font; custom CSS.

Media downloads
- Original-size photos and best-quality video in one click, also from a post's own page.
- Choose the folder, file-name pattern and source tag; ask where to save each file; download history; optional aria2.

Privacy
No data collected. No analytics, no accounts, no remote code. Everything stays in your browser. Open source (MIT).

Not affiliated with, endorsed by, or sponsored by X Corp.

**Support link ("Support" / contributions field):** https://ko-fi.com/falsehamartia
**Homepage:** https://github.com/Lynchalot/multi-column-for-x
**Support site:** https://github.com/Lynchalot/multi-column-for-x/issues

**Categories:** Social & Communication; Appearance
**Tags:** twitter, x, columns, multi-column, timeline, media download, video
**License:** MIT
**Privacy policy:** paste the text of PRIVACY.md into the privacy-policy field (or link to it once the repository is public)
**Compatibility:** tick Firefox for desktop; untick Firefox for Android (the layout is built for wide screens)

**Notes to reviewer** (paste this):
There is no build step, no minification and no obfuscation: the uploaded files are the source (also at the repository above). No remote code, no network requests of its own, no analytics.

What it does, and why each piece exists:
- `src/hook.js` (content script, world MAIN, document_start): wraps `fetch`/`XMLHttpRequest` on x.com only to receive a copy of the timeline JSON that x.com's own code already downloads (posted to the extension with `window.postMessage`). It never changes a request or a response. It also stops videos in x.com's own hidden timeline from playing while the extension's columns are covering it (`HTMLMediaElement.prototype.play` is wrapped for videos inside x.com's primary column only), and forwards Escape/arrow keys to the extension's image viewer.
- `src/main.js` and `src/parse.js`: turn that JSON into cards drawn by the extension. Like, repost, bookmark and reply are performed by dispatching clicks on x.com's own (hidden) buttons; the extension does not call x.com's API itself.
- To show a post's comments the extension briefly navigates x.com's own page to that post (`history.pushState` plus a `popstate` event, as x.com's router follows a link) so that x.com fetches the conversation, reads it from the same JSON, and navigates back. Falls back to clicking x.com's own link to the post.
- While that happens a static copy of x.com's right sidebar is shown (cloned DOM, inert) so the sidebar doesn't flicker.
- `background.js`: saves media with the `downloads` API (only URLs on https://pbs.twimg.com and https://video.twimg.com are accepted) or, if the user turns it on, hands the file addresses to the user's own aria2 on localhost.

Permissions: `storage` (settings and download history, local only), `downloads` (the Download button), host access to x.com / twitter.com (the site it enhances) and pbs.twimg.com / video.twimg.com (the media files). `optional_host_permissions` for localhost/127.0.0.1 are requested only when the user switches on the aria2 hand-off. `data_collection_permissions`: none.

Everything user-visible in the options page is generated from `src/settings.js`.

**Screenshots to take (1280x800 or larger, PNG):**
1. Home in 4-5 columns (hero shot).
2. A card's comments open, sorted Most liked.
3. The image viewer with Download / Copy link.
4. The settings page (Algorithmic content + Downloads).
5. A narrow window: top bar wrapping, 1-2 columns.
Use public posts only; blur or crop anything personal (your own account name, DMs, notifications).

**Icon:** store/icon-128.png (the extension itself ships icons/icon.svg).
