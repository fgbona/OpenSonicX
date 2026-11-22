/**
 * Supervised first try of two writes klotznick's guide documents and this project has not checked
 * on the owner's unit: copying a stored preset (11 4B + destination u16 + source u16) and turning
 * the tuner on and off (CC 58 on channel 1). Run with the pedal on USB, every other editor closed:
 *
 *   node apps/mcp/scripts/try-copy-tuner.ts copy P42 P49   (copy P42 into P49, after confirming)
 *   node apps/mcp/scripts/try-copy-tuner.ts tuner
 *
 * Before the copy, the destination's stored record is saved to ~/.pocket-master-editor; after it,
 * the destination is read back without loading it (12 4F) and compared with the source. Only the
 * exact frames below are sent; everything sent and received goes to the log it prints at the end.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { buildFrame, decodePresetNames, diffPresets, isReadOnly, MessageType, parsePresetLabel, PocketMasterLink, presetLabel, Query, readStoredPreset, toHex, USER_PRESETS } from '@pocket-master/core';

const PORT_NAME = /pocket\s*master/i;
const QUIET_MS = 3000;
const REPLY_WAIT_MS = 2000;
const COPY = 0x4b;
const TUNER_ON = Uint8Array.from([0xb0, 0x3a, 0x7f]);
const TUNER_OFF = Uint8Array.from([0xb0, 0x3a, 0x00]);
const u16 = (v: number) => [v & 0xff, (v >>> 8) & 0xff];

/** 11 4B: copy stored preset `source` (P or F bank) into user slot `destination`. */
export function copyPresetFrame(destination: number, source: number): Uint8Array {
  if (!Number.isInteger(destination) || destination < 0 || destination >= USER_PRESETS) throw new Error(`the destination must be a user preset P01..P${USER_PRESETS}`);
  if (!Number.isInteger(source) || source < 0 || source >= 100 || source === destination) throw new Error('the source must be another preset, P01..P50 or F01..F50');
  return buildFrame([MessageType.SET, COPY, ...u16(destination), ...u16(source)]);
}

/** Records of the 12 10 settings reply by address ("a0 a1" in hex), for looking at the tuner state (02 01). */
function settingsRecords(payload: Uint8Array): Map<string, string> {
  const records = new Map<string, string>();
  for (let o = 2; o + 4 <= payload.length; ) {
    const length = (payload[o + 2] as number) | ((payload[o + 3] as number) << 8);
    if (o + 4 + length > payload.length) break;
    records.set(toHex(payload.subarray(o, o + 2)), toHex(payload.subarray(o + 4, o + 4 + length)));
    o += 4 + length;
  }
  return records;
}

async function main(args: string[]) {
  const [mode, from, to] = args;
  if (mode !== 'copy' && mode !== 'tuner') throw new Error('usage: try-copy-tuner.ts copy <from> <to> | tuner');
  const { Input, Output } = await import('@julusian/midi');
  const input = new Input();
  const output = new Output();
  const port = (p: { getPortCount(): number; getPortName(i: number): string }) => {
    const i = Array.from({ length: p.getPortCount() }, (_, k) => p.getPortName(k)).findIndex((n) => PORT_NAME.test(n));
    if (i < 0) throw new Error('No Pocket Master MIDI port: plug the pedal in by USB and close other editors.');
    return i;
  };
  const lines: string[] = [];
  const say = (line: string) => { console.log(line); lines.push(line); };
  const ask = async (question: string) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try { return (await rl.question(question)).trim(); } finally { rl.close(); }
  };
  let receiver: ((bytes: Uint8Array) => void) | null = null;
  input.ignoreTypes(false, true, true);
  input.on('messageBuffer', (_t: number, m: Buffer) => receiver?.(new Uint8Array(m)));
  input.openPort(port(input));
  output.openPort(port(output));
  // Read queries go through the link's guard; the two writes are sent as the exact frames above.
  const send = (bytes: Uint8Array) => {
    if (!isReadOnly(bytes)) throw new Error('blocked: the link only sends read queries here');
    output.sendMessage(Buffer.from(bytes));
  };
  const write = async (bytes: Uint8Array, note: string) => {
    const replies: Uint8Array[] = [];
    receiver = (b) => replies.push(b);
    lines.push(`TX ${toHex(bytes)}  (${note})`);
    output.sendMessage(Buffer.from(bytes));
    await new Promise((r) => setTimeout(r, REPLY_WAIT_MS));
    for (const b of replies) lines.push(`RX ${toHex(b)}`);
    say(`${note}: ${replies.length} message(s) back${replies.length ? ` (${replies.map(toHex).join(' | ')})` : ''}`);
  };
  const withLink = async <T>(work: (link: PocketMasterLink) => Promise<T>): Promise<T> => {
    const link = new PocketMasterLink({ send, listen: (r) => void (receiver = r) }, (e) => lines.push(`${e.dir} ${e.hex}${e.note ? `  (${e.note})` : ''}`));
    try { return await work(link); } finally { link.close(); }
  };
  try {
    let stray = 0;
    receiver = () => void stray++;
    await new Promise((r) => setTimeout(r, QUIET_MS));
    if (stray) return say(`${stray} unsolicited message(s) in ${QUIET_MS / 1000} s: close other editors (SonicMaster, browser tabs) and run again`);

    if (mode === 'copy') {
      const source = parsePresetLabel(from ?? '');
      const destination = parsePresetLabel(to ?? '');
      const frame = copyPresetFrame(destination, source);
      const before = await withLink(async (link) => ({
        names: decodePresetNames((await link.request(Query.PRESET_NAMES)).payload),
        source: await readStoredPreset(link, source),
        destination: await readStoredPreset(link, destination),
      }));
      const dir = process.env.POCKET_MASTER_HOME ?? join(homedir(), '.pocket-master-editor');
      mkdirSync(dir, { recursive: true });
      const backup = join(dir, `copy-backup-${presetLabel(destination)}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      writeFileSync(backup, JSON.stringify({ slot: presetLabel(destination), name: before.destination.name, stored: toHex(before.destination.payload) }, null, 2));
      say(`Destination ${presetLabel(destination)} "${before.names[destination]}" saved to ${backup}`);
      const answer = await ask(`Copy ${presetLabel(source)} "${before.names[source]}" over ${presetLabel(destination)} "${before.names[destination]}"? Type COPY to go on: `);
      if (answer !== 'COPY') return say('Nothing sent.');
      await write(frame, `copy ${presetLabel(source)} -> ${presetLabel(destination)}`);
      const after = await withLink(async (link) => ({
        names: decodePresetNames((await link.request(Query.PRESET_NAMES)).payload),
        destination: await readStoredPreset(link, destination),
      }));
      const differences = diffPresets(after.destination.preset, before.source.preset);
      say(`${presetLabel(destination)} is now named "${after.names[destination]}" (source "${before.names[source]}")`);
      say(differences.length === 0 ? `${presetLabel(destination)} holds the same preset as ${presetLabel(source)}: the copy works.` : `${presetLabel(destination)} DIFFERS from ${presetLabel(source)} in ${differences.length} place(s): ${differences.slice(0, 5).join('; ')}`);
    } else {
      const tuner = async (when: string) => withLink(async (link) => {
        const state = settingsRecords((await link.request(Query.GLOBALS)).payload).get('02 01') ?? 'missing';
        say(`settings record 02 01 (tuner state per the guide) ${when}: ${state}`);
      });
      await tuner('before');
      await write(TUNER_ON, 'tuner on (CC 58 = 127)');
      await tuner('after on');
      await ask('Look at the pedal: is the tuner on the screen? Note it, then press Enter to turn it off. ');
      await write(TUNER_OFF, 'tuner off (CC 58 = 0)');
      await tuner('after off');
    }
  } finally {
    receiver = null;
    input.closePort();
    output.closePort();
    const dir = process.env.POCKET_MASTER_HOME ?? join(homedir(), '.pocket-master-editor');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `try-${mode}-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    writeFileSync(file, `${lines.join('\n')}\n`);
    console.log(`\nFull log: ${file}`);
  }
}

main(process.argv.slice(2)).catch((error: Error) => {
  console.error(error.message);
  process.exitCode = 1;
});
