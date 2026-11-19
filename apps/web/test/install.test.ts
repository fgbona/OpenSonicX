import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotName } from '../lib/slotName.ts';

test('slot names drop the extension, keep printable ASCII and fit the pedal', () => {
  assert.equal(slotName('Gallien Krueger 250 ML - Death.nam', 'profile'), 'Gallien Krueger');
  assert.equal(slotName('Mesa OS V30.wav', 'ir'), 'Mesa OS V3');
  assert.equal(slotName('Açaí cab.WAV', 'ir'), 'A_a_ cab');
  assert.equal(slotName('.nam', 'profile'), 'Capture');
  assert.equal(slotName('   ', 'ir'), 'User IR');
});
