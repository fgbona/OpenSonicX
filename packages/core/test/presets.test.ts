import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presetLabel, decodeCurrentPreset } from '../src/presets.ts';

test('presetLabel names user and factory slots like the unit', () => {
  assert.equal(presetLabel(0), 'P01');
  assert.equal(presetLabel(7), 'P08');
  assert.equal(presetLabel(49), 'P50');
  assert.equal(presetLabel(50), 'F01');
  assert.equal(presetLabel(99), 'F50');
  assert.throws(() => presetLabel(100), /0\.\.99/);
});

test('decodeCurrentPreset reads the index from the reply', () => {
  assert.equal(decodeCurrentPreset(Uint8Array.from([0x12, 0x43, 0x07, 0x00])), 7);
  assert.throws(() => decodeCurrentPreset(Uint8Array.from([0x12, 0x41, 0x07])), /current-preset/);
});
