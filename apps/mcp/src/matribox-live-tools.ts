/**
 * MCP tools for the Matribox II Pro's remaining live controls: patch volume, footswitch and
 * expression-pedal assignments (SysEx, echoed, read back), and the manual's MIDI Control Changes
 * (tuner, tempo, looper, drum machine, CTRL 1-4, quick knobs). All experimental.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MB_BPM_MAX, MB_BPM_MIN, MB_CC, mbBpmControlChanges, mbControlChange, mbSwitch } from '@pocket-master/core';
import type { MatriboxSession } from './matribox-session.ts';

type Run = (tool: string, run: () => Promise<string>) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>;

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const LIVE = { readOnlyHint: false, destructiveHint: false, openWorldHint: false } as const;
const EXPERIMENTAL = "Experimental: decoded from the official editor's traffic and the manual, not yet checked on the owner's unit.";
const live = (what: string) => `Matribox II Pro: ${what} The change is live in the loaded preset; nothing is stored until matribox_save_preset (loading another preset discards it). ${EXPERIMENTAL}`;
const cc = (what: string) =>
  `Matribox II Pro: ${what} Sent as a MIDI Control Change (from the manual); the unit sends no answer, and it acts only when its MIDI channel matches (or is Omni) and its "MIDI In Source" includes USB. ${EXPERIMENTAL}`;
const block = z.string().describe('Block of the loaded preset: its 1-based position in the chain ("2") or its module name ("DRV") when the chain has only one');
const channel = z.number().int().min(1).max(16).optional().describe("The unit's MIDI channel (global settings), 1..16; default 1 (Omni also takes it)");
const entry = z
  .number()
  .int()
  .min(1)
  .max(9)
  .describe('Expression entry 1..9: likely 1-3 = EXP 1 mode A (heel-toe), 4-6 = EXP 1 mode B (after the toe switch), 7-9 = EXP 2 (not confirmed); 1 is the usual volume entry');
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
        "Matribox II Pro: the loaded preset's patch volume, tempo, which blocks each footswitch A-D toggles (stomp mode), and the expression-pedal entries (block, parameter, min..max). Reads only.",
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
      description: live('makes footswitch A, B, C or D toggle a block in stomp mode (assign true), or stops it (false). A switch may toggle several blocks. Read back to check.'),
      inputSchema: { footswitch: z.enum(['A', 'B', 'C', 'D']), block, assign: z.boolean().optional().describe('true (default) to assign, false to remove') },
      annotations: LIVE,
    },
    (args) => run('matribox_assign_footswitch', () => matribox().assignFootswitch({ ...args, assign: args.assign ?? true })),
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
