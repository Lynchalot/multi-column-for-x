'use strict';
// Makes store pictures from your own screenshots of X: takes off the window's dark margin, blurs the places named in store/own-shots.json (your own profile at the
// bottom of X's menu, say) and writes store/screenshots/own/<name>.png at 1280 wide, which make-slides.js then uses in place of the generated shot of that name.
//   node store/prepare-own.js <folder with your screenshots>
// The originals are never copied into the repository: only the blurred results are. Each entry of own-shots.json: { "src": file in the folder, "name": the slide's file name,
// "blur": [[x, y, width, height], ...], "y": where the cut starts, "x" and "w": a narrower cut, for a close-up } in the original's pixels. The slide's picture is 16:10, so a
// taller window is cut to that shape from the line `y` (the window's own edge, 8, if there is none): choose it so that what the slide is about is inside. A shot already 16:10
// is left whole. "parts": [{ "src", "x", "w", "blur" }, ...] sets several shots side by side, each cut to its own x and w (the same y and height), with a thin line between
// (two themes in one picture, say). Needs ImageMagick (convert).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dir = process.argv[2];
if (!dir) { console.error('usage: node store/prepare-own.js <folder with your screenshots>'); process.exit(2); }
const OUT = path.join(__dirname, 'screenshots', 'own');
fs.mkdirSync(OUT, { recursive: true });
const shots = JSON.parse(fs.readFileSync(path.join(__dirname, 'own-shots.json'), 'utf8'));
const MARGIN = 8; // (the window's own dark edge in a full-window capture)
const GAP = 3; // (the line between parts)
const mosaic = ([x, y, bw, bh]) => ['-region', `${bw}x${bh}+${x}+${y}`, '-scale', '6%', '-scale', '1667%', '-blur', '0x6', '+region']; // (a coarse mosaic, then a blur: nothing of a face or a name is left)
const size = (file) => execFileSync('identify', ['-format', '%w %h', file + '[0]'], { encoding: 'utf8' }).trim().split(' ').map(Number);
for (const s of shots) {
  const out = path.join(OUT, s.name + '.png');
  if (s.parts) {
    const files = s.parts.map((q) => path.join(dir, q.src));
    if (files.some((f) => !fs.existsSync(f))) { console.log('missing', s.name); continue; }
    const total = s.parts.reduce((n, q) => n + q.w, 0), h = size(files[0])[1];
    const ch = Math.min(h - 2 * MARGIN, Math.round(total / 1.6)), top = Math.max(MARGIN, Math.min(s.y || MARGIN, h - MARGIN - ch));
    const args = [];
    s.parts.forEach((q, i) => {
      if (i) args.push('(', '-size', `${GAP}x${ch}`, 'xc:#8590a6', ')');
      args.push('(', files[i] + '[0]');
      for (const r of q.blur || []) args.push(...mosaic(r));
      args.push('-crop', `${q.w}x${ch}+${q.x}+${top}`, '+repage', ')');
    });
    args.push('+append', '-resize', '1280x', '-strip', 'PNG24:' + out);
    execFileSync('convert', args);
    console.log('wrote', s.name);
    continue;
  }
  const src = path.join(dir, s.src);
  if (!fs.existsSync(src)) { console.log('missing', s.src); continue; }
  const [w, h] = size(src);
  const args = [src + '[0]'];
  for (const r of s.blur || []) args.push(...mosaic(r));
  const cw = s.w || w - 2 * MARGIN, ch = Math.min(h - 2 * MARGIN, Math.round(cw / 1.6)), top = Math.max(MARGIN, Math.min(s.y || MARGIN, h - MARGIN - ch));
  const left = Math.max(MARGIN, Math.min(s.x || MARGIN, w - MARGIN - cw));
  args.push('-crop', `${cw}x${ch}+${left}+${top}`, '+repage', '-resize', '1280x', '-strip', 'PNG24:' + out);
  execFileSync('convert', args);
  console.log('wrote', s.name);
}
