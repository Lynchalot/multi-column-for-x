# Changelog

## 0.37.0
- **The comment box has the tools X's own has: Picture, GIF and Emoji**, under the box (in a post's panel, and in the box under a comment). Nothing under the buttons is made until one is pressed, so the box costs three buttons.
- **Picture**: choose up to four pictures (JPEG, PNG, WebP), or one GIF or one video (MP4, QuickTime), never a mix, as X allows. A picture on the clipboard pasted into the box, or a file dropped on it, is attached too. They show as small tiles with a remove button; Reply is on with pictures and no words. When sent, the files are handed to the file input X's own reply box has (the reply box is opened out of sight, as for any comment), and the reply waits for X to have taken them (its Reply button comes on only then, and stays on) for up to 45 seconds, two minutes for a GIF or video. If X does not take them the reply box is left open on X's side to finish, as with any failed comment. Not seen on real X: its reply box's file input (`input[data-testid="fileInput"]`), and that its Reply button waits for the uploads. The stand-in has both, and the real-Firefox test sends a file through the content script's hand-over to the page.
- **Emoji**: a small picker (six sets, and the last sixteen you used first, kept in x.com's page storage), arrows to move over it, Enter or Space to pick, Esc to close it (the post stays open). It puts the emoji where the cursor is and stays open for more. The panel's keys and arrows leave it alone while it has the focus.
- **GIF** opens X's own reply box for this post (or comment) in a new tab with the words so far (`/intent/post?in_reply_to=…&text=…`), because the GIF search is X's own service and is not reachable from here without calling X's private API. **Location and the flag are not built**: they are settings of X's own box, and there is nothing of ours to hand them to.
- Tests: the attachment rules (unit), the three buttons and nothing made before a press, the picker (cursor, open for more, keys, Esc, recent), pictures (chosen, shown, removed, four at most, a GIF alone, sent with and without words, the bytes arrive), the wait for the upload, paste and a refused file, the GIF button's address; and in real Firefox, a picture chosen in the box reaching X's page through the content script.
- The Firefox rig's reply test needs the document to have the focus (a reply is typed with `execCommand('insertText')`, which does nothing in a document that does not have it): the install's options tab, if it opens late, takes it.

## 0.36.0
Going through posts without stopping.
- **The post after the open one is made ready.** While a post is open, the pictures of the next two posts are asked for at once (so the picture is there when you arrive), and after a second on a post the next one's comments are fetched, through the same small budget the other lookups done in case you want them share (eight a minute, and none for a while if X says it is limiting them), and not while other comments are on their way. Setting **Get the next post ready while a post is open** (Posts, on).
- **A video in the panel can play at once**: **Videos in a post's panel** (Posts): Play when I click (as before), Play at once muted, or Play at once with the sound as you left it (a key that opened the panel counts as a press, so the browser allows the sound; if it refuses, the video plays muted). Not for a sensitive video that is still blurred, nor for a comment's picture.
- **What happens when a video in the panel ends**: **Stop** (as before), **Play it again**, or **Go to the next post**. It does not go on while you are typing a comment, the viewer or a menu is open, or the tab is in the background.
- **Posts you have read can be skipped**: **Skip posts I've already read when stepping through posts in a panel** (Reading, off). Forward only: the way back is always the one before, and when everything ahead was read the next one is shown anyway. A post counts as read after you have looked at it for a second, as before, and now also when it has been in the panel for a second; while a panel is open the cards behind it are not counted (they are covered). The list is kept even when "Posts I've already read" is left alone.
- **Stepping never runs out.** The columns behind a panel follow it (only as far as keeps the post in view), so closing the panel leaves you where you got to and the feed goes on drawing and loading ahead of you, as it does when you scroll. Near the end of what is loaded the feed is given the hidden page first (a post's comments wait up to four seconds for it; this applies when stepping, never to the first click), and a step taken at the very end waits for more posts to arrive and is then made, up to eight seconds. Before, the next-post key did nothing at the end of what was drawn, and a feed under a panel that was being stepped through could not load, because every step began a visit to X's page.
- **A Reels preset** (Settings, Starting points): the panel plays videos with sound, goes on to the next post when one ends, skips what you have read, and the Like, Bookmark and Repost keys move on; the columns show Media (set once when it is picked, not part of what ticks it; change it from the Show list as usual). Every other preset puts these back.
- Tests: the walk past read posts (and not without the setting), a post counted by being in the panel, the next post's comments and pictures asked for (not one with nothing to fetch, nothing with the setting off), the panel's video (by default not, muted and looping, with sound and on to the next post, stopping, not leaving a typed comment), fifty steps through the feed without a hold-up and the open post in view, the Reels preset's keys and the preset list.
- Not seen on real X: the pictures are fetched ahead and the comments by the same visits the panel already makes; whether the video's first seconds are ready as quickly as its poster is not something the stand-in can show (it has no decodable video). Nothing is buffered ahead for a video.

## 0.35.1
- **An open Grok or Chat panel is on top of everything**: the columns, an open post, and the pinned menu and sidebar. Grok's panel is nearly as tall as the window, which was past the size the scan accepted for a panel (820 px), so it was never found, no hole was cut in the columns for it, and the cards painted over it. The scan now takes a panel up to the height of the window, and a panel that is open (bigger than a button) is raised: under `#layers` the whole of `#layers` goes above the columns (`html.xmc-drawer-up`; it is given a position if it has none), elsewhere the panel itself (`data-xmc-up`). The hole in the columns stays, for a panel that cannot be raised from where X keeps it. The toast, the picture viewer and the settings are still above it.
- **It is found when it opens, not at the next slow pass** (up to four seconds before): something added under `#layers` or a press on the Grok or Chat button runs a quick scan of `#layers` at once, and a full one a little after the press.
- Tests: an open Grok panel 1000 px tall under `#layers` is on top of the columns and of an open post, and the lift is gone with it; the same for a panel kept in X's own page; and in real Firefox.

## 0.35.0
- **The panel keys can be seen, changed and turned off.** A new **Keyboard** section in the settings: the on/off switch and the "next post after Like/Bookmark/Repost" switch (moved from Posts), and a row for each of Like, Bookmark, Repost, Download, Copy link and Comment with its key: press the key's button, then the key you want (Backspace or Reset puts the default back; a key another action already has is refused, saying which). Letters, numbers and punctuation, on their own; the arrow keys, Enter and Esc stay as they are. The panel's tooltips, the viewer's and the legend show the keys in use.
- **A key to begin with: Enter, from the feed, opens the first post in view** (the first one on the page if the page is at its top, the first one showing if it is scrolled), and the arrow keys carry on from there. Enter on a button or in a box is theirs. It is the first row of the Keyboard section and can be another key (Enter is only for this one); the first-run tip says "or press Enter to open the first one".
- **A keyboard button at the corner of a post's panel** opens a small card of the keys (the ones in use, "Change keys" to the settings), and **the first time a panel opens** a toast says what the keys are, with a Change button (once; `keysHintSeen`).
- **The toolbar button shows "!" (in red) when the extension has no access to x.com**, and its tooltip says to click it; the panel then has the "Allow x.com" button. Firefox keeps that access as a permission the person can switch off, a temporary load can come up without it, and until now nothing said so (0.34.1 added the line in the panel; this puts the sign where it is seen). "off" for the master switch is as before.
- The Firefox test for the status report waits for it (it is first written about twelve seconds after a page loads, in every version).
- Tests: the key map (defaults, capitals, two characters, unknown actions, a key taken by another action), the Keyboard section's rows (choosing, a taken key, reset), a remapped key in the panel with its tooltips and the legend, the hint once, and the badge in the Chrome rig.

## 0.34.1
- **The "is it running" line is on the settings page too**, and looks at the x.com tab used last when the page in front is not one (so it can be read from about:addons, Preferences, as well as from the toolbar panel). When the script is not answering it says when it last started on x.com ("It last started on x.com at 21:14 (version 0.34.0), so it can run here; this tab was probably open before the extension was loaded") or that it has never started since it was loaded. For a report of the extension loaded in Zen and doing nothing, while the same zip drew columns in Firefox.
- Checked, and not the cause: Zen 1.23b itself (the same build, 20261002114451) runs this version on a clean profile (all sixteen real-browser tests pass), also with `dom.webgpu.enabled` on. The difference is in the profile: the extension's access to x.com switched off, another extension on x.com, a pref, a container or a private window. `XMC_FF_PREFS='{"pref":value}'` sets prefs for the Firefox tests.

## 0.34.0
**Keys for a post's panel and the picture viewer**, for going through posts without the mouse. They work only while a panel or the viewer is open and nothing is being typed into.
- **← →** go through the post's pictures and then on to the next post (back: the previous post). **Shift+← →** go to the next or previous post, skipping the pictures. (Before, the arrows stepped the pictures only when one had the focus, and the posts otherwise.) In the viewer the arrows step its pictures as before.
- **A** like, **S** save (bookmark), **W** repost (straight away, no menu; Undo is in the toast), **E** download (in the viewer, the picture showing), **Q** copy the link, **C** comment: the comment box takes the keyboard as soon as the comments are in (from the viewer, the viewer goes and the panel opens). **Enter** on nothing in particular opens the picture showing full size.
- They are letters Vimium leaves alone by default (it takes h j k l d u f r x y p o b t i v m n and most capitals), so j, k, d and u still scroll the comments. X's own page does not see them (it has shortcuts of its own, S among them). Each is in its button's tooltip and in `aria-keyshortcuts`.
- **Esc in the comment box leaves the box**, and the panel stays (what you typed stays); Esc again closes. Before, Esc closed the panel with the comment in it.
- **The toolbar panel says whether the extension is running on the tab you are looking at**, at the top: "Running on this tab (version 0.34.0)"; "Switched off"; "Open x.com to see whether it is running there"; "Not running on this tab. It was probably open before the extension was loaded" with a Reload button; or "The extension is not allowed on x.com, so it cannot run there" with an Allow x.com button (Firefox lets a person switch that access off under about:addons, Permissions, and nothing runs on the site until it is back on). Added after a report of "loaded but not doing anything" that could not be told from here.
- Two settings (Posts): **Keyboard shortcuts in a post's panel and the picture viewer** (on) and **Move to the next post after the Like, Bookmark or Repost key** (off).
- Tests: the arrows through pictures then posts, Shift, each letter, typing letters into the box, Esc, the setting off, the same letters from the viewer; and in real Firefox the arrows, A reaching X's handler, C and Esc.

## 0.33.0
- **A master switch.** "Enabled" at the top of the toolbar panel, the gear's panel and the settings page. Off: the extension draws nothing, changes nothing, watches nothing and records nothing on x.com, and X's page is X's own (the page-world hook, which has to decide before X has started, stands down too). The toolbar button says "off" while it is off. Turning it on or off reloads the open X tabs (a page put back by hand is never quite the page X made). Everything else in the settings is left as it was and shows dimmed. The switch is `enabled` in the schema (on unless turned off); a note kept in x.com's storage (`xmcOff`) lets the hook and the content script see it at once; if the switch was turned over while no X tab was open, the first page opened afterwards lets go of itself before anything is drawn and brings the note up to date. (There was a setting of this name in 0.7.0, removed later; it is a new one.)
- **A post closed and opened again while its comments were still waiting had them refused.** One request is made for a post's comments however many panels ask. It was dropped if the panel that asked first was closed by the time its turn came (it queues behind other requests), even when the panel had been opened again and was waiting for the same answer: that panel was told "Closed before it loaded", and the failure was counted against Comments in the status table (one such failure was in the diagnostics from real X). The request now stands while any panel still wants it.
- Tests: the switch off with and without the note (nothing drawn, X's page showing), turned over in an open tab and back (reloads), the same in real Firefox through the toolbar panel's page and `browser.storage`; the closed-and-opened-again panel.

## 0.32.3
From the first sample taken on real X (Firefox 157, the home timeline and one post's comments): the parser read all 393 posts X sent and dropped none, X's Home link, tabs, Like, Repost, Bookmark, Reply and post text were all found, and comments worked. What it showed:
- **The columns menu says what Auto is**: "Auto (2 columns)" (or "Auto (1 column)"), not "Auto (2 now)".
- **"Save sample" kept a person's name.** The sanitiser keeps the short label on a button, and counted any link as a button, so a post's author (a link) kept their name and handle, and the avatar's test id (`UserAvatar-Container-<handle>`) and the link to the profile kept the handle. A label is now kept only on a button, a tab, or a link of the menu or the tab bar, never where a person's name sits and never if it has an `@` in it; test ids and addresses lose the handle. `scripts/scrub-sample.js in.json out.json` makes the copy for `test/fixtures/real/` from a file taken before this: post and user numbers become others of the same length that keep their order, picture and video addresses lose their file names, the markup goes through the sanitiser again. The sample from real X is now in `test/fixtures/real/` in that form, and `npm test` reads it (the posts, the conversation, the test ids of the buttons).
- **The Share button was reported as not found** on every post. X's Share button has no test id (it is labelled "Share post"), and nothing here presses it (Copy link builds the address itself), so the check, its row in the status table and its place in the sample are gone.
- **A Space's response is no longer listed** under posts X sent that are not read as timelines (`AudioSpaceById`).
- Not changed, and the sample shows it is not a fault: Translate reads "failing" when it was pressed on posts X offered no translation for ("X offers no translation for this one"). That is X's answer, not a change in X; a sample taken on a post in another language will show the button.

## 0.32.2
**Two things that did nothing in Firefox, and now work.** Found by a new test that runs the extension in a real Firefox; the Chromium tests could not see either.
- **The mouse wheel in the full-size viewer and in a post's panel** steps between pictures by a distance of at least 4. Firefox sends a notch of a mouse wheel as three *lines* (`deltaMode` 1), Chrome as a hundred pixels, so in Firefox a notch was under the limit and the wheel did nothing. The distance is now counted in pixels whichever way the browser sends it (a line is 40). A trackpad, which sends pixels, was never affected.
- **Vimium's keys.** Firefox moves a page whose root is `overflow: hidden` (X's is, under the columns) without firing a `scroll` event on it. The columns were told about a key's scroll by that event, so j, k, d, u, gg and G changed X's hidden page and nothing else. The extension now also looks at where X's page is, twenty times a second (a read of `scrollY`); the event still does the same job where a browser sends it.
- **A test in a real Firefox** (`npm run test:firefox`): the zip `web-ext build` makes, installed as a temporary add-on through geckodriver, x.com mapped to the stand-in over https. Fourteen tests: the install and the columns, the page-world hook and the content scripts, a setting made in the gear's panel reaching `browser.storage` and the page, the panel framed over the page with no fallback tab (also under a page policy that allows frames only from the page's own origin: it held), the toolbar panel's page, the background's answers, Vimium's keys, a tour (a post, a picture full size, the menu folded and unfolded by a real pointer press on the logo, the gear), and the status table, and since then the download, the clipboard, the wheel, a post's comments and a Like reaching the page. It needs a Firefox and geckodriver (`XMC_FIREFOX`, `XMC_GECKODRIVER`); CI uses the runner's.
- Tests: the keys scroll the columns in a browser that fires no scroll event on the page (the Chromium test, with that event taken away); a wheel notch counted in lines steps the viewer (Chromium, a dispatched `WheelEvent` with `deltaMode: 1`, and the same in Firefox).
- The Firefox tests also check, in the real browser: the download button saves the pictures through `browser.downloads` into a folder, Copy link and Copy diagnostics reach the clipboard from the content script, and the wheel. The stand-in can now put its pictures and videos on `pbs.twimg.com` and `video.twimg.com` as X does (the download is refused for any other host), and serve PNG instead of SVG (an SVG used as an image is a document of its own in the browser, which a soak run counts as growth).
- The soak script (`test/real/soak.js`) no longer retains what it waits for: `page.waitForSelector` returns a handle that keeps the element and everything under it alive, which showed as a leak of about 370 nodes for each post opened. Measured without it, opening and closing a post forty times grows nothing after the first sixteen (nodes and listeners flat).

## 0.32.1
- **A button that is missing because X already shows the other state is not a failure.** Like, Bookmark, comment likes and comment bookmarks looked for the button that does the job; if X's page showed the opposite one (an `unlike` where Like was wanted, because the page and the extension had drifted apart), that was counted as a missing button, and three in a row switched the feature off for five minutes. It is now taken as done and nothing is counted. A button missing with no opposite present is still a failure, as before.
- Test: a Like that X already shows as liked, pressed four times, counts nothing against Like and dims nothing.

## 0.32.0
**Less fragile**: what you asked for after the comparison with Control Panel for Twitter, as far as it can be done without a login to X. (Nothing in this is tried on real X.)
- **A button X has changed fails soft, and says what was missing.** Pressing Like, Bookmark or Repost when X's button is not found used to flip the heart and do nothing, silently. It now puts the heart back and says it could not find X's button. Three failures in a row switch that one feature off for five minutes: its button is dimmed, and pressing it says what was looked for (the test id) and offers Report. A success, or the five minutes passing, puts it back. The same count is kept for comments, comment likes and bookmarks, translation and the timeline data.
- **The columns fail open.** If X sends posts that cannot be read (the part holding the words and counts gone, say), or sends nothing for ten seconds, or the script keeps stopping with an error in the steps that draw the columns (thirty in ten seconds), X's own page shows with a line saying why and a Report button. The pill's tooltip says why too. "Turn Columns On" tries again.
- **What is working is a table** under Troubleshooting on the settings page: each feature with its state and last reason, the menu and right panel placement, what the start-up probe found on X's own page (the Home link, the tab bar, the link on a post's time, the Like, Repost, Bookmark, Reply and Share buttons, the post text), posts X sent under names that are not read as timelines, and how many of the posts X sent the parser read. It is also in Copy diagnostics (`features`). It is written to the browser's storage by the page and read there (counts and reasons only, no post text).
- **The parser counts.** What it read and what it let go, and why (no `legacy`, no author, no id, no words), the kinds of entry seen, and any operation that carries posts but is not one it treats as a timeline. A post item is now found by what it holds, not only by the name X gives its type, and a post's words are looked for in a second place.
- **Save sample for the developer** (a post's ... menu): a file with the shape of the last timelines and conversations X sent, with every word, name and address replaced (same lengths, so links and mentions still land), and the markup of the buttons this extension presses with the text taken out (a short label on a button is kept). Nothing is sent. `test/fixtures/real/` is where such files go: `npm test` reads every one the way the extension reads X and checks that the buttons are still found by the ids in `XMCLogic.CONTROLS`. When X changes, a new sample shows what moved; a payload that drifts fails a test.
- **The ids of X's buttons are one list** (`XMCLogic.CONTROLS`), used by the presses, the probe and the sample checks. **The words on X's translation controls are one table** (`XMCLogic.WORDS`), English only for now: a language is added by adding a row taken from a sample of that language's X, not from a guess. (Finding the Translate button by its place under the post's words, whatever its words, was already there.)
- **A beta channel, set up but not run:** `node scripts/build-beta.js` makes the Firefox package with an `update_url`; the workflow `.github/workflows/beta.yml` signs a tag `beta-v<version>` as an unlisted add-on, attaches it to a GitHub release and adds it to `updates.json`. It needs two secrets on the repository (`AMO_JWT_ISSUER`, `AMO_JWT_SECRET`); the notes are in `store/SUBMIT.md`.
- Tests: the tracker, the control ids, the parser's counts, the sanitiser (same posts, none of the words), a button that is not there, a timeline that cannot be read, a run of errors, Save sample end to end, and in the Chrome rig the report reaching `chrome.storage` and the settings table.

## 0.31.0
**A Chrome (and Edge) package**, from the same files. `npm run build:chrome` writes `dist/chrome/` (what "Load unpacked" takes) and `web-ext-artifacts/multi_column_for_x-chrome-<version>.zip`.
- **What differs in the Chrome package:** the background is a service worker that loads the same scripts (`chrome/background-sw.js`), the icons are PNG (Chrome takes no SVG; `chrome/icons/`), and the Firefox-only keys (add-on id, data-collection declaration) are left out. Everything else, including the toolbar panel, the gear's panel over the page and the page-world hook, is the same manifest.
- **In the code, for both browsers:** the extension API is `browser` or `chrome`, whichever there is (the scripts looked for `browser` only, which in Chrome meant settings kept in the page's localStorage instead of the extension's storage); the background answers messages with `sendResponse` (Chrome does not take a promise from a message listener; Firefox takes either).
- **A test of the built package in a real Chromium** (`npm run test:chrome`, in CI too): the extension loaded as an installed one (its scripts in their own world, `chrome.storage`, a service worker), x.com mapped to the stand-in over https with a throwaway certificate. Six tests: the install opens the settings at the presets and the columns draw; a setting made on the options page goes through `chrome.storage` and reaches the page; the gear's panel is the extension's own page framed over x.com and stays (no fallback tab); the toolbar panel saves to storage; the service worker answers (opens the options page, refuses a download that is not X's media); a key that moves X's hidden page moves the columns. The page-world tests (`npm run test:e2e`) are as before.
- Not done: Chrome Web Store and Edge listings (the notes are in `store/SUBMIT.md`), and the tests that read `window.__xmc` have no counterpart in the Chrome rig (the extension's world is not the page's).

## 0.30.3
- **The settings panel lies over the cards: nothing resizes round it.** Opening it covered the menu and the right panel with its (invisible) backdrop, and the check that the pinned menus are still what you would click took the backdrop for a broken pin: after about 1.5 s it let both go, and the columns grew and shrank into the space (two columns became one, with the menu and right panel back where X puts them). The check now knows the settings panel, as it knows the post panel and the viewer, and so does the check that the menu is showing. A test opens the panel, waits five seconds, and compares the menu, the right panel, the column count and widths and the columns' edges with how they were: before the change the menu and panel were unpinned and the columns went from 2 to 1.

## 0.30.2
- **The toolbar button opens the settings in a panel, in sections that fold out.** There was no button before (the settings were under the add-on's entry in Firefox's extensions menu, in a tab). Now the toolbar icon opens a 440 px panel with the headings of the settings page (Presets, Columns, Reading, Home timeline, and the rest); pressing one opens it and closes the one that was open, and the last one left open is open next time. The search (and "Only changed") is at the top and opens every section with a match. Changes are saved as they are made, as on the full page, and "All settings" opens that page in a tab. Download history and Export, Import and Reset stay on the full page. A test opens the panel, folds sections, changes a setting, searches, reloads, and runs the size and name audit on it.
- **The gear in the columns' bar opens the settings in a panel over the page, not in a new tab.** It is the same panel the toolbar button opens (one page to keep right), in a frame at the top right in X's colours (dark or light, taken from the page). A change applies at once. Esc, its Close button, the gear again, or a press on the page outside it puts it away; "All settings" opens the full page in a tab. "Mute words…" in a post's menu opens it at Muting & filtering. If the panel has not come up within three seconds (a page that will not frame it), the settings page opens in a tab as before, and the trace says so. Needs the panel's files listed as web-accessible to x.com (manifest). Not tried on real X: whether X lets its page frame an extension page is the one thing to look at; the fallback is the old behaviour.
- **Media wall and Custom can be picked.** Each preset set only a handful of settings and left the rest, so after you picked Media wall, Calm (or Just columns) still matched and was the box ticked; Custom could not be chosen either, for the same reason. Every preset now sets all the settings that any of them touches, so exactly one matches at a time, and picking Custom by hand keeps it ticked and changes nothing. One consequence: picking Calm or Just columns now puts the Media wall's column width, column count, autoplay and view counts back to their defaults (before, they stayed as they were).
- **Preset wording:** Just columns, "Default X but laid out in columns."; Calm, "All algorithmic content disabled (only people you follow, no trends or suggestions)."; Media wall unchanged. Calm still folds threads and reposts and fades posts you have read; the line no longer says so.
- **The default name and logo is X's own** (it was Twitter's bird, "Tweet", "Retweet"). Anyone who had not chosen gets X; the Twitter wording is still under Settings, Look. Saved by an older version, the old default does not hold it.
- **The first-run tip** is a centred list: click a post, Esc and the arrow keys, pointing at a picture, the scroll wheel between opened pictures, the gear, and "Support us here" (a link to ko-fi.com/falsehamartia, in a new tab).
- **Vimium's j, k, d, u, gg and G scroll the columns without a click first.** From your note. Vimium scrolls the element you last clicked, or the whole page when that is not inside something that scrolls: before any click, or after one on the menu or the top bar, that is X's own page behind the columns, and nothing seemed to happen until you clicked in the gap between cards (I read Vimium's own code for this). Now, when a letter, Space or a paging key has just been pressed and X's hidden page moves that this extension did not move, the columns move by the same amount (gg and G go the whole way) and X's page is put back; with a post open the keys scroll its comments. X's page also keeps a little room at its top and bottom while it is idle, or "up" and "back to the top" would have nowhere to go. Esc and other keys are left alone (X puts its own page back when you go back). Typing in a box is the box's. Not tried with Vimium itself: the test stands a small script in for it.
- **A video taken full screen stays full screen.** From your recording (the button is pressed, the screen goes full for a moment and the video drops back to the card, twice). Going full screen makes the window larger; more columns then fit, so the columns were laid out again, which moves every post into new columns, and a video that is moved leaves full screen. A change of width now waits while a video is full screen (or has just been pressed, before the window has grown), and the columns catch up after it. A test takes a card's video full screen, grows the window and checks it is still full screen and was not moved; before the change it left full screen 6 ms after the resize. Not tried on real Firefox: the cause is the one the stand-in reproduces, and the Firefox full-screen toast in your recording fits it.
- **Bookmarks, Likes and Lists in the left menu had lost their names** (from your recording: icons alone, in the middle of a wide row, folded or not). X draws its menu with the names only when it has room, and for a moment, or in a narrow window, with icons alone; an entry copied from it in that state stayed that way. They are now made again when X's menu goes from one to the other. Not seen on real X: the cause is my reading of X's behaviour; the test makes the stand-in menu lose and regain its names.

## 0.30.1
- **The folded menu no longer disappears.** From your recording (21:23): press the logo, the menu folds to icons, a second later all of it is gone and the columns stay where they were. In 0.30.0 the menu's box was cut down to the width of the icons after folding. X lays its menu against the right edge of that box, so a narrower box pushed the icons left, off the screen on a wide window. A test now builds that layout (menu at the right of a wide header): the first icon was at -210 px; it is in view and stays. The box keeps its own width again, and what hangs over the columns past the icons is cut off with a clip: it shows nothing and catches no press.
- **While a post is visited, the still copy of a folded menu was not folded.** Every visit (a hover on a post for comments, translating, liking) put up a copy of the menu with all its names and a full-width Post button until the real menu came back. A test found it: seven names showing, the Post button 230 px wide. The fold rules now reach the copy.
- **The menu is watched.** Twice a second, while it is pinned and nothing is moving, the first icon is checked: in view, not hidden, not under anything that is not ours. If it is not for a second, the pin is done again; if that does not bring it back, once more without the clip. The trace gets a `menu gone` line with what was found, and Copy diagnostics carries it under `panels.menuGone`.
- Not tried on real X. If the menu goes again: Copy diagnostics, and look at `panels.menuGone` and the last `menu gone`, `unpin`, `freeze` and `thaw` lines of the trace.

## 0.30.0
**Translating is quicker**, two ways (from the ideas after your note that X now translates by itself).
- **Pointing at a Translate button for a moment starts the translation before you press it** (150 ms; on a card's button, in the panel, and on a comment's). The hidden page goes to the post in the visit that fetches its comments, so by the time you press, it is usually done and the panel opens with the translation showing and "Show original". Pass over the button without stopping and nothing starts. Pressing while it is still on its way waits for that one, with no second visit. It shares the small budget of lookups done only in case you want them (8 a minute, none for a while if X says it is limiting you), and a quiet failure is not repeated: pressing always tries afresh.
- **Pressing Translate on a post whose comments are not in yet translates during the visit that loads them**, on the page already open, instead of a second visit afterwards. The comments are handed over first, as before; the translation follows in the same visit. (Before: comments, back to the feed, then a second trip to the post: two page changes and about twice the wait.) If the comments are already in, or X has not offered a translation to that visit, it goes on its own as before. A translation of a *comment* still takes its own visit.
- Copy diagnostics `translateTimes` now says how each was done (`via`: `comments` or `visit`) and whether pointing started it (`warm`), with the times.
- Tests: pointing starts the visit with no panel open and one visit in all; a quick pass starts nothing; pressing while it is on its way makes no second visit; the older translate tests now run through the ride-along path.
- **Folded menu: the columns now start by the icons.** From your recording: folded, the menu looked right but the columns stayed where they had been, as wide a margin as with the names. The columns were placed by the widest box among X's menu links; folded to icons, a link's box can stay as wide as it was (stretched, or keeping room for the hidden name) while its icon is small, so the width came out as before. Each link is now measured by its icon and the padding round it, the folded menu is clipped to that width (so a box overhanging it catches no clicks meant for the columns), and whether the fold worked is judged by the names being gone, not by how wide any of X's boxes is. Copy diagnostics `panels` gained `iconsClamped` and `widestLinks` (the four widest boxes, by name and width), which would show which of X's boxes it was if this is not the whole story. A test makes every link 240 px wide: before the columns stayed put (250 to 260), now they move to the icons. Not seen on real X; "not aligned properly" may be the same gap, and if it is not, the `panels` block will say.
- **Over a post the cursor is the ordinary arrow; the hand is for links and buttons.** The whole post was clickable and showed the hand everywhere, so a link in the words did not stand out. The post, a thread's posts, the post a reply answers and a comment's body keep the arrow (pressing them still opens the panel); links, buttons and the picture arrows keep the hand.
- **A profile's header no longer disappears while you click around a profile.** From your recording (10 s: the header is there, you open a post, and when the panel closes it is gone for good). Whenever X's hidden page went to a post for us (comments, translating, liking), the address was the post's and no profile's, so the header was taken down and its copy of X's markup thrown away; back on the profile, X's own header was not always there to copy again, so nothing came back. The header and the name in the top bar now stay as they are for the length of the visit. (A test holds X's answer back and looks every 25 ms: the header was missing for 59 of 110 looks before, none after.) Not tried on real X.
- **X's logo folds and unfolds the left menu; the ☰ row is gone.** The logo was a second link to Home, so it now does the job the 0.28.0 menu button did and the row it took at the top of the menu is back. It has a label ("Fold the menu to icons" / "Show the menu with names"), `aria-expanded`, a tooltip with Alt+[, and works from the keyboard (Enter, Space). With the columns off it is X's link again, exactly as it was. Ctrl, Shift or middle-click still open Home in a tab.
- **In the full-size viewer the wheel moves between the pictures.** One step for each flick, forwards or back, held to about three a second so a trackpad's tail does not skip a whole post; the columns behind do not scroll. A post with one picture is unchanged.
- Not tried on real X (the logo's markup is taken from X's public page: `h1 a[href="/home"]`). What to look for: the Translate press answering in about the time the comments take plus X's translate answer, and `translateTimes` showing `via: comments`.

## 0.29.1
- **"Turn Columns Off" no longer disappears and comes back.** Found from your recording (8.2 s on, it goes and stays gone). The pill was shown only while the address was one the columns belong to; whenever X's hidden page went to a post for us (comments you hovered or opened, translating, liking), the address was the post's, so the pill hid for as long as the visit took, a second or several. It now follows the columns: it is up whenever they are. On a post's own page, which X shows as itself, there is still none. A test holds a visit open and watches the pill every 25 ms (it was hidden for the whole visit before).
- **Posts X has already translated are shown translated, with "Show original".** X now translates posts in other languages by itself on its page. The extension looked only at X's data (the original words), so it asked X again. It now takes the words from X's page when X says it has translated a post ("Translated from…", or a "Show original" button), and shows them in the panel and in comments at once, with no visit and no waiting; pressing Translate on a card opens the panel with it already done. Setting: "Show X's own translations of posts in other languages" (on). Copy diagnostics has `autoTranslate`: how many it took, which ones, and how many foreign-language posts X's page had drawn, so on your X it says whether X is translating them. Not seen on real X: only X's English wording is recognised ("Translated from", "Show original").
- **Pressing a video that is already playing its muted preview turns the sound on and carries on from where it is.** It used to start it again from the beginning, which jolts when you are two seconds in. (0.27.2 had added the restart on request; this takes it back.) A video that is not playing is unchanged: the player's own controls.
- **Copy diagnostics shows where translation time goes** (`translateTimes`, the last eight: milliseconds from the press to the post being opened, found, X's Translate control appearing, X's answer, and the total), for the posts X has not translated itself.

## 0.29.0
**Ease of use**, from the audit and double check you asked for, plus the startup motion (option A of the proposal).
- **Start-up motion, once per page load, 0.1 s.** As X's page is let through, its menu, sidebar and the top bar fade in instead of appearing at once (opacity only). When the first posts arrive the columns settle in from 6 px below, 12 ms apart, left to right (60 ms at most for the sixth column on). Nothing else changes: switching tab or filter keeps its own fade, and nothing runs for people who ask for reduced motion. Copy diagnostics and the log now carry `veil-lifted` and `first-draw` (milliseconds after the page began), which says how long the blank wait is on your X.
- **Text size** (Settings, Look): Smaller, Normal, Larger (115%), Largest (130%). It scales the words in posts and in the post panel, live, and leaves the top bar alone. Cards are rebuilt at the new size so heights stay right.
- **Settings page: search, changed marks, Reset.** A search box at the top (press `/`; Esc clears it) narrows the list by words in any order, in names, help text and option labels; a section with nothing left goes, with its link. Every setting that is not at its default shows "Changed from the default" and a Reset that puts that one back (and stops storing it). "Only changed (n)" lists just those.
- **Audit of what can be pressed** (new test, `test/e2e/a11y.js`): every button and link the extension draws must be 24 by 24 px at least (WCAG 2.2, 2.5.8, with its spacing exception for roomy targets and the sentence exception for links) and have a name a screen reader can say. It found and fixed: card avatars and comment avatars had no name (they are now for the pointer only; the name beside them goes to the same place); the picture link in a comment, the viewer's two arrows and a profile's banner link had none; names and times in card headers, comment times, and comment Like/Reply/Save were 16 to 23 px high; the edge tab was 16 px wide; a profile's Following, Followers and Joined were 17 px high. The test runs the feed, the filter menu, the folded menu, the panel with comments, the photo viewer, several pictures in the panel, a profile and the settings page.
- **Looks different, a little:** a card's header rows are 24 px each (about 8 px taller card), and the edge tab is 24 px wide, so the columns end 8 px sooner while the right panel is shown. Neither is tried on real X.

## 0.28.3
- **Pictures in comments are no longer stretched.** Since 0.27.8 (the change that gave comment pictures their shape before they load) a comment's picture was capped at 140 px high but kept the width of the pane, so a 4:3 picture showed squashed to roughly 4:1 (a test now catches it: 4.00:1 before, 1.33:1 after). A comment's picture is now sized from its own proportions: as wide as that needs, up to 140 px high, cropped to fit at the edges and never stretched, and still the right size before it arrives. Found while making the store screenshots: a generated picture came out with black bars, which an ordinary photo would have shown as stretching.
- **Store screenshots** (`store/screenshots/`, six, 1280x800) and the script that makes them (`node store/make-screenshots.js`): the test stand-in for x.com with invented accounts and posts and generated pictures, so no real post or name is shown. Listing captions updated.

## 0.28.2
- **The log of what the extension did survives a reload.** Copy diagnostics used to carry only the events since the page last loaded, so a problem you saw before a reload (or while the laptop was shut and the page was refreshed) was gone. The last 300 or so events are now kept in the browser's extension storage, written every few seconds and when the page goes away, and Copy diagnostics has them as `log.earlier` (with this computer's date and time, and a short id for each page load, so other tabs show up as their own). Page loads, the tab going into the background and back, the page going away, and any error the extension caught are logged too.
- **What is kept:** the same events as before (kinds, post numbers, widths), plus the kind of page (home, profile, search…) instead of the address. No post text. **Settings, Troubleshooting: "Keep a short log for Copy diagnostics"** (on) turns it off and deletes it. PRIVACY.md says so.
- Not tried on real Firefox: the mock stores the log in the page's own storage, the real extension in `storage.local`. If a log is missing after a reload, say so.

## 0.28.1
Hardening the folding menu against X's real markup, which nobody working on this has seen.
- **The menu's names are found by their words, not by X's nesting.** 0.28.0 faded "the link's second box after the icon", which is how the stand-in x.com is built and how I remember X's. Each name is now found as the biggest piece of text in a link that has an icon, and marked; the stylesheet fades the marked boxes as well as the old guess. A test nests the links differently (spans, the name two boxes deep) and the menu still folds (it did not with only the old rule).
- **If the menu will not fold, it says so.** Once the slide ends the extension measures the menu; if it is still much wider than its icons, a note says "X's menu would not fold here" (once), and the trace has a `rail FAILED` line with the two widths. Before, the button would just have done nothing.
- **Copy diagnostics has `panels`**: both choices, the state classes, how many names were found and how many are still showing, the menu's and sidebar's edges, where the columns start and end, the edge tab, and an outline of one menu link (tag names, roles, the word of its name; no account details). 0.28.0's note said it had this. It did not.

## 0.28.0
**The side panels fold away for more room** (from the Google Maps mock-ups, variant A).
- **A menu button (three lines) sits at the top of X's left menu**, in line with the other icons. Pressing it folds the menu to icons: the names fade out, the Post button turns round, the Columns pill becomes an icon and the columns slide left to take the room. Pressing it again brings the names back. On a narrow window X already shows icons only, so there is nothing to fold.
- **The right panel (search, trends, who to follow) slides off the edge**, and a small tab on the window's edge brings it back. The columns widen into the space; on the way back they narrow again. If the new width means a different number of columns the posts are laid out once more behind a short fade, never jumping.
- **Keyboard: Alt+[ folds the left menu, Alt+] slides the right panel** (while the columns are showing).
- **Settings: "Left menu, while the columns are showing" and "Right panel"** hold the choice, which is remembered and is there on arrival with no slide.
- The menu's own box ends where the icons end, so a folded menu never sits over the first column.
- Nothing is new on X's side: the menu and sidebar are still X's own, pinned as before; the button is a copy of one of X's menu links (so it lines up exactly), and the folding is our own CSS. Not tried on real X: whether X's menu links have the same inner structure as the stand-in (the names are found as the link's second box), and where the Post button and the Columns pill land when folded. (0.28.0 said Copy diagnostics would show the menu's state; it did not until 0.28.1.)

## 0.27.9
A pass over how things look, from rendering the screens and reading the stylesheet.
- **The "More from @user" heading in the panel was blue and clickable-looking.** Its container shared a class name with the "Show more" link, so it took the link's colour and pointer. It is now the same as the "Comments" heading.
- **The row of icons under a post lines up from card to card.** A post with no media used to drop the download button, so its icons sat further apart than the next card's. The empty slot is kept (the remaining difference is the width of the digits in the counts).
- **Counts are no longer cut off or broken mid-word in narrow cards.** In your five-column screenshot "Quote Tweets" wrapped to three lines and "views" was clipped. Those counts stay whole, move to a second line if they must, and the view count gives way when a quote count is there and the card is narrow.
- **Everything the keyboard can reach shows a ring**: pictures in the panel, links, and the photo viewer's buttons had none (the pictures and viewer buttons became reachable in 0.26.3 without one).
- The close cross in the panel is the same size as the arrows beside it (40 px).
- **Settings: the presets are radio buttons**, not tick boxes (only one can be on).
- Tests: the recycling test's count is relative to how far loading got.

## 0.27.8
- **A quoted post's picture, and the pictures in comments, no longer push things down when they load.** They had no height until they arrived, so a card with a quoted picture grew by about 220px (and a comment list shifted) the moment the picture came in. They now have their shape from the start. This is what an occasionally failing test of mine kept catching ("a returned post is 220px off its old height", 5 times in 14 runs under load; 0 in 14 after).
- Likes, bookmarks and reposts on a post X hasn't drawn in its list now search for it for 4 seconds (not 1.5) before going through a visit to the post's own page; the Joined popup mover acts only on the Joined line and never on a modal dialog (found in a review of the last releases' code).
- The privacy text said Copy diagnostics holds "no post text"; it can now hold short snippets (about 50 characters) of X's page when a step fails. The text says so. README and the store listing cover the carousel, quoted posts, video sound and the popup.
- New tests for the mock's "Show probable spam" cell (never pressed), a like on a quoted post in the panel, and a race fixed in one scrolling test.

## 0.27.7
- **In the panel a picture is scaled to the width of its pane**, as it is on the feed. A picture whose own file was smaller than the pane (yours was 372 wide in a 546 pane) was left at its own size with a blurred margin round it. (A test now serves a 200 px picture into a 724 px pane: it stayed at 210 before.)
- **X's "About this account" popup on Joined now appears under Joined in the copy of a profile header.** Pressing Joined presses X's real one; X draws its popup in its own layer where its hidden header is, so the page now moves that popup's box to sit under the button you pressed. It is X's own popup, so a press outside closes it. Not tried on real X: the diagnostics have `popProbe` (whether a popup was seen and whether its box could be moved), which says what happened if it doesn't show.
- **Following, Followers, Joined and the bio's links underline as you point at them**, marked by the page as well as by `:hover` (the CSS-only version did nothing on your X).
- A flaky test fixed (the "..." menu was read before it was drawn).

## 0.27.6
- **The Lists entry in the left menu goes to your own lists** (`/yourname/lists`). It went to `/i/lists`, which is an empty page.
- **The translated post no longer repeats its own words in the small "Translated from…" line.** The language was read from the page's whole text, where X's line, its "Show original" and the post's words run together, so the line carried the post's text. It is now read from X's line alone ("Translated from Spanish").

## 0.27.5
- **Translate finds X's "Show translation" control.** Your probe on yaya's post showed the control worded "Show translation" (not "Translate post") among several other buttons, so neither the label nor the position fallback matched. Both wordings are known now, and the position fallback only counts buttons below the post's words.
- **In the panel, the empty space around a picture is filled with a blurred, dimmed copy of it, not black.** A small or differently shaped picture no longer sits in a black box. It uses the picture's own address (nothing extra to download) and is hidden on sensitive pictures until you reveal them.
- **Posts that X hasn't drawn are given 1.5 seconds, not 3.5, before the router is asked.** Your diagnostics showed the router path works every time on real X and cost 4.4 to 5.4 seconds, most of it the wait.
- **The Bookmarks, Likes and Lists entries in the left menu get the same hover pill as X's own entries.** X draws that pill from script, which a copy of its link does not get.
- **Following, Followers and Joined underline when you point at them in a profile header**, as they do on X. (X's "About this account" popup on Joined is not reproduced: it is drawn by X in its hidden page, at its own position.)

## 0.27.4
- **Translate waits for X's Translate control.** Your trace showed four `translate FAILED … X offers no translation` lines, each right as the visit ended: the extension looked for the control the instant X's page opened, and X draws it a moment later (after it has judged the post's language). It now waits up to 5 seconds for it. If there is still no control, Copy diagnostics has `translateProbe` (the post's language, its words, and the buttons X's page showed) so the real cause is visible.
- **The foot-of-conversation button is never one that reveals hidden replies.** Your `moreProbe` showed X's "Show probable spam" at the foot of a conversation, and 0.27.2 pressed it. Buttons whose words mention spam, offensive, abusive, muted, blocked or sensitive content are now left alone.

## 0.27.3
- **Video: no native controls while a video only previews.** Pressing a previewing video still paused it in Zen, so the page now takes the player's own controls away for the preview (nothing native is left to read the press as "pause") and gives them back a moment after the press. The press itself plays the video from the start, with sound. The diagnostics trace now has `video` lines (preview started, press, and any pause that followed it), so if this still misbehaves, Copy diagnostics will show what the browser did.

## 0.27.2
- **"Loading more comments…" no longer spins for a post whose comments are all there.** Your recording showed a post with 4 comments, all 4 on screen, and the spinner going anyway (X still sent a cursor). The line now appears only while fewer direct replies are shown than the post's own count says it has, and it gives up after 6 seconds, not 12, with "See all comments on X" instead of an endless spinner. If X puts a button at the foot of a conversation for the rest (as you described), it is pressed (found by where it sits, so any language), and what it says goes into Copy diagnostics (`moreProbe`) so it can be matched properly.
- **The "Open conversation" button is gone. The time on a post in the panel is a link to the post on X**, as on any social site (and the time on a comment is a link to that comment). "Prefer one tab" is respected.
- **A quoted post opens in the panel**, not a new tab (it was treated as a post we hadn't seen). Its comments load, and like and bookmark work on it, through its own page.
- **Pressing a previewing video plays it from the start, with sound.** Some browsers' own controls read that press as "pause"; a pause in the moment after it is undone.
- **Opening a post whose video is playing hands the video over:** the one behind stops and the panel's plays from the same place.
- **Translate** tries once more by itself when X didn't open or draw the post, and after a failure the button says "Try translating again" before it offers "Translate on X".

## 0.27.1
- **Comments and Translate no longer fail on posts X hasn't drawn in its hidden list.** Your diagnostics showed it: X's list is virtual and does not always draw a post far down the feed, and the extension hunted for it for about 11 seconds, then gave up with "Couldn't find this post on X's side" without ever asking X's router to open it. It now looks for 3.5 seconds, then goes straight to the router. A visit that fails is now written to the diagnostics (before, this particular failure left no trace, which is why `commentFailures` was empty).
- **Videos: pressing on a hover preview now turns the sound on** (it used to keep playing muted, so a second press paused it). A **speaker button** sits with Like, Repost, Bookmark and Download over the picture: sound on or off, and it starts the video if it was stopped. The preview no longer stops when the pointer moves from the video onto those buttons.
- The pointer over the sides of a carousel picture is the ordinary pointer, not a resize arrow.

## 0.27.0
- **A post with several pictures is a carousel in the panel.** One picture at a time, an arrow each side, a dot for each picture (the current one lit). The wheel over the pictures flicks between them, as it did before; the left or right third of a picture steps back or on (the pointer shows which way), and the middle opens it full size. Left and Right step the pictures while the focus is in them, and the posts anywhere else in the panel.
- **The post arrows are solid white circles at the screen edges, and the backdrop behind the panel is darker (70%).**

## 0.26.3
- **The panel and the photo viewer work from the keyboard.** Both are now dialogs: Tab and Shift+Tab stay inside them instead of walking into the feed behind, closing one gives the focus back to the button or photo you opened it from, and the viewer takes the focus when it opens. Photos on cards and in the panel can be focused and opened with Enter or Space.
- Labels set with `aria-*` (the loading placeholders' `aria-hidden` among them) were being set as plain properties and so did nothing; they are now real attributes.

## 0.26.2
- **A tab switch on a slow connection no longer leaves you on the old feed.** If the tab you switched to took more than 12 seconds to load, the extension stopped waiting and, when its posts did arrive, never showed them (X's tab said For you, the columns still showed Following). It now takes that feed when it turns up, for two minutes after giving up.
- **A reply's panel no longer jumps when the post it answers arrives.** Room is kept for it (a grey placeholder) and the real post swaps in; it was pushing the post's own words down by its height.
- Privacy notes updated for what has been added (two markers in x.com's page storage, the age-check flag, translation, the diagnostics log). Test fixes for slow machines (a Back counted by the wrong visit, a comments request that could beat the placeholder, a timing assumption in the comments scroll test).

## 0.26.1
- **With Bookmarks and Likes both added to the left menu, X's History entry is hidden** and they take its place (it was the two in one). Turn either off and History comes back. History is recognised by its address (`/i/bookmarks`, `/i/history`) or its English name.

## 0.26.0
- **Cards show up over a wallpaper again.** The card tint is a few per cent of the text colour over whatever is behind the page; over a see-through page (a wallpaper or a theme) that all but vanishes. When the page background is see-through the tint and the hairline edge are now stronger (9% and 15%, from 4% and 8%); on a plain page nothing changes. (This also fixed the see-through check itself, which took plain black, `rgb(0, 0, 0)`, for transparent.) Copy diagnostics now has a `theme` entry (the colours, whether the page is see-through, what a card's background and edge come out as).
- **Bookmarks, Likes and Lists in X's left menu**, three options under Navigation & sidebar (off by default). Each is a link made from one of X's own menu links, placed under History / Bookmarks, and loads that page when pressed (a normal page load).

## 0.25.1
- **Translation no longer depends on X being in English.** X's translate button and its "Translated from …" line are written in your interface language, so they are no longer found by their English words: the button is also found by where it sits (the one plain button beside the post's words, never one of X's named controls, and nothing is pressed if that isn't clear), and "translated" is recognised by X's words having changed after the press. The language shown in "Translated from …" is whatever X says (only when X says it in English; otherwise it just says "Translated"). The language it translates into is your X setting.

## 0.25.0
- **Translate in the panel.** The Translate post button on a post, a comment, or a card now translates it in place using X's own translation: the hidden page goes to the post, presses X's Translate control and the translated words are read off X's page and shown with "Translated from Japanese" and a Show original / Show translation toggle (asked of X once per post). On a card it opens the post's panel and translates there. If X offers nothing we can read, the button becomes "Translate on X" and opens the post on X. Written from X's wording, not its markup, so unverified on real X: a failure leaves a `translate FAILED` line, with the reason, in Copy diagnostics' `trace`.
- When X still has a stale copy of a post in its page, the one on show is used.

## 0.24.1
- **A menu button on a narrow bar.** Below about 560px the Show, Columns, Sensitive media and Settings controls (and Mark all read, when it applies) fold into one ☰ button; the tabs and the refresh button, which shows "N new", stay. Wider bars are as before.
- **Columns appear about 0.4 seconds sooner after a reload** when Following is the default: the hold that kept the For you posts from flashing before Following was only released every half second; it now is the moment Following is up (in the test page, first posts at about 0.33 seconds, was 0.73).
- The Show list and the bar's other choices are right from the first card, not half a second later.

## 0.24.0
- **Comments in the panel keep loading as you scroll.** When the end of the list comes into view the next page is fetched and added below, without moving what you are reading, until X has no more (a small "Loading more comments…" line shows at the end meanwhile, with Try again if X sends nothing). X sends further pages when its own post page is scrolled, so the hidden page is taken to the post and scrolled in steps; pages that arrive early, late or twice are merged, not replaced. It gives way if another post's comments are waiting, and stops when the panel is closed.
- **Comments that never loaded** (about half of the visits in your last diagnostics ran 11 to 14 seconds and never opened the post): the link is now found afresh right before it is pressed (X swaps its list's elements as the hidden page scrolls), and if X still ignores it, X's own router is asked to go to the post. Failed visits are recorded with a reason (`commentFailures` in Copy diagnostics, and a `FAILED` line in `trace`). Unverified on real X: whether its router follows the request.
- **"Skip X's age check on sensitive media" is on by default** (it worked for you).
- **Back pressed while a comments visit is under way now closes the panel** (it used to land on the panel's own history entry and do nothing).

## 0.23.4
- Removed the setting "Show a Quotes link under posts that have been quoted": nothing read it, so it did nothing.
- The check that notices X's own page showing through now runs about every 1.2 seconds and never while you are scrolling (it was every 0.4 seconds), so it costs nothing you can feel.

## 0.23.3
- **Copy diagnostics now includes a log of what happened** (`trace`: panels opened and closed, visits to X's post pages, Backs pressed and answered, freezes, pins given up, layout shifts, and a `LEAK` line whenever X's own timeline, menu or sidebar is showing through the columns). One paste shows what a recording would.
- **Back right after a comments visit now closes the panel.** A Back within 1.5 seconds of a visit ending was taken for our own and ignored; our own Backs are counted exactly, so that guess is gone. If the panel opens while a visit is running, its history entry is added as soon as the visit has ended, so Back still closes it.
- **Finding a post far down X's hidden list is faster** (bigger steps when far away; still steps, never a leap). Your diagnostics showed one such lookup at 2.3 seconds.

## 0.23.2
- **Copy diagnostics is back as a menu item**: a post's `...` menu now has "Copy diagnostics" (copies the details, opens nothing) above "Report a problem" (which opens the issue page and copies them too).

## 0.23.1
- **Comments start loading sooner.** Resting the pointer on a post now starts fetching its comments after 0.4 seconds (0.25 on its comment button), was 0.9 and 0.5, so by the time you click they are usually already there (about 0.1 seconds in the test page). The background budget goes from 6 to 8 lookups a minute, and still stops for 15 minutes if X starts refusing. A background lookup that is still waiting in line when you open a post gives way to it.
- **Copy diagnostics now says where comment time goes** (`commentTimes`: waiting in line, finding the post, X opening it, X's answer, per request), so the next speed-up is based on your machine.

## 0.23.0
- **Comments appear the moment they arrive.** They used to wait until X's hidden page had gone back from the post's page, which in Zen can take seconds (with a 2.6 second Back, comments came after 2.3 to 3.9 seconds; now 0.1 to 0.9 seconds whatever the Back does). The hidden page finishes stepping back behind them. Asking for the same post's comments again while they are on their way now waits for that same request.
- **Finding the post on X's hidden side is quicker**: it takes the post the moment X has drawn it instead of waiting out a fixed pause at each step (first comments on a post you haven't rested on: about 0.85 seconds in the test page, was 1.3).
- **A light blur behind an open post** (3px, with the dim a little lighter). Option: "Blur the columns behind an open post". If the first moments of an opening drop frames it goes off by itself for the session, and after three such openings it is switched off in the settings. Not applied if your system asks for reduced transparency.

## 0.22.5
- **"Turn Columns Off" no longer goes wacky when you open a post.** It lives inside X's menu, so the still copy of the menu (added in 0.22.3) contained a second, unstyled copy of it: a dark box with an oversized icon. The copy now leaves it out, and the real button stays where it is.

## 0.22.4
- **An open post now sits over X's menu and sidebar** (they were drawn above it, undimmed).
- **The sidebar and menu no longer drop out while a post is open.** The check that they are still pinned took the open panel covering them for a broken pin, gave up after a few seconds, handed them back to X's own placement, and re-pinned them about ten seconds later. The same applied to the full-size picture viewer and to toasts. Anything of ours covering them is now fine.

## 0.22.3
- **The panel no longer closes by itself while its comments load.** The visit to X's post page ends with a Back; Zen can take several seconds to answer it, and the answer was taken for you pressing Back, which closed the panel (and the reopening and closing looked like flashing). The panel now keeps count of the Backs it pressed itself and ignores their answers however late, and ignores any answer that lands on its own history entry.
- **The left menu no longer disappears while comments load.** The right sidebar already had a still copy shown for the duration of a visit; the menu now has one too, and the pin check no longer mistakes the hidden original for a broken pin (which had been dropping the menu back to X's own placement after a visit).

## 0.22.2
- **No flash of X's own page on reload.** On a page where the columns were showing, X's own timeline, menu and sidebar are kept out of sight from the first moment of the load until the columns take over (they used to show for the first second or so, then the menu jumped to its pinned place). It lasts at most 6 seconds if the extension never starts, and only on a page the columns were already on.
- **The post panel no longer jumps as comments arrive** (posts without a picture): it now grows downwards from a fixed top instead of re-centring.
- **Stepping into a comment and back keeps the panel's shape**: a comment without a picture of its own keeps the post's picture on the left, and the old panel goes at once, so there is never a second dimmed backdrop on top of the first.
- While X's hidden page is busy for us, its menu and sidebar are hidden even if they have been rebuilt and not yet pinned.

## 0.22.1
- **Bookmark, copy link and views on comments**, in the list and in a comment's own view. Bookmark presses X's own button on that comment, like Like does.
- **Skip X's age check now acts before X starts.** The setting is kept where the page hook can read it at once, X's starting state has the flag switched off before its app reads it, and the lookup is still covered afterwards. The hook reports what it managed (Copy diagnostics, field `ageFlag`; also logged to the console as "[xmc] age flag"). Reload X once after turning it on.

## 0.22.0
- **Comments open in the panel like posts.** Press a comment's words and it opens with its picture large on the left, its own replies (the ones X sent with the post), a reply box and Like on the right, with "Back to the post" and Esc returning to the post. Pressing a comment's picture opens it full size, in the post or in a comment.
- **Option: Skip X's age check on sensitive media** (off by default). It turns off X's own age-verification flag in your browser (the same flag Control Panel for Twitter turns off), so X shows its older "sensitive content" notice, which the Sensitive media setting already handles. Reload X after changing it.
- Comments and the comment view get a "Translate post" button for other languages; it opens X, where translation works.

## 0.21.3
- **Closing the post panel no longer takes you to an older page.** Going Back is slow in Zen, and the tidy-up pass saw our history entry still there and stepped Back a second time, past Home onto whatever you had open before (X's own post page, columns hidden, for several seconds). It now waits for the first step to finish.
- **X's "Age-restricted adult content" box is never pressed.** Its Show only opens X's "Confirm age in X mobile app" dialog unless the account is age-verified, so Show can't reveal it; Sensitive media: Hide still removes the box (and the picture) on posts, replies and profiles, and matches X's wording more loosely. The ordinary "sensitive content" notices are still pressed by Show.
- The extra step back after a comments visit only happens when what is left is our own history entry.

## 0.21.2
- **Clicking a post while its comments were already loading in the background** (which starts when you rest the pointer on a card) no longer leaves X's own post page showing with the columns hidden and no comments. The panel only adds its Back entry when X's hidden side is on neither a post's page nor on its way to one, and the visit takes one more step back if it is still on the post's page.
- **Comments that can't load say why.** If X refuses the request (rate limit), the panel says so, with Try again and Report a problem. A request that takes more than 30 seconds gives up the same way.
- **Less background lookup.** Resting on a post, and finding the post a reply answers, share one small budget (6 a minute) and stop for 15 minutes if X starts refusing them; the ones you ask for are never held back.
- **"Age-restricted adult content" on X's own post pages** is now handled by the sensitive-media setting: Show presses X's Show, Don't show leaves the box out. This is written from X's wording, not from X's page: if it still gets in the way, send "Report a problem".

## 0.21.1
- The post a reply answers is set in the same larger type as a short reply that is only words (it had stayed small next to it).

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
