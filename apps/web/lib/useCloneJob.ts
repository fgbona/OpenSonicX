'use client';

/** The conversion of one capture in the Clones panel: its stage, result and cancellation. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { checkCloFile, ConversionCancelled, convertNamForMatribox, type MatriboxClone } from './convertNam';
import { isNamFile } from './cloneSource';

export type CloneJob =
  | { readonly state: 'idle' }
  | { readonly state: 'working'; readonly stage: 'download' | 'convert' | 'check'; readonly fraction: number }
  | ({ readonly state: 'ready' } & MatriboxClone)
  | { readonly state: 'failed'; readonly error: string };

/** What `run` ended with: the capture, the person's cancel, or the reason it failed. */
export type CloneJobResult = MatriboxClone | 'cancelled' | { readonly error: string };

export function useCloneJob() {
  const [job, setJob] = useState<CloneJob>({ state: 'idle' });
  const abort = useRef<AbortController | null>(null);

  const cancel = useCallback(() => abort.current?.abort(), []);
  useEffect(() => cancel, [cancel]); // the panel went away: stop the worker
  const reset = useCallback(() => {
    cancel();
    setJob({ state: 'idle' });
  }, [cancel]);

  /** Converts a .nam (about 35 s) or checks a .clo; a newer run replaces the one in progress. */
  const run = useCallback(async (bytes: Uint8Array): Promise<CloneJobResult> => {
    abort.current?.abort();
    const mine = new AbortController();
    abort.current = mine;
    // A cancel leaves the panel idle; a newer run has already taken over the state.
    const stopped = () => {
      if (abort.current === mine) setJob({ state: 'idle' });
      return 'cancelled' as const;
    };
    const nam = isNamFile(bytes);
    setJob({ state: 'working', stage: nam ? 'download' : 'check', fraction: 0 });
    try {
      const result = nam
        ? await convertNamForMatribox(
            new TextDecoder().decode(bytes),
            (s) => !mine.signal.aborted && setJob({ state: 'working', stage: s.stage, fraction: s.stage === 'convert' ? s.fraction : 0 }),
            mine.signal,
          )
        : await checkCloFile(bytes, mine.signal);
      if (mine.signal.aborted) return stopped();
      setJob({ state: 'ready', ...result });
      return result;
    } catch (e) {
      if (e instanceof ConversionCancelled || mine.signal.aborted) return stopped();
      const error = e instanceof Error ? e.message : String(e);
      setJob({ state: 'failed', error });
      return { error };
    }
  }, []);

  return { job, run, cancel, reset };
}
