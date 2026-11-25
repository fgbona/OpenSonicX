/**
 * The Matribox II Pro's global settings as the editor shows them (core globals.ts): read on
 * connect, changed by the editor's writes and by the unit's own notices. Pure updates only.
 */
import { mbReadGlobalState, type MatriboxLink, type MbGlobalSetting, type MbGlobalState } from '@pocket-master/core';

/** The three global reads; null (logged) when the unit does not answer them, so the editor still opens. */
export async function readGlobals(link: MatriboxLink): Promise<MbGlobalState | null> {
  try {
    return await mbReadGlobalState(link);
  } catch (e) {
    console.error('Matribox: could not read the global settings', e);
    return null;
  }
}

export const withGlobal = (g: MbGlobalState, setting: MbGlobalSetting, value: number): MbGlobalState => ({ ...g, general: { ...g.general, [setting]: value } });

/** The unit sends its global tempo only while it is on (mb-37). */
export const withGlobalTempo = (g: MbGlobalState, bpm: number): MbGlobalState => ({ ...g, general: { ...g.general, tempo: { on: true, bpm } } });

export const withEqLevel = (g: MbGlobalState, level: number): MbGlobalState => ({ ...g, eq: { ...g.eq, level } });

export const withEqGain = (g: MbGlobalState, band: number, gain: number): MbGlobalState => ({ ...g, eq: { ...g.eq, bands: g.eq.bands.map((b, i) => (i === band ? { ...b, gain } : b)) } });

export const withEqOn = (g: MbGlobalState, eqOn: boolean): MbGlobalState => ({ ...g, eqOn });

/** The unit's MIDI channel for the editor's Control Changes: its USB input channel, or null for Omni (any channel). */
export const ccChannelOf = (g: MbGlobalState | null): number | null => (g && g.general.midiChannelUsb >= 1 ? g.general.midiChannelUsb : null);
