'use client';

import { MB_BIG_MEMORY_MAX, MB_DSP_HIGH, mbDspLoad } from '@pocket-master/core';
import { useI18n } from './I18n';

/**
 * The chain's estimated DSP load (core's mbDspLoad: from the block types, the unit reports none), with
 * a warning near and past the limit, and the unit's own "System overloaded" notice when it sent one.
 */
export function MatriboxDspLoad({ chain, overload, onClose }: { chain: readonly { readonly moduleIndex: number }[]; overload: 'cpu' | 'memory' | null; onClose: () => void }) {
  const { t } = useI18n();
  const load = mbDspLoad(chain);
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
        <span>{t('mb.dspLoad', { percent: load.percent })}</span>
        <meter min={0} max={100} low={MB_DSP_HIGH} high={MB_DSP_HIGH} optimum={0} value={Math.min(load.percent, 100)} aria-label={t('mb.dspLoad', { percent: load.percent })} />
      </div>
      {warning && (
        <p className="mb-dsp-warning" role="status">
          {warning}
        </p>
      )}
    </div>
  );
}
