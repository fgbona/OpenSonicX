import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePreset, type Preset } from '../src/dump.ts';
import { diffPresets } from '../src/edit.ts';
import { realP08 } from './fake-pedal.ts';

test('the dump gives the preset BPM (record 0x2002)', () => {
  assert.equal(decodePreset(realP08()).bpm, 120);
});

test('a BPM difference alone produces no edit: firmware V1.3.3 ignores BPM writes', () => {
  const p08 = decodePreset(realP08());
  const other: Preset = { ...p08, bpm: 90 };
  assert.deepEqual(diffPresets(other, p08), []);
});
