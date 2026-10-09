# Putting Multi-Column for X on Firefox

What is already done: `web-ext lint` is clean (0 errors, 0 warnings), the zip builds with only the 14 files that run (no tests or docs),
listing text / reviewer notes / icon are in `store/`, privacy policy is `PRIVACY.md`, licence is MIT.

## 1. Decide three things before the first upload
1. **Add-on ID** (in `manifest.json`, `browser_specific_settings.gecko.id`): `multi-column-for-x@lynchalot.github.io`. It can never change after the first
   upload, and Mozilla keeps the ID of a deleted add-on reserved for good: if you ever delete the add-on, the next one needs a new ID.
   (The first ID, `x-multicolumn@lynchalot.local`, was burned by a deleted unfinished upload.)
2. **Name.** "Multi-Column for X" follows the pattern of other "for X/Twitter" add-ons. If a reviewer objects to the trademark, the fallback
   is "Multi-Column for X (unofficial)". The listing already says "Not affiliated with X Corp."
3. **Version.** Use 1.0.0 for the first public upload, once you have used the current build on real X for a day or two.
   (Set it in `manifest.json` and `package.json`; every upload needs a higher number than the last.)

## 2. Accounts (about 10 minutes)
1. Firefox account (the one you use for Sync is fine), turn on two-step authentication if it asks.
2. https://addons.mozilla.org/developers/ -> sign in -> accept the Distribution Agreement and fill in a display name.
3. Make the GitHub repo public (the privacy policy and support links point at it):
   `gh repo edit Lynchalot/multi-column-for-x --visibility public --accept-visibility-change-consequences`

## 3. Get a signed copy for your own Zen today (unlisted, no waiting for review)
Firefox and Zen only keep an add-on across restarts if Mozilla has signed it. Unlisted signing is automatic and takes minutes.
1. `npm run lint` then `npm run build` -> `web-ext-artifacts/multi-column_for_x-<version>.zip`
2. Developer Hub -> **Submit a New Add-on** -> **On your own** -> upload the zip -> wait for validation -> download the signed `.xpi`.
   (Or from the terminal: get an API key and secret at https://addons.mozilla.org/developers/addon/api/key/ and run
   `npx web-ext sign --channel=unlisted --api-key=... --api-secret=...`. Never commit the secret.)
3. Zen: `about:addons` -> gear -> **Install Add-on From File...** -> pick the `.xpi`.
Note: an unlisted add-on does not update itself. After the public listing is approved, install from there instead (updates arrive automatically).

## 4. The public listing
1. Developer Hub -> **Submit a New Add-on** -> **On this site** -> upload the zip (same one).
2. "Do you need to submit source code?" -> **No** (nothing is minified or generated).
3. Compatibility: tick **Firefox for desktop**, untick **Firefox for Android**.
4. Listing details, all copy-paste from `store/listing.md`: name, summary, description, categories, tags, license (MIT),
   homepage, support site (the GitHub issues page), privacy policy (paste the text of `PRIVACY.md`), notes to reviewer.
5. Support / contributions link: your Ko-fi, https://ko-fi.com/falsehamartia
   (if the field refuses it, tell me; it only accepts certain donation sites).
6. Icon: `store/icon-128.png`. Screenshots: `store/screenshots/slides/01-…07-` (see `store/listing.md`;
   regenerate with `node store/make-screenshots.js` then `node store/make-slides.js`).
7. Submit. Automatic checks run first; a person usually reads the notes for add-ons that run on a big site like x.com, so
   it can take from a few days to a couple of weeks. Replies come by email: answer them in the Developer Hub thread.

## 5. After it is approved
- Tag a release on GitHub (`git tag v1.0.0 && git push --tags`) and attach the zip.
- Every update: bump the version in `manifest.json` and `package.json`, add a line to `CHANGELOG.md`, `npm test && npm run lint && npm run build`,
  upload the new zip to the same listing (Developer Hub -> the add-on -> Upload New Version). Users get it automatically.
- Add `docs/` screenshots to the README if you like; link the AMO page from the README and from Ko-fi.

## The beta channel (a fast lane for fixes)
The listed add-on waits in Mozilla's review queue for every version. A beta channel does not: Mozilla signs an "unlisted" version automatically in minutes, and an add-on built with an `update_url` then updates itself from a file on GitHub.
1. addons.mozilla.org -> Developer Hub -> **Manage API Keys**: make a key. In the GitHub repository: Settings -> Secrets and variables -> Actions -> add `AMO_JWT_ISSUER` (the "JWT issuer") and `AMO_JWT_SECRET`.
2. Bump the version in `manifest.json` and `package.json`, merge to `main`, then `git tag beta-v<that version> && git push origin beta-v<that version>`. The workflow `Beta` builds `dist/beta`, signs it (unlisted), attaches the `.xpi` to a GitHub release and adds it to `updates.json` on `main`.
3. Whoever wants fixes early installs the `.xpi` from the release page once (in place of the listed one: same add-on id). Firefox checks `updates.json` about once a day.
4. Nothing here touches the listed add-on, which must not carry an `update_url`. `.github/workflows/beta.yml` has not been run yet.

## 7. Chrome Web Store and Edge (0.31.0 and on)
1. `npm run build:chrome` -> `web-ext-artifacts/multi_column_for_x-chrome-<version>.zip` (the same version number as the Firefox one).
2. Chrome Web Store developer account (a one-off registration fee), then **New item** -> upload the zip. Edge Add-ons takes the same zip (free account).
3. The dashboard asks for, and these are the answers:
   - **Single purpose:** shows the X (Twitter) timeline in several columns and gives controls for reading it (filters, a post panel with comments, media download).
   - **Permission justifications:** `storage`: settings, download history, which posts you have read and a short event log, all kept on the device. `downloads`: the Download button saves the post's pictures or video. Host access to x.com and twitter.com: the site it enhances. pbs.twimg.com and video.twimg.com: the media files the Download button and the original-size view fetch.
   - **Remote code:** none. **Data usage:** collects none; tick the three certifications. Privacy policy URL: the raw `PRIVACY.md` on GitHub.
   - **Graphics:** the 128 px icon (`store/icon-128.png`), the 1280x800 slides (`store/screenshots/slides/`), and the small promo tile (440x280) the dashboard asks for: `store/chrome-promo-440x280.png` (made by `node store/make-promo.js`).
4. Chrome takes an unpacked folder for your own use at once: chrome://extensions -> Developer mode -> **Load unpacked** -> `dist/chrome`.
5. Review is usually a few days; a broad host permission on a big site gets read by a person.

## 6. Questions reviewers tend to ask (answers are already in the notes to reviewer)
- Why a script in the page's own world (`world: "MAIN"`)? To receive a copy of the JSON x.com already downloads. It changes nothing.
- How are comments loaded? x.com's own link to the post is clicked on its hidden copy of the timeline, the conversation is read from the JSON x.com downloads, and the page goes straight back.
- Why `downloads`? The Download button (only X's media hosts are accepted).
- Any remote code, analytics, obfuscation? None.
