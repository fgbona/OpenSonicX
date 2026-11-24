import { test } from 'node:test';
import assert from 'node:assert/strict';
import { profileChoices, modelValue, parseModelValue } from '../lib/ampChoices.ts';

const slots = ['Randall SA', null, null, null, null];

test('only occupied captured-profile slots are offered, with their names', () => {
  assert.deepEqual(
    profileChoices(slots).map((c) => [c.slot, c.name, c.code.toString(16)]),
    [[1, 'Randall SA', '7000000']],
  );
  assert.deepEqual(profileChoices(null), []);
});

test('the selected value matches the reported profile code by its low 24 bits', () => {
  assert.equal(modelValue(0x0f000000, true), 'clone:7000000');
  assert.equal(modelValue(0x07000003, false), 'amp:7000003');
});

test('parseModelValue tells amp models and captured profiles apart', () => {
  assert.deepEqual(parseModelValue('clone:7000000'), { code: 0x07000000, clone: true });
  assert.deepEqual(parseModelValue('amp:7000003'), { code: 0x07000003, clone: false });
  assert.equal(parseModelValue('nonsense'), null);
});
