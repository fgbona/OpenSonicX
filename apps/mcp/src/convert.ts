/**
 * NAM capture -> captured-profile arrays in Node: the reference DI is downloaded once from
 * SonicMaster (pinned commit), checked by SHA-256 and cached; the five probe passes run in
 * parallel worker threads, the fit in this thread.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { finishClo, parseNam, parseReferenceDi, PROBE_LEVELS, REFERENCE_DI, referenceDiAt48, type CloArrays } from '@pocket-master/core';

export type Converter = (namJson: string, onProgress?: (done: number, total: number) => void) => Promise<CloArrays>;

export async function referenceDi(cacheDir: string): Promise<Float32Array> {
  const path = join(cacheDir, 'nam_reference_di_44100.f32');
  try {
    return await parseReferenceDi(new Uint8Array(await readFile(path)));
  } catch {
    // missing or damaged: download it again
  }
  const res = await fetch(REFERENCE_DI.url);
  if (!res.ok) throw new Error(`could not download the reference DI for the conversion (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const di = await parseReferenceDi(bytes); // refuses anything but the pinned file
  await mkdir(cacheDir, { recursive: true });
  await writeFile(`${path}.part`, bytes);
  await rename(`${path}.part`, path);
  return di;
}

/** The worker entry next to this module, as a .ts file from source or a .js file from the bundle. */
const workerUrl = () => new URL(import.meta.url.endsWith('.ts') ? './convert-worker.ts' : './convert-worker.js', import.meta.url);

function probeInWorker(namJson: string, di48: Float64Array, level: number): Promise<Float64Array> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerUrl(), { workerData: { namJson, di48, level } });
    worker.once('message', (response: Float64Array) => resolve(response));
    worker.once('error', reject);
    worker.once('exit', (code) => code !== 0 && reject(new Error(`conversion worker stopped (exit ${code})`)));
  });
}

/** `loadDi` replaces the downloaded reference DI (tests use a synthetic one). */
export function nodeConverter(cacheDir: string, loadDi: () => Promise<Float32Array> = () => referenceDi(cacheDir)): Converter {
  return async (namJson, onProgress) => {
    parseNam(namJson); // refuse unsupported captures before downloading anything
    const di48 = referenceDiAt48(await loadDi());
    let done = 0;
    const responses = await Promise.all(
      PROBE_LEVELS.map(async (level) => {
        const response = await probeInWorker(namJson, di48, level);
        onProgress?.(++done, PROBE_LEVELS.length);
        return [level, response] as const;
      }),
    );
    return finishClo(di48, new Map(responses));
  };
}
