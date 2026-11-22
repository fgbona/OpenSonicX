import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGES, translate, detectLang, translateError, progressText } from '../lib/i18n.ts';

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

test('Portuguese and English have the same keys', () => {
  assert.deepEqual(Object.keys(MESSAGES.pt).sort(), Object.keys(MESSAGES.en).sort());
});

test('every message uses the same placeholders in both languages', () => {
  for (const key of Object.keys(MESSAGES.en) as (keyof typeof MESSAGES.en)[]) {
    assert.deepEqual(placeholders(MESSAGES.pt[key]), placeholders(MESSAGES.en[key]), key);
  }
});

test('translate fills placeholders and leaves unknown ones visible', () => {
  assert.equal(translate('pt', 'save.submit', { slot: 'P03' }), 'Salvar em P03');
  assert.equal(translate('en', 'save.submit', { slot: 'P03' }), 'Save to P03');
  assert.equal(translate('en', 'save.submit', {}), 'Save to {slot}');
});

test('detectLang picks Portuguese for any pt locale and English otherwise', () => {
  assert.equal(detectLang(['pt-BR', 'en']), 'pt');
  assert.equal(detectLang(['pt']), 'pt');
  assert.equal(detectLang(['en-US', 'pt-BR']), 'en');
  assert.equal(detectLang(['fr-FR']), 'en');
  assert.equal(detectLang([]), 'en');
});

test('translateError maps the editor\'s own messages and keeps protocol errors as they are', () => {
  assert.equal(translateError('pt', 'Choose an input and an output port first.'), 'Escolha uma porta de entrada e uma de saída primeiro.');
  assert.equal(translateError('pt', 'Could not open the ports: busy'), 'Não foi possível abrir as portas: busy');
  assert.equal(translateError('pt', 'record 0x3003 is too short'), 'record 0x3003 is too short');
  assert.equal(translateError('en', 'Choose an input and an output port first.'), 'Choose an input and an output port first.');
});

test('progressText translates the save steps', () => {
  assert.equal(progressText('pt', 'Backing up P03'), 'Fazendo backup do P03');
  assert.equal(progressText('pt', 'Saved P03'), 'P03 salvo');
  assert.equal(progressText('pt', 'Preparing'), 'Preparando');
  assert.equal(progressText('en', 'Saving P03'), 'Saving P03');
});

test('progressText translates every busy step the editor shows', () => {
  assert.equal(progressText('pt', 'Loading'), 'Carregando');
  assert.equal(progressText('pt', 'Renaming'), 'Renomeando');
  assert.equal(progressText('pt', 'Uploading'), 'Enviando');
  assert.equal(progressText('pt', 'Reading settings'), 'Lendo as opções');
  assert.equal(progressText('pt', 'Factory reset'), 'Restaurando os padrões de fábrica');
  assert.equal(progressText('en', 'Reading settings'), 'Reading settings');
});

test('translateError translates a factory reset that was not sent', () => {
  assert.equal(translateError('pt', 'Factory reset was not sent: timeout'), 'A restauração de fábrica não foi enviada: timeout');
});

test('translateError covers the preset file errors raised by core', () => {
  assert.equal(translateError('pt', 'not a Pocket Master preset file'), 'Este arquivo não é um preset da Pocket Master.');
  assert.equal(translateError('pt', 'not a Pocket Master preset file (invalid JSON)'), 'Este arquivo não é um preset da Pocket Master.');
  assert.equal(translateError('pt', 'the preset file is damaged and cannot be read'), 'O arquivo de preset está danificado e não pode ser lido.');
});
