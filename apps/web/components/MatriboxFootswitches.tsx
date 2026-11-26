'use client';

import { MB_FS_FUNCTIONS, mbFsCtrl, type MbFootswitch, type MbResolvedBlock } from '@pocket-master/core';
import type { MessageKey } from '@/lib/i18n';
import { mbLookKey } from '@/lib/matriboxLook';
import { Fold } from './Fold';
import { useI18n } from './I18n';

const SWITCHES = 'ABCD';
/** The firmware's "toggle slot 1..12" functions (read only: the official editor does not offer them). */
const FS_SLOT1 = 24;

interface Props {
  /** Footswitches A..D: the function each runs when pressed, in stomp mode. */
  footswitches: readonly MbFootswitch[];
  /** Per CTRL 1..4, the storage slots in it. */
  ctrl: readonly (readonly number[])[];
  chain: readonly MbResolvedBlock[];
  disabled: boolean;
  onFunction: (footswitch: number, fn: number) => void;
  onCtrl: (ctrl: number, slot: number, on: boolean) => void;
}

/** What footswitches A-D run in stomp mode, and the blocks CTRL 1-4 switch: one card a CTRL, one lit chip a block in it. */
export function MatriboxFootswitches({ footswitches, ctrl, chain, disabled, onFunction, onCtrl }: Props) {
  const { t } = useI18n();
  const fnName = (id: number) => (MB_FS_FUNCTIONS.some((f) => f.id === id) ? t(`mb.fsFn.${id}` as MessageKey) : t('mb.fsFnOther', { n: id - FS_SLOT1 + 1 }));
  return (
    <Fold title={t('mb.footswitches')}>
      <div className="mb-body">
        <p className="muted small">{t('mb.fsFunctionsHint')}</p>
        <div className="mb-fs-functions">
          {footswitches.map((f, i) => {
            const fs = SWITCHES[i] ?? '';
            const known = MB_FS_FUNCTIONS.some((x) => x.id === f.press);
            return (
              <label key={fs} className="mb-control">
                <span>{t('mb.footswitchName', { fs })}</span>
                <select className="param-select" aria-label={t('mb.fsFunction', { fs })} value={f.press} disabled={disabled} onChange={(e) => onFunction(i, Number(e.target.value))}>
                  {!known && <option value={f.press}>{fnName(f.press)}</option>}
                  {MB_FS_FUNCTIONS.map((x) => (
                    <option key={x.id} value={x.id}>
                      {fnName(x.id)}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </div>
      </div>
      <div className="mb-fs-grid">
        {ctrl.map((assigned, row) => {
          const n = row + 1;
          const runBy = footswitches.flatMap((f, i) => (mbFsCtrl(f.press) === row ? [SWITCHES[i] ?? ''] : []));
          return (
            <fieldset key={n} className="mb-fs">
              <legend>
                {/* The number in its own box: it sits on the cap's chrome, not on the round cap's corners. */}
                <span className="mb-fs-cap" aria-hidden="true">
                  <span>{n}</span>
                </span>
                <span className="mb-fs-name">{t('mb.ctrlName', { n })}</span>
              </legend>
              <p className="muted small">{runBy.length ? runBy.map((fs) => t('mb.ctrlRunBy', { fs })).join(', ') : t('mb.ctrlUnused')}</p>
              <div className="mb-fs-chips">
                {chain.map((b) => {
                  const on = assigned.includes(b.slot);
                  const block = `${b.position}. ${b.module}`;
                  return (
                    <button
                      key={b.slot}
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={t('mb.ctrlHolds', { n, block })}
                      className={`mb-chip mb-${mbLookKey(b)}${on ? ' is-on' : ''}`}
                      disabled={disabled}
                      onClick={() => onCtrl(row, b.slot, !on)}
                    >
                      <span className="mb-chip-n">{b.position}</span>
                      {b.module}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
      </div>
    </Fold>
  );
}
