'use client';

import { MB_FOOTSWITCHES, type MbResolvedBlock } from '@pocket-master/core';
import { mbLookKey } from '@/lib/matriboxLook';
import { Fold } from './Fold';
import { useI18n } from './I18n';

const SWITCHES = 'ABCD';

interface Props {
  /** Per footswitch A..D, the storage slots it toggles. */
  footswitches: readonly (readonly number[])[];
  chain: readonly MbResolvedBlock[];
  disabled: boolean;
  onFootswitch: (footswitch: number, slot: number, on: boolean) => void;
}

/** Which blocks footswitches A-D toggle in stomp mode: one card a switch, one lit chip a block it toggles. */
export function MatriboxFootswitches({ footswitches, chain, disabled, onFootswitch }: Props) {
  const { t } = useI18n();
  return (
    <Fold title={t('mb.footswitches')}>
      <div className="mb-fs-grid">
        {Array.from({ length: MB_FOOTSWITCHES }, (_, row) => {
          const letter = SWITCHES[row] ?? '';
          const assigned = footswitches[row] ?? [];
          return (
            <fieldset key={row} className="mb-fs">
              <legend>
                {/* The letter in its own box: it sits on the cap's chrome, not on the round cap's corners. */}
                <span className="mb-fs-cap" aria-hidden="true">
                  <span>{letter}</span>
                </span>
                <span className="mb-fs-name">{t('mb.footswitchName', { fs: letter })}</span>
              </legend>
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
                      aria-label={t('mb.footswitchToggles', { fs: letter, block })}
                      className={`mb-chip mb-${mbLookKey(b)}${on ? ' is-on' : ''}`}
                      disabled={disabled}
                      onClick={() => onFootswitch(row, b.slot, !on)}
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
