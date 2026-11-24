/**
 * Times the NAM -> captured-profile conversion stage by stage on one thread:
 *   node packages/core/scripts/bench-clo.ts [capture.nam ...]
 * With no argument it uses the parity fixtures plus a synthetic capture shaped like the
 * standard NAM WaveNet (16 + 8 channels, 10 dilations each, kernel 3), the common real case.
 * The apps run the five probe passes in parallel workers, so their wall time is roughly
 * resample + the slowest probe + fit.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { finishClo, PROBE_LEVELS, probeResponse, referenceDiAt48 } from '../src/clo/generate.ts';
import { parseNam } from '../src/clo/nam.ts';
import { syntheticDi } from '../src/clo/synthetic-di.ts';

const DILATIONS = [1, 2, 4, 8, 16, 32, 64, 128, 256, 512];

/** A standard-architecture .nam with deterministic pseudo-random weights. */
function standardNam(): string {
  const arrays = [
    { input_size: 1, condition_size: 1, head_size: 8, channels: 16, kernel_size: 3, dilations: DILATIONS, activation: 'Tanh', gated: false, head_bias: false },
    { input_size: 16, condition_size: 1, head_size: 1, channels: 8, kernel_size: 3, dilations: DILATIONS, activation: 'Tanh', gated: false, head_bias: true },
  ];
  let count = 0;
  for (const a of arrays) {
    count += a.channels * a.input_size; // rechannel
    count += DILATIONS.length * (a.channels * a.channels * a.kernel_size + a.channels + a.channels * a.condition_size + a.channels * a.channels + a.channels);
    count += a.head_size * a.channels + (a.head_bias ? a.head_size : 0);
  }
  count += 1; // head scale
  let s = 0x12345678;
  const weights = Array.from({ length: count }, () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return ((s / 4294967296) * 2 - 1) * 0.3;
  });
  return JSON.stringify({ version: '0.5.4', architecture: 'WaveNet', config: { layers: arrays, head: null, head_scale: 0.02 }, weights });
}

const fixture = (name: string) => new URL(`../test/fixtures/clo/${name}`, import.meta.url);
const cases: [string, string][] = process.argv.length > 2
  ? process.argv.slice(2).map((p) => [basename(p), readFileSync(p, 'utf8')])
  : [
      ['ref_input.nam (fixture)', readFileSync(fixture('ref_input.nam'), 'utf8')],
      ['synthetic_v070.nam (fixture)', readFileSync(fixture('synthetic_v070.nam'), 'utf8')],
      ['standard WaveNet (synthetic weights)', standardNam()],
    ];

const time = <T>(f: () => T): [T, number] => {
  const t0 = performance.now();
  const r = f();
  return [r, (performance.now() - t0) / 1000];
};

const [di48, tResample] = time(() => referenceDiAt48(syntheticDi()));
console.log(`resample 44.1 -> 48 kHz: ${tResample.toFixed(2)} s`);
for (const [name, json] of cases) {
  const model = parseNam(json);
  const responses = new Map<number, Float64Array>();
  const probeTimes = PROBE_LEVELS.map((level) => {
    const [r, t] = time(() => probeResponse(model, di48, level));
    responses.set(level, r);
    return t;
  });
  const [, tFit] = time(() => finishClo(di48, responses));
  const serial = tResample + probeTimes.reduce((a, b) => a + b, 0) + tFit;
  const parallel = tResample + Math.max(...probeTimes) + tFit;
  console.log(`${name}: probe ${probeTimes.map((t) => t.toFixed(2)).join(' / ')} s, fit ${tFit.toFixed(2)} s; total ${serial.toFixed(1)} s serial, ~${parallel.toFixed(1)} s with parallel probes`);
}
