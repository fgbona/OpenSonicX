'use client';

import { MB_DRUM_BPM_MAX, MB_DRUM_BPM_MIN, MB_DRUM_GENRES, mbDrumPatternName } from '@pocket-master/core';
import type { Matribox } from '@/lib/useMatribox';
import { Fold } from './Fold';
import { Slider, Switch } from './MatriboxGlobals';
import { useI18n } from './I18n';

/**
 * The unit's drum machine (core drum.ts): play or stop, style and rhythm, tempo, volume. Each change
 * is read back from the unit; what is changed on the unit shows up here too.
 */
export function MatriboxDrums({ mb }: { mb: Matribox }) {
  const { t } = useI18n();
  const d = mb.drum;
  const off = mb.busy !== null;
  const set = (change: Parameters<Matribox['setDrum']>[0]) => void mb.setDrum(change);
  return (
    <Fold title={t('mbDrum.title')} note={d ? t(d.playing ? 'mbDrum.playing' : 'mbDrum.stopped') : undefined} open={false}>
      <div className="mb-body settings">
        {!d ? (
          <p className="muted small">{t('mbDrum.unreadable')}</p>
        ) : (
          <>
            <div className="mb-head-actions">
              <button type="button" className={`btn${d.playing ? '' : ' btn-primary'}`} aria-pressed={d.playing} disabled={off} onClick={() => set({ playing: !d.playing })}>
                {t(d.playing ? 'mbDrum.stop' : 'mbDrum.play')}
              </button>
            </div>
            <label className="settings-row">
              <span className="settings-label">{t('mbDrum.genre')}</span>
              <select className="param-select" value={d.genre} disabled={off} onChange={(e) => set({ genre: Number(e.target.value), pattern: 0 })}>
                {MB_DRUM_GENRES.map((g, i) => (
                  <option key={g.name} value={i}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="settings-row">
              <span className="settings-label">{t('mbDrum.pattern')}</span>
              <select className="param-select" value={d.pattern} disabled={off} onChange={(e) => set({ pattern: Number(e.target.value) })}>
                {Array.from({ length: MB_DRUM_GENRES[d.genre]?.count ?? 0 }, (_, i) => (
                  <option key={i} value={i}>
                    {mbDrumPatternName(d.genre, i)}
                  </option>
                ))}
              </select>
            </label>
            <Switch label={t('mbDrum.follow')} on={d.follow} disabled={off} onChange={(follow) => set({ follow })} />
            <Slider
              label={t('mbDrum.bpm')}
              value={Math.min(Math.max(d.bpm, MB_DRUM_BPM_MIN), MB_DRUM_BPM_MAX)}
              min={MB_DRUM_BPM_MIN}
              max={MB_DRUM_BPM_MAX}
              unit="BPM"
              disabled={off || d.follow}
              onChange={(bpm) => set({ bpm })}
            />
            <Slider label={t('mbDrum.volume')} value={d.volume} min={0} max={100} disabled={off} onChange={(volume) => set({ volume })} />
          </>
        )}
      </div>
    </Fold>
  );
}
