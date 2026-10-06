# Changelog

## 0.21.0
- **Short posts that are only words are set larger** (20px, 22px in the panel), so they hold their own beside the pictures. Posts with a picture, video, link card or quote, and long posts, are unchanged. Option: Posts, "Set short posts that are only words in larger type".
- **A toast with Undo** after saving a post to bookmarks or reposting it ("Saved to bookmarks · Undo"), so a mistaken press has an obvious way back.
- **More from this account** in the post panel: a short row of the same person's other posts we already have (nothing is fetched); a tile opens that post.
- **A muted preview when you point at a video**: it plays after a moment and stops when you move away; pressing on it keeps it playing with sound as you last set it. Option: Posts, "Play a muted preview when I point at a video".

## 0.20.0
- **Columns button is now just the number and a small arrow** (e.g. `3 ⌄`). The list under it has Auto first (and how many that is now), then only as many columns as fit at this width.
- **One "Show" menu replaces the second row of filter chips.** `Show: Everything ⌄` sits in the top bar and lists Everything, Posts only, Retweets, Quote Tweets, Media (or Videos and Photos on a profile's Media tab). The tab row above is X's alone.
- **Narrow windows:** the top bar stays on one row (it scrolls sideways before it wraps), the buttons drop their words below a certain width, and a card too narrow for it drops its view count.
- **A fresh install starts on the Calm preset**, so Calm is what is ticked on the settings page (nothing changes for anyone who is already using it).
- **Comments on their way show grey comment placeholders** in the post panel instead of a spinner.
- **Posts on their way show grey placeholder cards** at the foot of each column when there is blank space on screen, with the "Loading more" spinner as before.

## 0.19.0
- **One button for the number of columns.** The `− auto · 2 +` stepper and the separate Auto button are replaced by a single columns button that shows "Auto" or the number. It opens a short list: Auto (and how many that is now), then 1 to 8 columns, with the current one ticked.

## 0.18.1
- **Snappier motion.** Everything that moves now takes a tenth of a second or less (the panel opening out of a picture is 0.15s), and a test keeps it that way. The soft blur behind the panel and on the picture buttons is gone, since it was the costliest part of those fades. Nothing waits for an animation: clicks and keys work straight away.

## 0.18.0
- **Comments are usually there when the panel opens.** Resting on any post for about half a second (not just the comments button) starts loading its comments out of sight.
- **The post panel grows out of the picture (or card) you clicked** and fades out when closed.
- **The Back button closes the panel** instead of leaving the page. Closing it with Esc or a click leaves no extra history behind.
- **Pictures arrive from a quiet tint** and fade in, rather than appearing out of black.

## 0.17.0
- **A one-time hint** under the top bar the first time columns show: what clicking, Esc and the arrow keys do, that pictures have actions on hover, and where settings are. "Got it" dismisses it for good (it also goes away the first time you open a post).
- **The comments button opens the post panel** with the cursor in the reply box, instead of making the card very tall. Option: Posts, "Open comments" (In the post panel / Inside the card).
- **Following shows its Popular / Recent arrow** from the start; pressing the tab a second time opens the choice.
- **"Report a problem"** replaces "Copy diagnostics" everywhere: it opens the project's issue page and copies the details for you to paste in. The fallback message when columns can't load says what to do.
- **The "Tweets" filter is now "Posts only"**, which is what it shows.
- Actions on a picture stay visible on touch screens.

## 0.16.0
- **Replies carry their whole conversation.** A reply shows every post above it that X sent with it (up to three, oldest first), not just the last one. Where X sent the reply on its own, the posts it answers are looked up out of sight, one at a time, for replies you have been looking at for a moment (never while you scroll, at most eight a minute), and the card fills in. Option: Posts, "Look up the post a reply answers when X did not send it".
- **The post panel shows the same context** above the post, and a post's comments no longer include the conversation above it (those posts used to be listed as comments).

## 0.15.0
- **Posts open in a panel over the columns.** Click a post (its words, its time, a post it quotes or a thread post) and it opens large: the pictures at full size on one side, on the other the words, the actions and the comments with the reply box. Esc, the cross or a click outside closes it and the columns are exactly where you left them. The arrow keys go to the next or previous post. Option: Posts, "Open posts and profiles" (panel by default; new tab or this tab as before). Translate post and Open conversation still open the post on X.
- **Actions on the picture.** Point at a picture and like, repost, save and download appear on it. Option: Posts, "Show like, repost and save on a picture when I point at it".

## 0.14.2
- **Sensitive media works on X's own pages** (a post's page, a profile, search): the setting now acts on X's own blur. "Show" removes the blur and X's notice, "Hide" leaves the picture out, "Blur" leaves X as it is. X's blur is found by its one style rule, the way Control Panel for Twitter does it.

## 0.14.1
- **Cards stand off the page**: each card (and a profile's header) has a faint tint, a little lighter than a dark page or darker than a light one, with a hairline edge, so you can see where one ends and the next begins. The tint is see-through, so a themed or wallpaper background still shows. Option: Look, "Card background" (None puts them back on the page).

## 0.14.0
- **A profile's header is the first card of the first column**, top left, with the posts flowing beside and below it, instead of a banner across the whole window.
- **The post a reply answers is set in the same size as the reply**, in full contrast, as on X.
- **Short, quiet motion** where it explains something: the columns fade up when a new set of posts is drawn (a tab, a filter, a new page); comments and folded threads ease open; the heart and bookmark give a small beat when pressed; the picture viewer fades in; sensitive pictures un-blur smoothly; read posts fade smoothly. Everything is about a tenth of a second, and all of it switches off with "reduce motion" in your system settings.

## 0.13.1
- **The profile header is now a copy of X's own**: banner, picture, name, bio with its links, location and join date, Following and Followers counts, "Followed by", and the buttons (Following, message, notifications, more). Links open as they do elsewhere here; a button presses X's real one. The text-only header from 0.13.0 stays as a fallback if X's header can't be found.
- **A reply's context shows the whole post it answers**: its pictures, the post it quotes and its link card, as X does, not just its words.
- Fixed a stray "null" above the profile header.

## 0.13.0
- **Replies show what they answer.** A reply carries the post it is answering above it (name, handle, the text, a note if it has pictures), on every page. On a profile's Replies tab the post it answers is shown only there, not again as a card of its own. It uses the post X sent with the reply, or one already seen in this session; a reply whose parent X did not send still says "Replying to @name".
- **Profile header.** A profile page now has a compact header above its posts (banner, picture, name, handle, bio, place, join date, following and follower counts), and the name stays in the top bar. Option: Posts, "Show a profile's header above its posts". It is read from what X sends when the profile opens, or from X's own header if that did not arrive.

## 0.12.2
- **Grok's floating button lines up beside Chat's** when X's right sidebar is shown. Its position is now set from where the two buttons actually are, not from the boxes X wraps them in.
- **Presets** are ticked boxes (the one that matches your settings is ticked, "Custom" when none does), with shorter descriptions.

## 0.12.1
- **Normal scrollbar** on the columns (it was the thin one).
- **Sensitive media outside the home feed.** Pictures in comments are now blurred (or left out, with "Hide") by the same setting as posts. On X's own pages, a post's page or a profile that asks "view profile?", "Sensitive media: Show" now presses X's own notice for you.
- **List names.** A list page's name goes in the tab title (X leaves it as "List") and at the left of the top bar. It is read from what X sends when the list opens.

## 0.12.0
- **Threads fold into one card.** A person's replies to themselves (when both are in the feed) sit under their first post, behind "N more posts in this thread". Option: Reading, "Fold a person's thread into one card" (on by default).
- **Tall single pictures are trimmed** to a sensible shape instead of running the full height of the column; click for the whole picture. Option: Posts, "Tall pictures".
- **Volume is remembered.** The volume and mute you set on a video apply to the next one (videos that autoplay muted stay muted).
- **Presets** at the top of the settings page: Just columns, Calm, Media wall. The settings page opens there on first install.

## 0.11.7
- **Smoother tab switching.** Pressing a tab whose posts haven't been loaded yet no longer blanks the columns: the old posts stay, dimmed, with a "Loading" pill, until the new ones arrive.
- **No more flash of X's page after a tab switch.** The "no posts arrived in 10 seconds" check counted from when you opened the page, so a slow tab could trip it at once. It now starts when you press the tab and waits while a switch is under way.

## 0.11.6
- **Fixes blank columns in 0.11.4 and 0.11.5.** The bottom-right corner search could take a big page wrapper for a button and cut a screen-sized hole out of the columns. Only button-sized things count now, and no hole may cover most of the screen.

## 0.11.5
- **A strip for the floating Grok and Chat buttons** when X's right-hand sidebar is hidden and the buttons are shown: the columns stop short of them instead of running underneath. The buttons stay stacked. No strip when both are hidden.

## 0.11.4
- **Floating Chat button found by where it sits.** Your diagnostics showed nothing in the corner was `position: fixed`, so the earlier searches could not see it. The corner is now probed for whatever is on top there. "Copy diagnostics" lists what it finds (`corner`).

## 0.11.3
- **Floating Chat button, again:** the search for X's floating buttons now includes `#layers`, where X can keep the chat drawer. "Copy diagnostics" lists the small floating things in the bottom-right corner and whether each was found.

## 0.11.2
- **Hiding the floating Chat button works** when X has renamed it: whatever else sits in Grok's corner stack is treated as Chat. The two help lines under those settings are gone.

## 0.11.1
- **Hide the floating Grok and Chat buttons** (settings, Navigation & sidebar). Both are in the left menu already.

## 0.11.0
- **Like and reply to a single comment.** Each comment has a heart and a Reply button. Both work the way posts do: X's hidden side opens the post, presses the real button on that comment and goes back, so the columns don't move.
- **The reply box is at the top of the comments**, above the first comment.

## 0.10.1
- **No more doubled columns after an update.** A tab left open while the extension updated or reloaded kept the old copy running beside the new one, and both drew columns on top of each other (ghost posts, doubled tabs, two Columns buttons). The newest copy now takes over and the old one stands down.

## 0.10.0
- **A layout for each page** (option): Home, Search, Lists, Bookmarks and profiles each remember their own column count.
- **Posts you've read** (option): hide or fade them on Home and Lists. Read means on screen for a second; only the post's number is kept, on your device. Nothing disappears while you read: it applies on your next visit and when you refresh. A top-bar button shows what's hidden, and when everything recent is read it stops loading older posts and says so. A button on the settings page forgets the list.
- **Reposts folded** (option): several people reposting the same post make one card, "A, B and 2 others reposted".
- Comment order was already remembered between visits; there is now a test for it.

## 0.9.3
- **Long sessions stay light:** posts far above or below you give their contents back (keeping their exact height, so nothing shifts) and get them again
  as you scroll towards them. It starts once 150 posts are on the page.
- **A health check:** a small amber warning in the top bar when the extension notices something it relies on has stopped working (it can't see X's data,
  can't find the tab bar, X stopped sending posts, likes or comments keep failing). Hover for what, click to copy a report. When columns give up on a page, a message says so.
- **Browser tests:** a stand-in x.com now lives in the repo (`npm run mock`) and 15 tests drive the real extension in headless Chrome, locally and on GitHub.
- GitHub issue forms (a bug report asks for the diagnostics).

## 0.9.2
- **Translate post now opens the post** (in a new tab by default, or in place if you chose that), where X translates it itself. Translating inside the columns
  was unreliable, so it is gone, along with the "translate automatically" option. Less running on X's hidden side as well.

## 0.9.1
- **Right sidebar stays put.** Your recordings showed its contents vanishing for seconds and jumping down while you scroll fast: X moves the
  sidebar's wrappers (sticky, fixed, offsets, transforms) in step with the hidden page's scroll. They are now held still the moment X touches them.
- **A fixed number of columns gives way on a narrow window.** Yours was set to a fixed 5 (the top bar shows "5", not "auto · 5"), so it never reduced.
  A fixed number now only applies while each column stays at least 320px wide; narrower, it drops columns down to one, and returns when the window grows.
  The **Auto** button is highlighted when the number is automatic, and + / − change the number you chose.
- **Photos no longer sit black while you scroll fast:** they start loading as soon as the post is drawn (a few screens ahead), not when they are nearly on screen.

## 0.9.0
- **Chat and Grok are back, side by side**: Grok's button sits to the left of Chat's in the bottom-right corner instead of above it. When the chat
  panel opens it is cut out of the columns (it used to open behind them) and Grok steps aside.
- **Translate post works with X's wording.** Your diagnostics showed X's post page calls the control "Show translation", not "Translate post". It is
  recognised now (and a post X already translated is read as it is).
- **New posts are noticed again.** X only checks for new posts while its own page sits at the top, and the loader keeps that page deep. While you
  are reading the top of the feed and nothing needs loading, the hidden page is now put back at the top; and X's own "See new posts" pill makes the
  refresh button say "New".

## 0.8.9
- **The floating Chat and Grok buttons are removed** (both are in the left menu). They are found by their place in the bottom-right corner as well as
  by name, so X renaming them doesn't bring them back. There is no setting for them any more.
- **Following's Popular / Recent (and Videos / Photos) switching is sturdier:** X closes its menu when it sees a click outside it, which could
  happen when you clicked ours. Our menu no longer lets X see the click, and if X closed its menu anyway it is opened again out of sight. Going back to
  the sort X started on is instant (it used to wait several seconds). Copy diagnostics now includes what X showed when you pressed a tab.

## 0.8.8
- Settings page cleaned up: shorter descriptions, no section intros except Navigation & sidebar, no footer line.
- Removed: the post-outline option, the aria2 download hand-off (and the localhost permission it needed), and the file-name tag box
  (files still end in `-twitter`).
- Removed the unused shortcut to a post's page for comments (X ignored it).

## 0.8.7
- **Right sidebar and the floating Grok / Chat buttons no longer collide.** The sidebar now stops above the buttons (room is kept only for the ones
  that are switched on), so they sit under it like a footer. Anything inside X's sidebar that X shifts as the page scrolls is held still,
  and scrolling with the pointer over X's sidebars or left menu now scrolls the columns (it used to scroll X's hidden page, which moved the sidebar's contents).
- **Comments no longer wait ~7 seconds first.** The shortcut to a post's page was ignored by the real X in your diagnostics, so it is off; comments use the reliable way directly.
- **Translate post, more patient and more honest:** waits longer for X's Translate link, and when it fails a note stays on the post saying what happened on the post's
  page and in the timeline (and a Copy diagnostics button). The diagnostics now list both attempts with the labels of the buttons X showed.

## 0.8.6
- **No more of X's own page showing through** while comments or a translation are loading: any right sidebar (or left menu) X builds
  while it is being driven stays invisible until the extension has pinned it, and the real sidebar stays hidden behind the still copy for the whole visit.
- **Loading keeps up better.** Found a real stall: after any like, bookmark, repost or similar, loading more posts was blocked for 20 seconds. Now it's
  800ms. While you are scrolling, about six pages are kept waiting (two or three when reading), and the next page is requested the moment one arrives.
- **Translate post** looks for X's Translate control by what it is (not just where), reads the result by what changed, and if the post's own page
  gives nothing it tries X's copy of the post in the timeline. If it still fails the message says where it stopped, and Copy diagnostics (now also in the post's ⋯ menu) includes it.
- **The Columns button says what it does**: "Turn Columns On" / "Turn Columns Off".
- **Floating Grok and Chat buttons are shown by default**, as on X (hide either in settings).
- **Optional outline around each post** (Look > Outline around each post; off by default). Posts have no outline otherwise.
- **Replies button shelved**: a timeline holds a handful of replies and finding them was slow. It only appears if you set replies to their own tab.

## 0.8.5
Audit pass.
- A failure while loading comments or a translation now ends in a message instead of a panel stuck on "Loading comments...".
- Going back after a comments visit only happens if X's page is still on the post we opened (not one you went to yourself meanwhile).
- Pressing the tab you are already on keeps what's on screen and returns to the top (it used to blank the columns for a couple of seconds).
- Resizing the window no longer makes the sidebars flicker to X's own position while you drag; they are re-measured once you stop.
- Links in posts are only ever web addresses (never `javascript:` or `data:`).
- Lighter: the top bar and Columns pill are only touched when something changed; floating-button scan skips background tabs;
  the list of conversations kept is capped; videos removed from the page stop being watched.
- Safety net: X's own pop-ups can't stay invisible for more than 20s if a menu is left open.
- Polish: visible keyboard focus rings, soft hover transitions, reduced-motion support, menu and toast fade in.
- Settings: "Support" link; shorter description.
- Packaging: `web-ext lint` is clean; Firefox for Android minimum version declared (142) to match the data-collection declaration.

## 0.8.4
- **Explore is X's own page again** (Today's News, Trending, Who to follow, Posts For You): the columns only showed the posts at the bottom and
  hid the rest, and waited a long time for them. A **Try columns** pill in the sidebar turns the columns on for that page if you want them.

## 0.8.3
- **Right sidebar no longer spasms.** Whenever the extension visited a post on X's hidden side (comments, translation, replying), X swapped
  its sidebar for the post page's version ("Relevant people"...) and back. A still copy of the sidebar now shows during the visit, and a sidebar X
  rebuilds is pinned at once instead of up to half a second later.
- **Automatic translation is off by default** (it was the only thing that kept visiting posts on X's hidden side while you read): the
  "Translate post" button is there instead; switch automatic back on in Posts. When on, it now only runs while you've stopped scrolling.
- Hovering for comments needs a real pause (about a third of a second) before it fetches anything.

## 0.8.2
- Fixed: the area between the sidebars turned solid black on a themed or wallpaper background (0.8.1 filled in a solid colour so the loading pill
  would be readable). The columns' background is X's own again, see-through where X's is; only the loading pill, menus and toast are solid.

## 0.8.1
- **No more jumping back to the top**: the columns could be wiped (and the scroll position lost) while X's hidden side was on a
  post's page fetching comments or translations. Fixed, and hovering only starts fetching comments for a real hover, not when the page scrolls under the pointer.
- **Posts in other languages translate automatically**, like X: once a post has been on screen a moment it is translated (one at a time,
  at most ten a minute, never while comments load), shown in place of the original with "Translated from Japanese · Show original".
  Switch off in Posts for a "Translate post" button instead.
- **Explore's Trending / News / Sports / Entertainment** tabs are lists of trends and stories, not posts: they now show X's own page,
  with a **Try columns** pill if you want to see. (They used to wait for posts that never came.) Explore's For you tab is still columns.
- **Loading spinner turns smoothly** (it was being rebuilt ten times a second), and the "Loading more" pill is solid and readable.
- **Right sidebar no longer jumps**: it fell back to X's own position for 10s whenever its first link had scrolled out of view,
  and X's own sticky offsets moved its contents as the hidden page scrolled.
- **Lighter on X's side**: X's hidden copy of the timeline can no longer start its videos (they streamed and decoded for nothing).
  Loading stops asking after four unanswered nudges instead of spinning forever.
- Settings page: icon, shorter header, "Do you like this extension? Support development here."

## 0.8.0
- **Comments are much faster**, and they work when you're far down the feed: the post's page is opened the way X's own router
  follows a link, instead of scrolling X's hidden list back to the post first (which could take ~10s or fail). If X ignores that, it falls
  back to the old way, which now takes bigger steps when the post is far away. Hovering the comments button starts fetching them early.
- **X's dropdown tabs work**: the profile **Videos / Photos** tab and Following's **Popular / Recent** open a menu of our own (X's was
  drawn in the wrong place), pressing the real item for you. Each choice keeps its own feed, so Photos and Videos (or Popular and Recent)
  no longer mix or show up as "N new". On a profile's Videos/Photos tab the second line has **Videos** and **Photos** buttons.
- **Columns keep their width**: automatic columns stay about 500px (never more than 20% wider; set in options) and a narrower
  window drops columns, down to one, instead of squeezing them. Spare room is a margin on both sides.
- **A post's own page**: Download and Copy-link buttons under the post (and under replies; Download only where there is media),
  and the Bookmark and Grok buttons under every reply are hidden (both can be switched off in Posts).

## 0.7.2
- Blank space under a short column no longer waits for the tallest one: more posts are drawn as soon as ANY column runs out
  (a few screens ahead), catching up faster when blank space is on screen. Cards not yet drawn count as the estimated
  height, not a flat 420px, so the columns stay more level. While waiting for X, the spinner stays on screen if there is blank space.
- A profile's **Media** tab now has **All / Photos / Videos** (GIFs count as videos), like X's app.

## 0.7.1
- A video you started now pauses when it is scrolled half out of view (GIFs still play only while visible).
- Several posts' comments can be opened at once: they queue and fill in one after another instead of refusing the second.
- "That's everything X has sent" no longer appears early: two ad-only pages in a row used to count as the end. It now needs X's
  "no next page" marker (or a long run of empty pages), and posts that arrive later cancel it.
- Loading stays about two pages ahead of what you've drawn, so fast scrolling doesn't hit the wall.
- The Columns pill uses X's own sidebar font and size, has an icon instead of a text glyph, is outlined when columns are on
  and filled when they are off, and turns into a round icon button when X's sidebar is narrow.

## 0.7.0
- Top bar redesigned: tabs and controls on one line (wrapping on small windows), the All / Tweets / Retweets… views on a sub-line;
  a view only appears once the feed has something for it (no empty Replies tab).
- Columns on/off + retry is now a permanent pill in X's left sidebar (it used to float over the chat button).
- Posts and profiles open in a new tab by default (setting), so you never lose your place; "this tab" mode returns you to the exact spot.
- Image viewer gained Download and Copy link buttons.
- Download location: default `X` folder inside Downloads; "Ask me where to save" for anywhere else; aria2 accepts a full path.
- New settings category: **Algorithmic content** (For you tab, only followed accounts, Who to follow, Trending, Topics, Discover more, Premium upsells).
- Translate post (uses X's own "Translate post"), Explore pages in columns (best effort), columns follow window resizes,
  no flash when loading comments, comment order menu is readable.

## 0.6.x
- Fixed "Loading more… waiting for X" (a scroll lock froze X's page); faster loading; Copy diagnostics.
- Comment ordering and writing a comment from the comments panel; flat downloads with a `-twitter` source tag.

## 0.5.x
- Reads X's own timeline data instead of copying its page: no flicker, in-card video, filters, NSFW toggle, sidebar controls,
  Control Panel for Twitter and Media Harvest features built in.
