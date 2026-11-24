/**
 * The editor's own app:// page gets MIDI with SysEx without a prompt: it opens the plugged-in pedal
 * by itself when the window opens, like the official app. Nothing else is granted, to anyone.
 */
const MIDI = new Set(['midi', 'midiSysex']);

export function grantsWithoutPrompt(origin: string, permission: string): boolean {
  if (!MIDI.has(permission)) return false;
  try {
    const url = new URL(origin);
    return url.protocol === 'app:' && url.host === 'editor';
  } catch {
    return false;
  }
}
