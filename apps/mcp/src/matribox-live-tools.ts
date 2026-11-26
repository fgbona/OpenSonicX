/**
 * MCP tools for the Matribox II Pro's remaining live controls: patch volume, footswitch and
 * expression-pedal assignments (SysEx, echoed, read back), and the manual's MIDI Control Changes
 * (tuner, tempo, looper, drum machine, CTRL 1-4, quick knobs). All experimental.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MB_BPM_MAX, MB_BPM_MIN, MB_CC, MB_DRUM_BPM_MAX, MB_DRUM_BPM_MIN, MB_DRUM_GENRES, MB_FS_FUNCTIONS, MB_IR_SLOTS, mbBpmControlChanges, mbControlChange, mbSwitch } from '@pocket-master/core';
import type { MatriboxSession } from './matribox-session.ts';

type Run = (tool: string, run: () => Promise<string>) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const LIVE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const EXPERIMENTAL = "Experimental: decoded from the official editor's traffic and the manual, checked on one unit so far.";
const live = (what: string) => `Matribox II Pro: ${what} The change is live in the loaded preset; nothing is stored until matribox_save_preset (loading another preset discards it). ${EXPERIMENTAL}`;
const cc = (what: string) =>
  `Matribox II Pro: ${what} Sent as a MIDI Control Change (from the manual); the unit sends no answer, and it acts only when its MIDI channel matches (or is Omni) and its "MIDI In Source" includes USB. ${EXPERIMENTAL}`;
const block = z.string().describe('Block of the loaded preset: its 1-based position in the chain ("2") or its module name ("DRV") when the chain has only one');
const channel = z.number().int().min(1).max(16).optional().describe("The unit's MIDI channel (global settings), 1..16; default 1 (Omni also takes it)");
const entry = z.number().int().min(1).max(9).describe('Expression entry 1..9: 1-3 = EXP 1 mode A (heel-toe), 4-6 = EXP 1 mode B (after the toe switch), 7-9 = EXP 2; 1 is the usual volume entry');
const percent = z.number().min(0).max(100);

const LOOPER = {
  on: [MB_CC.looper, 127],
  off: [MB_CC.looper, 0],
  record: [MB_CC.looperRecord, 127],
  auto_record: [MB_CC.looperAutoRecord, 127],
  play: [MB_CC.looperPlay, 127],
  stop: [MB_CC.looperPlay, 0],
  undo_redo: [MB_CC.looperUndo, 127],
  delete: [MB_CC.looperDelete, 127],
  placement_pre: [MB_CC.looperPlacement, 127],
  placement_post: [MB_CC.looperPlacement, 0],
} as const;
const DRUM = { on: [MB_CC.drumMenu, 127], off: [MB_CC.drumMenu, 0], play: [MB_CC.drumPlay, 127], stop: [MB_CC.drumPlay, 0] } as const;
const keys = <T extends object>(o: T) => Object.keys(o) as [keyof T & string, ...(keyof T & string)[]];

/** A level (0..100) or an action as [cc, value]; `level` names the CCs that need `value`. */
function action(table: Readonly<Record<string, readonly [number, number]>>, levels: Readonly<Record<string, readonly [number, number]>>, name: string, value: number | undefined): [number, number] {
  const level = levels[name];
  if (level) {
    if (value === undefined || !Number.isInteger(value) || value < 0 || value > level[1]) throw new Error(`${name} needs value, an integer 0..${level[1]}`);
    return [level[0], value];
  }
  const found = table[name];
  if (!found) throw new Error(`unknown action "${name}"`);
  return [found[0], found[1]];
}

export function registerMatriboxLive(server: McpServer, run: Run, matribox: () => MatriboxSession): void {
  server.registerTool(
    'matribox_get_assignments',
    {
      title: 'Get the Matribox assignments',
      description:
        "Matribox II Pro: the loaded preset's patch volume, tempo, what each footswitch A-D runs in stomp mode (and which blocks it toggles), the blocks in CTRL 1-4, what quick knobs 1-3 edit, and the expression-pedal entries (block, parameter, min..max). Reads only.",
      annotations: READ,
    },
    () => run('matribox_get_assignments', () => matribox().getAssignments()),
  );

  server.registerTool(
    'matribox_set_volume',
    {
      title: 'Set the Matribox patch volume',
      description: live("sets the loaded preset's patch volume, 0..100."),
      inputSchema: { volume: z.number().int().min(0).max(100).describe('Patch volume 0..100') },
      annotations: LIVE,
    },
    (args) => run('matribox_set_volume', () => matribox().setVolume(args)),
  );

  server.registerTool(
    'matribox_assign_footswitch',
    {
      title: 'Assign a Matribox footswitch',
      description: live(
        'makes footswitch A, B, C or D toggle a block in stomp mode (assign true), or stops it (false): the block goes in or out of the CTRL the switch runs (A runs CTRL 1 by default); a switch set to something else (tuner, tap...) is set to its own CTRL first. A switch may toggle several blocks. Read back to check.',
      ),
      inputSchema: { footswitch: z.enum(['A', 'B', 'C', 'D']), block, assign: z.boolean().optional().describe('true (default) to assign, false to remove') },
      annotations: LIVE,
    },
    (args) => run('matribox_assign_footswitch', () => matribox().assignFootswitch({ ...args, assign: args.assign ?? true })),
  );

  server.registerTool(
    'matribox_assign_ctrl',
    {
      title: 'Put a block in a Matribox CTRL',
      description: live(
        'puts a block in CTRL 1, 2, 3 or 4 (assign true) or takes it out (false). A CTRL is a group of blocks that a footswitch set to it (or CC 71..74) switches on and off together. Read back to check.',
      ),
      inputSchema: { ctrl: z.number().int().min(1).max(4).describe('CTRL 1..4'), block, assign: z.boolean().optional().describe('true (default) to add, false to remove') },
      annotations: LIVE,
    },
    (args) => run('matribox_assign_ctrl', () => matribox().assignCtrl({ ...args, assign: args.assign ?? true })),
  );

  server.registerTool(
    'matribox_set_footswitch_function',
    {
      title: 'Set what a Matribox footswitch does',
      description: live(
        "sets what footswitch A, B, C or D runs in stomp mode when pressed (or held, hold true): a CTRL (its blocks toggle), tap tempo, tuner, looper, preset or bank changes... (decoded from waveod's reimplemented firmware, not from a capture). Read back to check.",
      ),
      inputSchema: {
        footswitch: z.enum(['A', 'B', 'C', 'D']),
        function: z.enum(MB_FS_FUNCTIONS.map((f) => f.name) as [string, ...string[]]).describe('What the switch runs'),
        hold: z.boolean().optional().describe('true to set the long press instead of the press (default false)'),
      },
      annotations: LIVE,
    },
    (args) => run('matribox_set_footswitch_function', () => matribox().setFootswitchFunction({ ...args, hold: args.hold ?? false })),
  );

  server.registerTool(
    'matribox_assign_quick_knob',
    {
      title: 'Assign a Matribox quick knob',
      description: live(
        'points quick knob 1, 2 or 3 (the knobs under the screen) at a block\'s parameter, the preset tempo ("BPM"), the patch volume ("volume") or nothing ("none") (decoded from waveod\'s reimplemented firmware, not from a capture). Read back to check.',
      ),
      inputSchema: {
        knob: z.number().int().min(1).max(3).describe('Quick knob 1..3'),
        target: z.string().describe('A block of the loaded preset (as for the other tools), or "BPM", "volume" or "none"'),
        parameter: z.string().optional().describe('Parameter name of that block, as matribox_get_preset shows it (only for a block)'),
      },
      annotations: LIVE,
    },
    (args) => run('matribox_assign_quick_knob', () => matribox().assignQuickKnob(args)),
  );

  server.registerTool(
    'matribox_assign_expression',
    {
      title: 'Assign the Matribox expression pedal',
      description: live(
        "points an expression-pedal entry at a block's parameter, swept from min to max (percent of the parameter's range, default 0..100). Read back to check (the field order of this write is decoded from one capture).",
      ),
      inputSchema: {
        entry,
        block,
        parameter: z.string().describe('Parameter name as matribox_get_preset shows it'),
        min: percent.optional().describe('Heel end, 0..100 (default 0)'),
        max: percent.optional().describe('Toe end, 0..100 (default 100)'),
      },
      annotations: LIVE,
    },
    (args) => run('matribox_assign_expression', () => matribox().assignExpression(args)),
  );

  server.registerTool(
    'matribox_set_expression_range',
    {
      title: 'Set a Matribox expression range',
      description: live('changes the heel (min) and/or toe (max) end of an expression-pedal entry, 0..100.'),
      inputSchema: { entry, min: percent.optional().describe('Heel end, 0..100'), max: percent.optional().describe('Toe end, 0..100') },
      annotations: LIVE,
    },
    (args) => run('matribox_set_expression_range', () => matribox().setExpressionRange(args)),
  );

  server.registerTool(
    'matribox_set_drums',
    {
      title: 'Play the Matribox drum machine',
      description: `Matribox II Pro: the drum machine, for practice: play or stop it, pick a rhythm (a style: ${MB_DRUM_GENRES.map((g) => g.name).join(', ')}, or a rhythm name such as "Rock 2", "Shuffle", "Funk 3", "4/4"), set its own tempo or make it follow the preset tempo, and its volume; all optional, none only reads it. Sent as the editor protocol's drum settings and read back from the unit (prefer it to matribox_drum). Nothing is saved to a preset. ${EXPERIMENTAL}`,
      inputSchema: {
        play: z.boolean().optional().describe('true starts the beat, false stops it'),
        rhythm: z.string().optional().describe('A style (its first rhythm) or a rhythm name'),
        bpm: z.number().int().min(MB_DRUM_BPM_MIN).max(MB_DRUM_BPM_MAX).optional().describe("The drums' own tempo (stops following the preset tempo)"),
        follow_tempo: z.boolean().optional().describe("true: follow the preset's (or the global) tempo"),
        volume: percent.int().optional(),
      },
      annotations: LIVE,
    },
    (args) => run('matribox_set_drums', () => matribox().setDrums({ play: args.play, rhythm: args.rhythm, bpm: args.bpm, followTempo: args.follow_tempo, volume: args.volume })),
  );

  server.registerTool(
    'matribox_rename_ir',
    {
      title: 'Rename a Matribox user IR',
      description: `Matribox II Pro: renames user IR slot 1..20 (1..16 printable ASCII characters); the IR in it stays. Checked by reading the names back. ${EXPERIMENTAL}`,
      inputSchema: { slot: z.number().int().min(1).max(MB_IR_SLOTS), name: z.string().min(1).max(16) },
      annotations: LIVE,
    },
    (args) => run('matribox_rename_ir', () => matribox().renameIr(args)),
  );

  registerCcTools(server, run, matribox);
}

function registerCcTools(server: McpServer, run: Run, matribox: () => MatriboxSession): void {
  const send = (tool: string, what: string, build: (ch: number) => Uint8Array[], ch = 1) => run(tool, () => matribox().control(build(ch), what));

  server.registerTool(
    'matribox_tuner',
    {
      title: 'Matribox tuner on or off',
      description: cc('turns the tuner on or off (CC 58).'),
      inputSchema: { on: z.boolean(), channel },
      annotations: LIVE,
    },
    ({ on, channel: ch }) => send('matribox_tuner', `Tuner ${on ? 'on' : 'off'}`, (c) => [mbControlChange(c, MB_CC.tuner, mbSwitch(on))], ch),
  );

  server.registerTool(
    'matribox_tap_tempo',
    {
      title: 'Tap the Matribox tempo',
      description: cc('one tap of tap tempo (CC 70); call it at the beat, or use matribox_set_bpm.'),
      inputSchema: { channel },
      annotations: LIVE,
    },
    ({ channel: ch }) => send('matribox_tap_tempo', 'Tap tempo', (c) => [mbControlChange(c, MB_CC.tapTempo, 127)], ch),
  );

  server.registerTool(
    'matribox_set_bpm',
    {
      title: 'Set the Matribox BPM',
      description: cc(`sets the loaded preset's tempo, ${MB_BPM_MIN}..${MB_BPM_MAX} BPM (CC 68 MSB + CC 69 LSB).`),
      inputSchema: { bpm: z.number().int().min(MB_BPM_MIN).max(MB_BPM_MAX), channel },
      annotations: LIVE,
    },
    ({ bpm, channel: ch }) => send('matribox_set_bpm', `Tempo ${bpm} BPM`, (c) => mbBpmControlChanges(c, bpm), ch),
  );

  server.registerTool(
    'matribox_looper',
    {
      title: 'Control the Matribox looper',
      description: cc(
        'looper: on/off (CC 59), record (60), auto_record (61), play/stop (62), undo_redo (63), delete (64), placement pre/post (67), record_volume / playback_volume with value 0..100 (65, 66).',
      ),
      inputSchema: {
        action: z.enum([...keys(LOOPER), 'record_volume', 'playback_volume']),
        value: z.number().int().min(0).max(100).optional().describe('0..100, for record_volume and playback_volume'),
        channel,
      },
      annotations: LIVE,
    },
    ({ action: name, value, channel: ch }) =>
      send(
        'matribox_looper',
        `Looper ${name.replace('_', ' ')}${value === undefined ? '' : ` ${value}`}`,
        (c) => [mbControlChange(c, ...action(LOOPER, { record_volume: [MB_CC.looperRecordVolume, 100], playback_volume: [MB_CC.looperPlaybackVolume, 100] }, name, value))],
        ch,
      ),
  );

  server.registerTool(
    'matribox_drum',
    {
      title: 'Control the Matribox drum machine',
      description: cc('drum machine: on/off (menu, CC 92), play/stop (93), rhythm with value 0..99 (94), volume with value 0..100 (95).'),
      inputSchema: { action: z.enum([...keys(DRUM), 'rhythm', 'volume']), value: z.number().int().min(0).max(100).optional().describe('Rhythm 0..99 or volume 0..100'), channel },
      annotations: LIVE,
    },
    ({ action: name, value, channel: ch }) =>
      send(
        'matribox_drum',
        `Drum ${name}${value === undefined ? '' : ` ${value}`}`,
        (c) => [mbControlChange(c, ...action(DRUM, { rhythm: [MB_CC.drumRhythm, 99], volume: [MB_CC.drumVolume, 100] }, name, value))],
        ch,
      ),
  );

  server.registerTool(
    'matribox_ctrl',
    {
      title: 'Send a Matribox CTRL',
      description: cc('sends CTRL 1..4 (CC 71..74) with a value 0..127, for whatever the unit assigns to them.'),
      inputSchema: { ctrl: z.number().int().min(1).max(4), value: z.number().int().min(0).max(127), channel },
      annotations: LIVE,
    },
    ({ ctrl, value, channel: ch }) => send('matribox_ctrl', `CTRL ${ctrl} = ${value}`, (c) => [mbControlChange(c, MB_CC.ctrl1 + ctrl - 1, value)], ch),
  );

  server.registerTool(
    'matribox_quick_knob',
    {
      title: 'Turn a Matribox quick knob',
      description: cc('sets quick-access knob 1..3 to 0..100 (CC 16, 18, 20): the parameter the preset assigns to that knob.'),
      inputSchema: { knob: z.number().int().min(1).max(3), value: z.number().int().min(0).max(100), channel },
      annotations: LIVE,
    },
    ({ knob, value, channel: ch }) => send('matribox_quick_knob', `Quick knob ${knob} = ${value}`, (c) => [mbControlChange(c, MB_CC.quickKnob1 + (knob - 1) * 2, value)], ch),
  );
}
