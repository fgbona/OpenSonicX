/**
 * Byte-exact checks against the owner's capture of the official editor uploading a user IR
 * (mb-17). The capture and the WAV are the owner's / third-party files and are never committed:
 * this test runs only where they are (~/.pocket-master-editor/matribox), and is skipped in CI.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildMbFrames, MB_WRITE } from '../src/matribox/frame.ts';
import { mbIrSamplesFromWav, mbIrUpload } from '../src/matribox/ir.ts';
import { unwrapMbMessage, wrapMbMessage } from '../src/matribox/message.ts';
import { fromHex, toHex } from '../src/hex.ts';

const DIR = join(homedir(), '.pocket-master-editor', 'matribox');
const CAPTURE = join(DIR, 'captures', 'mb-17-ir-upload.txt');
const WAV = join(DIR, 'sources', 'MT2 MBoogie  Badlander 57.wav');
const skip = existsSync(CAPTURE) && existsSync(WAV) ? false : "needs the owner's IR upload capture (local only)";

/** The 23 host frames of the upload: the write frames with a non-zero total length past one page. */
function uploadFrames(): Uint8Array[] {
  return readFileSync(CAPTURE, 'utf8')
    .split('\n')
    .map((l) => /To Matribox II PRO\s+(F0 21 25 4D .*)$/.exec(l)?.[1])
    .filter((h): h is string => h !== undefined)
    .map((h) => fromHex(h.trim()))
    .filter((f) => f[8] === MB_WRITE && f[10] === 0x20);
}

/** The pages' nibbles joined back into the message and unwrapped. */
function uploadMessage(frames: readonly Uint8Array[]) {
  const nibbles = frames.flatMap((f) => [...f.subarray(13, -1)]);
  return unwrapMbMessage(Uint8Array.from({ length: nibbles.length / 2 }, (_, i) => ((nibbles[2 * i] as number) << 4) | (nibbles[2 * i + 1] as number)));
}

test('the IR upload: paging, checksums and message wrap rebuild the capture byte for byte', { skip }, () => {
  const frames = uploadFrames();
  assert.equal(frames.length, 23);
  const message = uploadMessage(frames);
  assert.equal(message.cmd, 0x14);
  assert.equal(message.data.length, 4128);
  const rebuilt = buildMbFrames(MB_WRITE, wrapMbMessage(1, 0x14, message.data));
  assert.deepEqual(rebuilt.map(toHex), frames.map(toHex));
});

test('the IR conversion matches the 1024 samples the official editor sent', { skip }, () => {
  const data = uploadMessage(uploadFrames()).data;
  const sent = new Int32Array(data.slice(32).buffer);
  assert.deepEqual([...mbIrSamplesFromWav(new Uint8Array(readFileSync(WAV)))], [...sent]);
});

test('mbIrUpload rebuilds the whole captured upload, checksum field included', { skip }, () => {
  const frames = mbIrUpload(5, 'MT2 MBoogie  Bad', new Uint8Array(readFileSync(WAV)));
  assert.deepEqual(frames.map(toHex), uploadFrames().map(toHex));
});
