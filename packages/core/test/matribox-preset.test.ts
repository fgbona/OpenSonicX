import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeCatalog, fakeModel as model, fakeParam as w } from './matribox-fake-catalog.ts';
import { MB_PRESET_BODY_SIZE, MB_PRESET_SIZE, mbPresetLabel, parseMbPresetLabel, parseMatriboxPrst, parseMbPreset, resolveMbPreset, writeMatriboxPrst } from '../src/matribox/preset.ts';
import { lzo1xDecompress } from '../src/matribox/lzo1x.ts';
import { fromHex } from '../src/hex.ts';

// The owner's own unit: preset 66 "Drive AD", read with argument 0x43 (decompressed device reply).
const DRIVE_AD = fromHex(
  readFileSync(new URL('./fixtures/matribox-preset-drive-ad.txt', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .join(''),
);

// Section layout (id, body size) as every sample has it.
const LAYOUT = [
  [0, 11],
  [1, 105],
  [2, 10],
  [3, 15],
  [4, 76],
  [5, 742],
  [7, 95],
  [8, 69],
  [9, 12],
] as const;

interface Synth {
  name?: string;
  style?: string;
  chain?: number[];
  types?: number[];
  fxids?: number[];
  on?: number[];
  values?: Record<number, Record<number, number>>;
  tag?: number;
}

/** A synthetic 1207-byte preset body built from the layout (invented content). */
function body({ name = 'Synth', style = 'Pop', chain = [1, 0], types = [3, 4], fxids = [0x301, 0x401], on = [1, 0], values = {}, tag = 0x10000002 }: Synth = {}): Uint8Array {
  const out = new Uint8Array(MB_PRESET_BODY_SIZE);
  const view = new DataView(out.buffer);
  let at = 0;
  for (const [id, size] of LAYOUT) {
    view.setUint32(at, tag, true);
    view.setUint32(at + 4, size, true);
    const b = at + 8;
    out.set([0, 0, id, 1], b);
    if (id === 1) {
      out.set(
        Array.from(name, (c) => c.charCodeAt(0)),
        b + 8,
      );
      out.set(
        Array.from(style, (c) => c.charCodeAt(0)),
        b + 95,
      );
    }
    if (id === 4) {
      out.fill(0xff, b + 4, b + 28);
      out.set(chain, b + 4);
      out.set(types, b + 16);
      fxids.forEach((f, slot) => view.setUint32(b + 28 + 4 * slot, f, true));
    }
    if (id === 5) {
      out.set(on, b + 724);
      for (const [slot, params] of Object.entries(values)) {
        for (const [id, v] of Object.entries(params)) view.setFloat32(b + 4 + Number(slot) * 60 + Number(id) * 4, v, true);
      }
    }
    at = b + size;
  }
  return out;
}

const withHeader = (n: number, b: Uint8Array) => Uint8Array.from([n, 0, 0, 0, ...b]);

/** A literal-only LZO1X stream of any length (long-run form), as a .prst carries. */
function literalStream(data: Uint8Array): number[] {
  const zeros = Math.floor((data.length - 18) / 255);
  return [0, ...new Array<number>(zeros).fill(0), data.length - 18 - 255 * zeros, ...data, 0x11, 0, 0];
}
const prstText = (b: Uint8Array) => Buffer.from(JSON.stringify(literalStream(b))).toString('base64');

// Synthetic catalog (invented models).
const CATALOG = fakeCatalog([
  ['DYN', 0, [model(0x1b, 'Fake Gate', 'Imaginary Gate', [w('Threshold', 0, -80, 0)])]],
  ['DRV', 3, [model(0x301, 'Fake Drive', 'Imaginary OD', [w('Gain', 0), w('Level', 2)])]],
  ['AMP', 4, [model(0x401, 'Fake Amp', 'Imaginary Amp', [w('Gain', 0), w('Master', 3)])]],
]);

test('parses the real device preset: number, name, style and chain in signal order', () => {
  assert.equal(DRIVE_AD.length, MB_PRESET_SIZE);
  const p = parseMbPreset(DRIVE_AD);
  assert.equal(p.number, 0x43);
  assert.equal(p.name, 'Drive AD'); // stale "II PRO" after the NUL is ignored
  assert.equal(p.style, 'Rock');
  assert.deepEqual(
    p.chain.map((b) => [b.slot, b.moduleIndex, b.fxid, b.on]),
    [
      [1, 0, 0x0000001b, true],
      [0, 3, 0x0300002a, false],
      [2, 4, 0x0700001a, true],
      [3, 5, 0x0a000006, true],
      [4, 10, 0x0c00000b, true],
      [5, 15, 0x06000003, true],
    ],
  );
  assert.deepEqual(p.chain[1]?.values.slice(0, 3), [15, 50, 14]);
  assert.equal(p.chain[0]?.values.length, 15);
});

test('keeps every section raw, so a later writer can serialize the preset back byte for byte', () => {
  const p = parseMbPreset(DRIVE_AD);
  assert.deepEqual(
    p.sections.map((s) => [s.id, s.body.length]),
    LAYOUT.map(([id, size]) => [id, size]),
  );
  const rebuilt = Uint8Array.from([
    ...DRIVE_AD.subarray(0, 4),
    ...p.sections.flatMap((s) => {
      const head = new Uint8Array(8);
      new DataView(head.buffer).setUint32(0, s.tag, true);
      new DataView(head.buffer).setUint32(4, s.body.length, true);
      return [...head, ...s.body];
    }),
  ]);
  assert.deepEqual(rebuilt, DRIVE_AD);
});

test('the parsed preset is frozen and does not share memory with the input', () => {
  const input = Uint8Array.from(DRIVE_AD);
  const p = parseMbPreset(input);
  assert.ok(Object.isFrozen(p) && Object.isFrozen(p.chain) && Object.isFrozen(p.chain[0]) && Object.isFrozen(p.sections));
  input[39] = 0x58;
  assert.equal(p.sections[1]?.body[8], 0x44); // still "D"
});

test('a .prst body (1207 bytes, no header) parses with no number', () => {
  const p = parseMbPreset(body({ name: 'Body Only' }));
  assert.equal(p.number, null);
  assert.equal(p.name, 'Body Only');
});

test('parseMatriboxPrst reads base64 of a JSON byte array holding a raw LZO1X stream', () => {
  const p = parseMatriboxPrst(prstText(body({ name: 'From File', values: { 0: { 0: 7.5 } } })));
  assert.equal(p.name, 'From File');
  assert.equal(p.number, null);
  assert.deepEqual(
    p.chain.map((b) => b.slot),
    [1, 0],
  );
  assert.equal(p.chain[1]?.values[0], 7.5);
});

test('parseMatriboxPrst rejects text that is not a preset file', () => {
  assert.throws(() => parseMatriboxPrst('not base64 at all!'), /\.prst/);
  assert.throws(() => parseMatriboxPrst(Buffer.from('{"a":1}').toString('base64')), /byte array/);
  assert.throws(() => parseMatriboxPrst(Buffer.from('[1,2,300]').toString('base64')), /byte array/);
  assert.throws(() => parseMatriboxPrst(Buffer.from('[1,2,3]').toString('base64')), /LZO1X/);
  assert.throws(() => parseMatriboxPrst(prstText(withHeader(1, body()))), /1207/); // a device dump is not a .prst
});

test('rejects presets of the wrong size or with broken sections', () => {
  assert.throws(() => parseMbPreset(new Uint8Array(100)), /1211 or 1207/);
  const badTag = body({ tag: 0x12345678 });
  assert.throws(() => parseMbPreset(badTag), /tag/);
  const badId = body();
  badId[8 + 2] = 6;
  assert.throws(() => parseMbPreset(badId), /section 0/);
  const badLength = body();
  new DataView(badLength.buffer).setUint32(4, 12, true);
  assert.throws(() => parseMbPreset(badLength), /length/);
});

test('rejects a chain that names a slot twice, a slot out of range or an unused slot', () => {
  assert.throws(() => parseMbPreset(body({ chain: [0, 0] })), /twice/);
  assert.throws(() => parseMbPreset(body({ chain: [12] })), /slot 12/);
  assert.throws(() => parseMbPreset(body({ chain: [0, 1], types: [3, 0xff] })), /no module/);
});

test("resolves names against the catalog, reading only the selected model's parameters", () => {
  const p = parseMbPreset(body({ values: { 0: { 0: 41, 1: 999, 2: 60 }, 1: { 0: 7, 3: 8, 5: 20001 } } }));
  const r = resolveMbPreset(p, CATALOG);
  assert.equal(r.name, 'Synth');
  assert.deepEqual(
    r.chain.map((b) => [b.position, b.slot, b.module, b.model?.name, b.on]),
    [
      [1, 1, 'AMP', 'Fake Amp', false],
      [2, 0, 'DRV', 'Fake Drive', true],
    ],
  );
  assert.equal(r.chain[0]?.model?.basedOn, 'Imaginary Amp');
  // Stale values at positions the model does not use (999, 20001) are never shown.
  assert.deepEqual(
    r.chain[0]?.params.map((x) => [x.name, x.value, x.min, x.max]),
    [
      ['Gain', 7, 0, 100],
      ['Master', 8, 0, 100],
    ],
  );
  assert.deepEqual(
    r.chain[1]?.params.map((x) => [x.name, x.value]),
    [
      ['Gain', 41],
      ['Level', 60],
    ],
  );
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.chain[0]?.params));
});

test('an fxid the catalog does not know is kept raw and flagged', () => {
  const r = resolveMbPreset(parseMbPreset(body({ fxids: [0x301, 0x499] })), CATALOG);
  assert.equal(r.chain[0]?.model, null);
  assert.equal(r.chain[0]?.fxid, 0x499);
  assert.equal(r.chain[0]?.module, 'AMP');
  assert.deepEqual(r.chain[0]?.params, []);
  const unknownModule = resolveMbPreset(parseMbPreset(body({ types: [3, 9] })), CATALOG);
  assert.equal(unknownModule.chain[0]?.module, 'module 9');
});

test('mbPresetLabel: four presets per bank, A..D', () => {
  assert.equal(mbPresetLabel(0), '1A');
  assert.equal(mbPresetLabel(66), '17C');
  assert.equal(mbPresetLabel(239), '60D'); // the capture's select of 60D sent 0xEF
  assert.throws(() => mbPresetLabel(240), /0\.\.239/);
});

test('parseMbPresetLabel reads 1A..60D (case-insensitive) and refuses the rest', () => {
  assert.equal(parseMbPresetLabel('1A'), 0);
  assert.equal(parseMbPresetLabel('17c'), 66);
  assert.equal(parseMbPresetLabel(' 60D '), 239);
  for (let i = 0; i < 240; i += 37) assert.equal(parseMbPresetLabel(mbPresetLabel(i)), i);
  for (const bad of ['0A', '61A', '1E', 'P01', '', '1']) assert.throws(() => parseMbPresetLabel(bad), /preset label/, bad);
});

/** The 1207-byte body a .prst written by us holds. */
const prstBody = (text: string) => lzo1xDecompress(Uint8Array.from(JSON.parse(atob(text)) as number[]));

test('writeMatriboxPrst round-trips the real device preset: same sections, .prst tags, no number', () => {
  const device = parseMbPreset(DRIVE_AD);
  const text = writeMatriboxPrst(device);
  assert.match(text, /^[A-Za-z0-9+/]+={0,2}$/);
  const back = parseMatriboxPrst(text);
  assert.equal(back.number, null);
  assert.deepEqual([back.name, back.style, back.chain], [device.name, device.style, device.chain]);
  assert.deepEqual(
    back.sections.map((s) => [s.id, s.tag, [...s.body]]),
    device.sections.map((s) => [s.id, 0x10000002, [...s.body]]),
  );
  // The body is the device reply without its u32 number, with the .prst section tag.
  const expected = Uint8Array.from(DRIVE_AD.subarray(4));
  let at = 0;
  for (const [, size] of LAYOUT) {
    new DataView(expected.buffer).setUint32(at, 0x10000002, true);
    at += 8 + size;
  }
  assert.deepEqual(prstBody(text), expected);
});

test('writeMatriboxPrst is the inverse of parseMatriboxPrst on a .prst body, byte for byte', () => {
  const original = body({ name: 'From File', values: { 0: { 0: 7.5, 14: -3 } } });
  const parsed = parseMatriboxPrst(prstText(original));
  assert.deepEqual(prstBody(writeMatriboxPrst(parsed)), original);
  assert.deepEqual(parseMatriboxPrst(writeMatriboxPrst(parsed)), parsed);
});
