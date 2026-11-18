import type { Frame } from './frame.ts';

/** A multi-packet reply arrives within ~0.1 s; older partial sets are stale. */
export const PARTIAL_TTL_MS = 1000;

interface PartialSet {
  readonly startedAt: number;
  readonly parts: ReadonlyMap<number, Frame>;
}

/**
 * Joins the packets of multi-packet replies (same `total`, indexes 0..total-1).
 * A packet 0 or a stale set starts over, so packets of two replies never mix.
 */
export class Reassembler {
  #pending = new Map<number, PartialSet>();

  feed(frame: Frame, now: number): Frame | null {
    if (frame.total <= 1) return frame;
    const current = this.#pending.get(frame.total);
    const restart = !current || frame.index === 0 || now - current.startedAt > PARTIAL_TTL_MS;
    const base = restart ? { startedAt: now, parts: new Map<number, Frame>() } : current;
    const parts = new Map(base.parts).set(frame.index, frame);
    if (parts.size < frame.total) {
      this.#pending.set(frame.total, { startedAt: base.startedAt, parts });
      return null;
    }
    this.#pending.delete(frame.total);
    return join(frame.total, parts);
  }
}

function join(total: number, parts: ReadonlyMap<number, Frame>): Frame {
  const ordered = Array.from({ length: total }, (_, i) => parts.get(i) as Frame);
  const payload = new Uint8Array(ordered.reduce((n, f) => n + f.payload.length, 0));
  ordered.reduce((offset, f) => (payload.set(f.payload, offset), offset + f.payload.length), 0);
  return { total: 1, index: 0, payload, crcOk: ordered.every((f) => f.crcOk) };
}
