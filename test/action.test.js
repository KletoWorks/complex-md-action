import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const action = readFileSync(new URL('../action.yml', import.meta.url), 'utf8');
const declared = (section) => {
  const block = new RegExp(`^${section}:\\n((?:  .*\\n?)*)`, 'm').exec(action)?.[1] || '';
  return [...block.matchAll(/^  ([\w-]+):$/gm)].map((m) => m[1]).sort();
};
const src = readdirSync(new URL('../src/', import.meta.url))
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'))
  .join('\n');

test('action.yml runs src/main.js on node24', () => {
  assert.match(action, /^runs:\n  using: node24\n  main: src\/main\.js$/m);
});

test('every input the code reads is declared, and every declared input is read', () => {
  const read = [...new Set([...src.matchAll(/(?:input|boolInput|intInput)\(env, '([\w-]+)'/g)].map((m) => m[1]))].sort();
  assert.deepEqual(read, declared('inputs'));
});

test('every output the code sets is declared', () => {
  const set = new Set();
  for (const m of src.matchAll(/setOutputs\(env, \{([^}]*)\}/g)) {
    for (const k of m[1].matchAll(/'([\w-]+)':|\b(hotspots|partners|comment)\b:/g)) set.add(k[1] || k[2]);
  }
  for (const k of ['hotspots', 'load-bearing', 'partners', 'comment', 'comment-url']) assert.ok(set.has(k), k);
  assert.deepEqual([...set].sort(), declared('outputs'));
});

test('the action has no npm dependencies', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.doesNotMatch(src, /from '(?!node:|\.)/);
});

test('no plain YAML scalar in action.yml holds a colon and a space', () => {
  for (const line of action.split('\n')) {
    const m = /^\s+[\w-]+: (.*)$/.exec(line);
    if (!m || /^["'$]/.test(m[1]) || m[1].startsWith('${{')) continue;
    assert.doesNotMatch(m[1], /: | #/, line);
  }
});

test('node src/main.js runs the action and exits with its code', async () => {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [new URL('../src/main.js', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, GITHUB_EVENT_NAME: 'push' },
    encoding: 'utf8',
  });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /^::error::complex-md-action runs on pull_request_target or pull_request, not on push\./);
});
