import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseComplexMd } from '../src/vendor/complexmd.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('the vendored parser reads hotspots, load bearing files and pairs', () => {
  const map = parseComplexMd(fixture('small.COMPLEX.md'));
  assert.equal(map.hotspots.length, 2);
  assert.equal(map.load_bearing[0].path, 'lib/symbols.js');
  assert.equal(map.co_change.length, 6);
  assert.deepEqual(map.co_change[0].files, ['lib/server.js', 'types/server.d.ts']);
  assert.equal(map.front.commit, '1234567');
  assert.match(map.directive('lib/server.js'), /^Before editing this file, run `npm run test:server`/);
});

test('the vendored parser reads a real generated map', () => {
  const map = parseComplexMd(fixture('complex-md.COMPLEX.md'));
  assert.deepEqual(map.hotspots.map((h) => h.path), ['cli/src/signals.js', 'cli/src/complexmd.js', 'cli/src/targets.js']);
  assert.equal(map.load_bearing.length, 0);
  assert.ok(map.co_change.length >= 10);
});

test('a file without front matter parses to null', () => {
  assert.equal(parseComplexMd('# not a map\n'), null);
});

test('an unquoted all-digit commit keeps its leading zero', async () => {
  const { parseComplexMd } = await import('../src/vendor/complexmd.js');
  const text = '---\ncomplex_md: "0.3"\ncommit: 0179008\nhotspots:\nco_change:\n---\n\n## Where the risk lives\n\nx\n';
  assert.equal(parseComplexMd(text).front.commit, '0179008');
});
