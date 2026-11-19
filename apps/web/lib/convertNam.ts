/**
 * NAM capture -> captured-profile arrays in the browser: the probe passes run in parallel web
 * workers, then the fit in one more. The reference DI is downloaded from SonicMaster once, kept in
 * Cache Storage, and checked by SHA-256 every time it is used.
 */
import { parseNam, parseReferenceDi, PROBE_LEVELS, REFERENCE_DI, referenceDiAt48, type CloArrays } from '@pocket-master/core';

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

function runJob<T>(message: unknown, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    // Built from lib/convert.worker.ts by `npm run build:worker` (Turbopack does not bundle workers).
    const worker = new Worker('/convert-worker.js', { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ ok: boolean; error?: string } & T>) => {
      worker.terminate();
      if (e.data.ok) resolve(e.data);
      else reject(new Error(e.data.error ?? 'conversion failed'));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'conversion worker failed'));
    };
    worker.postMessage(message, transfer);
  });
}

/** Converts .nam JSON text; `onStage` reports download, each probe pass and the fit. */
export async function convertNam(namJson: string, onStage?: (s: ConvertStage) => void): Promise<CloArrays> {
  parseNam(namJson); // refuse unsupported captures before downloading 12 MB
  onStage?.({ stage: 'download' });
  const di48 = referenceDiAt48(await referenceDi());
  let done = 0;
  const responses = await Promise.all(
    PROBE_LEVELS.map(async (level) => {
      const { response } = await runJob<{ response: Float64Array }>({ kind: 'probe', namJson, di48, level });
      onStage?.({ stage: 'probe', done: ++done, total: PROBE_LEVELS.length });
      return [level, response] as const;
    }),
  );
  onStage?.({ stage: 'fit' });
  const { arrays } = await runJob<{ arrays: CloArrays }>({ kind: 'finish', di48, responses });
  return arrays;
}
