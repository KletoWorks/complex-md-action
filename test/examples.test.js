import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const read = (dir) => (existsSync(new URL(`../${dir}/`, import.meta.url))
  ? readdirSync(new URL(`../${dir}/`, import.meta.url)).filter((f) => /\.ya?ml$/.test(f)).map((f) => ({ name: `${dir}/${f}`, text: readFileSync(new URL(`../${dir}/${f}`, import.meta.url), 'utf8') }))
  : []);
const workflows = [...read('examples'), ...read('.github/workflows')];
const steps = (text) => text.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l)).map((l) => l.replace(/^\s*-?\s*uses:\s*/, ''));

test('there is an example for each job', () => {
  assert.deepEqual(read('examples').map((w) => w.name).sort(), ['examples/complex-md-bounds.yml', 'examples/complex-md-comment.yml']);
});

test('every action is pinned to a full commit SHA', () => {
  for (const w of workflows) {
    for (const u of steps(w.text)) {
      if (u.startsWith('./')) continue;
      assert.match(u, /^[\w.-]+\/[\w.-]+@([0-9a-f]{40}|RELEASE_COMMIT_SHA) # v\d+\.\d+\.\d+$/, `${w.name}: ${u}`);
      if (u.includes('RELEASE_COMMIT_SHA')) assert.match(u, /^KletoWorks\/complex-md-action@/, w.name);
    }
  }
});

test('every workflow starts from no permissions and grants per job', () => {
  for (const w of workflows) assert.match(w.text, /^permissions: \{\}$/m, w.name);
});

test('the pull_request_target example checks out nothing and runs nothing', () => {
  const w = workflows.find((x) => x.name === 'examples/complex-md-comment.yml');
  assert.match(w.text, /^  pull_request_target:/m);
  assert.doesNotMatch(w.text.replace(/^\s*#.*$/gm, ''), /actions\/checkout|^\s*(-\s*)?run:/m);
  assert.match(w.text, /pull-requests: write/);
  assert.doesNotMatch(w.text, /contents: write|issues: write/);
});

test('the bounds example runs on pull_request with read only permissions', () => {
  const w = workflows.find((x) => x.name === 'examples/complex-md-bounds.yml');
  const code = w.text.replace(/^\s*#.*$/gm, '');
  assert.match(code, /^  pull_request:/m);
  assert.doesNotMatch(code, /pull_request_target/);
  assert.doesNotMatch(code, /: write/);
  assert.match(w.text, /persist-credentials: false/);
  assert.match(w.text, /impact-strict: true/);
});

test('no workflow puts event data into a run step', () => {
  for (const w of workflows) {
    const runs = w.text.split('\n').filter((l) => /^\s*(-\s*)?run:/.test(l));
    for (const r of runs) assert.doesNotMatch(r, /\$\{\{\s*github\.event/, `${w.name}: ${r}`);
  }
});
