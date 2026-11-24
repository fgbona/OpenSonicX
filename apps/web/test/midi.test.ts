import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPedal, pickPocketMaster, webMidiPort } from '../lib/midi.ts';

test('pickPedal preselects a supported pedal, the Pocket Master first', () => {
  const ports = [{ name: 'UMC404HD 192k' }, { name: 'Matribox II PRO' }, { name: 'Pocket Master' }] as MIDIPort[];
  assert.equal(pickPedal(ports)?.name, 'Pocket Master');
  assert.equal(pickPedal(ports.slice(0, 2))?.name, 'Matribox II PRO');
  assert.equal(pickPedal(ports.slice(0, 1)), undefined);
});

test('pickPocketMaster never falls back to another device', () => {
  const ports = [{ name: 'UMC404HD 192k' }, { name: 'Pocket Master' }] as MIDIPort[];
  assert.equal(pickPocketMaster(ports)?.name, 'Pocket Master');
  assert.equal(pickPocketMaster([{ name: 'UMC404HD 192k' }] as MIDIPort[]), undefined);
});

test('webMidiPort sends to the output and delivers input messages until stopped', () => {
  const sent: Uint8Array[] = [];
  const input = { onmidimessage: null as ((e: { data: Uint8Array | null }) => void) | null };
  const port = webMidiPort(input as unknown as MIDIInput, { send: (b: Uint8Array) => void sent.push(b) } as unknown as MIDIOutput);
  const got: number[][] = [];
  port.listen((bytes) => void got.push([...bytes]));
  input.onmidimessage?.({ data: Uint8Array.of(0xf0, 1, 0xf7) });
  input.onmidimessage?.({ data: null });
  port.send(Uint8Array.of(0xf0, 2, 0xf7));
  port.listen(null);
  assert.deepEqual(got, [[0xf0, 1, 0xf7]]);
  assert.deepEqual(sent.map((b) => [...b]), [[0xf0, 2, 0xf7]]);
  assert.equal(input.onmidimessage, null);
});
