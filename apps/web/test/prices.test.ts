import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerCost, parsePrices, priceOf } from '../lib/prices.ts';

const CATALOG = { data: [
  { id: 'anthropic/claude-haiku-5.5', pricing: { prompt: '0.000001', completion: '0.000005' } },
  { id: 'anthropic/claude-haiku-5.5:batch', pricing: { prompt: '0.0000005', completion: '0.0000025' } },
  { id: 'openai/gpt-oss-120b', pricing: { prompt: '0.0000001', completion: '0.0000005' } },
  { id: 'broken/model', pricing: { prompt: 'n/a' } },
] };

test('a provider\'s model id finds its price in the catalog, whatever the punctuation or vendor prefix', () => {
  const prices = parsePrices(CATALOG);
  assert.deepEqual(priceOf(prices, 'claude-haiku-5-5'), { input: 0.000001, output: 0.000005 }, 'the regular price, not the batch one');
  assert.deepEqual(priceOf(prices, 'anthropic/claude-haiku-5.5'), { input: 0.000001, output: 0.000005 });
  assert.deepEqual(priceOf(prices, 'openai/gpt-oss-120b'), { input: 0.0000001, output: 0.0000005 });
  assert.equal(priceOf(prices, 'unknown-model'), null);
  assert.equal(priceOf(prices, 'broken/model'), null);
});

test('an answer\'s cost: the provider\'s own figure when it gives one, else tokens times price, else none', () => {
  const price = { input: 0.000001, output: 0.000005 };
  assert.equal(answerCost({ input: 1000, output: 200, cost: 0.0042 }, price), 0.0042);
  assert.equal(answerCost({ input: 1000, output: 200 }, price), 0.002);
  assert.equal(answerCost({ input: 1000, output: 200 }, null), null);
  assert.equal(answerCost({ input: 0, output: 0 }, price), null, 'no usage reported');
});
