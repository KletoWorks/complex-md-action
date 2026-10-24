import { test } from 'node:test';
import assert from 'node:assert/strict';
import { input, boolInput, intInput } from '../src/inputs.js';

test('inputs read INPUT_ names with hyphens kept, and blank means the default', () => {
  assert.equal(input({ 'INPUT_MAP-PATH': ' docs/COMPLEX.md ' }, 'map-path', 'COMPLEX.md'), 'docs/COMPLEX.md');
  assert.equal(input({ 'INPUT_MAP-PATH': '  ' }, 'map-path', 'COMPLEX.md'), 'COMPLEX.md');
});

test('a boolean input is true or false and nothing else', () => {
  assert.equal(boolInput({ INPUT_COMMENT: 'TRUE' }, 'comment', false), true);
  assert.equal(boolInput({}, 'comment', false), false);
  assert.throws(() => boolInput({ INPUT_COMMENT: '1' }, 'comment', false), /true or false/);
});

test('a whole number input refuses fractions, zero and words', () => {
  assert.equal(intInput({}, 'impact-max-files', 25), 25);
  assert.equal(intInput({ 'INPUT_IMPACT-MAX-FILES': '3' }, 'impact-max-files', 25), 3);
  for (const v of ['0', '2.5', 'many']) assert.throws(() => intInput({ 'INPUT_IMPACT-MAX-FILES': v }, 'impact-max-files', 25), /whole number/);
});
