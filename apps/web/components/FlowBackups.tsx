'use client';

import type { BackupFile } from '@pocket-master/core';
import { useI18n } from './I18n';

/** Download buttons for the backups a save or restore just took (a click is what lets the browser download). */
export function FlowBackups({ backups, warning, onDownload }: { backups: readonly BackupFile[]; warning: string | null; onDownload: (f: BackupFile) => void }) {
  const { t, te } = useI18n();
  if (backups.length === 0) return null;
  return (
    <div className="flow-backups">
      {warning && <p className="alert" role="alert">{te(warning)}</p>}
      <p className="muted small">{t('flow.note')}</p>
      <div className="flow-backup-buttons">
        {backups.map((b) => (
          <button key={`${b.kind}-${b.createdAt}`} type="button" className="btn btn-small" onClick={() => onDownload(b)}>
            {b.kind === 'session' ? t('flow.downloadAll') : t('flow.downloadSlot', { slot: b.slots[0]?.label ?? '' })}
          </button>
        ))}
      </div>
    </div>
  );
}
