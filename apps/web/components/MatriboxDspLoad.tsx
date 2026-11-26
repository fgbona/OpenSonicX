'use client';

import { MB_BIG_MEMORY_MAX, mbDspLoad } from '@pocket-master/core';
import { useI18n } from './I18n';

/**
 * The chain's estimated DSP load (core's mbDspLoad: from the block types, the unit reports none), with
 * a warning near and past the limit, and the unit's own "System overloaded" notice when it sent one.
 */
export function MatriboxDspLoad({ chain, overload, onClose }: { chain: readonly { readonly moduleIndex: number }[]; overload: 'cpu' | 'memory' | null; onClose: () => void }) {
  const { t } = useI18n();
  const load = mbDspLoad(chain);
  // The estimate can pass 100 %, but a load past the budget reads as "over the limit", never as 113 %.
  const shown = Math.min(load.percent, 100);
  const label = load.percent > 100 ? t('mb.dspLoadOver') : t('mb.dspLoad', { percent: load.percent });
  const warning = load.bigMemory > MB_BIG_MEMORY_MAX ? t('mb.dspMemory') : load.level === 'over' ? t('mb.dspOver') : load.level === 'high' ? t('mb.dspHigh') : null;
  return (
    <div className="mb-dsp">
      {overload && (
        <p className="alert mb-overload" role="alert">
          {t(overload === 'cpu' ? 'mb.overloadCpu' : 'mb.overloadMemory')}{' '}
          <button type="button" className="btn btn-small" onClick={onClose}>
            {t('mb.overloadClose')}
          </button>
        </p>
      )}
      <div className={`mb-dsp-load mb-dsp-${load.level}`} title={t('mb.dspNote')}>
        <span>{label}</span>
        {/* A drawn bar, not <meter>: its fill is styled per browser and showed empty in dark themes. Past 100 % it stays full. */}
        <span className="mb-dsp-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={shown}>
          <span className="mb-dsp-fill" style={{ width: `${shown}%` }} />
        </span>
      </div>
      {warning && (
        <p className="mb-dsp-warning" role="status">
          {warning}
        </p>
      )}
    </div>
  );
}
