/**
 * Offline decoder for MIDI Monitor captures (`.mmon`) of the Matribox II Pro and its official
 * editor (docs/matribox-captures.md). Reads files only: it never opens a MIDI port.
 *
 *   node apps/mcp/scripts/mb-capture.ts decode  <capture.mmon>...   every message, both sides
 *   node apps/mcp/scripts/mb-capture.ts notices <capture.mmon>...   the unit's unsolicited notices
 *   node apps/mcp/scripts/mb-capture.ts diff    <base.mmon> [<capture.mmon>...]
 *
 * diff compares the global tables (unit replies to cmd 11, 13, 16) of each capture's last
 * read-back with the base capture's first one, byte by byte and as float32 words, and lists each
 * capture's host writes. With one file it compares that file's first and last read-backs.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { joinMbPages, MB_REPLY, MB_WRITE, type MbFrame, type MbMessage, parseMbFrame, parseMbNotice, unwrapMbMessage } from '@pocket-master/core';

// ---------- binary property list (bplist00), the container MIDI Monitor saves ----------

/** A keyed-archiver object reference. */
export interface PlistUid {
  readonly uid: number;
}
type Plist = null | boolean | number | string | Uint8Array | PlistUid | readonly Plist[] | { readonly [key: string]: Plist };

/** Reads a whole bplist00 file into plain values (data as Uint8Array, UIDs as { uid }). */
export function readBplist(buf: Uint8Array): Plist {
  if (new TextDecoder().decode(buf.subarray(0, 8)) !== 'bplist00') throw new Error('not a binary property list (bplist00)');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const trailer = buf.length - 32;
  const offsetSize = buf[trailer + 6] as number;
  const refSize = buf[trailer + 7] as number;
  const top = Number(view.getBigUint64(trailer + 16));
  const table = Number(view.getBigUint64(trailer + 24));
  const uint = (at: number, size: number) => buf.subarray(at, at + size).reduce((v, b) => v * 256 + b, 0);
  const cache = new Map<number, Plist>();

  const object = (ref: number, depth: number): Plist => {
    if (depth > 64) throw new Error('property list nested too deep');
    const hit = cache.get(ref);
    if (hit !== undefined) return hit;
    const at = uint(table + ref * offsetSize, offsetSize);
    const marker = buf[at] as number;
    const kind = marker >> 4;
    const low = marker & 0x0f;
    // Count of a data/string/array/dict: low nibble, or a following int object when it is 0xF.
    const count = (): [number, number] => {
      if (low !== 0x0f) return [low, at + 1];
      const size = 1 << ((buf[at + 1] as number) & 0x0f);
      return [uint(at + 2, size), at + 2 + size];
    };
    const refs = (from: number, n: number) => Array.from({ length: n }, (_, i) => uint(from + i * refSize, refSize));
    let value: Plist;
    if (kind === 0x0) value = low === 0x09 ? true : low === 0x08 ? false : null;
    else if (kind === 0x1) value = low === 3 ? Number(view.getBigInt64(at + 1)) : uint(at + 1, 1 << low);
    else if (kind === 0x2) value = low === 2 ? view.getFloat32(at + 1) : view.getFloat64(at + 1);
    else if (kind === 0x3) value = view.getFloat64(at + 1);
    else if (kind === 0x8) value = { uid: uint(at + 1, low + 1) };
    else {
      const [n, start] = count();
      if (kind === 0x4) value = buf.slice(start, start + n);
      else if (kind === 0x5) value = new TextDecoder('latin1').decode(buf.subarray(start, start + n));
      else if (kind === 0x6) value = String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint16(start + i * 2)));
      else if (kind === 0xa) value = refs(start, n).map((r) => object(r, depth + 1));
      else if (kind === 0xd) {
        const keys = refs(start, n);
        const values = refs(start + n * refSize, n);
        value = Object.fromEntries(keys.map((k, i) => [String(object(k, depth + 1)), object(values[i] as number, depth + 1)]));
      } else throw new Error(`unsupported property list object 0x${marker.toString(16)}`);
    }
    cache.set(ref, value);
    return value;
  };
  return object(top, 0);
}

// ---------- MIDI Monitor events ----------

export interface MidiEvent {
  /** Seconds since the capture's first event. */
  readonly t: number;
  /** 'To' = host to unit (spied output), 'From' = unit to host. */
  readonly dir: 'To' | 'From';
  readonly bytes: Uint8Array;
}

const isDict = (v: Plist | undefined): v is { readonly [key: string]: Plist } =>
  typeof v === 'object' && v !== null && !(v instanceof Uint8Array) && !Array.isArray(v) && !('uid' in v && Object.keys(v).length === 1);

/** The SysEx events of a `.mmon` file (an archived MIDI Monitor document), in time order. */
export function readMmon(file: Uint8Array): MidiEvent[] {
  const outer = readBplist(file);
  if (!isDict(outer) || !(outer.messageData instanceof Uint8Array)) throw new Error('not a MIDI Monitor document (no messageData)');
  const archive = readBplist(outer.messageData);
  const objects = isDict(archive) && Array.isArray(archive.$objects) ? (archive.$objects as readonly Plist[]) : [];
  const deref = (v: Plist | undefined): Plist | undefined => (typeof v === 'object' && v !== null && 'uid' in v && typeof v.uid === 'number' ? objects[v.uid] : v);
  const raw = objects.flatMap((o) => {
    if (!isDict(o) || !('data' in o) || typeof o.timeStamp !== 'number') return [];
    let data = deref(o.data);
    if (isDict(data)) data = deref(data['NS.data']);
    if (!(data instanceof Uint8Array)) return [];
    const source = deref(o.originatingEndpoint);
    const name = typeof source === 'string' ? source : isDict(source) ? String(deref(source.name) ?? '') : '';
    // MIDI Monitor keeps SysEx without its F0 (and sometimes without F7).
    const bytes = Uint8Array.from([0xf0, ...data, ...(data[data.length - 1] === 0xf7 ? [] : [0xf7])]);
    return [{ ticks: o.timeStamp, dir: name.startsWith('To ') ? ('To' as const) : ('From' as const), bytes }];
  });
  raw.sort((a, b) => a.ticks - b.ticks);
  const t0 = raw[0]?.ticks ?? 0;
  // ponytail: host ticks taken as 24 MHz (Apple silicon mach time); only used for display.
  return raw.map(({ ticks, dir, bytes }) => ({ t: (ticks - t0) / 24e6, dir, bytes }));
}

// ---------- Matribox messages ----------

export interface Decoded {
  readonly t: number;
  readonly dir: 'To' | 'From';
  /** Frame type of the last page: 0x11 read, 0x12 write, 0x00 unit. */
  readonly type: number;
  readonly message: MbMessage | null;
  /** Why the event is not a message (probe, bad frame, bad stream). */
  readonly note?: string;
}

/** Joins the pages of each direction and unwraps every complete message. */
export function decodeEvents(events: readonly MidiEvent[]): Decoded[] {
  const pages: Record<'To' | 'From', MbFrame[]> = { To: [], From: [] };
  const out: Decoded[] = [];
  for (const { t, dir, bytes } of events) {
    if (bytes[3] === 0x7e) {
      out.push({ t, dir, type: -1, message: null, note: 'probe ~GP-2' });
      continue;
    }
    let frame: MbFrame;
    try {
      frame = parseMbFrame(bytes);
    } catch (error) {
      out.push({ t, dir, type: -1, message: null, note: `not a frame (${(error as Error).message}): ${hex(bytes.subarray(0, 24))}` });
      continue;
    }
    pages[dir] = frame.offset === 0 ? [frame] : [...pages[dir], frame];
    let joined: Uint8Array | null;
    try {
      joined = joinMbPages(pages[dir]);
    } catch (error) {
      pages[dir] = [];
      out.push({ t, dir, type: frame.type, message: null, note: `pages dropped (${(error as Error).message})` });
      continue;
    }
    if (!joined) continue;
    pages[dir] = [];
    try {
      out.push({ t, dir, type: frame.type, message: unwrapMbMessage(joined, 1 << 20) });
    } catch (error) {
      out.push({ t, dir, type: frame.type, message: null, note: `unwrap failed (${(error as Error).message})` });
    }
  }
  return out;
}

export const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(' ');
const TYPE_NAMES: Record<number, string> = { 0x11: 'read ', 0x12: 'WRITE', 0x00: 'unit ' };

export function formatDecoded(d: Decoded, max = 64): string {
  const head = `${d.t.toFixed(2).padStart(7)} ${d.dir.padEnd(4)} ${TYPE_NAMES[d.type] ?? '     '}`;
  if (!d.message) return `${head} ${d.note ?? ''}`;
  const { flag, cmd, data } = d.message;
  const notice = d.type === MB_REPLY ? parseMbNotice(d.message) : null;
  const body = hex(data.subarray(0, max)) + (data.length > max ? ' …' : '');
  return `${head} flag ${flag} cmd ${cmd.toString(16).padStart(2, '0')} len ${String(data.length).padStart(4)}  ${body}${notice ? `  => ${JSON.stringify(notice)}` : ''}`;
}

// ---------- global tables and diffs ----------

/** Commands of the global tables (docs/matribox.md, "the global settings"). */
export const GLOBAL_CMDS: readonly number[] = [0x11, 0x13, 0x16];

const tableKey = ({ flag, cmd, data }: MbMessage) => `flag ${flag} cmd ${cmd.toString(16)} (${data.length} B)`;

/** Each read-back of the global tables: the unit's replies to cmd 11, 13 and 16 that are not notices. */
export function globalTables(decoded: readonly Decoded[]): Map<string, Uint8Array[]> {
  const tables = new Map<string, Uint8Array[]>();
  for (const { type, message } of decoded) {
    if (type !== MB_REPLY || !message || !GLOBAL_CMDS.includes(message.cmd) || parseMbNotice(message)) continue;
    const key = tableKey(message);
    tables.set(key, [...(tables.get(key) ?? []), message.data]);
  }
  return tables;
}

export interface ByteChange {
  readonly at: number;
  readonly before: number;
  readonly after: number;
}
export interface WordChange {
  /** Byte offset of the 4-byte aligned word. */
  readonly at: number;
  readonly before: { readonly u32: number; readonly f32: number };
  readonly after: { readonly u32: number; readonly f32: number };
}

/** Bytes that differ, and the aligned 32-bit words that hold them (read as u32 and float32 LE). */
export function diffTables(before: Uint8Array, after: Uint8Array): { bytes: ByteChange[]; words: WordChange[]; lengths: [number, number] } {
  const length = Math.min(before.length, after.length);
  const bytes = Array.from({ length }, (_, at) => ({ at, before: before[at] as number, after: after[at] as number })).filter((c) => c.before !== c.after);
  const word = (data: Uint8Array, at: number) => {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    return { u32: view.getUint32(at, true), f32: Number(view.getFloat32(at, true).toPrecision(7)) };
  };
  const starts = [...new Set(bytes.map((c) => c.at & ~3))].filter((at) => at + 4 <= length);
  const words = starts.map((at) => ({ at, before: word(before, at), after: word(after, at) }));
  return { bytes, words, lengths: [before.length, after.length] };
}

export function formatDiff(key: string, before: Uint8Array, after: Uint8Array): string[] {
  const { bytes, words, lengths } = diffTables(before, after);
  const lines = lengths[0] !== lengths[1] ? [`  ${key}: length ${lengths[0]} -> ${lengths[1]}`] : [];
  if (bytes.length === 0) return [...lines, `  ${key}: no change`];
  lines.push(`  ${key}: ${bytes.length} byte(s) changed`);
  for (const c of bytes) lines.push(`    byte ${String(c.at).padStart(3)}: ${hx(c.before)} -> ${hx(c.after)}  (${c.before} -> ${c.after})`);
  for (const w of words) lines.push(`    word ${String(w.at).padStart(3)}: u32 ${w.before.u32} -> ${w.after.u32}   f32 ${w.before.f32} -> ${w.after.f32}`);
  return lines;
}
const hx = (b: number) => b.toString(16).padStart(2, '0');

/** Every host write in a capture (type 0x12), the official app's changes. */
export const hostWrites = (decoded: readonly Decoded[]) => decoded.filter((d) => d.dir === 'To' && d.type === MB_WRITE);

/** Consecutive writes of one kind (same flag, cmd, length and 4-byte head), e.g. a knob drag's stream. */
export function writeRuns(writes: readonly Decoded[]): Decoded[][] {
  const kind = (d: Decoded) => (d.message ? `${d.message.flag}/${d.message.cmd}/${d.message.data.length}/${hex(d.message.data.subarray(0, 4))}` : '');
  const starts = writes.flatMap((w, i) => (i === 0 || kind(writes[i - 1] as Decoded) !== kind(w) ? [i] : []));
  return starts.map((start, i) => writes.slice(start, starts[i + 1] ?? writes.length));
}

/**
 * The unit's flag-1 messages that answer nothing: the notices, known or not. A unit message with
 * the flag and cmd of a host message still unanswered is taken as its reply or echo instead.
 */
export function unitNotices(decoded: readonly Decoded[]): Decoded[] {
  const key = (m: MbMessage) => `${m.flag}/${m.cmd}`;
  let pending: string[] = [];
  return decoded.filter(({ dir, message }) => {
    if (!message) return false;
    if (dir === 'To') {
      pending = [...pending, key(message)];
      return false;
    }
    const i = pending.indexOf(key(message));
    if (i >= 0) {
      pending = pending.filter((_, j) => j !== i);
      return false;
    }
    return message.flag === 1;
  });
}

// ---------- command line ----------

const load = (path: string) => decodeEvents(readMmon(readFileSync(path)));

function diffReport(basePath: string, paths: readonly string[]): string[] {
  const base = globalTables(load(basePath));
  const targets = paths.length === 0 ? [basePath] : paths;
  return targets.flatMap((path) => {
    const decoded = load(path);
    const tables = globalTables(decoded);
    const lines = [`== ${basename(path)} vs ${basename(basePath)}${paths.length === 0 ? ' (first vs last read-back)' : ''}`];
    const writes = hostWrites(decoded);
    lines.push(writes.length ? `  host writes (${writes.length}):` : '  host writes: none');
    for (const run of writeRuns(writes)) {
      lines.push(`  ${formatDecoded(run[0] as Decoded, 160)}`);
      if (run.length > 1) lines.push(`  ${formatDecoded(run[run.length - 1] as Decoded, 160)}  (last of ${run.length} like it)`);
    }
    if (tables.size === 0) lines.push('  no global read-back in this capture (quit and reopen the editor while capturing)');
    for (const [key, list] of tables) {
      const before = (paths.length === 0 ? list : base.get(key))?.[0];
      const after = list[list.length - 1] as Uint8Array;
      if (!before) lines.push(`  ${key}: not in the base capture`);
      else if (paths.length === 0 && list.length < 2) lines.push(`  ${key}: only one read-back, nothing to compare`);
      else lines.push(...formatDiff(key, before, after));
    }
    return lines;
  });
}

function main(args: readonly string[]): void {
  const [mode, ...files] = args;
  if (!mode || files.length === 0 || !['decode', 'notices', 'diff'].includes(mode)) {
    console.error('usage: node apps/mcp/scripts/mb-capture.ts decode|notices <capture.mmon>... | diff <base.mmon> [<capture.mmon>...]');
    process.exit(2);
  }
  if (mode === 'diff') {
    console.log(diffReport(files[0] as string, files.slice(1)).join('\n'));
    return;
  }
  for (const path of files) {
    const decoded = load(path);
    const rows = mode === 'notices' ? unitNotices(decoded) : decoded;
    console.log(`== ${basename(path)}: ${rows.length} ${mode === 'notices' ? 'unit notice(s)' : 'message(s)'}`);
    for (const d of rows) console.log(formatDecoded(d, mode === 'notices' ? 32 : 64));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
