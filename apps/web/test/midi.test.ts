import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPedal, MidiUnavailableError, openMidi, pedalPortsKey, webMidiPort } from '../lib/midi.ts';

const port = (id: string, name: string, state = 'connected') => ({ id, name, state }) as MIDIPort;

test('findPedal pairs one pedal\'s input and output, the Pocket Master first', () => {
  const inputs = [port('i0', 'UMC404HD 192k'), port('i1', 'Matribox II PRO'), port('i2', 'Pocket Master')];
  const outputs = [port('o0', 'UMC404HD 192k'), port('o1', 'Matribox II PRO'), port('o2', 'Pocket Master')];
  const both = findPedal(inputs, outputs);
  assert.deepEqual([both?.kind, both?.input.id, both?.output.id], ['pocket-master', 'i2', 'o2']);
  const matribox = findPedal(inputs.slice(0, 2), outputs.slice(0, 2));
  assert.deepEqual([matribox?.kind, matribox?.input.id, matribox?.output.id], ['matribox', 'i1', 'o1']);
  assert.equal(findPedal(inputs.slice(0, 1), outputs.slice(0, 1)), null);
});

test('findPedal skips unplugged ports and a pedal with only one side present', () => {
  const inputs = [port('i1', 'Matribox II PRO'), port('i2', 'Pocket Master', 'disconnected')];
  const outputs = [port('o1', 'Matribox II PRO'), port('o2', 'Pocket Master', 'disconnected')];
  assert.equal(findPedal(inputs, outputs)?.kind, 'matribox');
  // The Pocket Master's input came back before its output: not usable yet.
  assert.equal(findPedal([port('i2', 'Pocket Master')], [outputs[1]!]), null);
});

test('pedalPortsKey changes when a pedal port comes or goes, never for other devices', () => {
  const pm = [port('i2', 'Pocket Master'), port('o2', 'Pocket Master')];
  assert.equal(pedalPortsKey([...pm, port('x', 'UMC404HD 192k')]), pedalPortsKey(pm));
  assert.notEqual(pedalPortsKey(pm), pedalPortsKey(pm.slice(0, 1)));
  assert.equal(pedalPortsKey([port('i2', 'Pocket Master', 'disconnected')]), '');
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

/** Runs openMidi with a browser whose requestMIDIAccess rejects with `error`; returns what was logged. */
async function refusedWith(error: unknown): Promise<unknown[][]> {
  const logged: unknown[][] = [];
  const saved = { navigator: globalThis.navigator, window: (globalThis as { window?: unknown }).window, error: console.error };
  Object.defineProperty(globalThis, 'navigator', { value: { requestMIDIAccess: () => Promise.reject(error) }, configurable: true });
  (globalThis as { window?: unknown }).window = { isSecureContext: true };
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    await assert.rejects(openMidi(), MidiUnavailableError);
  } finally {
    Object.defineProperty(globalThis, 'navigator', { value: saved.navigator, configurable: true });
    (globalThis as { window?: unknown }).window = saved.window;
    console.error = saved.error;
  }
  return logged;
}

test('a refused MIDI permission is the person\'s choice: explained, not logged as an error', async () => {
  assert.deepEqual(await refusedWith(new DOMException('Permission denied.', 'NotAllowedError')), []);
});

test('any other MIDI failure is still logged', async () => {
  assert.equal((await refusedWith(new DOMException('boom', 'InvalidStateError'))).length, 1);
});
