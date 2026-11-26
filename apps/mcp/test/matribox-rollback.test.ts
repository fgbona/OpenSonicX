import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MB_WRITE, matriboxLink, parseMbFrame, parseMbPreset, unwrapMbMessage } from '@pocket-master/core';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import { MatriboxSession } from '../src/matribox-session.ts';
import { CATALOG } from './matribox-helpers.ts';

/** Each block's module, model, on/off and the values the catalog names (the unit's own defaults stay for the rest). */
const shape = (fake: FakeMatribox) =>
  parseMbPreset(fake.editBuffer).chain.map((b) => {
    const ids =
      CATALOG.modules
        .find((m) => m.index === b.moduleIndex)
        ?.models.find((m) => m.fxid === b.fxid)
        ?.params.map((p) => p.id) ?? [];
    return [b.moduleIndex, b.fxid, b.on, ...ids.map((id) => b.values[id])];
  });

/** A session whose `failAt`-th set-param write the unit applies without confirming it. */
function flaky(fake: FakeMatribox, failAt: number) {
  let writes = 0;
  const send = (b: Uint8Array) => {
    const frame = parseMbFrame(b);
    const data = frame.type === MB_WRITE ? unwrapMbMessage(frame.payload).data : null;
    if (data && data[0] === 1 && data[2] === 5 && data[3] === 1 && ++writes === failAt) {
      fake.echoes = false;
      fake.send(b);
      fake.echoes = true;
      return;
    }
    fake.send(b);
  };
  const link = matriboxLink({ send, listen: (r) => fake.listen(r ?? (() => undefined)) }, 100);
  return new MatriboxSession(() => ({ ...link, close: () => undefined }), { backups: '/nonexistent', presets: '/nonexistent', irs: '/nonexistent' }, CATALOG);
}

test('matribox_build_tone puts the old chain back when a write fails, and says nothing was applied', async () => {
  const fake = new FakeMatribox();
  const before = shape(fake);
  const blocks = [
    { module: 'DRV', model: 'Fake Drive', params: { Gain: 70 } },
    { module: 'AMP', model: 'Fake Plexi' },
  ];
  await assert.rejects(flaky(fake, 2).buildTone({ blocks }), /did not confirm the write.*Nothing was applied/s);
  assert.deepEqual(shape(fake), before); // chain, models, on/off and every value the catalog names
});
