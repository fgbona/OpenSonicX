import { CLONE_MODULE } from './catalog.ts';
import { modelOf, type Preset } from './dump.ts';
import type { Edit } from './edit.ts';
import { MessageType } from './queries.ts';
import { EditCommand } from './commands.ts';

const AMP_MODULE = 3;
const MODULE_COUNT = 9;

/** What the screen should do about a frame the pedal sent on its own. */
export type Notification = Edit | { readonly kind: 'reread' };

/**
 * Turns an unsolicited frame from the pedal into what changed on it (seen on V1.3.3):
 * `12 48 module alg float` is a knob, `12 49 module on` a block switch, `12 47` a model change.
 * The layout is that of the matching set command, with type 12. Returns null for anything else,
 * including values the current preset cannot hold, so a stray frame never corrupts the screen.
 */
export function decodeNotification(payload: Uint8Array, preset: Preset): Notification | null {
  if (payload[0] !== MessageType.GET) return null;
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const command = payload[1];

  if (command === EditCommand.MODEL) return { kind: 'reread' }; // the pedal applies model defaults; read them

  if (command === EditCommand.BLOCK_ON && payload.length >= 10) {
    const module = view.getUint32(2, true);
    if (module === CLONE_MODULE) return { kind: 'reread' }; // amp mode switched: AMP shows a different model now
    return module < MODULE_COUNT ? { kind: 'on', module, on: view.getUint32(6, true) !== 0 } : null;
  }

  if (command === EditCommand.PARAM && payload.length >= 14) {
    const reported = view.getUint32(2, true);
    const alg = view.getUint32(6, true);
    const value = view.getFloat32(10, true);
    if (!Number.isFinite(value)) return null;
    // Parameters of a captured amp profile live in module 9 but belong to the AMP block on screen.
    const clone = preset.ampMode === 'clone';
    const module = reported === CLONE_MODULE && clone ? AMP_MODULE : reported;
    if (reported === CLONE_MODULE && !clone) return null;
    if (reported === AMP_MODULE && clone) return null;
    const block = preset.chain.find((b) => b.module === module);
    if (!block || !modelOf(preset, block)?.params.some((p) => p.alg === alg)) return null;
    return { kind: 'param', module, alg, value };
  }
  return null;
}
