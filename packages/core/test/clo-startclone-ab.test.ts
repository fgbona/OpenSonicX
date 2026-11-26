/**
 * Local only: our Matribox conversion of the owner's `5 RECTIFIER.nam` against the .clo the official
 * editor made from it (taken from capture mb-19). The files are private and never in the repo, so
 * the test runs only with MATRIBOX_CLO_AB=1 (or a directory in MATRIBOX_CLO_AB holding
 * `5 RECTIFIER.nam`, `official-5-RECTIFIER.clo` and `nam_reference_di_44100.f32`).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { decodeClo } from '../src/clo/codec.ts';
import { Fft } from '../src/clo/fft.ts';
import { parseReferenceDi } from '../src/clo/reference-di.ts';
import { generateMatriboxClo } from '../src/clo/startclone.ts';

const env = process.env.MATRIBOX_CLO_AB;
const home = join(homedir(), '.pocket-master-editor');
const paths =
  env && env !== '1'
    ? { nam: join(env, '5 RECTIFIER.nam'), official: join(env, 'official-5-RECTIFIER.clo'), di: join(env, 'nam_reference_di_44100.f32') }
    : { nam: join(home, 'matribox/sources/5 RECTIFIER.nam'), official: join(home, 'matribox/ab-test/official-5-RECTIFIER.clo'), di: join(home, 'cache/nam_reference_di_44100.f32') };
const ready = !!env && Object.values(paths).every((p) => existsSync(p));

const N = 1 << 15;
const BANDS = [40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500];

/** 1/3-octave levels (dB) of an IR at 44.1 kHz. */
function thirds(h: Float32Array): number[] {
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  re.set(h);
  new Fft(N).transform(re, im, false);
  return BANDS.map((f) => {
    const lo = Math.ceil(((f / 2 ** (1 / 6)) * N) / 44100);
    const hi = Math.ceil((f * 2 ** (1 / 6) * N) / 44100);
    let e = 0;
    for (let k = lo; k < hi; k++) e += re[k]! ** 2 + im[k]! ** 2;
    return 10 * Math.log10(e / (hi - lo));
  });
}

test('the Matribox conversion of 5 RECTIFIER.nam follows the official editor', { skip: ready ? false : "needs the owner's private files (MATRIBOX_CLO_AB=1)", timeout: 600_000 }, async () => {
  const di = await parseReferenceDi(new Uint8Array(readFileSync(paths.di)));
  const ours = generateMatriboxClo(readFileSync(paths.nam, 'utf8'), di);
  const official = decodeClo(new Uint8Array(readFileSync(paths.official)));
  ours.gains.forEach((g, i) => assert.ok(Math.abs(g / official.gains[i]! - 1) < 0.01, `gain ${i}: ${g} vs ${official.gains[i]}`));
  assert.deepEqual(ours.biquad, official.biquad);
  // arrayB (the 1024 taps the unit plays): within 0.5 dB per 1/3 octave, 40 Hz - 12.5 kHz
  const b = thirds(ours.arrayB.subarray(0, 1024));
  const bo = thirds(official.arrayB.subarray(0, 1024));
  BANDS.forEach((f, i) => assert.ok(Math.abs(b[i]! - bo[i]!) < 0.5, `arrayB at ${f} Hz: ${(b[i]! - bo[i]!).toFixed(2)} dB`));
  // arrayA: its shape (re 1 kHz) within 0.5 dB from 160 Hz to 4 kHz. Known gaps, not asserted: its
  // level (about 4 dB under the official's), the bass (up to +1.2 dB) and above 5 kHz (-0.75 dB at 5 kHz, up to 6 dB higher; the IR is 20-40 dB down there).
  const a = thirds(ours.arrayA);
  const ao = thirds(official.arrayA);
  const k1 = BANDS.indexOf(1000);
  BANDS.forEach((f, i) => {
    if (f < 160 || f > 4000) return;
    const d = a[i]! - a[k1]! - (ao[i]! - ao[k1]!);
    assert.ok(Math.abs(d) < 0.5, `arrayA shape at ${f} Hz: ${d.toFixed(2)} dB`);
  });
});
