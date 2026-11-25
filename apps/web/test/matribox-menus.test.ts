import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMbCatalog } from '@pocket-master/core';
import { FAKE_ALG_DATA } from '../../../packages/core/test/matribox-fake-catalog.ts';
import { MB_MODULE_KEYS } from '../lib/matriboxLook.ts';
import { mbMenuModels, mbMenuModules } from '../lib/matriboxMenus.ts';

const catalog = parseMbCatalog(FAKE_ALG_DATA);
const names = (groups: ReturnType<typeof mbMenuModels>) => groups.map((g) => [g.name, g.options.map((o) => o.name)]);
const opts = { other: 'Other', unknown: (hex: string) => `Unknown model (${hex})` };

test("a block's model menu lists only its module's models, under their type headings", () => {
  const drv = mbMenuModels(catalog, 3, [], opts);
  assert.deepEqual(names(drv), [
    ['Overdrive', ['Fake Drive']],
    ['Fuzz', ['Fake Fuzz']],
  ]);
  assert.deepEqual(drv[0]!.options[0], { value: '3:50331690', name: 'Fake Drive', detail: 'Imaginary Overdrive 808' });
  // An origin that is only a number, or empty, is not gear.
  assert.equal(mbMenuModels(catalog, 5, [], opts)[0]!.options[0]!.detail, undefined);
});

test('groups follow the catalog order of first appearance; models keep catalog order inside a group', () => {
  const m = (fxid: number, name: string, type: string) => ({ fxid, index: 0, name, type, origin: '', widget: [] });
  const amps = parseMbCatalog({ Modules: [{ name: 'AMP', index: 4, alg: [m(1, 'A', 'Clean'), m(2, 'B', 'Drive'), m(3, 'C', 'Clean'), m(4, 'D', 'Hi Gain'), m(5, 'E', 'Drive')] }] });
  assert.deepEqual(names(mbMenuModels(amps, 4, [], opts)), [
    ['Clean', ['A', 'C']],
    ['Drive', ['B', 'E']],
    ['Hi Gain', ['D']],
  ]);
  // An empty type among named ones goes under "Other", where it first appears.
  const mixed = parseMbCatalog({ Modules: [{ name: 'DYN', index: 0, alg: [m(1, 'A', ''), m(2, 'B', 'Comp')] }] });
  assert.deepEqual(names(mbMenuModels(mixed, 0, [], opts)), [
    ['Other', ['A']],
    ['Comp', ['B']],
  ]);
});

test('a module with one type (or only empty types) shows no heading', () => {
  assert.deepEqual(names(mbMenuModels(catalog, 9, [], opts)), [[null, ['Fake Echo']]]);
  assert.deepEqual(names(mbMenuModels(catalog, 11, [], opts)), [[null, ['Clone 1']]]);
  assert.deepEqual(mbMenuModels(catalog, 7, [], opts), []); // a module the catalog has no models for
});

test("IR and CLONE models show the user's name for their slot, the catalog name beside it", () => {
  const ir = mbMenuModels(catalog, 6, [], { ...opts, userName: (fxid) => (fxid === 0x0a100000 ? 'My Cab.wav' : undefined) });
  assert.deepEqual(ir[0]!.options[0], { value: '6:168820736', name: 'My Cab.wav', detail: 'User IR 1' });
});

test('without the catalog: every module by index, and models only by the raw ids the chain uses', () => {
  const modules = mbMenuModules(null);
  assert.deepEqual(
    modules.map((m) => m.key),
    [...MB_MODULE_KEYS],
  );
  assert.deepEqual(modules[3], { index: 3, name: 'DRV', key: 'drv' });
  assert.deepEqual(mbMenuModules(catalog)[1], { index: 3, name: 'DRV', key: 'drv' });
  const raw = mbMenuModels(null, 3, [0x0300002a, 0x0300002a, 0x03000010], opts);
  assert.deepEqual(raw, [
    {
      name: null,
      options: [
        { value: '3:50331690', name: 'Unknown model (0x0300002a)' },
        { value: '3:50331664', name: 'Unknown model (0x03000010)' },
      ],
    },
  ]);
  assert.deepEqual(mbMenuModels(null, 9, [], opts), []);
});
