import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMbCatalog } from '../src/matribox/catalog.ts';

// Synthetic: same shape as the official editor's alg_data.json, invented content. Numbers come
// as strings there, so both forms are accepted.
const widget = (name: string, ID: string, defaultValue: string, min = '0', max = '100', step = '1') => ({ name, ID, defaultValue, min, max, step, valueRange: `${min}-${max}`, widgetType: 0 });
const SAMPLE = {
  Base: { Version: 'test' },
  Modules: [
    {
      name: 'DRV',
      index: 0,
      alg: [
        {
          fxid: 101,
          index: 0,
          name: 'Fuzzy Duck',
          type: 'Fuzz',
          origin: 'Imaginary Fuzz',
          style: 'Vintage',
          descriptionEN: 'A fuzz.',
          widget: [widget('Gain', '0', '50'), widget('Level', '1', '+3', '-12', '12', '0.5')],
        },
        { fxid: 102, index: 1, name: 'Clean Boost', origin: 808, style: null, widget: [widget('Boost', '0', '10')] },
      ],
    },
    { name: 'DLY', index: 1, alg: [{ fxid: 201, index: 0, name: 'Tape Echo', widget: [{ ...widget('Time', '0', '300', '20', '1000'), min: 20, max: 1000, defaultValue: 300 }] }] },
  ],
};

test('parses modules, models and numeric params', () => {
  const catalog = parseMbCatalog(SAMPLE);
  assert.deepEqual(
    catalog.modules.map((m) => [m.name, m.index, m.models.length]),
    [
      ['DRV', 0, 2],
      ['DLY', 1, 1],
    ],
  );
  const fuzz = catalog.modules[0]?.models[0];
  assert.deepEqual(fuzz, {
    fxid: 101,
    index: 0,
    name: 'Fuzzy Duck',
    type: 'Fuzz',
    origin: 'Imaginary Fuzz',
    style: 'Vintage',
    description: 'A fuzz.',
    params: [
      { name: 'Gain', id: 0, defaultValue: 50, min: 0, max: 100, step: 1 },
      { name: 'Level', id: 1, defaultValue: 3, min: -12, max: 12, step: 0.5 },
    ],
  });
  assert.equal(catalog.modules[0]?.models[1]?.origin, '808');
  assert.equal(catalog.modules[0]?.models[1]?.style, '');
  assert.equal(catalog.modules[0]?.models[1]?.type, '');
  assert.equal(catalog.modules[1]?.models[0]?.params[0]?.defaultValue, 300);
});

test('the result is deeply frozen', () => {
  const catalog = parseMbCatalog(SAMPLE);
  assert.ok(Object.isFrozen(catalog));
  assert.ok(Object.isFrozen(catalog.modules));
  assert.ok(Object.isFrozen(catalog.modules[0]?.models[0]?.params[0]));
});

test('rejects malformed input with a path to the problem', () => {
  const withParam = (patch: object) => ({
    Modules: [{ name: 'DRV', index: 0, alg: [{ fxid: 1, index: 0, name: 'X', widget: [{ ...widget('Gain', '0', '50'), ...patch }] }] }],
  });
  assert.throws(() => parseMbCatalog(null), /object/);
  assert.throws(() => parseMbCatalog({}), /Modules/);
  assert.throws(() => parseMbCatalog({ Modules: [{ index: 0, alg: [] }] }), /Modules\[0\]\.name/);
  assert.throws(() => parseMbCatalog({ Modules: [{ name: 'A', index: 0, alg: [{ fxid: 'x', index: 0, name: 'X', widget: [] }] }] }), /alg\[0\]\.fxid/);
  assert.throws(() => parseMbCatalog(withParam({ min: 'abc' })), /widget\[0\]\.min/);
  assert.throws(() => parseMbCatalog(withParam({ min: '' })), /widget\[0\]\.min/);
  assert.throws(() => parseMbCatalog(withParam({ ID: '1.5' })), /widget\[0\]\.ID/);
  assert.throws(() => parseMbCatalog(withParam({ step: '0' })), /step/);
  assert.throws(() => parseMbCatalog(withParam({ min: '60' })), /range/);
  assert.throws(() => parseMbCatalog(withParam({ defaultValue: '101' })), /range/);
  assert.throws(() => parseMbCatalog({ Modules: [{ name: 'A', index: 0, alg: [{ fxid: 1, index: 0, name: 'X', type: true, widget: [] }] }] }), /type/);
});
