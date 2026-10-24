import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeGitHub } from './helpers.js';
import { client, readMap, listFiles, commitsBehind, findSticky, syncSticky, contentsPath } from '../src/github.js';
import { MARKER } from '../src/comment.js';

const repo = 'acme/app';
const gh = (routes) => {
  const fake = fakeGitHub(routes);
  return { fake, gh: client({ token: 't0k', apiUrl: 'https://api.example.test', fetch: fake.fetch }) };
};

test('requests carry the token, the API version and a user agent', async () => {
  const { fake, gh: g } = gh({ 'GET /repos/acme/app/contents/COMPLEX.md': () => ({ body: '---\n---\n' }) });
  await readMap(g, repo, 'COMPLEX.md', 'base123');
  const h = fake.calls[0].headers;
  assert.equal(h.authorization, 'Bearer t0k');
  assert.equal(h['x-github-api-version'], '2022-11-28');
  assert.equal(h.accept, 'application/vnd.github.raw+json');
  assert.match(h['user-agent'], /complex-md-action/);
  assert.equal(fake.calls[0].query.ref, 'base123');
});

test('a missing map reads as null and other errors throw', async () => {
  const { gh: g } = gh({});
  assert.equal(await readMap(g, repo, 'COMPLEX.md', 'b'), null);
  const { gh: g2 } = gh({ 'GET /repos/acme/app/contents/COMPLEX.md': () => ({ status: 500, body: { message: 'boom' } }) });
  await assert.rejects(readMap(g2, repo, 'COMPLEX.md', 'b'), /500/);
});

test('the map path is encoded per segment and may not climb out', () => {
  assert.equal(contentsPath('docs/COMPLEX map.md'), 'docs/COMPLEX%20map.md');
  assert.throws(() => contentsPath('../COMPLEX.md'), /map-path/);
  assert.throws(() => contentsPath('/COMPLEX.md'), /map-path/);
  assert.throws(() => contentsPath(''), /map-path/);
});

test('the file list follows pagination to the end', async () => {
  const page = (n, count) => Array.from({ length: count }, (_, i) => ({ filename: `f${n}-${i}.js`, status: 'modified' }));
  const { fake, gh: g } = gh({
    'GET /repos/acme/app/pulls/7/files': ({ query }) => {
      const p = Number(query.page || 1);
      return {
        body: p === 1 ? page(1, 100) : page(2, 5),
        headers: p === 1 ? { link: '<https://api.example.test/repos/acme/app/pulls/7/files?per_page=100&page=2>; rel="next"' } : {},
      };
    },
  });
  const files = await listFiles(g, repo, 7);
  assert.equal(files.length, 105);
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[0].query.per_page, '100');
});

test('pagination refuses a next link to another host', async () => {
  const { gh: g } = gh({
    'GET /repos/acme/app/pulls/7/files': () => ({ body: [], headers: { link: '<https://evil.test/x?page=2>; rel="next"' } }),
  });
  await assert.rejects(listFiles(g, repo, 7), /another host/);
});

test('the lag is the number of base commits after the map commit', async () => {
  const { fake, gh: g } = gh({ 'GET /repos/acme/app/compare/1234567...bace999': () => ({ body: { status: 'ahead', ahead_by: 12 } }) });
  assert.equal(await commitsBehind(g, repo, '1234567', 'bace999'), 12);
  assert.equal(fake.calls[0].path, '/repos/acme/app/compare/1234567...bace999');
  const { gh: g2 } = gh({ 'GET /repos/acme/app/compare/1234567...bace999': () => ({ body: { status: 'identical', ahead_by: 0 } }) });
  assert.equal(await commitsBehind(g2, repo, '1234567', 'bace999'), 0);
  const { gh: g3 } = gh({ 'GET /repos/acme/app/compare/1234567...bace999': () => ({ body: { status: 'diverged', ahead_by: 3 } }) });
  assert.equal(await commitsBehind(g3, repo, '1234567', 'bace999'), null);
  const { gh: g4 } = gh({});
  assert.equal(await commitsBehind(g4, repo, '1234567', 'bace999'), null);
  assert.equal(await commitsBehind(g4, repo, 'not a sha', 'bace999'), null);
});

const comments = (list) => ({ 'GET /repos/acme/app/issues/7/comments': () => ({ body: list }) });
const bot = { type: 'Bot', login: 'github-actions[bot]' };

test('the sticky comment is the bot comment that opens with the marker', async () => {
  const { gh: g } = gh(comments([
    { id: 1, body: `${MARKER}\nplanted by a person`, user: { type: 'User', login: 'someone' } },
    { id: 2, body: 'unrelated', user: bot },
    { id: 3, body: `${MARKER}\nours`, user: bot },
  ]));
  assert.equal((await findSticky(g, repo, 7)).id, 3);
});

test('a new finding creates the comment', async () => {
  const { fake, gh: g } = gh({
    ...comments([]),
    'POST /repos/acme/app/issues/7/comments': ({ body }) => ({ status: 201, body: { id: 9, html_url: 'https://github.test/c/9', body: body.body } }),
  });
  const r = await syncSticky(g, repo, 7, { body: `${MARKER}\nnew`, cleared: `${MARKER}\nclear` });
  assert.deepEqual(r, { action: 'created', url: 'https://github.test/c/9' });
  assert.equal(fake.calls[1].body.body, `${MARKER}\nnew`);
});

test('a changed finding edits the comment in place', async () => {
  const { fake, gh: g } = gh({
    ...comments([{ id: 3, body: `${MARKER}\nold`, user: bot, html_url: 'u3' }]),
    'PATCH /repos/acme/app/issues/comments/3': ({ body }) => ({ body: { id: 3, html_url: 'u3', body: body.body } }),
  });
  const r = await syncSticky(g, repo, 7, { body: `${MARKER}\nnew`, cleared: `${MARKER}\nclear` });
  assert.deepEqual(r, { action: 'updated', url: 'u3' });
  assert.equal(fake.calls.filter((c) => c.method !== 'GET').length, 1);
});

test('the same finding writes nothing', async () => {
  const { fake, gh: g } = gh(comments([{ id: 3, body: `${MARKER}\nsame`, user: bot, html_url: 'u3' }]));
  const r = await syncSticky(g, repo, 7, { body: `${MARKER}\nsame`, cleared: `${MARKER}\nclear` });
  assert.deepEqual(r, { action: 'unchanged', url: 'u3' });
  assert.equal(fake.calls.every((c) => c.method === 'GET'), true);
});

test('a clean pull request with no comment posts nothing', async () => {
  const { fake, gh: g } = gh(comments([]));
  const r = await syncSticky(g, repo, 7, { body: null, cleared: `${MARKER}\nclear` });
  assert.deepEqual(r, { action: 'none', url: null });
  assert.equal(fake.calls.every((c) => c.method === 'GET'), true);
});

test('a pull request that became clean gets its comment cleared', async () => {
  const { fake, gh: g } = gh({
    ...comments([{ id: 3, body: `${MARKER}\nold`, user: bot, html_url: 'u3' }]),
    'PATCH /repos/acme/app/issues/comments/3': ({ body }) => ({ body: { id: 3, html_url: 'u3', body: body.body } }),
  });
  const r = await syncSticky(g, repo, 7, { body: null, cleared: `${MARKER}\nclear` });
  assert.deepEqual(r, { action: 'cleared', url: 'u3' });
  assert.equal(fake.calls.at(-1).body.body, `${MARKER}\nclear`);
});
