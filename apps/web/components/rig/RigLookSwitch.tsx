'use client';

import { setRigLook, useRigLook } from '@/lib/rigLook';
import { useI18n } from '../I18n';

/** The settings' "New look (preview)" switch, for both pedals; the choice is the browser's, not the pedal's. */
export function RigLookSwitch() {
  const { t } = useI18n();
  const on = useRigLook();
  return (
    <section className="settings-group rig-look" aria-label={t('rig.lookGroup')}>
      <h3>{t('rig.lookGroup')}</h3>
      <div className="settings-row">
        <span className="settings-label">{t('rig.look')}</span>
        <button type="button" role="switch" aria-checked={on} aria-label={t('rig.look')} className={`switch${on ? ' switch-on' : ''}`} onClick={() => setRigLook(!on)}>
          <span className="switch-knob" />
        </button>
      </div>
      <p className="muted small">{t('rig.lookNote')}</p>
    </section>
  );
}
