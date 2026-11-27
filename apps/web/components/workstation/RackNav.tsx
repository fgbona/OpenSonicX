'use client';

import type { MessageKey } from '@/lib/i18n';
import { useI18n } from '../I18n';

export interface RackItem {
  /** The id of the section the link jumps to. */
  readonly id: string;
  readonly label: MessageKey;
}

/**
 * The sticky row of the editor's sections (chain, controls, assistant…). Every section stays on
 * the page; the links only jump to it, so nothing a person or a test reaches is ever hidden.
 */
export function RackNav({ items }: { items: readonly RackItem[] }) {
  const { t } = useI18n();
  return (
    <nav className="ws-rack-nav" aria-label={t('ws.rack')}>
      {items.map((item) => (
        <a key={item.id} href={`#${item.id}`}>
          {t(item.label)}
        </a>
      ))}
    </nav>
  );
}
