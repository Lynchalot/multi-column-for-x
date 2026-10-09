const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../src/parse.js');
const L = require('../src/logic.js');
const Sample = require('../src/sample.js');
const F = require('./fixtures.js');

const HOME = 'https://x.com/i/api/graphql/abc123/HomeTimeline?variables=%7B%7D';

test('a sample keeps the shape of a timeline (the parser reads as many posts from it) and none of the words', () => {
  const raw = F.homeTimeline();
  const clean = Sample.sanitizeJson(raw);
  const a = P.parseResponse(raw, HOME), b = P.parseResponse(clean, HOME);
  assert.equal(b.items.length, a.items.length, 'as many posts');
  assert.deepEqual(b.items.map((t) => t.id), a.items.map((t) => t.id), 'with the same ids');
  const out = JSON.stringify(clean);
  const words = [];
  (function walk(n, k) { if (Array.isArray(n)) n.forEach((x) => walk(x, k)); else if (n && typeof n === 'object') for (const kk of Object.keys(n)) walk(n[kk], kk); else if (typeof n === 'string' && /\s/.test(n) && n.length >= 8 && !/^\w{3} \w{3} \d/.test(n)) words.push(n); })(raw); // (a date in X's form is kept on purpose)
  assert.ok(words.length > 3, 'the fixture has some sentences');
  for (const w of words) assert.ok(!out.includes(w), 'a sentence is still there: ' + w);
  for (const t of a.items) assert.ok(!out.includes('"' + t.author.handle + '"'), 'a handle is still there: ' + t.author.handle);
});

test('a sample\'s strings are the same length as the words they replace (a post\'s links and mentions are found by position)', () => {
  const s = Sample.sanitizeJson({ legacy: { full_text: 'café 😀 hello there', lang: 'en', created_at: 'Wed Oct 04 12:00:00 +0000 2026', id_str: '12345' } });
  assert.equal(Array.from(s.legacy.full_text).length, Array.from('café 😀 hello there').length);
  assert.notEqual(s.legacy.full_text, 'café 😀 hello there');
  assert.equal(s.legacy.lang, 'en'); assert.equal(s.legacy.id_str, '12345'); assert.match(s.legacy.created_at, /^Wed Oct 04/);
});

// Samples taken from real X (test/fixtures/real/README.md): every one in the folder is read the way the extension reads X.
const dir = path.join(__dirname, 'fixtures', 'real');
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.json$/.test(f)) : [];
test('samples from real X: the parser reads the timelines and conversations, and the buttons are still found by the ids we press', (t) => {
  if (!files.length) return t.skip('no samples yet (test/fixtures/real/README.md)');
  for (const f of files) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.equal(s.kind, 'multi-column-for-x sample', f);
    for (const [op, { url, json }] of Object.entries(s.ops || {})) {
      if (json && json.truncated) continue;
      if (op === 'TweetDetail') { // (a conversation is read for the post it is about, which X puts in the address, and a sample does not keep: the conversation's own number will do)
        const m = /"conversation_id_str":"(\d+)"/.exec(JSON.stringify(json)), focal = m ? m[1] : '';
        const d = P.parseDetail(json, url + '?variables=' + encodeURIComponent(JSON.stringify({ focalTweetId: focal })), focal);
        assert.ok(d && d.replies.length, f + ': ' + op + ' could not be read for post ' + focal);
        continue;
      }
      const r = P.parseResponse(json, url + '?variables=%7B%7D');
      if (r) assert.ok(r.items.length > 0, f + ': ' + op + ' gave no posts (' + JSON.stringify(r.seen) + ')');
    }
    for (const [kind, html] of Object.entries(s.controls || {})) {
      if (!L.CONTROLS[kind]) continue;
      assert.ok(L.CONTROLS[kind].some((id) => html.includes('data-testid="' + id + '"')), f + ': none of ' + L.CONTROLS[kind].join('/') + ' is in the ' + kind + ' markup');
    }
  }
});
