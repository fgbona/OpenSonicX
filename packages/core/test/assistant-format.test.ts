import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatModels, formatPreset } from '../src/assistant/format.ts';
import { decodePreset } from '../src/dump.ts';
import { realP08 } from './fake-pedal.ts';

const p08 = decodePreset(realP08());
const SLOTS = { irNames: ['Mesa OS', null, null, null, null], profileNames: ['Randall SA', null, null, null, null] };

test('the preset text names the slot, the state and every block with its values', () => {
  const text = formatPreset(7, 'IRON-RHY', p08, SLOTS, null);
  assert.match(text, /^P08 "IRON-RHY" · volume 65 · amp mode: amp model · unsaved changes: unknown\n/);
  assert.match(text, /\nChain: NR → FX1 → DRV → AMP → IR → EQ → FX2 → DLY → RVB\n/);
  assert.match(text, /\nAMP +on +Brit 800: Gain /);
});

test('the model list says what each model is based on, and lists captured profiles', () => {
  const text = formatModels('amp', 'AMP', SLOTS);
  assert.match(text, /^AMP models:\n- /);
  assert.match(text, /- Calif DualM: based on [^\n]*Mesa/);
  assert.match(text, /- Randall SA \(profile 1\): Captured profile loaded on the pedal\./);
});
