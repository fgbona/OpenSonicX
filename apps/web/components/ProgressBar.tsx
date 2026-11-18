import type { Progress } from '@pocket-master/core';

export function ProgressBar({ progress }: { progress: Progress }) {
  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={progress.step}>
      <p className="progress-step">{progress.step}…</p>
      <span className="progress-track"><span className="progress-fill" style={{ width: `${pct}%` }} /></span>
    </div>
  );
}
