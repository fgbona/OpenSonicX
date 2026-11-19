/// <reference lib="webworker" />
/** Web worker for the NAM -> captured-profile conversion: one probe pass, or the final fit. */
import { finishClo, parseNam, probeResponse } from '@pocket-master/core';

type Job =
  | { readonly kind: 'probe'; readonly namJson: string; readonly di48: Float64Array; readonly level: number }
  | { readonly kind: 'finish'; readonly di48: Float64Array; readonly responses: readonly (readonly [number, Float64Array])[] };

self.onmessage = (event: MessageEvent<Job>) => {
  const job = event.data;
  try {
    if (job.kind === 'probe') {
      const response = probeResponse(parseNam(job.namJson), job.di48, job.level);
      (self as unknown as Worker).postMessage({ ok: true, response }, [response.buffer]);
    } else {
      (self as unknown as Worker).postMessage({ ok: true, arrays: finishClo(job.di48, new Map(job.responses)) });
    }
  } catch (error) {
    (self as unknown as Worker).postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
};
