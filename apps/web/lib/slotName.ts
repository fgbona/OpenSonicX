export type SlotKind = 'profile' | 'ir';

export const NAME_MAX: Record<SlotKind, number> = { profile: 15, ir: 10 };

/** A file or model name as the pedal can show it: printable ASCII, no extension, length limit. */
export function slotName(raw: string, kind: SlotKind): string {
  const stem = raw.replace(/\.(wav|nam|json)$/i, '');
  return (
    stem
      .replace(/[^\x20-\x7e]/g, '_')
      .slice(0, NAME_MAX[kind])
      .trim() || (kind === 'ir' ? 'User IR' : 'Capture')
  );
}
