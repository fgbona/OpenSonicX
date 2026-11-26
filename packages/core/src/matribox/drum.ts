/**
 * The Matribox II Pro's drum machine, as the editor protocol drives it (docs/matribox.md, "Drum
 * machine"). Layouts, ranges and answers from zxmarcos/waveod's firmware rebuild (MIT, Marcos
 * Medeiros: src/editor/global_msgs.c, src/fw/globals_format.h, src/model/drum_names.c); not captured.
 *
 * - The state: flag 0, cmd 0x13, no argument; 10 bytes: u8 playing, 0, u16 genre, u16 pattern in the
 *   genre, u16 BPM, u8 follows the effects' tempo, u8 volume 0..100.
 * - One setting: flag 1, cmd 0x11, `00 <8n> 00 00` + u32, like a global setting: 0x81 play (0/1),
 *   0x82 genre << 16 | pattern, 0x83 pattern in the genre, 0x84 BPM 40..300, 0x85 follow the tempo,
 *   0x86 volume 0..100. The unit answers `{sub, value}` notices (0x82 and 0x83 with 0x82), but not
 *   always: nothing for play when it already plays, for a BPM while it follows an external clock,
 *   or for a volume over 100. So the writes are sent unanswered and the state is read back.
 */
import { buildMbFrame, MB_WRITE } from './frame.ts';
import type { MatriboxLink } from './link.ts';
import { mbRequest, wrapMbMessage } from './message.ts';

const DRUM_CMD = 0x13;
const SETTING_CMD = 0x11;
export const MB_DRUM_STATE_SIZE = 10;
export const MB_DRUM_BPM_MIN = 40;
export const MB_DRUM_BPM_MAX = 300;
const VOLUME_MAX = 100;

export interface MbDrumState {
  readonly playing: boolean;
  /** 0..7 (MB_DRUM_GENRES). */
  readonly genre: number;
  /** The pattern within its genre, 0-based. */
  readonly pattern: number;
  readonly bpm: number;
  /** The drums follow the effects' (preset or global) tempo instead of their own BPM. */
  readonly follow: boolean;
  /** 0..100. */
  readonly volume: number;
}
export type MbDrumChange = Partial<MbDrumState>;

/** The genres in the pattern bank's order, with their number of patterns (waveod model/drum_names.c, from the V1.2.2 application). */
export const MB_DRUM_GENRES: readonly { readonly name: string; readonly count: number }[] = [
  ['Rock', 30],
  ['Blues', 10],
  ['Funk', 7],
  ['Jazz', 7],
  ['Pop', 8],
  ['Electronic', 7],
  ['World', 21],
  ['Metronome', 10],
].map(([name, count]) => Object.freeze({ name: name as string, count: count as number }));

/** The 100 pattern names, genre after genre. */
export const MB_DRUM_PATTERNS: readonly string[] = [
  ...['Rock 1', 'Rock 2', 'Rock 3', 'Rock 4', 'Rock 5', 'Classic Rock 1', 'Classic Rock 2', 'Classic Rock 3', 'Hard Rock', 'Garage Rock', 'Prog Rock', 'Surf Rock', 'Rock 5/4'],
  ...['Post Rock 1', 'Post Rock 2', 'Post Rock 3', 'Punk 1', 'Punk 2', 'Punk 3', 'Punk 4', 'EMO', 'Grunge', 'New Wave', 'Post Punk 1', 'Post Punk 2', 'Hardcore'],
  ...['Metal 1', 'Metal 2', 'Nu-Metal 1', 'Nu-Metal 2'],
  ...['Blues 1', 'Blues 2', 'Blues 3', 'Blues 4', 'Swing', 'Shuffle', 'Shuffle 3/4', 'Bluegrass', 'Country', 'Folk'],
  ...['Funk 1', 'Funk 2', 'Funk 3', 'Funk 4', 'Jazz Funk 1', 'Jazz Funk 2', 'Jazz Funk 3'],
  ...['Jazz 1', 'Jazz 2', 'Jazz 3', 'Jazz 4', 'Bossanova 1', 'Bossanova 2', 'Fusion'],
  ...['Pop 1', 'Pop 2', 'Pop 3', 'Hip Hop 1', 'Hip Hop 2', 'Hip Hop 3', 'Hip Hop Rock', 'Pub'],
  ...['Electro1', 'Electro2', 'Electronic Pop', 'Techno', 'TripHop', 'Break Beat', 'Drum&Bass'],
  ...['Latin 1', 'Latin 2', 'Latin 3', 'Latin Pop 1', 'Latin Pop 2', 'Samba', 'Tango', 'Beguine', 'Ska', 'Polka', 'Waltz'],
  ...['Reggae 1', 'Reggae 2', 'Mazuke', 'Musette', 'March 1', 'March 2', 'March 3', 'New Age 1', 'New Age 2', 'World'],
  ...['1/4', '2/4', '3/4', '4/4', '5/4', '6/4', '7/4', '6/8', '7/8', '9/8'],
];

const SUB = { playing: 0x81, genre: 0x82, pattern: 0x83, bpm: 0x84, follow: 0x85, volume: 0x86 } as const;
export type MbDrumSetting = keyof typeof SUB;

const fail = (msg: string): never => {
  throw new RangeError(`Matribox drum machine: ${msg}`);
};
const isInt = (v: number, min: number, max: number) => Number.isInteger(v) && v >= min && v <= max;
const firstOf = (genre: number) => MB_DRUM_GENRES.slice(0, genre).reduce((n, g) => n + g.count, 0);
const genreOf = (genre: number) => MB_DRUM_GENRES[genre] ?? fail(`genre must be 0..${MB_DRUM_GENRES.length - 1}, got ${genre}`);
const checkPattern = (genre: number, pattern: number) => {
  const g = genreOf(genre);
  if (!isInt(pattern, 0, g.count - 1)) fail(`${g.name} has ${g.count} patterns (0..${g.count - 1}), got ${pattern}`);
};

/** The state read. */
export const mbReadDrum = (): Uint8Array => mbRequest(0, DRUM_CMD);

/** One setting write (`genre` takes genre << 16 | pattern); unanswered at times: use mbWriteDrum. */
export function mbSetDrum(setting: MbDrumSetting, value: number): Uint8Array {
  if (setting === 'genre') checkPattern(value >>> 16, value & 0xffff);
  else if (setting === 'bpm' && !isInt(value, MB_DRUM_BPM_MIN, MB_DRUM_BPM_MAX)) fail(`BPM must be ${MB_DRUM_BPM_MIN}..${MB_DRUM_BPM_MAX}, got ${value}`);
  else if (setting === 'volume' && !isInt(value, 0, VOLUME_MAX)) fail(`volume must be 0..${VOLUME_MAX}, got ${value}`);
  else if ((setting === 'playing' || setting === 'follow') && !isInt(value, 0, 1)) fail(`${setting} must be 0 or 1, got ${value}`);
  else if (setting === 'pattern' && !isInt(value, 0, 0xffff)) fail(`pattern must be a non-negative integer, got ${value}`);
  const v = value >>> 0;
  return buildMbFrame(MB_WRITE, wrapMbMessage(1, SETTING_CMD, [0x00, SUB[setting], 0x00, 0x00, v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, v >>> 24]));
}

/** The state reply (10 bytes). */
export function parseMbDrum(data: Uint8Array): MbDrumState {
  if (data.length !== MB_DRUM_STATE_SIZE) throw new Error(`the drum machine state must be ${MB_DRUM_STATE_SIZE} bytes, got ${data.length}`);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (at: number) => view.getUint16(at, true);
  return { playing: data[0] !== 0, genre: u16(2), pattern: u16(4), bpm: u16(6), follow: data[8] !== 0, volume: data[9] as number };
}

/** A setting answer (`00 <8n> 00 00` + u32) as a change; null for any other sub. */
export function mbDrumAnswer(sub: number, value: number): MbDrumChange | null {
  switch (sub) {
    case 0x8100:
      return { playing: value !== 0 };
    case 0x8200:
      return { genre: value >>> 16, pattern: value & 0xffff };
    case 0x8400:
      return { bpm: value };
    case 0x8500:
      return { follow: value !== 0 };
    case 0x8600:
      return { volume: value };
    default:
      return null;
  }
}

/** `state` with `change` applied the way the unit applies it: a new genre without a pattern starts at its first one. */
export const mbDrumWith = (state: MbDrumState, change: MbDrumChange): MbDrumState => ({
  ...state,
  ...(change.genre !== undefined && change.pattern === undefined ? { pattern: 0 } : {}),
  ...change,
});

/** The name of pattern `pattern` of `genre`. */
export const mbDrumPatternName = (genre: number, pattern: number): string => MB_DRUM_PATTERNS[firstOf(genre) + pattern] ?? `pattern ${pattern + 1}`;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** A pattern by its name ("Funk 2", "4/4"), or a genre by its name ("Rock": its first pattern). */
export function mbFindDrumRhythm(name: string): { genre: number; pattern: number } {
  const wanted = norm(name);
  const at = MB_DRUM_PATTERNS.findIndex((p) => norm(p) === wanted);
  if (at >= 0) {
    const genre = MB_DRUM_GENRES.findIndex((_, g) => at < firstOf(g + 1));
    return { genre, pattern: at - firstOf(genre) };
  }
  const genre = MB_DRUM_GENRES.findIndex((g) => norm(g.name) === wanted);
  if (genre >= 0) return { genre, pattern: 0 };
  throw new RangeError(`no drum rhythm is called "${name}": give a genre (${MB_DRUM_GENRES.map((g) => g.name).join(', ')}) or a pattern name such as "Rock 1", "Funk 2", "4/4"`);
}

/** What a person or a model asks of the drum machine (the assistant's and the MCP server's tools). */
export interface MbDrumRequest {
  readonly play?: unknown;
  /** A style or a rhythm name (mbFindDrumRhythm). */
  readonly rhythm?: unknown;
  readonly bpm?: unknown;
  readonly followTempo?: unknown;
  readonly volume?: unknown;
}

/** A request as a drum change, its values checked; null when it asks nothing (a read). A BPM of its own stops the following. */
export function mbDrumChangeOf(r: MbDrumRequest): MbDrumChange | null {
  const bool = (v: unknown, what: string) => (v === undefined || typeof v === 'boolean' ? v : fail(`${what} must be true or false`));
  const int = (v: unknown, min: number, max: number, what: string) => (v === undefined || (typeof v === 'number' && isInt(v, min, max)) ? v : fail(`${what} must be an integer ${min}..${max}`));
  if (r.rhythm !== undefined && typeof r.rhythm !== 'string') fail('rhythm must be a name');
  const bpm = int(r.bpm, MB_DRUM_BPM_MIN, MB_DRUM_BPM_MAX, 'bpm');
  const change: MbDrumChange = {
    ...(r.rhythm === undefined ? {} : mbFindDrumRhythm(r.rhythm as string)),
    playing: bool(r.play, 'play'),
    bpm,
    follow: bool(r.followTempo, 'follow_tempo') ?? (bpm === undefined ? undefined : false),
    volume: int(r.volume, 0, VOLUME_MAX, 'volume'),
  };
  const set = Object.fromEntries(Object.entries(change).filter(([, v]) => v !== undefined)) as MbDrumChange;
  return Object.keys(set).length === 0 ? null : set;
}

/** One line for people and models. */
export function mbDrumText(s: MbDrumState): string {
  const genre = MB_DRUM_GENRES[s.genre]?.name ?? `genre ${s.genre}`;
  return `Drum machine: ${s.playing ? 'playing' : 'stopped'} · ${genre}: ${mbDrumPatternName(s.genre, s.pattern)} · ${s.bpm} BPM${s.follow ? ' (follows the tempo)' : ''} · volume ${s.volume}`;
}

/** Reads the state. */
export const mbReadDrumState = async (link: MatriboxLink): Promise<MbDrumState> => parseMbDrum(await link.read(mbReadDrum()));

/** The writes of `change` from `before`, in the order that makes sense to hear: rhythm, tempo, volume, then play or stop. */
function drumWrites(before: MbDrumState, change: MbDrumChange): Uint8Array[] {
  const out: Uint8Array[] = [];
  if (change.genre !== undefined) {
    const pattern = change.pattern ?? 0;
    checkPattern(change.genre, pattern);
    out.push(mbSetDrum('genre', (change.genre << 16) | pattern));
  } else if (change.pattern !== undefined) {
    checkPattern(before.genre, change.pattern);
    out.push(mbSetDrum('pattern', change.pattern));
  }
  if (change.follow !== undefined) out.push(mbSetDrum('follow', change.follow ? 1 : 0));
  if (change.bpm !== undefined) out.push(mbSetDrum('bpm', change.bpm));
  if (change.volume !== undefined) out.push(mbSetDrum('volume', change.volume));
  if (change.playing !== undefined && change.playing !== before.playing) out.push(mbSetDrum('playing', change.playing ? 1 : 0));
  return out;
}

/**
 * Applies `change` and resolves with the state read back; throws, saying what the unit kept, when it
 * did not take a value (a BPM while it follows an external MIDI clock, for one).
 */
export async function mbWriteDrum(link: MatriboxLink, change: MbDrumChange): Promise<MbDrumState> {
  const keys = Object.keys(change).filter((k) => change[k as MbDrumSetting] !== undefined) as MbDrumSetting[];
  if (keys.length === 0) fail('nothing to change');
  const before = await mbReadDrumState(link);
  for (const frame of drumWrites(before, change)) link.post(frame); // checked in full before the first is sent
  const after = await mbReadDrumState(link);
  const wanted = mbDrumWith(before, change);
  for (const k of [...keys, ...(change.genre !== undefined ? (['pattern'] as const) : [])]) {
    if (after[k] !== wanted[k]) {
      const why = k === 'bpm' && after.follow ? ' (it follows the tempo: its own BPM is ignored while the clock comes from MIDI)' : '';
      throw new Error(`the Matribox kept the drum machine's ${k === 'bpm' ? 'BPM' : k} at ${String(after[k])}${why}`);
    }
  }
  return after;
}
