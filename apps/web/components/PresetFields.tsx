'use client';

import type { Edit, Preset } from '@pocket-master/core';
import { Knob } from './Knob';
import { useI18n } from './I18n';

/**
 * Preset volume as a knob. The dump's 0x2002 record (SonicMaster calls it BPM) is not shown:
 * the unit displays no such value and ignores every write tried (see core slots.ts).
 */
export function PresetFields({ preset, editable, onEdit }: { preset: Preset; editable: boolean; onEdit: (edit: Edit) => void }) {
  const { t } = useI18n();
  return (
    <section className="fields" aria-label={t('fields.aria')}>
      {preset.volume !== null && (
        <Knob label={t('preset.volume')} value={preset.volume} min={0} max={100} display={String(preset.volume)} defaultValue={75}
          disabled={!editable} onChange={(value) => onEdit({ kind: 'volume', value })} />
      )}
    </section>
  );
}
