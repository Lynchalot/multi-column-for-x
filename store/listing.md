# Add-on listing (addons.mozilla.org)

**Name:** Multi-Column for X

**Summary (max 250 characters):**
Your X (Twitter) timeline in masonry columns, with the best of Control Panel for Twitter and Media Harvest built in: filters, retweet/quote/reply views, one-click media download, in-card video, and no tracking.

**Description:**
Multi-Column for X turns the single narrow X feed into as many columns as your screen can hold, and replaces two popular helpers with one extension.

Layout
- Automatic columns (fits your window and re-flows when you resize it) or a fixed number.
- Smooth, stable scrolling that keeps loading. Nothing refreshes behind your back: new posts wait behind a "N new" button.
- Video and GIFs play in the card; photos open in a viewer with Download and Copy link.
- Open posts in a new tab so you never lose your place.

Control Panel features, built in
- Following by default, hide "For you", only accounts you follow.
- Reposts, quotes and replies: show, own view, or hide.
- Mute words, accounts and quoted posts; hide replies from paid accounts; NSFW blur/hide.
- Hide Trending, Who to follow, Topics, Premium and more; sidebar tidy-up; Twitter name and logo; system font; custom CSS.

Media Harvest features, built in
- Original-size photos and best-quality video, one click.
- Choose the folder, file-name pattern and source tag; ask where to save each file; download history; optional aria2.

Privacy
No data collected. No analytics, accounts or remote code. Everything stays in your browser. Open source (MIT).

**Support link (add-on page "Support" field):** https://ko-fi.com/falsehamartia
**Homepage:** https://github.com/Lynchalot/multi-column-for-x

**Categories:** Social & Communication; Appearance
**Tags:** twitter, x, columns, multi-column, timeline, media download, control panel
**License:** MIT
**Privacy policy:** contents of PRIVACY.md
**Notes to reviewer:**
The extension has no build step: the uploaded files are the source. It reads the JSON that x.com already sends to the page (hook.js, MAIN world, wraps fetch/XHR) and draws its own cards from it; it makes no network requests of its own. Like/repost/bookmark/reply press x.com's own buttons. Permissions: storage (settings), downloads (Download button), x.com/twitter.com (the site it enhances), pbs.twimg.com/video.twimg.com (media files). Optional localhost permission is requested only when the user turns on the aria2 hand-off.

**Screenshots to take (1280x800 or larger):**
1. Home in 4-5 columns (hero shot).
2. A card's comments open, sorted Most liked.
3. The image viewer with Download / Copy link.
4. The settings page (Algorithmic content + Downloads).
5. Narrow window: top bar wrapping, 1-2 columns.
