import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EMPTY_HISTORY, record, redo, undo, type Snapshot } from '../lib/history.ts';

// Presets stand in as plain objects: the history only keeps and returns them.
const SNAPSHOTS = Array.from({ length: 150 }, (_, n) => ({ n }) as unknown as Snapshot);
const p = (n: number) => SNAPSHOTS[n]!;

test('undo walks back through the edits and redo forward again', () => {
  let h = record(EMPTY_HISTORY, p(0), 'a', 0);
  h = record(h, p(1), 'b', 5000);
  const u1 = undo(h, p(2))!;
  assert.equal(u1.target, p(1));
  const u2 = undo(u1.history, p(1))!;
  assert.equal(u2.target, p(0));
  assert.equal(undo(u2.history, p(0)), null);
  const r1 = redo(u2.history, p(0))!;
  assert.equal(r1.target, p(1));
  assert.equal(redo(r1.history, p(1))!.target, p(2));
});

test('turning one knob counts as one step, however many edits it sends', () => {
  let h = record(EMPTY_HISTORY, p(0), 'param:3:1', 0);
  h = record(h, p(1), 'param:3:1', 300);
  h = record(h, p(2), 'param:3:1', 900);
  assert.equal(h.past.length, 1);
  assert.equal(undo(h, p(3))!.target, p(0));
  // A pause, or another control, starts a new step.
  assert.equal(record(h, p(3), 'param:3:1', 2500).past.length, 2);
  assert.equal(record(h, p(3), 'param:3:2', 1000).past.length, 2);
});

test('a new edit after an undo drops what could have been redone', () => {
  const h = record(EMPTY_HISTORY, p(0), 'a', 0);
  const u = undo(h, p(1))!;
  const after = record(u.history, p(0), 'b', 5000);
  assert.equal(redo(after, p(5)), null);
});

test('the history keeps at most 100 steps', () => {
  const h = Array.from({ length: 150 }, (_, i) => i).reduce((acc, i) => record(acc, p(i), `k${i}`, i * 5000), EMPTY_HISTORY);
  assert.equal(h.past.length, 100);
  assert.equal(h.past[0]!.before, p(50));
});
