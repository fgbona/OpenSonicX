import { PEDAL_PRIORITY, pedalOfPort, type MidiPort, type PedalKind } from '@pocket-master/core';

export class MidiUnavailableError extends Error {}

/** Asks the browser for MIDI with SysEx. Throws MidiUnavailableError with a user-facing message. */
export async function openMidi(): Promise<MIDIAccess> {
  if (typeof navigator === 'undefined' || !('requestMIDIAccess' in navigator)) {
    throw new MidiUnavailableError('This browser has no Web MIDI. Use Chrome, Edge or Opera on a computer.');
  }
  if (!window.isSecureContext) {
    throw new MidiUnavailableError('Web MIDI needs a secure page. Open the editor over https or on localhost.');
  }
  try {
    return await navigator.requestMIDIAccess({ sysex: true });
  } catch (error) {
    // A refusal is the person's choice (or the browser's setting), explained on the page; only
    // something unexpected is worth an error in the console.
    if (!(error instanceof DOMException && error.name === 'NotAllowedError')) console.error('requestMIDIAccess failed', error);
    throw new MidiUnavailableError(
      'MIDI access was blocked. Allow "MIDI devices" for this site in the browser settings, then try again.',
    );
  }
}

export interface FoundPedal<I extends MIDIPort, O extends MIDIPort> {
  readonly kind: PedalKind;
  readonly input: I;
  readonly output: O;
}

const plugged = (p: MIDIPort) => p.state === 'connected';

/**
 * The plugged-in pedal to open: the first in PEDAL_PRIORITY with both its input and its output
 * present; never another device, whose port would get a pedal's SysEx.
 */
export function findPedal<I extends MIDIPort, O extends MIDIPort>(inputs: Iterable<I>, outputs: Iterable<O>): FoundPedal<I, O> | null {
  const ins = [...inputs].filter(plugged);
  const outs = [...outputs].filter(plugged);
  for (const kind of PEDAL_PRIORITY) {
    const input = ins.find((p) => pedalOfPort(p.name) === kind);
    const output = outs.find((p) => pedalOfPort(p.name) === kind);
    if (input && output) return { kind, input, output };
  }
  return null;
}

/** The plugged-in pedal ports as one string: it changes when a pedal is plugged in or out. */
export function pedalPortsKey(ports: Iterable<MIDIPort>): string {
  return [...ports].filter((p) => plugged(p) && pedalOfPort(p.name) !== null).map((p) => `${p.type}:${p.id}`).sort().join(',');
}

/** A Web MIDI input/output pair as the port the core link talks through. */
export function webMidiPort(input: MIDIInput, output: MIDIOutput): MidiPort {
  return {
    send: (bytes) => output.send(bytes),
    listen: (receiver) => {
      input.onmidimessage = receiver ? (event) => event.data && receiver(event.data) : null;
    },
  };
}
