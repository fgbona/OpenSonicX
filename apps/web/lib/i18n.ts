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
  [en['error.choosePorts'], 'error.choosePorts'],
  [en['error.noWebMidi'], 'error.noWebMidi'],
  [en['error.insecure'], 'error.insecure'],
  [en['error.blocked'], 'error.blocked'],
  [en['error.closedDuringSave'], 'error.closedDuringSave'],
  [en['error.storage'], 'error.storage'],
  [en['error.storageImport'], 'error.storageImport'],
  // Raised by @pocket-master/core when a preset file is read.
  ['not a Pocket Master preset file', 'error.notPresetFile'],
  ['not a Pocket Master preset file (invalid JSON)', 'error.notPresetFile'],
  ['the preset file is damaged and cannot be read', 'error.damagedPresetFile'],
];
/** The editor's English messages that end in a reason from below, which stays as it is. */
const PREFIXES: ReadonlyArray<[string, MessageKey]> = [
  ['Could not open the ports: ', 'error.openPorts'],
  ['Factory reset was not sent: ', 'error.factoryReset'],
];

/** Core messages with values inside, by pattern; the named groups fill the placeholders. */
const PATTERNS: ReadonlyArray<[RegExp, MessageKey]> = [
  [/^saved, but (?<slot>P\d\d) is named "(?<got>.*)" instead of "(?<want>.*)"$/, 'error.savedOtherName'],
];

/** Translates errors raised by the web layer; protocol and decoder errors stay as they are. */
export function translateError(lang: Lang, text: string): string {
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
