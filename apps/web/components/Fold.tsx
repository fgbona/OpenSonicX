import type { ReactNode } from 'react';

interface Props {
  title: string;
  /** Shown beside the title, e.g. how much the folded part holds. */
  note?: string;
  /** Folded away until asked for when false. */
  open?: boolean;
  children: ReactNode;
}

/** A panel whose body folds away under its heading (a native <details>: keyboard and state come from the browser). */
export function Fold({ title, note, open = true, children }: Props) {
  return (
    <section className="panel fold" aria-label={title}>
      <details open={open}>
        <summary className="panel-head">
          <h2>{title}</h2>
          {note && <span className="muted small fold-note">{note}</span>}
        </summary>
        {children}
      </details>
    </section>
  );
}
