import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MB_CATALOG, mbCatalog, mbTextKey, type MbMap } from '../src/matribox/catalog.ts';

const read = (file: string) => readFileSync(new URL(`../src/matribox/${file}`, import.meta.url), 'utf8');
const MAP_TEXT = read('models.json');
const MAP = JSON.parse(MAP_TEXT) as MbMap & { version: number };
const TEXT = JSON.parse(read('model-text.json')) as Record<string, { name: string; gear?: string; en: string; pt: string }>;

interface Generator {
  buildMap(source: unknown, text?: unknown): unknown;
  assertClean(value: unknown): void;
  gear(origin: unknown): string;
  ALLOWED_KEYS: readonly string[];
}
// A non-literal specifier: the script is plain JS, with no types to resolve.
const SCRIPT: string = '../../../scripts/matribox-map.mjs';
const generator = () => import(SCRIPT) as Promise<Generator>;
/** The registered and trademark signs. */
const SIGNS = /[\u00ae\u2122]/;

const keysOf = (value: unknown): string[] => (Array.isArray(value) ? value.flatMap(keysOf) : value && typeof value === 'object' ? Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)]) : []);

test('models.json is the clean functional map: only our keys, none of the source texts or names, no trademark signs', async () => {
  const { ALLOWED_KEYS } = await generator();
  assert.deepEqual(
    [...new Set(keysOf(MAP))].filter((k) => !ALLOWED_KEYS.includes(k)),
    [],
  );
  assert.ok(!ALLOWED_KEYS.includes('name'), 'no model or module names in the map');
  // The source's description, parameter help, note, legal notice and title fields, by the start of their names.
  assert.doesNotMatch(MAP_TEXT, /"(descri|para[EC]N|remar|extra|copyri|fxtitle|name)/i);
  assert.doesNotMatch(MAP_TEXT, SIGNS);
  assert.equal(MAP.version, 1);
});

test('models.json holds every module and model of the unit, in our order, with sane ranges', () => {
  assert.deepEqual(
    MAP.modules.map((m) => m.module),
    ['DYN', 'FREQ', 'WAH', 'DRV', 'AMP', 'CAB', 'IR', 'EQ', 'MOD', 'DLY', 'RVB', 'CLONE', 'FXLOOP', 'FXSND', 'FXRTN', 'VOL'],
  );
  assert.deepEqual(
    MAP.modules.map((m) => m.index),
    MAP.modules.map((_, i) => i),
  );
  assert.equal(
    MAP.modules.reduce((n, m) => n + m.models.length, 0),
    267,
  );
  for (const m of MAP.modules) {
    assert.equal(new Set(m.models.map((a) => a.fxid)).size, m.models.length, `${m.module} fxids are unique`);
    for (const a of m.models) {
      for (const p of a.params) {
        assert.ok(p.step > 0 && p.min <= p.default && p.default <= p.max, `${m.module}:${a.fxid} ${p.label}`);
        if (p.options) assert.equal(p.options.length, Math.round((p.max - p.min) / p.step) + 1);
      }
    }
  }
});

test('model-text.json: every model has our own name and EN/PT text, names unique per module, no trademark signs', () => {
  const known = new Set(MAP.modules.flatMap((m) => m.models.map((a) => mbTextKey(m.module, a.fxid))));
  for (const key of known) {
    const t = TEXT[key];
    assert.ok(t?.name.trim() && t.en.trim() && t.pt.trim(), `text for ${key}`);
  }
  assert.deepEqual(
    Object.keys(TEXT).filter((k) => !known.has(k)),
    [],
  );
  for (const m of MAP.modules) {
    const names = m.models.map((a) => TEXT[mbTextKey(m.module, a.fxid)]?.name.trim().toLowerCase());
    assert.equal(new Set(names).size, names.length, `${m.module} names are unique`);
  }
  assert.doesNotMatch(read('model-text.json'), SIGNS);
});

// Brand and model tokens of real gear that a model's own name must not carry (the gear belongs in
// basedOn and the descriptions). Keep it in sync with model-text.json when names change.
const GEAR_TOKENS = /TS ?8|TS-?9|OCD|RAT|RIOT|GUV|FACE|CRY|UNI|OD-?1|SD-?1|CE-?1|DC-?2|BD-?2|PLEXI|PLX|RECT|JCM|MUFF|KLON|MESA|MARSH|FEND|BOSS|IBAN|SOLD|FRIED|DIEZ|ENGL|VOX|AC30|TWIN|BASSMAN/i;

test('no model name carries a brand or model token of real gear', () => {
  const offending = Object.entries(TEXT).flatMap(([key, t]) => (GEAR_TOKENS.test(t.name) ? [`${key} ${t.name}`] : []));
  assert.deepEqual(offending, []);
  assert.ok(GEAR_TOKENS.test('Green TS808') && GEAR_TOKENS.test('jcm800'), 'the pattern catches what it is for');
});

test('MB_CATALOG is the map with our names, the gear and descriptions in both languages', () => {
  const drv = MB_CATALOG.modules.find((m) => m.name === 'DRV');
  const first = drv?.models[0];
  assert.equal(drv?.index, 3);
  assert.equal(first?.name, TEXT[mbTextKey('DRV', first?.fxid ?? -1)]?.name);
  assert.ok(first?.basedOn);
  assert.ok(first?.description.en && first.description.pt);
  assert.ok(Object.isFrozen(MB_CATALOG) && Object.isFrozen(drv) && Object.isFrozen(first?.params[0]));
});

test('a model without text is named by module and index and described by its gear', () => {
  const map: MbMap = {
    modules: [
      { module: 'DRV', index: 3, models: [{ fxid: 9, index: 4, type: 'OD', basedOn: 'Imaginary OD', params: [{ id: 0, label: 'Mode', min: 0, max: 1, step: 1, default: 0, options: ['A', 'B'] }] }] },
    ],
  };
  const [model] = mbCatalog(map, {}).modules[0]?.models ?? [];
  assert.deepEqual(model, {
    fxid: 9,
    index: 4,
    name: 'DRV 4',
    type: 'OD',
    basedOn: 'Imaginary OD',
    description: { en: 'Imaginary OD', pt: 'Imaginary OD' },
    params: [{ name: 'Mode', id: 0, defaultValue: 0, min: 0, max: 1, step: 1, options: ['A', 'B'] }],
  });
  assert.equal(mbCatalog(map, { 'DRV:9': { name: 'Own', en: 'Mine.', pt: 'Meu.' } }).modules[0]?.models[0]?.description.pt, 'Meu.');
});

// Synthetic input in the source's shape, invented content.
const widget = (name: string, ID: string, defaultValue: string, extra: object = {}) => ({ name, ID, defaultValue, min: '0', max: '100', step: '1', valueRange: '0-100', widgetType: 0, ...extra });
const SOURCE = {
  Base: { notice: 'someone' },
  Modules: [
    {
      name: 'DLY',
      index: 9,
      alg: [
        { fxid: 2, index: 1, name: 'Invented', title: 'X', type: ' 4 x 12”', origin: 'Original: whatever', about: 'no', help: 'no', note: 'no', widget: [widget('Mix', '1', '+3')] },
        {
          fxid: 1,
          index: 0,
          name: 'Invented 2',
          type: 'Delay',
          origin: 'Imaginary\u00ae Echo\u2122\nAmpero Name: Other',
          widget: [widget('Mode', '1', '0', { min: '0', max: '2', valueRange: 'A, B, C', widgetType: 2 }), widget('Time', '0', '50')],
        },
      ],
    },
    { name: 'DYN', index: 0, alg: [] },
  ],
};

test('the generator keeps only our fields, in our order, and cleans the text', async () => {
  const { buildMap } = await generator();
  assert.deepEqual(buildMap(SOURCE), {
    version: 1,
    modules: [
      { module: 'DYN', index: 0, models: [] },
      {
        module: 'DLY',
        index: 9,
        models: [
          {
            fxid: 1,
            index: 0,
            type: 'Delay',
            basedOn: 'Imaginary Echo',
            params: [
              { id: 0, label: 'Time', min: 0, max: 100, step: 1, default: 50 },
              { id: 1, label: 'Mode', min: 0, max: 2, step: 1, default: 0, options: ['A', 'B', 'C'] },
            ],
          },
          { fxid: 2, index: 1, type: '4x12"', basedOn: '', params: [{ id: 1, label: 'Mix', min: 0, max: 100, step: 1, default: 3 }] },
        ],
      },
    ],
  });
});

test("the gear text is clean: no signs or *, no other maker's names, nothing for originals or numbers, one line", async () => {
  const { gear } = await generator();
  assert.equal(gear('Imaginary\u00ae Drive\u2122 *'), 'Imaginary Drive');
  assert.equal(gear('Imaginary Gate\nAmpero Name: Other Gate'), 'Imaginary Gate');
  assert.equal(gear('Imaginary Bass OD\nXTOMP/Ampero Name: Other OD'), 'Imaginary Bass OD');
  assert.equal(gear('Imaginary Amp (lead ch)\nAmpero name: Other'), 'Imaginary Amp (lead ch)');
  assert.equal(gear('Imaginary Amp Ampero Name: Other'), 'Imaginary Amp');
  assert.equal(gear('Original: Ampero 4-step filter'), '');
  assert.equal(gear('Original'), '');
  assert.equal(gear('55'), '');
  assert.equal(gear('binary ir cab: 39'), '');
  assert.equal(gear('Original: GP-100'), '');
  assert.equal(gear('XTOMP Imaginary'), '');
  assert.equal(gear('Imaginary Gate / ampero name: Other'), 'Imaginary Gate');
  assert.equal(gear('过载 Drive'), '');
  assert.equal(gear(null), '');
  assert.equal(gear('  Imaginary  Twin\n Normal CH  '), 'Imaginary Twin Normal CH');
});

test('models.json basedOn follows the same rules', () => {
  for (const m of MAP.modules) {
    for (const a of m.models) assert.doesNotMatch(a.basedOn, /^original|ampero|\*|\n|^\s|\s$/i, `${m.module}:${a.fxid}`);
  }
});

/** What must never reach the gear column: the source's own algorithms, IR files, another maker's products, a bare number. */
const NOT_GEAR = /original|binary ir|ampero|xtomp|gp-?100|^\s*\d+\s*$/i;

test('no basedOn or gear, in the map, our texts or the catalog, is an original, an IR file, another maker product or a bare number', () => {
  const values = [
    ...MAP.modules.flatMap((m) => m.models.map((a) => [`map ${m.module}:${a.fxid}`, a.basedOn])),
    ...Object.entries(TEXT).flatMap(([key, t]) => (t.gear === undefined ? [] : [[`gear ${key}`, t.gear]])),
    ...MB_CATALOG.modules.flatMap((m) => m.models.map((a) => [`catalog ${m.name}:${a.fxid}`, a.basedOn])),
  ];
  assert.deepEqual(
    values.filter(([, v]) => NOT_GEAR.test(v ?? '') || /[^\p{Script=Latin}\p{Script=Common}]/u.test(v ?? '')),
    [],
  );
  for (const [key, t] of Object.entries(TEXT)) {
    if (t.gear !== undefined) assert.ok(t.gear.trim(), `gear of ${key} is empty`);
    assert.doesNotMatch(`${t.name} ${t.en} ${t.pt}`, /binary ir|ampero|xtomp|gp-?100/i, key);
  }
});

test('every model has a meaningful name, not a numbered or lettered placeholder', () => {
  const generic = /^(DLY|VERB|EQ|SIMPLE|SHIMR)-?[A-Z0-9]$|#\d+$/;
  const offending = MB_CATALOG.modules.flatMap((m) => m.models.flatMap((a) => (generic.test(a.name) ? [`${m.name}:${a.fxid} ${a.name}`] : [])));
  assert.deepEqual(offending, []);
  assert.ok(generic.test('DLY-A') && generic.test('4x12 #25') && generic.test('SIMPLE-1') && !generic.test('Tweed 1x12'), 'the pattern catches what it is for');
});

test('our gear, when set, is the gear the catalog shows, and the text says so first', () => {
  for (const m of MB_CATALOG.modules) {
    for (const a of m.models) {
      const own = TEXT[mbTextKey(m.name, a.fxid)];
      if (!own?.gear) continue;
      assert.equal(a.basedOn, own.gear);
      assert.ok(own.en.startsWith(`Inspired by ${own.gear}.`) && own.pt.startsWith(`Inspirado no ${own.gear}.`), `${m.name}:${a.fxid}`);
    }
  }
  const map: MbMap = { modules: [{ module: 'CAB', index: 5, models: [{ fxid: 1, index: 0, type: '', basedOn: '', params: [] }] }] };
  assert.equal(mbCatalog(map, { 'CAB:1': { name: 'Own 1x12', gear: 'Imaginary 1x12', en: 'x', pt: 'y' } }).modules[0]?.models[0]?.basedOn, 'Imaginary 1x12');
});

test('the generator takes our gear over the source origin', async () => {
  const { buildMap } = await generator();
  const source = { Modules: [{ name: 'CAB', index: 5, alg: [{ fxid: 7, index: 0, type: '1 x 12”', origin: 'binary ir cab: 39', widget: [] }] }] };
  const modelOf = (map: unknown) => (map as MbMap).modules[0]?.models[0];
  assert.equal(modelOf(buildMap(source))?.basedOn, '');
  assert.equal(modelOf(buildMap(source, { 'CAB:7': { name: 'Own', gear: 'Imaginary\u00ae 1x12', en: '', pt: '' } }))?.basedOn, 'Imaginary 1x12');
});

test('the generator refuses any field outside the schema, trademark signs and malformed input', async () => {
  const { assertClean, buildMap } = await generator();
  assert.throws(() => assertClean({ modules: [{ models: [{ about: 'x' }] }] }), /about is not a field of the map/);
  assert.throws(() => assertClean({ modules: [{ models: [{ name: 'x' }] }] }), /name is not a field of the map/);
  assert.throws(() => assertClean({ modules: ['Brand\u2122'] }), /trademark sign/);
  assert.throws(() => buildMap({}), /Modules/);
  const withWidget = (patch: object) => ({ Modules: [{ name: 'DRV', index: 3, alg: [{ fxid: 1, index: 0, widget: [widget('Gain', '0', '50', patch)] }] }] });
  assert.throws(() => buildMap(withWidget({ min: 'abc' })), /min is not a number/);
  assert.throws(() => buildMap(withWidget({ step: '0' })), /step/);
  assert.throws(() => buildMap(withWidget({ defaultValue: '101' })), /range/);
  assert.throws(() => buildMap(withWidget({ ID: '1.5' })), /ID is not an integer/);
});
