import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseComplexMd } from '../src/vendor/complexmd.js';
import { touchedPaths, findTouched } from '../src/findings.js';

const map = parseComplexMd(readFileSync(new URL('./fixtures/small.COMPLEX.md', import.meta.url), 'utf8'));
const diff = (...names) => names.map((filename) => ({ filename, status: 'modified' }));

test('a diff that touches no mapped file is clean', () => {
  const f = findTouched(map, diff('README.md', 'lib/other.js'));
  assert.equal(f.clean, true);
  assert.deepEqual([f.hotspots, f.loadBearing, f.partners], [[], [], []]);
});

test('a touched hotspot is reported with its row and directive', () => {
  const f = findTouched(map, diff('lib/route.js', 'test/route.test.js'));
  assert.equal(f.clean, false);
  assert.deepEqual(f.hotspots.map((h) => h.path), ['lib/route.js']);
  assert.equal(f.hotspots[0].row.score, 5410);
  assert.match(f.hotspots[0].directive, /npm run test:route/);
  assert.deepEqual(f.partners.map((p) => p.partner), ['lib/server.js']);
});

test('hotspots keep map order, highest score first', () => {
  const f = findTouched(map, diff('lib/route.js', 'lib/server.js'));
  assert.deepEqual(f.hotspots.map((h) => h.path), ['lib/server.js', 'lib/route.js']);
});

test('a touched load bearing file is reported apart from hotspots', () => {
  const f = findTouched(map, diff('lib/symbols.js'));
  assert.deepEqual(f.hotspots, []);
  assert.deepEqual(f.loadBearing.map((h) => h.path), ['lib/symbols.js']);
  assert.equal(f.loadBearing[0].row.fan_in, 31);
});

test('a partner the diff leaves alone is reported, strongest pair first', () => {
  const f = findTouched(map, diff('lib/server.js'));
  assert.deepEqual(
    f.partners.map((p) => [p.changed, p.partner, p.count, p.coupling]),
    [
      ['lib/server.js', 'types/server.d.ts', 14, 61],
      ['lib/server.js', 'lib/route.js', 8, 35],
      ['lib/server.js', 'docs/server.md', 6, 30],
      ['lib/server.js', 'lib/hooks.js', 5, 28],
    ],
  );
});

test('a pair with both sides touched is not reported', () => {
  const f = findTouched(map, diff('lib/errors.js', 'docs/errors.md'));
  assert.equal(f.clean, true);
});

test('a pair whose cold side changed reports the hot partner', () => {
  const f = findTouched(map, diff('docs/errors.md'));
  assert.deepEqual(f.partners.map((p) => [p.changed, p.partner]), [['docs/errors.md', 'lib/errors.js']]);
});

test('a rename touches the old and the new path', () => {
  const files = [{ filename: 'lib/server2.js', previous_filename: 'lib/server.js', status: 'renamed' }];
  assert.deepEqual(touchedPaths(files), ['lib/server2.js', 'lib/server.js']);
  const f = findTouched(map, files);
  assert.deepEqual(f.hotspots.map((h) => h.path), ['lib/server.js']);
});

test('a deleted hotspot still counts as touched', () => {
  const f = findTouched(map, [{ filename: 'lib/route.js', status: 'removed' }]);
  assert.deepEqual(f.hotspots.map((h) => h.path), ['lib/route.js']);
});

test('entries without a string filename are ignored', () => {
  assert.deepEqual(touchedPaths([{}, { filename: 7 }, null, { filename: 'a.js' }]), ['a.js']);
});
