'use strict';
// The beta channel's package: the Firefox package with an update_url, so a copy signed as "unlisted" keeps itself up to date from GitHub.
//   node scripts/build-beta.js   ->  dist/beta/ (the folder web-ext signs)
// The listed add-on on addons.mozilla.org must not have an update_url (Mozilla serves its updates), so this is a separate build, never uploaded there.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const out = path.join(root, 'dist', 'beta');
const URL_ = process.env.XMC_UPDATE_URL || 'https://raw.githubusercontent.com/Lynchalot/multi-column-for-x/main/updates.json';
fs.rmSync(out, { recursive: true, force: true });
const copy = (from, to) => { fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true }); fs.copyFileSync(path.join(root, from), path.join(out, to)); };
for (const f of ['background.js', 'options.html', 'options.css', 'options.js', 'popup.html', 'icons/icon.svg']) copy(f, f);
for (const f of fs.readdirSync(path.join(root, 'src'))) copy('src/' + f, 'src/' + f);
const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
m.browser_specific_settings.gecko.update_url = URL_;
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
console.log('dist/beta (' + m.version + ') updates from ' + URL_);
