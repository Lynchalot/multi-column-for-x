# Changelog

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
