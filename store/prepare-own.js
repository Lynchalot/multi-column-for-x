'use strict';
// Makes store pictures from your own screenshots of X: takes off the window's dark margin, blurs the places named in store/own-shots.json (your own profile at the
// bottom of X's menu, say) and writes store/screenshots/own/<name>.png at 1280 wide, which make-slides.js then uses in place of the generated shot of that name.
//   node store/prepare-own.js <folder with your screenshots>
// The originals are never copied into the repository: only the blurred results are. Each entry of own-shots.json: { "src": file in the folder, "name": the slide's file name,
// "blur": [[x, y, width, height], ...] in the original's pixels }. Needs ImageMagick (convert).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = process.argv[2];
if (!dir) { console.error('usage: node store/prepare-own.js <folder with your screenshots>'); process.exit(2); }
const OUT = path.join(__dirname, 'screenshots', 'own');
fs.mkdirSync(OUT, { recursive: true });
const shots = JSON.parse(fs.readFileSync(path.join(__dirname, 'own-shots.json'), 'utf8'));
const MARGIN = 8; // (the window's own dark edge in a full-window capture)
for (const s of shots) {
  const src = path.join(dir, s.src);
  if (!fs.existsSync(src)) { console.log('missing', s.src); continue; }
  const [w, h] = execFileSync('identify', ['-format', '%w %h', src + '[0]'], { encoding: 'utf8' }).trim().split(' ').map(Number);
  const args = [src + '[0]'];
  for (const [x, y, bw, bh] of s.blur || []) args.push('-region', `${bw}x${bh}+${x}+${y}`, '-scale', '6%', '-scale', '1667%', '-blur', '0x6', '+region'); // (a coarse mosaic, then a blur: nothing of a face or a name is left)
  args.push('-crop', `${w - 2 * MARGIN}x${h - 2 * MARGIN}+${MARGIN}+${MARGIN}`, '+repage', '-resize', '1280x', '-strip', 'PNG24:' + path.join(OUT, s.name + '.png'));
  execFileSync('convert', args);
  console.log('wrote', s.name);
}
