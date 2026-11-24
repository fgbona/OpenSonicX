'use client';

import type { Progress } from '@pocket-master/core';
import { useI18n } from './I18n';

export function ProgressBar({ progress }: { progress: Progress }) {
  const { tp } = useI18n();
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={tp(progress.step)}>
      <p className="progress-step">
        {tp(progress.step)}…{progress.total > 1 && <span className="muted"> {pct}%</span>}
      </p>
      <span className="progress-track">
        <span className="progress-fill" style={{ width: `${pct}%` }} />
      </span>
    </div>
  );
}
