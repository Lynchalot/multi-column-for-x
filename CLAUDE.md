# Multi-Column for X: notes for whoever (or whatever) works on this next

Firefox/Zen MV3 extension that shows X/Twitter in masonry columns. Public repo, MIT, on addons.mozilla.org (v0.9.2 was submitted and awaits review; the repo is at 0.10.0).
The owner uses Zen on Linux with a ~3400px-wide screen and Vimium. Nobody working here can log in to X: nothing is verified against real X, only against the stand-in x.com in `test/e2e/mock/`. Say so when you report, and ask for "Copy diagnostics" output (the ⚠ button in the top bar, or a post's ... menu) when something fails on real X.

## Run it
- `npm test` unit tests (node:test, no dependencies). `npm run test:e2e` drives the real scripts in headless Chrome against the mock (needs Chrome, or set `XMC_BROWSER`; `npm ci` first). `npm run mock` serves the mock at http://127.0.0.1:8766/home/. `npm run lint` (web-ext), `npm run build` (zip).
- CI (GitHub Actions, Node 22) runs all of it; after pushing check `gh run list --limit 1`. On Node 22 the test script must be `node --test "test/*.test.js"` (a bare directory fails).
- npm can hang on a network without IPv6: use `NODE_OPTIONS=--dns-result-order=ipv4first`.

## Architecture
`src/hook.js` (world MAIN) copies the timeline JSON X already downloads -> `src/parse.js` -> `src/main.js` draws its own cards. `src/settings.js` is the one schema (the options page is generated from it; save only non-default values; bump `VERSION` and list the key when a default changes). `src/logic.js` is pure and unit-tested. `src/site.js` does sidebar/branding CSS tweaks. X's own page stays loaded but hidden (opacity 0) and is driven: scrolling it makes X paginate (`pump`), its real buttons do like/repost/bookmark/reply, and comments are fetched by clicking X's own post link and going back.
Debug in the console with `window.__xmc`.

## Rules learned the hard way
- Never replace or reset what the person is looking at automatically; new posts wait behind the "N new" button. Nothing may jump.
- Never set `overflow: hidden/clip` on html or body (X's hidden page then can't scroll and loading dies). Use `scrollbar-width: none`.
- Don't name a variable `history` or `location` in main.js. Don't use requestAnimationFrame for anything that must complete. Don't call X's private API directly for actions.
- Scroll X's hidden page by walking, not leaping. `renderFeed` must never run while X's hidden side is on a post page.
- The columns background must stay X's own (it can be transparent): never force a solid colour.
- Keep settings text short and plain. The owner dislikes explanatory AI-style sentences and quick-settings popovers.
- Card heights: recycled cards keep their exact measured height (don't round). `t.elSig` records how a card was built; stamp it only when creating the card.
- `t.id` of a repost is the ORIGINAL post's id.
- Never `git add -A`. Never commit a different add-on ID: the AMO ID is `multi-column-for-x@lynchalot.github.io` and can't change.
- Verify before saying something is fixed: reproduce it, run the tests, look at the output. The owner tests on real X straight away.

## Shelved
- **Post size (Compact / Text only):** built and tested but switched off because the Compact layout is wrong. `DENSITY_SHELVED` in `src/main.js`, `density` is `hidden: true` in `src/settings.js`, one e2e test is skipped (`POST_SIZE_SHELVED`). Bring it back only when asked, and fix the Compact layout first.
- Translation (0.25.0): the Translate button takes X's hidden page to the post (or, for a comment, to its post and then the comment), presses X's own "Translate post" control (found by its label, `translateControl`) and reads the words off X's page once "Translated from ..." shows. Written from X's wording, not its markup (nobody working here can see real X): if it fails the button turns into "Translate on X" and the trace has a `translate FAILED` line with the reason. Ask for Copy diagnostics, and for the outer HTML of X's Translate control and of a translated post. Keyboard browsing (J/K/L) was declined.

## Added in 0.12.0
Thread folding (`XMCLogic.threadPlan`, `renderThread`, `view.drawnIds`: a reply to themselves is skipped while its first post will be drawn; `t.thread` is set at draw time and `card.dataset.thr` rebuilds the card when it changes), tall-photo cap (`photoFloor`), remembered volume (`volumechange` only counts while the person is using the player), presets (`XMCSettings.PRESETS`, shown by options.js, opened on install by background.js). Picture-in-picture is Firefox's own (no web API for extensions), so there is nothing to build; the off-screen auto-pause can end a PiP video when the card scrolls away.

## Next up
Done in 0.11.0: like and reply on individual comments (`actOnComment` opens the post on X's hidden side, finds the comment by id, presses X's own button, goes back), reply box at the top. Not verified on real X: if a comment's like or reply fails there, ask for "Copy diagnostics".
Ideas to suggest: the post author's own replies marked, "show more replies" (only ~60 are listed), collapsing long threads, jump to a reply's parent.

## Learned in 0.21 to 0.23 (all found on real X or from the owner's recordings)
- History: the panel pushes `{xmcView:true}`; every Back we press goes through `stepBack` and is counted in `ownBacks`, and its popstate is ignored however late (Zen can take seconds). Never guess by time. A visit that starts while the panel opens gets its entry added afterwards (`ensurePanelEntry`).
- The pinned menu and sidebar are `z-index: 6`; the columns root is 5, and 20 while a post is open (`#xmc-root:has(> .xmc-view)`), so the panel sits over them. The pin check (`probeOk`) must treat our own panel, toast, viewer and still copies as fine, or it gives up and un-pins them after three passes.
- During a visit X rebuilds its menu and sidebar: both get a still copy (`freezeSidebar`, ids `xmc-sidefreeze`, `xmc-navfreeze`; the copy loses ids and `role`, and our pill is left out of it). Don't probe or re-pin while frozen.
- `src/hook.js` hides X's timeline, menu and sidebar from document start on a page where columns were showing (`localStorage.xmcVeil` = the path), lifted by the first tick; 6 s safety timer. Also reads `xmcSkipAge` before X boots.
- Comments are handed over the moment X answers (`opts.early`); the hidden page steps back behind them. One request per post (`repliesInflight`). Real-X timings (Copy diagnostics, `commentTimes`): X's own answer is 0.65 to 1.05 s of ~0.8 to 1.2 s; finding a far post once took 2.3 s.
- Copy diagnostics (a post's ... menu) carries `trace`, a rolling event log with `LEAK` lines when X's own page shows through. Ask for it before asking for a recording.
- The skip-age-check flag is `rweb_age_assurance_flow_enabled` (the technique Control Panel for Twitter uses). Untested against a real age-restricted post; `ageFlag` in the diagnostics says what the hook managed.

## Added in 0.28.0
Side panels fold (`settings.leftPanel` 'rail', `settings.rightPanel` 'hidden'; html classes `xmc-rail`, `xmc-sidehide`, `xmc-panelanim`). (0.30.0 replaced the menu button with X's logo: `syncLogoToggle`, `[data-xmc-logo]`, a capture-phase click and Space handler; the logo is `header h1 a[href="/home"]`, put back to a plain link when the columns are off. Not seen on real X.) The names are the link's second inner box (`a > div > div:nth-child(n+2)`), the right panel slides with `--xmc-sx`, and everything settles (`settlePanels`, 360 ms) by un-pinning and re-pinning so the header's width is re-measured: a folded header that keeps its old width sits over the first column and eats clicks. Not seen on real X: the inner structure of its menu links, the Post button and Columns pill folded, the edge tab's place. Mock-ups were an artifact (variants A/B/C); A was chosen.

## Added in 0.29.0
Start-up motion (`xmc-boot` on html while X's menu and sidebar fade in as the veil lifts; `xmc-first` on `.xmc-cols` for the first draw only, `booted` in `enterCols`; both removed by a timer, `first-draw` and `veil-lifted` in the trace), text size (`textSize`, `--xmc-ts` on `#xmc-root`; every font-size in posts and the panel is `calc(Npx * var(--xmc-ts, 1))`, so a new rule should be written that way; the top bar is left alone; `textSize` is in `RENDER_KEYS` so cards are rebuilt), settings search and Reset (options.js: `data-key`, `data-find`, `applyFind`, `refreshMarks`, `resetItem`), and `test/e2e/a11y.js`, the audit of target size (24 px, with WCAG 2.5.8's two exceptions) and names. A new button or link must pass it: the test fails by naming the element. Card avatars are `aria-hidden` and `tabindex=-1` on purpose (the name beside them goes to the same place).

## Added in 0.29.1
The Columns pill follows `active` (the columns being up), not the address: during a visit the address is a post's and `eligible()` is false, which hid the pill for the length of every visit. Anything else that asks `eligible()` while X's hidden page may be away on a post has the same trap (`peeking`/`active` already hold the columns). X translates posts itself: `harvestTranslations` reads X's own translated words from its hidden page into `translations` (only when X says "Translated from" or shows "Show original"; English wording only, not seen on real X: `autoTranslate` in the diagnostics says whether it took anything), and the panel and comments show those at once.

## Added in 0.30.0
Translation is `translateOnX` (dedupe by post id in `xlateRuns`) over two ways of doing it: riding the comments visit (`xlateWaiting`, served in `fetchRepliesVisit` after the comments are handed over, settled by `settleXlate` at every early exit and in `fetchReplies`'s `finally`, so nothing waits forever) or, when the comments are cached, a visit of its own (`translateVisit`); the steps on X's page are `translateHere`. `warmTranslate` starts one when a Translate button has been pointed at for 150 ms (panel and comment buttons in `wireTranslate`, a card's button by delegation on `colsEl`). A failed warm try is reported with `warm: true` and the press tries again. Not seen on real X.
