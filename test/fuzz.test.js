const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../src/parse.js');
const F = require('./fixtures.js');

// X changes its data without notice. Whatever comes back, the parser gives posts or nothing and never throws (a throw is a page that stops loading).
// The same kind of damage as in sample.test.js (which does it to a timeline recorded from X), done to the synthetic timelines and to a people list.
function damager(seed) {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const junk = [null, undefined, '', 'x', 0, -1, 1e21, true, [], {}, [null], { result: null }, { __typename: 'TweetTombstone' }, { rest_id: 5 }];
  const damage = (v, p) => {
    if (v && typeof v === 'object') for (const k of Object.keys(v)) { if (rnd() < p) { if (rnd() < 0.3) delete v[k]; else v[k] = junk[Math.floor(rnd() * junk.length)]; } else damage(v[k], p); }
    return v;
  };
  return damage;
}
const people = () => ({ data: { user: { result: { timeline: { timeline: { instructions: [{ type: 'TimelineAddEntries', entries: [1, 2, 3, 4, 5].map((n) => ({ entryId: 'user-' + n, content: { entryType: 'TimelineTimelineItem',
  itemContent: { itemType: 'TimelineUser', user_results: { result: { __typename: 'User', rest_id: String(n), core: { name: 'P' + n, screen_name: 'p' + n }, avatar: { image_url: 'https://pbs.twimg.com/a_normal.jpg' },
    relationship_perspectives: { following: true }, legacy: { description: 'bio' } } } } } })) }] } } } } } });

test('damaged timelines and people lists: the parser never throws', () => {
  const cases = [
    ['HomeTimeline', () => F.homeTimeline()],
    ['Followers', people],
    ['FollowersYouKnow', people],
  ];
  let rounds = 0;
  for (const [op, make] of cases) {
    const damage = damager(op.length * 7919);
    for (let i = 0; i < 300; i++) {
      const copy = damage(JSON.parse(JSON.stringify(make())), [0.003, 0.02, 0.06][i % 3]);
      assert.doesNotThrow(() => { P.parseResponse(copy, 'https://x.com/i/api/graphql/abc/' + op + '?variables=%7B%7D'); rounds++; }, op + ' damaged (round ' + i + ')');
    }
  }
  assert.equal(rounds, 900);
});

test('key choices saved as text, however damaged: bindings and panel keys fall back to the defaults, never throw, never share a key', () => {
  const K = require('../src/keys.js');
  const S = require('../src/settings.js');
  const bad = ['', '{', 'null', '[]', '"x"', '5', '{"like":5}', '{"like":["f"]}', '{"like":"__proto__"}', '{"__proto__":{"like":"z"}}', '{"constructor":"x"}', JSON.stringify({ like: 'x'.repeat(5000) }),
    JSON.stringify({ like: 'a b c' }), JSON.stringify({ like: 'j', bookmark: 'j' }), JSON.stringify({ like: 'g', top: 'g g' }), JSON.stringify(Object.fromEntries(Array.from({ length: 500 }, (_, i) => ['k' + i, 'a']))), '\u0000', '{"like":"\u0000"}'];
  for (const text of bad) {
    let b, m;
    assert.doesNotThrow(() => { b = K.bindings(text); m = S.panelKeyMap(text); }, JSON.stringify(text).slice(0, 40));
    const seen = new Map();
    for (const [act, toks] of Object.entries(b)) {
      assert.ok(Array.isArray(toks) && toks.length >= 1 && toks.length <= 2, act);
      const key = toks.join(' ');
      for (const [other, ot] of seen) assert.ok(!(key === ot || key.startsWith(ot + ' ') || ot.startsWith(key + ' ')), `${act} (${key}) clashes with ${other} (${ot}) for ${JSON.stringify(text).slice(0, 40)}`);
      seen.set(act, key);
    }
    assert.equal(({}).like, undefined, 'nothing reached Object.prototype');
    assert.ok(m && typeof m === 'object');
  }
});
