'use client';

import { useState } from 'react';
import { checkMbIrName, MB_IR_SLOTS } from '@pocket-master/core';
import type { Matribox } from '@/lib/useMatribox';
import { Fold } from './Fold';
import { useI18n } from './I18n';

const validName = (name: string) => {
  try {
    checkMbIrName(name);
    return true;
  } catch {
    return false; // the rule is shown in the UI language (mb.nameRule)
  }
};
/** An empty slot keeps the unit's default name. */
const isEmptyIr = (slot: number, name: string) => name.trim() === '' || name.trim() === `User IR ${slot + 1}`;

/** The 20 user IR slots as the unit names them, each renamable in place (the unit keeps the IR). */
export function MatriboxIrs({ mb }: { mb: Matribox }) {
  const { t } = useI18n();
  const names = mb.unit?.irNames ?? [];
  const [renaming, setRenaming] = useState<{ slot: number; name: string } | null>(null);
  const busy = mb.busy !== null;
  const rename = async () => {
    if (!renaming || !validName(renaming.name)) return;
    if (await mb.renameIr(renaming.slot, renaming.name.trim())) setRenaming(null);
  };
  return (
    <Fold title={t('mbIr.title')} open={false}>
      <div className="mb-body">
        <p className="muted small">{t('mbIr.note')}</p>
        <ul className="mb-clones" aria-label={t('mbIr.title')}>
          {Array.from({ length: MB_IR_SLOTS }, (_, i) => {
            const name = (names[i] ?? '').trim();
            return renaming?.slot === i ? (
              <li key={i}>
                <form
                  className="mb-lib-rename"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void rename();
                  }}
                >
                  <strong>IR {i + 1}</strong>
                  <input
                    value={renaming.name}
                    maxLength={16}
                    aria-label={t('mbIr.renameField', { n: i + 1 })}
                    aria-invalid={!validName(renaming.name)}
                    autoComplete="off"
                    spellCheck={false}
                    // biome-ignore lint/a11y/noAutofocus: the field the person just asked for
                    autoFocus
                    onChange={(e) => setRenaming({ slot: i, name: e.target.value })}
                    onKeyDown={(e) => e.key === 'Escape' && setRenaming(null)}
                  />
                  <button type="submit" className="btn btn-small btn-primary" disabled={busy || !validName(renaming.name)}>
                    {t('mbIr.rename')}
                  </button>
                  <button type="button" className="btn btn-small" onClick={() => setRenaming(null)}>
                    {t('action.cancel')}
                  </button>
                </form>
                {renaming.name.length > 0 && !validName(renaming.name) && <p className="field-error">{t('mb.nameRule')}</p>}
              </li>
            ) : (
              <li key={i}>
                <strong>IR {i + 1}</strong> {isEmptyIr(i, name) ? <span className="muted">{t('mbIr.empty')}</span> : name}{' '}
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={busy}
                  aria-label={t('mbIr.renameAria', { n: i + 1 })}
                  onClick={() => {
                    mb.clearError();
                    setRenaming({ slot: i, name: isEmptyIr(i, name) ? '' : name });
                  }}
                >
                  {t('mbIr.rename')}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Fold>
  );
}
