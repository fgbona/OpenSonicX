import type { MidiPort } from '@pocket-master/core';

const PORT_HINT = /pocket\s*master/i;

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
    console.error('requestMIDIAccess failed', error);
    throw new MidiUnavailableError(
      'MIDI access was blocked. Allow "MIDI devices" for this site in the browser settings, then try again.',
    );
  }
}

export function pickPocketMaster<T extends MIDIPort>(ports: readonly T[]): T | undefined {
  return ports.find((p) => PORT_HINT.test(p.name ?? ''));
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
