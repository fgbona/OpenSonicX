import type { BackupFile } from '@pocket-master/core';

/** Download buttons for the backups a save or restore just took (a click is what lets the browser download). */
export function FlowBackups({ backups, warning, onDownload }: { backups: readonly BackupFile[]; warning: string | null; onDownload: (f: BackupFile) => void }) {
  if (backups.length === 0) return null;
  return (
    <div className="flow-backups">
      {warning && <p className="alert" role="alert">{warning}</p>}
      <p className="muted small">Backups taken for this save. They are in the Backups panel; download a copy to keep it outside the browser.</p>
      <div className="flow-backup-buttons">
        {backups.map((b) => (
          <button key={`${b.kind}-${b.createdAt}`} type="button" className="btn btn-small" onClick={() => onDownload(b)}>
            Download {b.kind === 'session' ? 'all presets backup' : `${b.slots[0]?.label} backup`}
          </button>
        ))}
      </div>
    </div>
  );
}
