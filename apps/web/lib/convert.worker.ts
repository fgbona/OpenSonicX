/// <reference lib="webworker" />
/**
 * Web worker for the NAM conversions: the Pocket Master's (the DI resample, one probe pass, or the
 * final fit) and the Matribox's (the whole startClone port, reporting progress, then the simulated
 * CLONE block's sanity check; or the check alone for a .clo file).
 */
import { checkClo, cloProbe, encodeClo, finishClo, generateMatriboxClo, parseNam, probeResponse, referenceDiAt48 } from '@pocket-master/core';

type Job =
  | { readonly kind: 'resample'; readonly di: Float32Array }
  | { readonly kind: 'probe'; readonly namJson: string; readonly di48: Float64Array; readonly level: number }
  | { readonly kind: 'finish'; readonly di48: Float64Array; readonly responses: readonly (readonly [number, Float64Array])[] }
  | { readonly kind: 'matribox'; readonly namJson: string; readonly di: Float32Array }
  | { readonly kind: 'check'; readonly clo: Uint8Array };

const post = (message: unknown, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(message, transfer);

self.onmessage = (event: MessageEvent<Job>) => {
  const job = event.data;
  try {
    if (job.kind === 'resample') {
      const di48 = referenceDiAt48(job.di);
      post({ ok: true, di48 }, [di48.buffer]);
    } else if (job.kind === 'probe') {
      const response = probeResponse(parseNam(job.namJson), job.di48, job.level);
      post({ ok: true, response }, [response.buffer]);
    } else if (job.kind === 'finish') {
      post({ ok: true, arrays: finishClo(job.di48, new Map(job.responses)) });
    } else if (job.kind === 'matribox') {
      const clo = encodeClo(generateMatriboxClo(job.namJson, job.di, (fraction) => post({ progress: fraction })));
      post({ ok: true, clo, check: checkClo(clo, cloProbe()) }, [clo.buffer]);
    } else {
      post({ ok: true, check: checkClo(job.clo, cloProbe()) });
    }
  } catch (error) {
    post({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
