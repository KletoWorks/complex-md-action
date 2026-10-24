import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fakeGitHub } from './helpers.js';
import { run } from '../src/main.js';
import { MARKER } from '../src/comment.js';

const MAP = readFileSync(new URL('./fixtures/small.COMPLEX.md', import.meta.url), 'utf8');
const BASE = 'bace000000000000000000000000000000000001';

function setup({ event = 'pull_request_target', inputs = {}, files = [], map = MAP, existing = [], postStatus = 201, changedFiles } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'cmda-'));
  const eventPath = join(dir, 'event.json');
  writeFileSync(eventPath, JSON.stringify({
    pull_request: { number: 7, base: { sha: BASE, ref: 'main' }, head: { sha: 'feed', repo: { full_name: 'fork/app' } }, changed_files: changedFiles ?? files.length },
  }));
  const out = join(dir, 'out');
  const summary = join(dir, 'summary');
  writeFileSync(out, '');
  writeFileSync(summary, '');
  const env = {
    GITHUB_EVENT_NAME: event,
    GITHUB_EVENT_PATH: eventPath,
    GITHUB_REPOSITORY: 'acme/app',
    GITHUB_API_URL: 'https://api.example.test',
    GITHUB_OUTPUT: out,
    GITHUB_STEP_SUMMARY: summary,
    'INPUT_GITHUB-TOKEN': 'tok',
    'INPUT_MAP-PATH': 'COMPLEX.md',
    INPUT_COMMENT: 'true',
    'INPUT_IMPACT-STRICT': 'false',
    INPUT_VERIFY: 'false',
  };
  for (const [k, v] of Object.entries(inputs)) env[`INPUT_${k.toUpperCase()}`] = v;
  const fake = fakeGitHub({
    'GET /repos/acme/app/contents/COMPLEX.md': ({ query }) => (map === null ? { status: 404, body: {} } : { body: query.ref === BASE ? map : 'wrong ref' }),
    'GET /repos/acme/app/pulls/7/files': () => ({ body: files }),
    'GET /repos/acme/app/compare/1234567...bace000000000000000000000000000000000001': () => ({ body: { status: 'ahead', ahead_by: 4 } }),
    'GET /repos/acme/app/issues/7/comments': () => ({ body: existing }),
    'POST /repos/acme/app/issues/7/comments': ({ body }) => ({ status: postStatus, body: postStatus < 300 ? { id: 1, html_url: 'https://github.test/c/1', body: body.body } : { message: 'Resource not accessible by integration' } }),
    'PATCH /repos/acme/app/issues/comments/5': ({ body }) => ({ body: { id: 5, html_url: 'https://github.test/c/5', body: body.body } }),
  });
  const logs = [];
  return {
    env, fake, logs,
    log: (s) => logs.push(s),
    outputs: () => Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s).slice(0, 2))),
    summary: () => readFileSync(summary, 'utf8'),
  };
}

const go = (s) => run({ env: s.env, fetch: s.fake.fetch, log: s.log });

test('a hotspot touch posts one comment and sets the outputs', async () => {
  const s = setup({ files: [{ filename: 'lib/server.js', status: 'modified' }] });
  assert.equal(await go(s), 0);
  const post = s.fake.calls.find((c) => c.method === 'POST');
  assert.ok(post.body.body.startsWith(MARKER));
  assert.match(post.body.body, /1 hotspot touched/);
  assert.match(post.body.body, /4 commits behind the base/);
  assert.deepEqual(s.outputs(), { hotspots: '1', 'load-bearing': '0', partners: '4', comment: 'created', 'comment-url': 'https://github.test/c/1' });
  assert.match(s.summary(), /1 hotspot touched/);
});

test('the map is read at the base commit and the head is never fetched', async () => {
  const s = setup({ files: [{ filename: 'lib/server.js' }] });
  await go(s);
  const mapCall = s.fake.calls.find((c) => c.path.endsWith('/contents/COMPLEX.md'));
  assert.equal(mapCall.query.ref, BASE);
  assert.equal(s.fake.calls.some((c) => c.path.includes('fork/') || JSON.stringify(c.query).includes('feed')), false);
});

test('a pull request that touches nothing posts nothing', async () => {
  const s = setup({ files: [{ filename: 'README.md' }] });
  assert.equal(await go(s), 0);
  assert.equal(s.fake.calls.some((c) => c.method !== 'GET'), false);
  assert.equal(s.fake.calls.some((c) => c.path.includes('/compare/')), false);
  assert.equal(s.outputs().comment, 'none');
});

test('a comment from an earlier push is cleared', async () => {
  const s = setup({ files: [{ filename: 'README.md' }], existing: [{ id: 5, body: `${MARKER}\nold`, user: { type: 'Bot' } }] });
  assert.equal(await go(s), 0);
  const patch = s.fake.calls.find((c) => c.method === 'PATCH');
  assert.match(patch.body.body, /no longer touches/);
  assert.equal(s.outputs().comment, 'cleared');
});

test('no map on the base branch is a notice, not a failure', async () => {
  const s = setup({ map: null, files: [{ filename: 'lib/server.js' }] });
  assert.equal(await go(s), 0);
  assert.equal(s.fake.calls.some((c) => c.method !== 'GET'), false);
  assert.ok(s.logs.some((l) => l.startsWith('::notice::') && l.includes('No COMPLEX.md')));
});

test('a map the parser cannot read is a warning', async () => {
  const s = setup({ map: '# just a heading\n', files: [{ filename: 'lib/server.js' }] });
  assert.equal(await go(s), 0);
  assert.ok(s.logs.some((l) => l.startsWith('::warning::')));
});

test('a truncated file list is named in the comment', async () => {
  const s = setup({ files: [{ filename: 'lib/server.js' }], changedFiles: 3500 });
  await go(s);
  assert.match(s.fake.calls.find((c) => c.method === 'POST').body.body, /first 1 files/);
});

test('a forbidden write is a warning on pull_request', async () => {
  const s = setup({ event: 'pull_request', files: [{ filename: 'lib/server.js' }], postStatus: 403 });
  assert.equal(await go(s), 0);
  assert.ok(s.logs.some((l) => l.startsWith('::warning::') && l.includes('pull-requests: write')));
  assert.match(s.summary(), /1 hotspot touched/);
});

test('a forbidden write fails on pull_request_target', async () => {
  const s = setup({ files: [{ filename: 'lib/server.js' }], postStatus: 403 });
  assert.equal(await go(s), 1);
  assert.ok(s.logs.some((l) => l.startsWith('::error::')));
});

test('impact-strict or verify under pull_request_target is refused before any request', async () => {
  for (const inputs of [{ 'impact-strict': 'true' }, { verify: 'true' }]) {
    const s = setup({ inputs, files: [{ filename: 'lib/server.js' }] });
    assert.equal(await go(s), 1);
    assert.equal(s.fake.calls.length, 0);
    assert.ok(s.logs.some((l) => l.startsWith('::error::') && l.includes('pull_request_target')));
  }
});

test('another event is refused', async () => {
  const s = setup({ event: 'push' });
  assert.equal(await go(s), 1);
  assert.equal(s.fake.calls.length, 0);
});

test('an input that is not true or false is refused', async () => {
  const s = setup({ inputs: { comment: 'yes' } });
  assert.equal(await go(s), 1);
  assert.ok(s.logs.some((l) => l.includes('comment')));
});

test('impact-strict on pull_request runs the bounds check', async () => {
  const s = setup({ event: 'pull_request', inputs: { comment: 'false', 'impact-strict': 'true' }, files: [{ filename: 'lib/server.js' }] });
  s.env.GITHUB_WORKSPACE = mkdtempSync(join(tmpdir(), 'cmda-nogit-'));
  assert.equal(await go(s), 1);
  assert.ok(s.logs.some((l) => l.startsWith('::error::') && l.includes('actions/checkout')));
  assert.equal(s.fake.calls.length, 0);
});
