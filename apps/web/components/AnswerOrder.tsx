'use client';

import type { AiModel } from '@/lib/assistant';
import { useI18n } from './I18n';

interface Props {
  readonly order: readonly AiModel[];
  readonly name: (model: AiModel) => string;
  readonly onMove: (model: AiModel, delta: -1 | 1) => void;
  readonly rotate: boolean;
  readonly onRotate: (on: boolean) => void;
}

/** Which provider answers first: the list with ↑↓, and the switch to rotate per new conversation. */
export function AnswerOrder({ order, name, onMove, rotate, onRotate }: Props) {
  const { t } = useI18n();
  if (order.length < 2) return null;
  return (
    <section className="assistant-provider" aria-label={t('assistant.orderTitle')}>
      <h3>{t('assistant.orderTitle')}</h3>
      <p className="muted small">{t('assistant.orderHint')}</p>
      <ol className="assistant-order">
        {order.map((m, i) => (
          <li key={m}>
            <span>{i + 1}. {name(m)}</span>
            <span className="assistant-order-moves">
              <button type="button" className="btn btn-small btn-icon" disabled={i === 0} onClick={() => onMove(m, -1)} aria-label={t('assistant.moveUp', { model: name(m) })}>↑</button>
              <button type="button" className="btn btn-small btn-icon" disabled={i === order.length - 1} onClick={() => onMove(m, 1)} aria-label={t('assistant.moveDown', { model: name(m) })}>↓</button>
            </span>
          </li>
        ))}
      </ol>
      <label className="check">
        <input type="checkbox" checked={rotate} onChange={(e) => onRotate(e.target.checked)} />
        <span>{t('assistant.rotate')}</span>
      </label>
    </section>
  );
}
