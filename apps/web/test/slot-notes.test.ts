import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOTE_MAX, noteFor, parseNotes, withNote } from '../lib/slotNotes.ts';

test('a note belongs to a slot and the name it holds, so a new capture in the slot starts blank', () => {
  const notes = withNote({}, 'profile', 3, 'GK 250ML Death', '  Gallien-Krueger 250ML · pipppriss  ');
  assert.equal(noteFor(notes, 'profile', 3, 'GK 250ML Death'), 'Gallien-Krueger 250ML · pipppriss');
  assert.equal(noteFor(notes, 'profile', 3, 'Another capture'), undefined);
  assert.equal(noteFor(notes, 'ir', 3, 'GK 250ML Death'), undefined);
  assert.equal(noteFor(notes, 'profile', 3, null), undefined);
});

test('an empty note removes it, and notes are cut to their maximum length', () => {
  const notes = withNote(withNote({}, 'ir', 0, 'Marshal 80', 'Greenback 4x12'), 'ir', 0, 'Marshal 80', '   ');
  assert.deepEqual(notes, {});
  assert.equal(withNote({}, 'ir', 1, 'X', 'a'.repeat(200))['ir:1:X']?.length, NOTE_MAX);
});

test('stored notes are read defensively: bad JSON, wrong shapes and stray keys are dropped', () => {
  assert.deepEqual(parseNotes(null), {});
  assert.deepEqual(parseNotes('not json'), {});
  assert.deepEqual(parseNotes('[1,2]'), {});
  assert.deepEqual(parseNotes(JSON.stringify({ 'ir:0:A': 'ok', 'ir:9:B': 'bad slot', 'x:0:C': 'bad kind', 'profile:1:D': 5 })), { 'ir:0:A': 'ok' });
});
