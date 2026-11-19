/**
 * The reference DI the capture is probed with: SonicMaster's asset, which it describes as the
 * same signal the official Sonicake tool bundles. It is not part of this project: callers
 * download it from SonicMaster at a pinned commit and it is only used if its SHA-256 matches.
 */
export const REFERENCE_DI = {
  url: 'https://raw.githubusercontent.com/skyggedans/SonicMaster/931a68f4ee06263e1eb622ee0fccf9f84d2b9751/app/assets/data/nam_reference_di_44100.f32',
  sha256: '301399b1faba968f9e9e5d63056bea9bafddcbc1700f3f68bc9ca9c8f39a453a',
  bytes: 12348000,
} as const;

/** Checks the downloaded bytes and returns the DI as float32 samples at 44.1 kHz. */
export async function parseReferenceDi(bytes: Uint8Array): Promise<Float32Array> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== REFERENCE_DI.sha256) throw new Error('the downloaded reference DI does not match the expected file; conversion stopped');
  const copy = bytes.slice();
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}
