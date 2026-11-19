import { test } from 'node:test';
import assert from 'node:assert/strict';
import { catalog, modelsFor } from '../src/catalog.ts';
import { MODEL_INFO, modelInfo } from '../src/model-info.ts';
import { modelChoices, resolveModel } from '../src/resolve.ts';

const none = { irNames: null, profileNames: null };

test('every model of every block is described, so an assistant knows the whole pedal', () => {
  for (const { key } of catalog.blocks) {
    for (const model of modelsFor(key)) {
      if (/^User IR \d$/.test(model.name)) continue;
      assert.ok(modelInfo(key, model.name)?.about, `${key}: ${model.name} has no description`);
    }
  }
});

test('every description names a model that exists in the catalog', () => {
  for (const [block, models] of Object.entries(MODEL_INFO)) {
    const names = modelsFor(block).map((m) => m.name);
    for (const model of Object.keys(models)) assert.ok(names.includes(model), `${block}: ${model} is not in the catalog`);
  }
});

test('a model says which real gear it is based on, from the manual', () => {
  assert.match(modelInfo('amp', 'Calif DualM')?.basedOn ?? '', /Mesa\/Boogie Dual Rectifier.*Modern/);
  assert.match(modelInfo('amp', 'Brit 800')?.basedOn ?? '', /JCM800/);
  assert.match(modelInfo('ir', 'Dual 4x12')?.basedOn ?? '', /Rectifier 4x12/);
  assert.match(modelInfo('fx2', 'COMP 2')?.basedOn ?? '', /Keeley C4/);
  assert.equal(modelInfo('amp', 'A BassVT')?.basedOn, undefined, 'not in the manual: no guess');
});

test('model choices carry what each model is based on', () => {
  const choice = modelChoices('amp', none).find((c) => c.name === 'Calif DualM');
  assert.match(choice?.basedOn ?? '', /Dual Rectifier/);
});

test('a model can be named by the gear it is based on', () => {
  assert.equal(resolveModel('amp', 'Dual Rectifier Modern', none).name, 'Calif DualM');
  assert.equal(resolveModel('amp', 'jcm800', none).name, 'Brit 800');
  assert.equal(resolveModel('amp', 'peavey 5150', none).name, 'Halen 51');
  assert.equal(resolveModel('drv', 'tube screamer', none).name, 'Scream');
  assert.throws(() => resolveModel('amp', 'Dual Rectifier', none), /matches several AMP models: .*Calif DualV.*Calif DualM/);
});

test('catalog names still win over gear words', () => {
  assert.equal(resolveModel('ir', 'Dual 4x12', none).name, 'Dual 4x12');
  assert.equal(resolveModel('amp', 'brit 800', none).name, 'Brit 800');
});
