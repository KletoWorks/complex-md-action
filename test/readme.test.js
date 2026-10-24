import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseComplexMd } from '../src/vendor/complexmd.js';
import { findTouched } from '../src/findings.js';
import { renderComment, MARKER } from '../src/comment.js';

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const action = readFileSync(new URL('../action.yml', import.meta.url), 'utf8');

test('the sample comment in the README is what the action renders', () => {
  const sample = /```markdown\n([\s\S]*?)\n```/.exec(readme)[1];
  const map = parseComplexMd(readFileSync(new URL('./fixtures/complex-md.COMPLEX.md', import.meta.url), 'utf8'));
  const body = renderComment(findTouched(map, [{ filename: 'cli/src/targets.js' }, { filename: 'README.md' }]), { baseSha: 'x', front: map.front });
  const rendered = body.replace(MARKER + '\n', '').replace(/\n\n<sub>[\s\S]*$/, '');
  assert.equal(sample, rendered);
});

test('the README inputs table lists every input with its default', () => {
  const rows = [...readme.matchAll(/^\| `([\w-]+)` \| `([^`]+)` \|/gm)].map((m) => [m[1], m[2]]);
  const declared = [...action.matchAll(/^  ([\w-]+):\n    description: .*\n    default: (.*)$/gm)].map((m) => [m[1], m[2].replace(/^"|"$/g, '').replace(/^\$\{\{ (.*) \}\}$/, '$1')]);
  assert.deepEqual(rows.sort(), declared.sort());
});

test('the README names the pinned CLI version', async () => {
  const { CLI } = await import('../src/cli.js');
  assert.match(readme, new RegExp(`complex-md ${CLI.version.replace(/\./g, '\\.')}, checked against the sha512`));
});
