import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeStoredPreset, storedPresetFrame } from '../src/stored-preset.ts';
import { decodePreset } from '../src/dump.ts';
import { parseFrame } from '../src/frame.ts';
import { isReadOnly } from '../src/queries.ts';
import { realP08 } from './fake-pedal.ts';

// 12 4F + uint32 index reads a stored preset without loading it (klotznick's guide, CC0). The
// record is FF FF FF FF, a 16-byte name, then the same 474-byte body the edit buffer (12 41) holds.
const body = realP08().slice(2);
const name = Array.from({ length: 16 }, (_, i) => 'IRON-RHY'.charCodeAt(i) || 0);
const reply = Uint8Array.from([0x12, 0x4f, 0xff, 0xff, 0xff, 0xff, ...name, ...body]);

test('the request names the slot as a 32-bit index and is a read', () => {
  const frame = storedPresetFrame(75);
  assert.deepEqual(Array.from(parseFrame(frame).payload), [0x12, 0x4f, 75, 0, 0, 0]);
  assert.equal(isReadOnly(frame), true);
  assert.throws(() => storedPresetFrame(100), /0\.\.99/);
});

test('a stored preset decodes to its name and the same preset as the edit buffer', () => {
  const stored = decodeStoredPreset(reply);
  assert.equal(stored.name, 'IRON-RHY');
  assert.deepEqual(stored.preset, decodePreset(realP08()));
  assert.throws(() => decodeStoredPreset(realP08()), /not a stored-preset reply/);
  assert.throws(() => decodeStoredPreset(reply.slice(0, 30)), /not a stored-preset reply|missing records/);
});
