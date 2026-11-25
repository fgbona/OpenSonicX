'use client';

import { downloadJson } from '@/lib/backupStore';
import type { MbBackup } from '@/lib/matribox';
import { mbBackupFileName } from '@/lib/matriboxBackups';
import { Fold } from './Fold';
import { useI18n } from './I18n';

/** The slots a save overwrote, as they were before it; each downloads as a file. */
export function MatriboxBackups({ backups }: { backups: readonly MbBackup[] }) {
  const { t } = useI18n();
  return (
    <Fold title={t('mb.backups')} note={String(backups.length)}>
      <ul className="backups">
        {backups.map((b) => (
          <li key={`${b.createdAt}-${b.label}`} className="backup backup-head">
            <span className="backup-title">
              <strong>
                {b.label} {b.name}
              </strong>
              <span className="muted small">{new Date(b.createdAt).toLocaleString()}</span>
            </span>
            <button type="button" className="btn btn-small" onClick={() => downloadJson(b, mbBackupFileName(b))}>
              {t('mb.download')}
            </button>
          </li>
        ))}
      </ul>
    </Fold>
  );
}
