'use strict';
// Writes updates.json, the file a self-hosted (unlisted) Firefox add-on asks for updates (the manifest's update_url points at it).
//   node scripts/make-updates.js <version> <path-to-signed.xpi> <url-the-xpi-will-be-at>   [--file updates.json]
// It keeps the versions already in the file and adds this one (or replaces it). Used by .github/workflows/beta.yml.
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const fileArg = process.argv.indexOf('--file');
const file = fileArg > 0 ? process.argv[fileArg + 1] : path.join(__dirname, '..', 'updates.json');
const [version, xpi, link] = args;
if (!version || !xpi || !link) { console.error('usage: make-updates.js <version> <xpi> <url> [--file updates.json]'); process.exit(2); }
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8'));
const id = manifest.browser_specific_settings.gecko.id;
const min = manifest.browser_specific_settings.gecko.strict_min_version || '140.0';
const doc = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { addons: {} };
const list = ((doc.addons[id] || {}).updates || []).filter((u) => u.version !== version);
list.push({ version, update_link: link, update_hash: 'sha256:' + crypto.createHash('sha256').update(fs.readFileSync(xpi)).digest('hex'), applications: { gecko: { strict_min_version: min } } });
list.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
doc.addons[id] = { updates: list };
fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
console.log(file + ': ' + list.map((u) => u.version).join(', '));
