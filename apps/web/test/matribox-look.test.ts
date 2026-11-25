import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MB_MODULE_KEYS, mbAmpSkin, mbControl, mbFxidHex, mbLookKey, mbModelValue, mbModuleKey, mbSteps, parseMbModelValue } from '../lib/matriboxLook.ts';

test('a model menu value names the module and the model', () => {
  assert.deepEqual(parseMbModelValue(mbModelValue(3, 0x03000010)), { moduleIndex: 3, fxid: 0x03000010 });
  assert.equal(parseMbModelValue(''), null);
  assert.equal(parseMbModelValue('3:x'), null);
});

test('a block read without the catalog keeps its module look by index', () => {
  assert.equal(mbLookKey({ module: 'module 3', moduleIndex: 3 }), 'drv');
  assert.equal(mbLookKey({ module: 'module 15', moduleIndex: 15 }), 'vol');
  assert.equal(mbLookKey({ module: 'module 40', moduleIndex: 40 }), 'other');
  assert.equal(mbLookKey({ module: 'AMP', moduleIndex: 0 }), 'amp');
  assert.equal(mbFxidHex(0x0300002a), '0x0300002a');
});

test('every Matribox module has its own look key; unknown modules share the neutral one', () => {
  for (const name of ['DYN', 'FREQ', 'WAH', 'DRV', 'AMP', 'CAB', 'IR', 'EQ', 'MOD', 'DLY', 'RVB', 'CLONE', 'FXLOOP', 'FXSND', 'FXRTN', 'VOL']) {
    assert.equal(mbModuleKey(name), name.toLowerCase());
  }
  assert.equal(new Set(MB_MODULE_KEYS).size, 16);
  assert.equal(mbModuleKey('FX Loop'), 'fxloop');
  assert.equal(mbModuleKey('module 3'), 'other');
  assert.equal(mbModuleKey(''), 'other');
});

test('an amp model takes the finish of the gear its origin names', () => {
  const cases: [string, string | null][] = [
    ['Marshall JCM800', 'marshall'],
    ['Imaginary Plexi 50W', 'marshall'],
    ['Fender Tweed Deluxe', 'tweed'],
    ['Fender Bassman', 'tweed'],
    ['Fender Twin Reverb', 'blackface'],
    ['Fender\nDeluxe Reverb', 'blackface'],
    ['Mesa/Boogie Dual Rectifier', 'mesa'],
    ['MESA Boogie Mark V', 'mesa'],
    ['Vox AC30 Top Boost', 'vox'],
    ['Soldano SLO-100', 'hotrod'],
    ['Peavey 5150', 'metal'],
    ['EVH 5150 III', 'metal'],
    ['ENGL Powerball', 'german'],
    ['Diezel VH4', 'german'],
    ['Bogner Ecstasy', 'boutique'],
    ['Friedman BE-100', 'boutique'],
    ['Roland JC-120 Jazz Chorus', 'jazz'],
    ['Ampeg SVT', 'bass'],
    ['Fender Bassman 100 bass amp', 'bass'],
    ['Imaginary Amplifier', null],
    ['55', null],
    ['', null],
  ];
  for (const [origin, skin] of cases) assert.equal(mbAmpSkin(origin), skin, origin);
});

test('a parameter is a switch (0..1), a small selector (a few whole steps) or a knob', () => {
  assert.equal(mbControl({ min: 0, max: 1, step: 1 }), 'switch');
  assert.equal(mbControl({ min: 0, max: 3, step: 1 }), 'select');
  assert.equal(mbControl({ min: 0, max: 7, step: 1 }), 'select');
  assert.equal(mbControl({ min: 0, max: 100, step: 1 }), 'knob');
  assert.equal(mbControl({ min: 0, max: 1, step: 0.01 }), 'knob');
  assert.equal(mbControl({ min: -80, max: 0, step: 1 }), 'knob');
  assert.equal(mbControl({ min: 0, max: 3, step: 0 }), 'knob');
  assert.deepEqual(mbSteps({ min: 0, max: 3, step: 1 }), [0, 1, 2, 3]);
  assert.deepEqual(mbSteps({ min: 1, max: 2, step: 0.5 }), [1, 1.5, 2]);
});
