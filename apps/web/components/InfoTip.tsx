'use client';

/** A small "i" that shows a note on hover or keyboard focus; screen readers read the note as its label. */
export function InfoTip({ text }: { text: string }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: focusable on purpose, so the note also shows on keyboard focus
    <span className="info-tip" tabIndex={0} role="note" aria-label={text}>
      <span aria-hidden>i</span>
      <span className="info-tip-text" aria-hidden>
        {text}
      </span>
    </span>
  );
}
