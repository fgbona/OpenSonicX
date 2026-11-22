import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatModels, pickModel, PAID, paidById } from '../lib/providers.ts';

test('the paid providers are the ones chosen, each with its API and key page', () => {
  assert.deepEqual(PAID.map((p) => p.id), ['openrouter', 'openai', 'xai', 'deepseek', 'mistral', 'cerebras']);
  for (const p of PAID) {
    assert.match(p.api, /^https:\/\/[^/]+\.[a-z]+(\/.*)?$/, p.id);
    assert.match(p.keys, /^https:\/\//, p.id);
  }
  assert.equal(paidById('openai')?.name, 'OpenAI');
});

test('a key\'s model list keeps chat models only, and a sensible one is preselected', () => {
  const ids = ['text-embedding-3-small', 'gpt-9-mini', 'tts-1', 'gpt-9', 'whisper-1', 'omni-moderation-latest'];
  assert.deepEqual(chatModels(ids), ['gpt-9', 'gpt-9-mini']);
  assert.equal(pickModel(paidById('openai')!, ids), 'gpt-9-mini');
  assert.equal(pickModel(paidById('deepseek')!, ['deepseek-reasoner', 'deepseek-chat']), 'deepseek-chat');
  assert.equal(pickModel(paidById('mistral')!, ['codestral-latest']), 'codestral-latest', 'the first chat model when no preferred one');
  assert.equal(pickModel(paidById('xai')!, []), null);
});
