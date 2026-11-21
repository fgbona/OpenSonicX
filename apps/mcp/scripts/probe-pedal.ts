/**
 * Read-only diagnostic for a session with the real pedal: checks the USB port is quiet, sends every
 * known read query, and reports the firmware version (from the settings reply) and anything else
 * that looks like one. With --scan it also tries the query kinds nobody has mapped (GET frames
 * only, one at a time). Everything sent and received goes to ~/.pocket-master-editor/probe-<time>.txt.
 * It also finds a Smart Box, so the first session with one can start from the same read-only report.
 *
 *   node apps/mcp/scripts/probe-pedal.ts [--scan]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeCurrentPreset, decodeFirmware, decodePreset, diffPresets, isReadOnly, presetLabel, readStoredPreset, parseFrame, PocketMasterLink, Query, queryFrame, toHex, type QueryKind } from '@pocket-master/core';

const PORT_NAME = /pocket\s*master|smart\s*box/i;
const QUIET_MS = 3000;
const SCAN_WAIT_MS = 600;
/** The tested firmware's bytes in either order (the globals reply stores 03 03 01). */
const TESTED = [[1, 3, 3], [3, 3, 1]];

/** Places in a reply that could hold a firmware version: "x.y.z" text or the tested version's bytes. */
export function versionCandidates(payload: Uint8Array): string[] {
  const found: string[] = [];
  const text = Array.from(payload, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '\0')).join('');
  for (const m of text.matchAll(/[vV]?\d{1,2}\.\d{1,2}(\.\d{1,3})?/g)) found.push(`text "${m[0]}" at byte ${m.index}`);
  for (const bytes of TESTED) {
    for (let i = 0; i + bytes.length <= payload.length; i++) {
      if (bytes.every((b, j) => payload[i + j] === b)) found.push(`bytes ${bytes.map((b) => `0${b}`).join(' ')} at byte ${i}`);
    }
  }
  return found;
}

async function main(scan: boolean) {
  const { Input, Output } = await import('@julusian/midi');
  const input = new Input();
  const output = new Output();
  const port = (p: { getPortCount(): number; getPortName(i: number): string }) => {
    const i = Array.from({ length: p.getPortCount() }, (_, k) => p.getPortName(k)).findIndex((n) => PORT_NAME.test(n));
    if (i < 0) throw new Error('No Pocket Master or Smart Box MIDI port: plug the pedal in by USB and close other editors.');
    return i;
  };
  const lines: string[] = [];
  const say = (line: string) => { console.log(line); lines.push(line); };
  let receiver: ((bytes: Uint8Array) => void) | null = null;
  input.ignoreTypes(false, true, true);
  input.on('messageBuffer', (_t: number, m: Buffer) => receiver?.(new Uint8Array(m)));
  input.openPort(port(input));
  say(`Port: ${input.getPortName(port(input))}`);
  output.openPort(port(output));
  const send = (bytes: Uint8Array) => {
    if (!isReadOnly(bytes)) throw new Error('blocked: the probe only sends read queries');
    output.sendMessage(Buffer.from(bytes));
  };
  try {
    // Another editor on the port answers and steals replies (lesson of 2026-11-20).
    let stray = 0;
    receiver = () => void stray++;
    await new Promise((r) => setTimeout(r, QUIET_MS));
    say(`Quiet port check: ${stray} unsolicited message(s) in ${QUIET_MS / 1000} s${stray ? ' - close other editors (SonicMaster, browser tabs) and run again' : ''}`);
    if (stray) return;

    const link = new PocketMasterLink({ send, listen: (r) => void (receiver = r) }, (e) => lines.push(`${e.dir} ${e.hex}${e.note ? `  (${e.note})` : ''}`));
    for (const [name, kind] of Object.entries(Query)) {
      if (kind === Query.STORED_PRESET) continue; // needs an index: checked below
      try {
        const { payload } = await link.request(kind);
        const hits = versionCandidates(payload);
        const firmware = kind === Query.GLOBALS ? decodeFirmware(payload) : null;
        say(`${name} (12 ${kind.toString(16).padStart(2, '0')}): ${payload.length} bytes${firmware ? ` - firmware ${firmware}` : ''}${hits.length ? ` - VERSION? ${hits.join('; ')}` : ''}`);
      } catch (error) {
        say(`${name}: no reply (${(error as Error).message})`);
      }
    }
    // Reading a slot without loading it (12 4F) must give what the edit buffer holds while the
    // preset is unmodified; then backups can stop loading each slot.
    try {
      const index = decodeCurrentPreset((await link.request(Query.CURRENT_PRESET)).payload);
      const buffer = decodePreset((await link.request(Query.EDIT_BUFFER)).payload);
      const modified = (await link.request(Query.MODIFIED)).payload[2] === 1;
      const stored = await readStoredPreset(link, index);
      const same = diffPresets(stored.preset, buffer).length === 0;
      say(`STORED_PRESET ${presetLabel(index)} "${stored.name}": ${stored.payload.length} bytes, ${same ? 'same as the edit buffer' : 'DIFFERS from the edit buffer'}${modified ? ' (the preset has unsaved edits, so a difference is expected)' : ''}`);
    } catch (error) {
      say(`STORED_PRESET: failed (${(error as Error).message})`);
    }
    link.close();

    if (scan) {
      const known = new Set<number>(Object.values(Query));
      for (let kind = 0; kind < 0x80; kind++) {
        if (known.has(kind)) continue;
        const replies: Uint8Array[] = [];
        receiver = (bytes) => replies.push(bytes);
        const frame = queryFrame(kind as QueryKind);
        lines.push(`TX ${toHex(frame)}  (scan 12 ${kind.toString(16).padStart(2, '0')})`);
        send(frame);
        await new Promise((r) => setTimeout(r, SCAN_WAIT_MS));
        for (const bytes of replies) {
          lines.push(`RX ${toHex(bytes)}`);
          let payload = bytes;
          try { payload = parseFrame(bytes).payload; } catch { /* keep the raw bytes */ }
          const hits = versionCandidates(payload);
          say(`scan 12 ${kind.toString(16).padStart(2, '0')}: reply of ${payload.length} bytes${hits.length ? ` - VERSION? ${hits.join('; ')}` : ''}`);
        }
      }
    }
  } finally {
    receiver = null;
    input.closePort();
    output.closePort();
    const dir = process.env.POCKET_MASTER_HOME ?? join(homedir(), '.pocket-master-editor');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `probe-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`);
    writeFileSync(file, `${lines.join('\n')}\n`);
    console.log(`\nFull log: ${file}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.includes('--scan')).catch((error: Error) => {
    console.error(error.message);
    process.exit(1);
  });
}
