/**
 * Invented catalogs for tests of the editors, in the built-in map's schema. FAKE_CATALOG has the
 * fxids of the owner's "Drive AD"; each model has an invented `type` (the menus group by it);
 * CLONE's is empty. CAB 0x0a000006 is left out on purpose: an unknown model.
 */
import { mbCatalog, type MbCatalog, type MbMap, type MbTextMap } from '../src/matribox/catalog.ts';

type Model = MbMap['modules'][number]['models'][number];
type FakeModel = Omit<Model, 'index'> & { readonly name: string; readonly en: string; readonly pt?: string };

/** A parameter; its default is its minimum. */
export const fakeParam = (label: string, id: number, min = 0, max = 100) => ({ id, label, min, max, step: 1, default: min });
export const fakeModel = (fxid: number, name: string, basedOn: string, params: Model['params'], en = '', type = ''): FakeModel => ({ fxid, name, basedOn, params, en, type });

/** A catalog of modules [code, index, models]; a model's index is its position. */
export function fakeCatalog(modules: readonly (readonly [string, number, readonly FakeModel[]])[]): MbCatalog {
  const text: Record<string, MbTextMap[string]> = {};
  const map: MbMap = {
    modules: modules.map(([module, index, models]) => ({
      module,
      index,
      models: models.map(({ name, en, pt, ...m }, i) => {
        text[`${module}:${m.fxid}`] = { name, en, pt: pt ?? en };
        return { ...m, index: i };
      }),
    })),
  };
  return mbCatalog(map, text);
}

const p = fakeParam;
const model = fakeModel;

export const FAKE_CATALOG = fakeCatalog([
  ['DYN', 0, [model(0x1b, 'Fake Gate', 'Imaginary Gate', [p('Threshold', 0, -80, 0)], '', 'Gate')]],
  [
    'DRV',
    3,
    [
      { ...model(0x0300002a, 'Fake Drive', 'Imaginary Overdrive 808', [p('Gain', 0), p('Tone', 1), p('Volume', 2)], 'A mid-boost overdrive.', 'Overdrive'), pt: 'Um overdrive com médios.' },
      model(0x03000010, 'Fake Fuzz', 'Imaginary Fuzz Face', [p('Fuzz', 0), p('Level', 1)], '', 'Fuzz'),
    ],
  ],
  ['AMP', 4, [model(0x0700001a, 'Fake Plexi', 'Imaginary Plexi 50W', [p('Gain', 0), p('Master', 5)], '', 'Hi Gain')]],
  ['CAB', 5, [model(0x0a000001, 'Fake 4x12', '', [p('Volume', 1)], '', '4x12"')]],
  ['IR', 6, [model(0x0a100000, 'User IR 1', '', [p('Volume', 1)], '', 'User IR')]],
  ['DLY', 9, [model(0x0b000001, 'Fake Echo', 'Imaginary Tape Echo', [p('Mix', 0), p('Time', 1, 20, 2000)], '', 'Tape')]],
  ['RVB', 10, [model(0x0c00000b, 'Fake Hall', '', [p('Mix', 0), p('Decay', 1)], '', 'Hall')]],
  ['CLONE', 11, [model(0x0f000000, 'Clone 1', '', [p('Gain', 0)])]],
  ['VOL', 15, [model(0x06000003, 'Volume', 'Volume', [p('Volume', 0)])]],
]);
