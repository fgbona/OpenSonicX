/**
 * The tone assistant on the Pocket Master: core's chat tools, instructions and preset text over the
 * editor's ToneHost.
 */
import {
  CHAT_INSTRUCTIONS, CHAT_INSTRUCTIONS_THOROUGH, CHAT_TOOLS, chatContext, currentPresetText, presetLabel, runChatTool,
  type ChatGuard, type ToneHost,
} from '@pocket-master/core';
import { askedToSave, type ToneAgent } from './assistant.ts';
import { toneChanges } from './tone-changes.ts';

const ACTS = new Set(['edit_preset', 'undo_edit', 'revert_preset', 'select_preset', 'save_preset', 'load_saved_tone', 'keep_tone']);

export function pocketMasterAgent(host: ToneHost): ToneAgent {
  return {
    tools: CHAT_TOOLS,
    acts: ACTS,
    instructions: (thorough) => (thorough ? `${CHAT_INSTRUCTIONS} ${CHAT_INSTRUCTIONS_THOROUGH}` : CHAT_INSTRUCTIONS),
    context: (thorough) => chatContext(host, thorough ? 'full' : 'compact'),
    current: () => currentPresetText(host),
    runner: () => {
      const guard: ChatGuard = { index: host.snapshot().index };
      return (name, args) => runChatTool(host, name, args, guard);
    },
    watch: (off) => {
      const before = host.snapshot();
      // A save to another slot moves the index but keeps the sound, so it still compares.
      return (moved) => {
        const after = host.snapshot();
        return moved.loaded || (before.index !== after.index && !moved.saved) ? undefined : toneChanges(before.preset, after.preset, off);
      };
    },
    offerSave: (message) => {
      const slot = askedToSave(message);
      if (slot === null) return null;
      void host.proposeSave(slot, host.snapshot().name);
      return presetLabel(slot);
    },
  };
}
