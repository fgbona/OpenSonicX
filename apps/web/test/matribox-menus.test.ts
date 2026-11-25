import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MB_CATALOG } from '@pocket-master/core';
import { FAKE_CATALOG as catalog, fakeCatalog, fakeModel } from '../../../packages/core/test/matribox-fake-catalog.ts';
import { MB_MODULE_KEYS } from '../lib/matriboxLook.ts';
import { mbMenuModels, mbMenuModules } from '../lib/matriboxMenus.ts';

const names = (groups: ReturnType<typeof mbMenuModels>) => groups.map((g) => [g.name, g.options.map((o) => o.name)]);
const opts = { other: 'Other' };

test("a block's model menu lists only its module's models, under their type headings", () => {
  const drv = mbMenuModels(catalog, 3, opts);
  assert.deepEqual(names(drv), [
    ['Overdrive', ['Fake Drive']],
    ['Fuzz', ['Fake Fuzz']],
  ]);
  assert.deepEqual(drv[0]!.options[0], { value: '3:50331690', name: 'Fake Drive', detail: 'Imaginary Overdrive 808' });
  // A model based on no real gear has no detail.
  assert.equal(mbMenuModels(catalog, 5, opts)[0]!.options[0]!.detail, undefined);
});

test('groups follow the catalog order of first appearance; models keep catalog order inside a group', () => {
  const m = (fxid: number, name: string, type: string) => fakeModel(fxid, name, '', [], '', type);
  const amps = fakeCatalog([['AMP', 4, [m(1, 'A', 'Clean'), m(2, 'B', 'Drive'), m(3, 'C', 'Clean'), m(4, 'D', 'Hi Gain'), m(5, 'E', 'Drive')]]]);
  assert.deepEqual(names(mbMenuModels(amps, 4, opts)), [
    ['Clean', ['A', 'C']],
    ['Drive', ['B', 'E']],
    ['Hi Gain', ['D']],
  ]);
  // An empty type among named ones goes under "Other", where it first appears.
  const mixed = fakeCatalog([['DYN', 0, [m(1, 'A', ''), m(2, 'B', 'Comp')]]]);
  assert.deepEqual(names(mbMenuModels(mixed, 0, opts)), [
    ['Other', ['A']],
    ['Comp', ['B']],
  ]);
});

test('a module with one type (or only empty types) shows no heading', () => {
  assert.deepEqual(names(mbMenuModels(catalog, 9, opts)), [[null, ['Fake Echo']]]);
  assert.deepEqual(names(mbMenuModels(catalog, 11, opts)), [[null, ['Clone 1']]]);
  assert.deepEqual(mbMenuModels(catalog, 7, opts), []); // a module the catalog has no models for
});

test("IR and CLONE models show the user's name for their slot, the catalog name beside it", () => {
  const ir = mbMenuModels(catalog, 6, { ...opts, userName: (fxid) => (fxid === 0x0a100000 ? 'My Cab.wav' : undefined) });
  assert.deepEqual(ir[0]!.options[0], { value: '6:168820736', name: 'My Cab.wav', detail: 'User IR 1' });
});

test('the built-in catalog lists every module of the unit, each with its models grouped by type', () => {
  const modules = mbMenuModules(MB_CATALOG);
  assert.deepEqual(
    modules.map((m) => m.key),
    [...MB_MODULE_KEYS],
  );
  assert.deepEqual(mbMenuModules(catalog)[1], { index: 3, name: 'DRV', key: 'drv' });
  for (const m of modules) assert.ok(mbMenuModels(MB_CATALOG, m.index, opts).flatMap((g) => g.options).length > 0, m.name);
  const amp = mbMenuModels(MB_CATALOG, 4, opts);
  assert.ok(amp.length > 1 && amp.every((g) => g.name), 'AMP models are grouped under type headings');
});
