import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mbReadPresetNames, mbRequest, parseMbPresetNames } from '../src/matribox/message.ts';
import { mbAddBlock, mbSavePreset, mbSetBlockOn } from '../src/matribox/write.ts';
import { matriboxLink } from '../src/matribox/link.ts';
import { pedalOfPort } from '../src/pedals.ts';
import { FakeMatribox } from './fake-matribox.ts';

const link = (fake = new FakeMatribox(), timeoutMs = 1000) => matriboxLink({ send: (b) => fake.send(b), listen: (r) => fake.listen(r ?? (() => undefined)) }, timeoutMs);

test('the link joins a paged reply, skips unrelated notifications and returns the decompressed data', async () => {
  const data = await link().read(mbReadPresetNames());
  assert.equal(data.length, 7444);
  assert.equal(parseMbPresetNames(data)[66]?.name, 'Drive AD');
});

test('the link times out with a clear error when the unit does not answer', async () => {
  await assert.rejects(link(new FakeMatribox(), 50).read(mbRequest(0, 0x13)), /Matribox II PRO did not answer.*cmd 0x13/);
});

test('the link refuses a read that is not a read request, and post refuses anything but a write', async () => {
  await assert.rejects(link().read(mbSetBlockOn(0, true)), /expected a frame of type 0x11/);
  assert.throws(() => link().post(mbReadPresetNames()), /post sends write frames only/);
});

test('a write resolves on the echo, a chain edit on the chain notice, and a save is only sent', async () => {
  const fake = new FakeMatribox();
  const unit = link(fake);
  await unit.write(mbSetBlockOn(0, false));
  await unit.write(mbAddBlock(0, 3, 0x0300002a));
  unit.post(mbSavePreset(5, 'New'));
  assert.equal(fake.stored(5)?.length, 1211);
});

test('a write the unit does not echo times out', async () => {
  const fake = new FakeMatribox();
  fake.echoes = false;
  await assert.rejects(link(fake, 50).write(mbSetBlockOn(0, false)), /did not confirm the write/);
});

test('pedalOfPort tells the supported pedals apart by their MIDI port name', () => {
  assert.equal(pedalOfPort('Pocket Master'), 'pocket-master');
  assert.equal(pedalOfPort('PocketMaster Bluetooth'), 'pocket-master');
  assert.equal(pedalOfPort('Matribox II PRO'), 'matribox');
  assert.equal(pedalOfPort('MatriboxII PRO Port 1'), 'matribox');
  assert.equal(pedalOfPort('UMC404HD 192k'), null);
  assert.equal(pedalOfPort(null), null);
});
