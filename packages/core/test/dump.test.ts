import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseFrame } from '../src/frame.ts';
import { Reassembler } from '../src/reassembler.ts';
import { decodePreset, type Block } from '../src/dump.ts';
import { fromHex } from '../src/hex.ts';
import { readCapture } from './capture.ts';

function p08Payload(): Uint8Array {
  const r = new Reassembler();
  const frames = readCapture('p08-capture.txt').filter((m) => m.dir === 'RX').slice(1);
  const joined = frames.map((m) => r.feed(parseFrame(m.bytes), 0)).at(-1);
  assert.ok(joined);
  return joined.payload;
}
const p34 = fromHex(readFileSync(new URL('./fixtures/p34-payload.hex', import.meta.url), 'utf8'));
const block = (blocks: readonly Block[], key: string) => blocks.find((b) => b.key === key)!;
const param = (b: Block, name: string) => b.params.find((p) => p.name === name)!;

test('P08 decodes volume, amp mode and chain order', () => {
  const preset = decodePreset(p08Payload());
  assert.equal(preset.volume, 65);
  assert.equal(preset.ampMode, 'normal');
  assert.deepEqual(preset.chain.map((b) => b.label), ['NR', 'FX1', 'DRV', 'AMP', 'IR', 'EQ', 'FX2', 'DLY', 'RVB']);
});

test('P08 decodes models, on/off and parameters as confirmed on the unit', () => {
  const { chain } = decodePreset(p08Payload());
  assert.deepEqual(
    chain.map((b) => [b.key, b.on, b.model]),
    [
      ['nr', true, 'Gate'], ['fx1', false, 'Boost'], ['drv', true, 'Scream'], ['amp', true, 'Brit 800'],
      ['ir', true, 'BritGN 4x12'], ['eq', true, 'GT EQ 1'], ['fx2', false, 'A-Chorus'], ['dly', false, 'Analog'],
      ['rvb', false, 'Plate 2'],
    ],
  );
  assert.equal(param(block(chain, 'nr'), 'THRE').value, 24);
  assert.equal(param(block(chain, 'amp'), 'Middle').value, 71);
  assert.equal(param(block(chain, 'eq'), '400Hz').display, '-2');
  assert.equal(param(block(chain, 'dly'), 'Time').display, '400 ms');
  assert.equal(param(block(chain, 'fx2'), 'Rate').display, '0.5 Hz');
  assert.equal(param(block(chain, 'fx1'), '+3dB').display, 'on');
});

test('P34 reference dump decodes 9 blocks', () => {
  const preset = decodePreset(p34);
  assert.equal(preset.chain.length, 9);
  assert.ok(preset.chain.every((b) => b.model.length > 0));
});

test('decodePreset unknown code renders the hex code', () => {
  const payload = p08Payload().slice();
  // effect-code record: tag 0x3003, length 40 (little-endian), then 10 x uint32
  const header = [0x03, 0x30, 0x28, 0x00];
  const at = payload.findIndex((_, i) => header.every((b, j) => payload[i + j] === b));
  assert.ok(at > 0);
  new DataView(payload.buffer).setUint32(at + 4 + 4 * 6, 0x0e00ffff, true);
  const fx2 = block(decodePreset(payload).chain, 'fx2');
  assert.equal(fx2.model, '0x0E00FFFF');
  assert.deepEqual(fx2.params, []);
});

test('decodePreset rejects a payload that is not an edit-buffer dump', () => {
  assert.throws(() => decodePreset(Uint8Array.from([0x12, 0x43, 7, 0])), /edit-buffer/);
  assert.throws(() => decodePreset(p08Payload().slice(0, 120)), /missing/);
});

test('clone amp mode reads the AMP slot from the captured-profile module', () => {
  const payload = p08Payload().slice();
  const find = (header: number[]) => payload.findIndex((_, i) => header.every((b, j) => payload[i + j] === b));
  const view = new DataView(payload.buffer);
  const states = find([0x01, 0x30, 0x04, 0x00]);
  const effects = find([0x03, 0x30, 0x28, 0x00]);
  view.setUint32(states + 4, view.getUint32(states + 4, true) | (1 << 9), true);
  view.setUint32(effects + 4 + 4 * 9, 0x0f000001, true); // profile 2, category 0x0F as the device reports it
  const preset = decodePreset(payload);
  assert.equal(preset.ampMode, 'clone');
  assert.equal(block(preset.chain, 'amp').model, 'User Profile 2');
});
