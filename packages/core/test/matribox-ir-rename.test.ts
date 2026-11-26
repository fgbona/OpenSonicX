import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toHex } from '../src/hex.ts';
import { parseMbFrame } from '../src/matribox/frame.ts';
import { mbRenameIr, mbWriteIrName } from '../src/matribox/ir.ts';
import { matriboxLink } from '../src/matribox/link.ts';
import { unwrapMbMessage } from '../src/matribox/message.ts';
import { FakeMatribox } from './fake-matribox.ts';

test('the IR rename is flag 2, cmd 0x14: u32 slot + 20-byte name (waveod media_msgs.c)', () => {
  const m = unwrapMbMessage(parseMbFrame(mbRenameIr(3, 'Mesa OS')).payload);
  assert.deepEqual([m.flag, m.cmd], [2, 0x14]);
  assert.equal(toHex(m.data), `03 00 00 00 4D 65 73 61 20 4F 53${' 00'.repeat(13)}`);
  assert.throws(() => mbRenameIr(20, 'x'), RangeError);
  assert.throws(() => mbRenameIr(0, ''), RangeError);
  assert.throws(() => mbRenameIr(0, 'seventeen chars!!'), RangeError);
});

test('mbWriteIrName renames the slot and checks it in the names read back', async () => {
  const fake = new FakeMatribox();
  const link = matriboxLink({ send: (b) => fake.send(b), listen: (r) => fake.listen(r ?? (() => undefined)) }, 500);
  const names = await mbWriteIrName(link, 4, 'V30 SM57');
  assert.equal(names[4], 'V30 SM57');
  fake.send = () => undefined; // a unit that drops it
  await assert.rejects(mbWriteIrName(link, 5, 'Gone'), /did not answer|after the rename/);
});
