import { test } from 'node:test';
import assert from 'node:assert/strict';
import { grantsWithoutPrompt } from '../src/permissions.ts';

test('the editor gets MIDI with SysEx without a prompt, so it opens the pedal by itself', () => {
  assert.equal(grantsWithoutPrompt('app://editor/', 'midi'), true);
  assert.equal(grantsWithoutPrompt('app://editor', 'midiSysex'), true);
});

test('nothing else, and no other origin, gets a permission', () => {
  assert.equal(grantsWithoutPrompt('app://editor/', 'media'), false);
  assert.equal(grantsWithoutPrompt('app://editor/', 'notifications'), false);
  assert.equal(grantsWithoutPrompt('https://tone3000.com/', 'midiSysex'), false);
  assert.equal(grantsWithoutPrompt('app://editor.evil/', 'midiSysex'), false);
});
