const test = require('node:test');
const assert = require('node:assert');
const K = require('../src/keys.js');

const press = (key, o) => Object.assign({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false }, o);

test('a key press becomes a token', () => {
  assert.equal(K.token(press('j')), 'j');
  assert.equal(K.token(press('G', { shiftKey: true })), 'G');
  assert.equal(K.token(press('?', { shiftKey: true })), '?');
  assert.equal(K.token(press(' ')), 'Space');
  assert.equal(K.token(press(' ', { shiftKey: true })), 'S-Space');
  assert.equal(K.token(press('d', { ctrlKey: true })), 'C-d');
  assert.equal(K.token(press('D', { ctrlKey: true })), 'C-d');
  assert.equal(K.token(press('ArrowLeft')), 'Left');
  assert.equal(K.token(press('ArrowLeft', { shiftKey: true })), 'S-Left');
  assert.equal(K.token(press('Escape')), 'Esc');
  assert.equal(K.token(press('Enter')), 'Enter');
});

test('modifier-only presses, Alt, Meta, Ctrl+Shift and keys that are the browser’s give no token', () => {
  for (const k of ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp', 'PageDown', 'F5', 'Dead', 'Unidentified']) assert.equal(K.token(press(k)), '', k);
  assert.equal(K.token(press('j', { altKey: true })), '');
  assert.equal(K.token(press('j', { metaKey: true })), '');
  assert.equal(K.token(press('D', { ctrlKey: true, shiftKey: true })), '');
  assert.equal(K.token(null), '');
});

test('a sequence is one or two good tokens', () => {
  assert.deepEqual(K.parse('g g'), ['g', 'g']);
  assert.deepEqual(K.parse('  C-d '), ['C-d']);
  assert.deepEqual(K.parse('S-Space'), ['S-Space']);
  assert.equal(K.parse('g g g'), null);
  assert.equal(K.parse(''), null);
  assert.equal(K.parse('ab'), null);
  assert.equal(K.parse('C-D'), null);
  assert.equal(K.parse('Esc'), null); // (Esc is never bound)
  assert.equal(K.parse(5), null);
});

test('every action has a default, and the defaults do not clash', () => {
  const b = K.bindings('');
  for (const [act] of K.ACTIONS) assert.ok(b[act], act + ' has a key');
  const acts = K.ACTIONS.map(([a]) => a);
  assert.deepEqual(Object.keys(K.VIM).sort(), acts.slice().sort());
  for (const x of acts) for (const y of acts) if (x < y) assert.ok(!K.clashes(b[x], b[y]), x + ' and ' + y + ' clash');
  assert.deepEqual(b.top, ['g', 'g']);
  assert.deepEqual(b.goHome, ['g', 'h']);
  assert.deepEqual(b.halfDown, ['C-d']);
});

test('every action is in a group, and every group has actions', () => {
  for (const [, , g] of K.ACTIONS) assert.ok(K.GROUPS.includes(g), g);
  for (const g of K.GROUPS) assert.ok(K.ACTIONS.some(([, , x]) => x === g), g);
});

test('a person’s own keys go over the defaults; bad or clashing ones are ignored', () => {
  assert.deepEqual(K.bindings(JSON.stringify({ like: 'x' })).like, ['x']);
  assert.deepEqual(K.bindings(JSON.stringify({ top: 'T T' })).top, ['T', 'T']);
  assert.deepEqual(K.bindings(JSON.stringify({ like: 'j' })).like, ['f']); // j is down's
  assert.deepEqual(K.bindings(JSON.stringify({ like: 'g' })).like, ['f']); // g begins gg
  assert.deepEqual(K.bindings(JSON.stringify({ like: 'g g g' })).like, ['f']);
  assert.deepEqual(K.bindings(JSON.stringify({ nonsense: 'x' })).like, ['f']);
  assert.deepEqual(K.bindings('not json').like, ['f']);
  assert.deepEqual(K.bindings('[1]').like, ['f']);
  assert.deepEqual(K.bindings(JSON.stringify({ like: 5 })).like, ['f']);
});

test('assign says why a key is refused, and writes only what differs from the default', () => {
  let r = K.assign('', 'like', 'x');
  assert.ok(r.ok); assert.equal(r.mine, JSON.stringify({ like: 'x' }));
  r = K.assign(r.mine, 'like', 'f'); // back to the default: nothing kept
  assert.ok(r.ok); assert.equal(r.mine, '');
  r = K.assign('', 'like', 'j');
  assert.ok(!r.ok); assert.match(r.why, /already/);
  r = K.assign('', 'like', 'g');
  assert.ok(!r.ok); assert.match(r.why, /begins/);
  r = K.assign('', 'like', 'a b c');
  assert.ok(!r.ok);
  r = K.assign(JSON.stringify({ like: 'x', bookmark: 'z' }), 'like', null);
  assert.ok(r.ok); assert.equal(r.mine, JSON.stringify({ bookmark: 'z' }));
  assert.ok(!K.assign('', 'nope', 'x').ok);
  r = K.assign('', 'reply', 'f'); // like's
  assert.ok(!r.ok);
  r = K.assign(JSON.stringify({ like: 'x' }), 'reply', 'f'); // like let go of f: it is free
  assert.ok(r.ok);
});

test('sequences are written for people', () => {
  assert.equal(K.label(['g', 'g']), 'gg');
  assert.equal(K.label(['G']), 'G');
  assert.equal(K.label(['C-d']), 'Ctrl+D');
  assert.equal(K.label(['S-Space']), 'Shift+Space');
  assert.equal(K.label(['g', 'C-d']), 'g Ctrl+D');
  assert.equal(K.label('g h'), 'gh');
});

test('the matcher finds a whole sequence, waits on half of one, and gives up on the rest', () => {
  const step = K.matcher(K.bindings(''));
  assert.deepEqual(step(['j']), { kind: 'match', act: 'down' });
  assert.deepEqual(step(['g']), { kind: 'pending' });
  assert.deepEqual(step(['g', 'g']), { kind: 'match', act: 'top' });
  assert.deepEqual(step(['g', 'h']), { kind: 'match', act: 'goHome' });
  assert.deepEqual(step(['g', 'x']), { kind: 'none' });
  assert.deepEqual(step(['C-d']), { kind: 'match', act: 'halfDown' });
  assert.deepEqual(step(['x']), { kind: 'none' });
  assert.deepEqual(step(['G']), { kind: 'match', act: 'bottom' });
});
