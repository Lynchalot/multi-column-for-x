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
- In-column translation was deleted (the Translate button opens the post). Keyboard browsing (J/K/L) was declined.

## Next up
Done in 0.11.0: like and reply on individual comments (`actOnComment` opens the post on X's hidden side, finds the comment by id, presses X's own button, goes back), reply box at the top. Not verified on real X: if a comment's like or reply fails there, ask for "Copy diagnostics".
Ideas to suggest: the post author's own replies marked, "show more replies" (only ~60 are listed), collapsing long threads, jump to a reply's parent.
