'use client';

import { useMemo, useRef } from 'react';
import { matriboxAgent } from '@/lib/matriboxAgent';
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

/** The tone assistant on the Matribox: it needs the catalog, the person's own alg_data.json, to pick models. */
export function MatriboxAssistant({ mb, history, proposeSave }: Props) {
  const { t } = useI18n();
  // The agent stays the same across renders and reads the editor as it is now.
  const latest = useRef({ mb, history, proposeSave });
  latest.current = { mb, history, proposeSave };
  const agent = useMemo(
    () =>
      matriboxAgent({
        snapshot: () => {
          const { mb: now, history: steps } = latest.current;
          if (!now.unit || !now.catalog) throw new Error('The Matribox or its model catalog is not there any more.');
          return { current: now.unit.current, preset: steps.preset() ?? now.unit.preset, catalog: now.catalog };
        },
        apply: (chain) => latest.current.history.applyChain(chain),
        undo: () => latest.current.history.undo(),
        proposeSave: (index, name) => latest.current.proposeSave(index, name),
      }),
    [],
  );
  if (!mb.catalog) {
    return (
      <section className="panel assistant" aria-label={t('assistant.title')}>
        <header className="panel-head">
          <h2>{t('assistant.title')}</h2>
        </header>
        <p className="muted assistant-body">{t('mb.assistantNeedsCatalog')}</p>
      </section>
    );
  }
  return <AssistantPanel agent={agent} hint="mb.assistantHint" privacy="mb.assistantPrivacy" />;
}
