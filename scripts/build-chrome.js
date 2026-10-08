'use strict';
// The Chrome (and Edge) package, from the same files as the Firefox one: dist/chrome/ and web-ext-artifacts/multi_column_for_x-chrome-<version>.zip.
//   node scripts/build-chrome.js          (add --no-zip to leave just the folder, which is what "Load unpacked" and the tests take)
// What differs: the background is a service worker (chrome/background-sw.js loads the same scripts), the icons are PNG (chrome/icons/), and
// the Firefox-only keys are left out.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const out = path.join(root, 'dist', 'chrome');
const copy = (from, to) => { fs.mkdirSync(path.dirname(path.join(out, to)), { recursive: true }); fs.copyFileSync(path.join(root, from), path.join(out, to)); };

fs.rmSync(out, { recursive: true, force: true });
for (const f of ['background.js', 'options.html', 'options.css', 'options.js', 'popup.html', 'icons/icon.svg']) copy(f, f);
for (const f of fs.readdirSync(path.join(root, 'src'))) copy('src/' + f, 'src/' + f);
copy('chrome/background-sw.js', 'background-sw.js');
for (const n of [16, 32, 48, 128]) copy(`chrome/icons/icon-${n}.png`, `icons/icon-${n}.png`);

const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
delete m.browser_specific_settings; // (Firefox's add-on id and data-collection declaration)
m.minimum_chrome_version = '111'; // (content scripts in the page's own world)
m.background = { service_worker: 'background-sw.js' };
const png = (sizes) => Object.fromEntries(sizes.map((n) => [String(n), `icons/icon-${n}.png`]));
m.icons = png([16, 32, 48, 128]);
m.action = Object.assign({}, m.action, { default_icon: png([16, 32, 48, 128]) });
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(m, null, 2) + '\n');
console.log('dist/chrome (' + m.version + ')');

if (!process.argv.includes('--no-zip')) {
  execFileSync('npx', ['--yes', 'web-ext', 'build', '--source-dir', out, '--artifacts-dir', path.join(root, 'web-ext-artifacts'), '--filename', 'multi_column_for_x-chrome-' + m.version + '.zip', '--overwrite-dest'], { stdio: 'inherit' });
}
