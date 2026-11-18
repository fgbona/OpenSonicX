import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  setBlockOn, setAmpMode, selectModel, setParam, setChain, validateChain, isAllowedEdit, encodeValue,
} from '../src/commands.ts';
import { buildFrame } from '../src/frame.ts';
import { queryFrame, Query } from '../src/queries.ts';
import { catalog, CLONE_MODULE, type ParamSpec } from '../src/catalog.ts';
import { toHex } from '../src/hex.ts';

// ~7400 commands captured from a real unit (PocketEdit library, via pocket-master-mcp, MIT).
type Lib = {
  moduleStates: Record<string, { on: string; off: string }>;
  ampModes: { factory: string; clone: string };
  effectTypes: Record<string, Record<string, string>>;
  parameters: Record<string, Record<string, Record<string, string>>>;
  chainOrderCommands: Record<string, string>;
};
const lib = JSON.parse(readFileSync(new URL('./fixtures/pocketedit-commands.json', import.meta.url), 'utf8')) as Lib;
/** Capture notation is BLE-MIDI: drop the 80 80 timestamp, keep F0 … F7. */
const capture = (h: string) => h.toUpperCase().replace(/^8080/, '').replace(/(..)(?!$)/g, '$1 ');
const MODULE = Object.fromEntries(catalog.blocks.map((b) => [b.label, b.module]));

test('setBlockOn matches every captured module on/off command', () => {
  for (const [mod, c] of Object.entries(lib.moduleStates)) {
    assert.equal(toHex(setBlockOn(Number(mod), true)), capture(c.on), `module ${mod} on`);
    assert.equal(toHex(setBlockOn(Number(mod), false)), capture(c.off), `module ${mod} off`);
  }
});

test('setAmpMode matches the captured amp mode commands', () => {
  assert.equal(toHex(setAmpMode(true)), capture(lib.ampModes.clone));
  assert.equal(toHex(setAmpMode(false)), capture(lib.ampModes.factory));
});

test('selectModel matches every captured effect selection', () => {
  const byId = new Map(Object.entries(catalog.models).flatMap(([key, ms]) => ms.map((m) => [`${key}:${m.id}`, m])));
  const keyOf = Object.fromEntries(catalog.blocks.map((b) => [b.module, b.key]));
  let n = 0;
  for (const [mod, fx] of Object.entries(lib.effectTypes)) {
    for (const [id, hex] of Object.entries(fx)) {
      if (id === '201') continue; // stored in a short 10-byte form in the capture library
      const clone = Number(id) >= 901;
      const model = byId.get(`${clone ? 'clone' : keyOf[Number(mod)]}:${id}`);
      assert.ok(model, `model ${id} in catalog`);
      assert.equal(toHex(selectModel(clone ? CLONE_MODULE : Number(mod), model.code)), capture(hex), `model ${id}`);
      n++;
    }
  }
  assert.ok(n > 100);
});

test('setParam matches every captured parameter command', () => {
  let n = 0;
  for (const [mod, algs] of Object.entries(lib.parameters)) {
    for (const [alg, values] of Object.entries(algs)) {
      if (mod === '8' && alg === '5') continue; // one mislabelled capture in the library
      for (const [value, hex] of Object.entries(values)) {
        assert.equal(toHex(setParam(Number(mod), Number(alg), Number(value))), capture(hex), `${mod}/${alg}=${value}`);
        n++;
      }
    }
  }
  assert.ok(n > 200);
});

test('setChain matches every captured chain order', () => {
  for (const [names, hex] of Object.entries(lib.chainOrderCommands)) {
    assert.equal(toHex(setChain(names.split('-').map((l) => MODULE[l]!))), capture(hex), names);
  }
});

test('validateChain keeps DRV-AMP-IR-EQ together and every module once', () => {
  assert.doesNotThrow(() => validateChain([0, 1, 2, 3, 4, 5, 6, 7, 8]));
  assert.throws(() => validateChain([0, 1, 2, 6, 3, 4, 5, 7, 8]), /together/);
  assert.throws(() => validateChain([0, 1, 2, 3, 4, 5, 6, 7, 7]), /exactly once/);
  assert.throws(() => setChain([0, 1, 3, 2, 4, 5, 6, 7, 8]), /together/);
});

test('isAllowedEdit accepts only chain, model, parameter and on/off commands', () => {
  assert.equal(isAllowedEdit(setParam(3, 4, 71)), true);
  assert.equal(isAllowedEdit(setBlockOn(2, false)), true);
  assert.equal(isAllowedEdit(selectModel(2, 1)), true);
  assert.equal(isAllowedEdit(setChain([0, 1, 2, 3, 4, 5, 6, 7, 8])), true);
  assert.equal(isAllowedEdit(buildFrame([0x11, 0x4a, 0, 0, 0, 0])), false, 'save');
  assert.equal(isAllowedEdit(buildFrame([0x11, 0x43, 7, 0, 0, 0])), false, 'select preset');
  assert.equal(isAllowedEdit(buildFrame([0x11, 0x11, 2, 2, 0, 0, 50, 0, 0, 0])), false, 'global');
  assert.equal(isAllowedEdit(buildFrame([0x11, 0x42, 1, 0x20, 1, 0, 50])), false, 'preset volume');
  assert.equal(isAllowedEdit(queryFrame(Query.EDIT_BUFFER)), false, 'query');
  assert.equal(isAllowedEdit(Uint8Array.from([0xf0, 0x7f, 0xf7])), false, 'garbage');
});

test('encodeValue validates and rounds by the catalog spec', () => {
  const knob: ParamSpec = { name: 'Gain', alg: 0, min: 0, max: 100, step: 1 };
  const rate: ParamSpec = { name: 'Rate', alg: 1, min: 0.1, max: 10, step: 0.1, unit: 'Hz' };
  const sw: ParamSpec = { name: '+3dB', alg: 1, type: 'switch' };
  const sel: ParamSpec = { name: 'Mode', alg: 2, type: 'select', options: ['Guitar', 'Bass'] };
  assert.equal(encodeValue(knob, 37.4), 37);
  assert.equal(encodeValue(rate, 0.5600001), 0.6);
  assert.equal(encodeValue(sw, true), 1);
  assert.equal(encodeValue(sw, 0), 0);
  assert.equal(encodeValue(sel, 'Bass'), 1);
  assert.equal(encodeValue(sel, 0), 0);
  assert.throws(() => encodeValue(knob, 101), /Gain must be 0\.\.100/);
  assert.throws(() => encodeValue(knob, Number.NaN), /Gain must be 0\.\.100/);
  assert.throws(() => encodeValue(sel, 'Banjo'), /Mode options: Guitar, Bass/);
  assert.throws(() => encodeValue(sel, 2), /Mode options/);
});
