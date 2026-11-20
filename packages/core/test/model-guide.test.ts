import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog } from '../src/catalog.ts';
import { GROUPS, groupModels, modelGuide } from '../src/model-guide.ts';

const models = Object.entries(catalog.models).filter(([key]) => key !== 'clone')
  .flatMap(([key, list]) => list.map((m) => ({ key, name: m.name })));

test('every catalog model has a plain-language label in both languages and a Portuguese description', () => {
  const missing = models.filter(({ key, name }) => {
    const guide = modelGuide(key, name);
    return !guide || !guide.label.en || !guide.label.pt || !guide.aboutPt || !(guide.group in GROUPS);
  });
  assert.deepEqual(missing, []);
});

test('labels stay short enough for a menu line', () => {
  const long = models.flatMap(({ key, name }) => {
    const label = modelGuide(key, name)!.label;
    return [label.en, label.pt].filter((l) => `${name} — ${l}`.length > 52).map((l) => `${name} — ${l}`);
  });
  assert.deepEqual(long, []);
});

test('models are grouped in the guide order, catalog order inside a group, unknown ones last', () => {
  const amps = [{ name: 'Bog XT' }, { name: 'Dark Twin' }, { name: 'Brit 800' }, { name: 'Jazz 120' }, { name: 'New Amp' }];
  assert.deepEqual(groupModels('amp', amps, 'pt').map((g) => [g.name, g.models.map((m) => m.name)]), [
    ['Limpo', ['Dark Twin', 'Jazz 120']],
    ['Crunch', ['Brit 800']],
    ['High gain', ['Bog XT']],
    [null, ['New Amp']],
  ]);
});
