import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MB_DSP_HIGH, mbCheckDspLoad, mbDspLoad } from '../src/matribox/dsp-load.ts';
import { parseMbNotice, type MbNotice } from '../src/matribox/notice.ts';
import { matriboxLink } from '../src/matribox/link.ts';
import { parseMbPreset } from '../src/matribox/preset.ts';
import { mbAddBlock } from '../src/matribox/write.ts';
import { FakeMatribox } from './fake-matribox.ts';

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Module indexes: DYN 0, FREQ 1, DRV 3, AMP 4, CAB 5, IR 6, EQ 7, MOD 8, DLY 9, RVB 10, CLONE 11, VOL 15. */
const chain = (...modules: number[]) => modules.map((moduleIndex) => ({ moduleIndex }));
const typical = chain(0, 3, 4, 5, 10, 15); // gate, drive, amp, cab, reverb, volume
const twelve = chain(0, 1, 3, 3, 4, 5, 7, 8, 8, 9, 10, 15); // the owner's kind of 12-block preset

test('a typical chain is well within the estimate; a full 12-block chain is past it', () => {
  assert.deepEqual(mbDspLoad(typical), { percent: 58, bigMemory: 1, level: 'ok' });
  const full = mbDspLoad(twelve);
  assert.equal(full.level, 'over');
  assert.ok(full.percent > 100, `${full.percent}%`);
  assert.equal(mbDspLoad([]).percent, 0);
});

test('near the limit is high; a third CAB/IR/CLONE is over whatever the cycles', () => {
  const high = mbDspLoad(chain(0, 3, 4, 5, 8, 9, 10, 15, 1)); // 87%
  assert.ok(high.percent >= MB_DSP_HIGH && high.percent <= 100, `${high.percent}%`);
  assert.equal(high.level, 'high');
  assert.deepEqual(mbDspLoad(chain(5, 6, 11)), { percent: 59, bigMemory: 3, level: 'over' });
});

test('the check refuses an edit that adds load past the limit, naming what to drop', () => {
  assert.equal(mbCheckDspLoad([], typical), '');
  assert.throws(() => mbCheckDspLoad(typical, twelve), /DSP load 1\d\d% \(an estimate.*heaviest: CAB ~19%, RVB ~17%, FREQ ~13%/);
  assert.throws(() => mbCheckDspLoad(typical, [...typical, ...chain(6, 11)]), /3 CAB\/IR\/CLONE blocks.*memory for 2/);
  assert.match(mbCheckDspLoad(typical, chain(0, 3, 4, 5, 8, 9, 10, 15, 1)), /^Note: estimated DSP load 87%/);
});

test('an edit that does not add load is never refused, even on a chain already past the limit', () => {
  assert.match(mbCheckDspLoad(twelve, twelve), /^Note:/); // a knob turned on an overloaded preset
  assert.match(mbCheckDspLoad(twelve, twelve.slice(1)), /^Note:/); // a block removed, still past it
  assert.doesNotThrow(() => mbCheckDspLoad(chain(5, 6, 11, 4), chain(5, 6, 11)));
});

test('the overload notice decodes its cause (zxmarcos/matribox-studio: 1 DSP, 2 memory)', () => {
  const overload = (cause: number) => parseMbNotice({ flag: 1, cmd: 0x11, data: Uint8Array.of(0, 7, 0, 0, cause, 0, 0, 0) });
  assert.deepEqual(overload(1), { kind: 'overload', cause: 'cpu' });
  assert.deepEqual(overload(2), { kind: 'overload', cause: 'memory' });
  assert.equal(overload(0), null); // the flag cleared
});

test('the simulated unit refuses a third CAB/IR/CLONE and switches everything off past the DSP, with the notice', async () => {
  const fake = new FakeMatribox();
  fake.noise = [];
  fake.cpuOverload = true;
  const link = matriboxLink({ send: (b) => fake.send(b), listen: (r) => fake.listen(r ?? (() => undefined)) }, 1000);
  const seen: MbNotice[] = [];
  link.onNotice((n) => seen.push(n));
  const loaded = () => parseMbPreset(fake.editBuffer).chain;
  const start = loaded().length; // "Drive AD": one CAB
  await link.write(mbAddBlock(start, 6, 0x0a100000)); // an IR: two now
  await link.write(mbAddBlock(start + 1, 11, 0x0f000000)); // a CLONE: refused
  await tick();
  assert.equal(loaded().length, start + 1);
  assert.deepEqual(
    seen.filter((n) => n.kind === 'overload'),
    [{ kind: 'overload', cause: 'memory' }],
  );
  while (mbDspLoad(loaded()).percent <= 100) await link.write(mbAddBlock(loaded().length, 1, 0x01000019)); // FREQ until past the DSP
  await tick();
  assert.deepEqual(seen.filter((n) => n.kind === 'overload').at(-1), { kind: 'overload', cause: 'cpu' });
  assert.ok(loaded().every((b) => !b.on));
});
