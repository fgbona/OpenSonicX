'use client';

import { useMemo, useRef } from 'react';
import { MB_CATALOG } from '@pocket-master/core';
import { matriboxAgent } from '@/lib/matriboxAgent';
import { keepMbTone, mbLibraryNow, mbTone } from '@/lib/matriboxLibrary';
import type { Matribox } from '@/lib/useMatribox';
import type { MatriboxHistory } from '@/lib/useMatriboxHistory';
import { AssistantPanel } from './AssistantPanel';
import { useI18n } from './I18n';

interface Props {
  mb: Matribox;
  history: MatriboxHistory;
  /** Opens the Save dialog filled in; resolves with what the person did. */
  proposeSave: (index: number, name: string) => Promise<'saved' | 'cancelled'>;
}

/** The tone assistant on the Matribox: it picks models from the built-in catalog by the gear they are based on. */
export function MatriboxAssistant({ mb, history, proposeSave }: Props) {
  const { lang } = useI18n();
  // The agent stays the same across renders and reads the editor as it is now.
  const latest = useRef({ mb, history, proposeSave, lang });
  latest.current = { mb, history, proposeSave, lang };
  const agent = useMemo(
    () =>
      matriboxAgent({
        snapshot: () => {
          const { mb: now, history: steps, lang: language } = latest.current;
          if (!now.unit) throw new Error('The Matribox is not there any more.');
          return { current: now.unit.current, preset: steps.preset() ?? now.unit.preset, catalog: MB_CATALOG, lang: language };
        },
        apply: (chain) => latest.current.history.applyChain(chain),
        undo: () => latest.current.history.undo(),
        proposeSave: (index, name) => latest.current.proposeSave(index, name),
        tones: mbLibraryNow,
        keepTone: async (name, notes) => {
          const preset = await latest.current.mb.readEditBuffer();
          if (!preset) throw new Error('The edit buffer could not be read from the Matribox.');
          keepMbTone(mbTone(preset, name, notes));
        },
      }),
    [],
  );
  return <AssistantPanel agent={agent} hint="mb.assistantHint" privacy="mb.assistantPrivacy" />;
}
