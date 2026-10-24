import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseComplexMd } from '../src/vendor/complexmd.js';
import { findTouched } from '../src/findings.js';
import { MARKER, renderComment, renderCleared, code, MAX_BODY } from '../src/comment.js';

const map = parseComplexMd(readFileSync(new URL('./fixtures/small.COMPLEX.md', import.meta.url), 'utf8'));
const diff = (...names) => names.map((filename) => ({ filename, status: 'modified' }));
const ctx = { baseSha: 'abcdef0123456789abcdef0123456789abcdef01', mapPath: 'COMPLEX.md', front: map.front, behind: 12 };

test('the comment starts with the marker and counts each list', () => {
  const body = renderComment(findTouched(map, diff('lib/server.js', 'lib/symbols.js')), ctx);
  assert.ok(body.startsWith(MARKER + '\n'));
  assert.match(body, /1 hotspot touched/);
  assert.match(body, /1 load bearing file touched/);
  assert.match(body, /4 co-change partners not in this pull request/);
});

test('plural and singular counts read correctly', () => {
  const body = renderComment(findTouched(map, diff('lib/server.js', 'lib/route.js')), ctx);
  assert.match(body, /2 hotspots touched/);
  assert.doesNotMatch(body, /load bearing/);
});

test('a hotspot row carries its numbers and its directive', () => {
  const body = renderComment(findTouched(map, diff('lib/server.js')), ctx);
  assert.match(body, /\| `lib\/server\.js` \| 9120 \| 41 \| 17 \| 23 \| 6 \|/);
  assert.match(body, /- `lib\/server\.js`: Before editing this file, run `npm run test:server`/);
});

test('partners show three per changed file and count the rest', () => {
  const body = renderComment(findTouched(map, diff('lib/server.js')), ctx);
  assert.match(body, /`types\/server\.d\.ts` \(14 commits together, 61 percent\)/);
  assert.match(body, /`lib\/route\.js` \(8 commits together, 35 percent\)/);
  assert.match(body, /`docs\/server\.md` \(6 commits together, 30 percent\)/);
  assert.doesNotMatch(body, /lib\/hooks\.js/);
  assert.match(body, /and 1 more in COMPLEX\.md/);
});

test('the footer names the base commit, the map commit and its lag', () => {
  const body = renderComment(findTouched(map, diff('lib/route.js')), ctx);
  assert.match(body, /`COMPLEX\.md` at base `abcdef0`/);
  assert.match(body, /generated 2026-10-20 at `1234567`, 12 commits behind the base/);
  assert.match(body, /runs no code from this pull request/);
});

test('an unknown lag is said plainly', () => {
  const body = renderComment(findTouched(map, diff('lib/route.js')), { ...ctx, behind: null });
  assert.match(body, /`1234567`, a commit not in the base history/);
  const zero = renderComment(findTouched(map, diff('lib/route.js')), { ...ctx, behind: 0 });
  assert.match(zero, /`1234567`, current with the base/);
});

test('a truncated file list is reported', () => {
  const body = renderComment(findTouched(map, diff('lib/route.js')), { ...ctx, truncated: 3000 });
  assert.match(body, /GitHub lists the first 3000 files of a pull request/);
});

test('code spans survive backticks, pipes and line breaks in a path', () => {
  assert.equal(code('a.js'), '`a.js`');
  assert.equal(code('we`ird.js'), '`` we`ird.js ``');
  assert.equal(code('a|b.js'), '`a\\|b.js`');
  assert.equal(code('a\nb\u0000.js'), '`a b.js`');
});

test('the cleared comment keeps the marker and says nothing is touched', () => {
  const body = renderCleared(ctx);
  assert.ok(body.startsWith(MARKER + '\n'));
  assert.match(body, /no longer touches a hotspot, a load bearing file or a co-change pair/);
  assert.doesNotMatch(body, /behind|generated/);
});

test('a very long comment is cut below the GitHub limit', () => {
  const big = { ...map, co_change: [] };
  const files = [];
  for (let i = 0; i < 4000; i++) {
    big.co_change.push({ files: [`src/f${i}.js`, `src/g${i}.js`], count: 3, coupling: 50 });
    files.push({ filename: `src/f${i}.js` });
  }
  const body = renderComment(findTouched(big, files), ctx);
  assert.ok(body.length <= MAX_BODY, `length ${body.length}`);
  assert.match(body, /and 3980 more changed files with a partner left unchanged/);
});
