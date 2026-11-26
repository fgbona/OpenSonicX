import { en, pt, type MessageKey } from './messages.ts';

export type Lang = 'en' | 'pt';
export type { MessageKey };
export const LANGS: readonly Lang[] = ['pt', 'en'];
export const MESSAGES: Readonly<Record<Lang, Record<MessageKey, string>>> = { en, pt };

export type Vars = Readonly<Record<string, string | number>>;

/** Message in a language with {placeholders} filled; an unknown placeholder stays visible. */
export function translate(lang: Lang, key: MessageKey, vars: Vars = {}): string {
  return MESSAGES[lang][key].replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}

/** Portuguese when the browser's first preferred language is any pt locale, English otherwise. */
export function detectLang(languages: readonly string[]): Lang {
  return languages[0]?.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

/** The editor's own English messages, by exact text or by prefix with the rest as {reason}. */
const EXACT: ReadonlyArray<[string, MessageKey]> = [
  [en['error.noWebMidi'], 'error.noWebMidi'],
  [en['error.insecure'], 'error.insecure'],
  [en['error.blocked'], 'error.blocked'],
  [en['error.closedDuringSave'], 'error.closedDuringSave'],
  [en['error.storage'], 'error.storage'],
  [en['error.storageImport'], 'error.storageImport'],
  [en['error.mbTempoNotAccepted'], 'error.mbTempoNotAccepted'],
  // Raised by @pocket-master/core when a preset file is read.
  ['not a Pocket Master preset file', 'error.notPresetFile'],
  ['not a Pocket Master preset file (invalid JSON)', 'error.notPresetFile'],
  ['the preset file is damaged and cannot be read', 'error.damagedPresetFile'],
  ['not a Pocket Master .prst file', 'error.notPresetFile'],
  ['the .prst file is damaged and cannot be read', 'error.damagedPresetFile'],
  // Raised by lib/matriboxPresetFile.ts when a picked file is read.
  ['not a Matribox II Pro preset file (.prst)', 'error.notMbPreset'],
  ['this is a Pocket Master .prst file, a different format: the Matribox II Pro cannot load it', 'error.pocketMasterPrst'],
];
/** The editor's English messages that end in a reason from below, which stays as it is. */
const PREFIXES: ReadonlyArray<[string, MessageKey]> = [
  ['Could not open the ports: ', 'error.openPorts'],
  ['Factory reset was not sent: ', 'error.factoryReset'],
];

/** Core messages with values inside, by pattern; the named groups fill the placeholders. */
const PATTERNS: ReadonlyArray<[RegExp, MessageKey]> = [
  [/^saved, but (?<slot>P\d\d) is named "(?<got>.*)" instead of "(?<want>.*)"$/, 'error.savedOtherName'],
  [/^Matribox II PRO did not confirm the write \((?<what>[^)]*)\) within (?<ms>\d+) ms\. Is it on, and is the official editor closed\?$/, 'error.mbNoConfirm'],
  [/^Matribox II PRO took the write for parameter (?<got>\d+) instead of (?<want>\d+) \(slot (?<slot>\d+)\): the block's model has no such parameter\.$/, 'error.mbWrongParam'],
  [/^Could not download the reference DI for the conversion \(HTTP (?<status>\d+)\)\.$/, 'error.cloneDi'],
];

/** A failed write as matriboxOps.ts names it, and its rollback: their reasons are translated in turn. */
const COMPOSED: ReadonlyArray<[RegExp, MessageKey]> = [
  [/^(?<reason>.*) Nothing was applied: the Matribox is back as it was\.$/s, 'error.mbRolledBack'],
  [/^(?<reason>.*) The change stopped part way and could not be undone \((?<rollback>.*)\): the screen shows what the Matribox holds now\.$/s, 'error.mbNotUndone'],
  [/^Block (?<n>\d+) \((?<block>.*?)\), (?<change>[^:]+): (?<reason>.*)$/s, 'error.mbWriteBlock'],
];
/** What a failed write was changing (matriboxOps.ts describeOp); a parameter's "Low Cut = 80" stays as it is. */
const CHANGES: ReadonlyArray<[RegExp, MessageKey]> = [
  [/^on$/, 'mb.change.on'],
  [/^off$/, 'mb.change.off'],
  [/^add$/, 'mb.change.add'],
  [/^remove$/, 'mb.change.remove'],
  [/^model change$/, 'mb.change.model'],
  [/^move to (?<to>\d+)$/, 'mb.change.move'],
];

function translateChange(lang: Lang, change: string): string {
  for (const [pattern, key] of CHANGES) {
    const match = pattern.exec(change);
    if (match) return translate(lang, key, match.groups ?? {});
  }
  return change;
}

/** Translates errors raised by the web layer; protocol and decoder errors stay as they are. */
export function translateError(lang: Lang, text: string): string {
  for (const [pattern, key] of COMPOSED) {
    const groups = pattern.exec(text)?.groups;
    if (!groups) continue;
    const vars = Object.fromEntries(
      Object.entries(groups).map(([name, value]) => [name, name === 'reason' || name === 'rollback' ? translateError(lang, value) : name === 'change' ? translateChange(lang, value) : value]),
    );
    return translate(lang, key, vars);
  }
  const exact = EXACT.find(([source]) => source === text);
  if (exact) return translate(lang, exact[1]);
  for (const [pattern, key] of PATTERNS) {
    const groups = pattern.exec(text)?.groups;
    if (groups) return translate(lang, key, groups);
  }
  const prefixed = PREFIXES.find(([prefix]) => text.startsWith(prefix));
  if (prefixed) return translate(lang, prefixed[1], { reason: text.slice(prefixed[0].length) });
  return text;
}

/** Core and the editor report progress in English ("Backing up P03"); this maps it to the UI language. */
const STEPS: ReadonlyArray<[RegExp, MessageKey]> = [
  [/^Backing up (\S+)$/, 'progress.backingUp'],
  [/^Saving (\S+)$/, 'progress.saving'],
  [/^Checking (\S+)$/, 'progress.checking'],
  [/^Saved (\S+)$/, 'progress.saved'],
  [/^Copying (\S+ to \S+)$/, 'progress.copying'],
  [/^Restoring (\S+)$/, 'progress.restoring'],
  [/^Preparing$/, 'progress.preparing'],
  [/^Loading$/, 'progress.loading'],
  [/^Renaming$/, 'progress.renaming'],
  [/^Deleting$/, 'progress.deleting'],
  [/^Uploading$/, 'progress.uploading'],
  [/^Downloading$/, 'progress.downloading'],
  [/^Converting$/, 'progress.converting'],
  [/^Verifying$/, 'progress.verifying'],
  [/^Reading settings$/, 'progress.readingSettings'],
  [/^Factory reset$/, 'progress.factoryReset'],
];

export function progressText(lang: Lang, step: string): string {
  for (const [pattern, key] of STEPS) {
    const match = pattern.exec(step);
    if (match) return translate(lang, key, { slot: match[1] ?? '' });
  }
  return step;
}
