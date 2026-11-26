/**
 * NAM capture -> captured-profile arrays in the browser: the probe passes run in parallel web
 * workers, then the fit in one more. The reference DI is downloaded from SonicMaster once, kept in
 * Cache Storage, and checked by SHA-256 every time it is used.
 */
import { decodeClo, parseNam, parseReferenceDi, PROBE_LEVELS, REFERENCE_DI, type CloArrays, type CloCheck } from '@pocket-master/core';

const CACHE = 'pocket-master-reference-di-v1';

export type ConvertStage = { readonly stage: 'download' } | { readonly stage: 'probe'; readonly done: number; readonly total: number } | { readonly stage: 'fit' };

async function referenceDi(): Promise<Float32Array> {
  const cache = typeof caches === 'undefined' ? null : await caches.open(CACHE).catch(() => null);
  const cached = await cache?.match(REFERENCE_DI.url);
  if (cached) {
    try {
      return await parseReferenceDi(new Uint8Array(await cached.arrayBuffer()));
    } catch {
      await cache?.delete(REFERENCE_DI.url);
    }
  }
  const res = await fetch(REFERENCE_DI.url);
  if (!res.ok) throw new Error(`Could not download the reference DI for the conversion (HTTP ${res.status}).`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const di = await parseReferenceDi(bytes);
  await cache?.put(REFERENCE_DI.url, new Response(bytes)).catch(() => undefined);
  return di;
}

/** Workers of the conversion in progress, so a failure stops all of them. */
const running = new Set<Worker>();

function stopAll(): void {
  running.forEach((w) => w.terminate());
  running.clear();
}

// Built from lib/convert.worker.ts by `npm run build:worker` (Turbopack does not bundle workers).
const newWorker = () => new Worker(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/convert-worker.js`, { type: 'module' });

function runJob<T>(message: unknown, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = newWorker();
    running.add(worker);
    worker.onmessage = (e: MessageEvent<{ ok: boolean; error?: string } & T>) => {
      worker.terminate();
      running.delete(worker);
      if (e.data.ok) resolve(e.data);
      else reject(new Error(e.data.error ?? 'conversion failed'));
    };
    worker.onerror = (e) => {
      worker.terminate();
      running.delete(worker);
      reject(new Error(e.message || 'conversion worker failed'));
    };
    worker.postMessage(message, transfer);
  });
}

/** Converts .nam JSON text; `onStage` reports download, each probe pass and the fit. */
export async function convertNam(namJson: string, onStage?: (s: ConvertStage) => void): Promise<CloArrays> {
  parseNam(namJson); // refuse unsupported captures before downloading 12 MB
  onStage?.({ stage: 'download' });
  const di = await referenceDi();
  // The 44.1 -> 48 kHz resample takes about a second: a worker keeps the page responsive.
  const { di48 } = await runJob<{ di48: Float64Array }>({ kind: 'resample', di }, [di.buffer]);
  let done = 0;
  const probes = Promise.all(
    PROBE_LEVELS.map(async (level) => {
      const { response } = await runJob<{ response: Float64Array }>({ kind: 'probe', namJson, di48, level });
      onStage?.({ stage: 'probe', done: ++done, total: PROBE_LEVELS.length });
      return [level, response] as const;
    }),
  );
  const responses = await probes.catch((error) => {
    stopAll(); // one failed pass makes the others useless
    throw error;
  });
  onStage?.({ stage: 'fit' });
  const { arrays } = await runJob<{ arrays: CloArrays }>({ kind: 'finish', di48, responses });
  return arrays;
}

export interface MatriboxClone {
  /** The .clo to upload (8840 bytes). */
  readonly clo: Uint8Array;
  /** The simulated CLONE block on the reference DI's guitar: silent, far too loud or broken is refused. */
  readonly check: CloCheck;
}

export class ConversionCancelled extends Error {
  constructor() {
    super('Conversion cancelled.');
  }
}

/** One Matribox job in its own worker: progress messages until the result; `signal` terminates it. */
function runMatriboxJob(
  message: { kind: 'matribox' | 'check' } & Record<string, unknown>,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<{ clo?: Uint8Array; check: CloCheck }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new ConversionCancelled());
    const worker = newWorker();
    const stop = () => {
      worker.terminate();
      reject(new ConversionCancelled());
    };
    signal?.addEventListener('abort', stop, { once: true });
    const done = () => {
      worker.terminate();
      signal?.removeEventListener('abort', stop);
    };
    worker.onmessage = (e: MessageEvent<{ progress?: number; ok?: boolean; error?: string; clo?: Uint8Array; check: CloCheck }>) => {
      if (e.data.progress !== undefined) return onProgress?.(e.data.progress);
      done();
      if (e.data.ok) resolve(e.data);
      else reject(new Error(e.data.error ?? 'conversion failed'));
    };
    worker.onerror = (e) => {
      done();
      reject(new Error(e.message || 'conversion worker failed'));
    };
    worker.postMessage(message);
  });
}

/**
 * .nam JSON -> a Matribox CLONE capture the official editor's way (generateMatriboxClo, about 35 s
 * off the main thread), checked through the simulated CLONE block. `onStage` reports the download
 * and the conversion's share done; aborting `signal` stops the worker.
 */
export async function convertNamForMatribox(namJson: string, onStage?: (s: { stage: 'download' } | { stage: 'convert'; fraction: number }) => void, signal?: AbortSignal): Promise<MatriboxClone> {
  parseNam(namJson); // refuse unsupported captures before downloading 12 MB
  onStage?.({ stage: 'download' });
  const di = await referenceDi();
  if (signal?.aborted) throw new ConversionCancelled();
  onStage?.({ stage: 'convert', fraction: 0 });
  const { clo, check } = await runMatriboxJob({ kind: 'matribox', namJson, di }, (fraction) => onStage?.({ stage: 'convert', fraction }), signal);
  if (!clo) throw new Error('the conversion gave no capture');
  return { clo, check };
}

/** A .clo file checked (size, magic, CRC), then played through the simulated CLONE block in a worker. */
export async function checkCloFile(clo: Uint8Array, signal?: AbortSignal): Promise<MatriboxClone> {
  decodeClo(clo);
  const { check } = await runMatriboxJob({ kind: 'check', clo }, undefined, signal);
  return { clo, check };
}
