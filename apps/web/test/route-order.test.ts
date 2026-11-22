import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveInOrder, orderRoute, rotated } from '../lib/route-order.ts';

test('the saved order comes first, then providers added since, in the default order', () => {
  assert.deepEqual(orderRoute(['openai', 'anthropic', 'groq', 'flash', 'lite'], ['groq', 'openai']), ['groq', 'openai', 'anthropic', 'flash', 'lite']);
  assert.deepEqual(orderRoute(['groq', 'flash', 'lite'], ['openai', 'flash']), ['flash', 'groq', 'lite'], 'a removed provider is skipped');
  assert.deepEqual(orderRoute(['groq'], []), ['groq']);
});

test('a provider moves one place up or down, and stays put at either end', () => {
  const order = ['openai', 'groq', 'flash'] as const;
  assert.deepEqual(moveInOrder(order, 'groq', -1), ['groq', 'openai', 'flash']);
  assert.deepEqual(moveInOrder(order, 'groq', 1), ['openai', 'flash', 'groq']);
  assert.deepEqual(moveInOrder(order, 'openai', -1), ['openai', 'groq', 'flash']);
  assert.deepEqual(moveInOrder(order, 'flash', 1), ['openai', 'groq', 'flash']);
});

test('rotation starts each new conversation one provider further, wrapping around', () => {
  const route = ['openai', 'anthropic', 'groq'] as const;
  assert.deepEqual(rotated(route, 0), ['openai', 'anthropic', 'groq']);
  assert.deepEqual(rotated(route, 1), ['anthropic', 'groq', 'openai']);
  assert.deepEqual(rotated(route, 4), ['anthropic', 'groq', 'openai']);
  assert.deepEqual(rotated([], 3), []);
});
