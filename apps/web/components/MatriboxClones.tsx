'use client';

import { useEffect, useRef, useState } from 'react';
import { checkMbCloneName, MB_CLONE_SLOTS, type MbCloneStep } from '@pocket-master/core';
import { cloneNameFromFile, type CloneSource, fetchCloneFile, firstEmptyClone, isEmptyClone, isNamFile, pickToneModel } from '@/lib/cloneSource';
import { useCloneJob } from '@/lib/useCloneJob';
import type { useTone3000 } from '@/lib/useTone3000';
import type { Matribox } from '@/lib/useMatribox';
import { FileButton } from './FileButton';
import { useI18n } from './I18n';
import { MatriboxCloneConfirm } from './MatriboxCloneConfirm';
import { ProgressBar } from './ProgressBar';
import { Tone3000SignIn } from './Tone3000SignIn';

/** The assistant's proposal: load this source into this slot (0-based) under this name; the person confirms. */
export interface CloneProposal {
  readonly slot: number;
  readonly name: string;
  readonly source: CloneSource;
  readonly resolve: (result: 'uploaded' | 'cancelled') => void;
  readonly reject: (error: Error) => void;
}

interface Props {
  mb: Matribox;
  t3k: ReturnType<typeof useTone3000>;
  proposal: CloneProposal | null;
  /** The proposal is settled (the editor drops it). */
  onProposalEnd: () => void;
}

const validName = (name: string) => {
  try {
    checkMbCloneName(name);
    return true;
  } catch {
    return false; // the rule is shown in the UI language (mb.nameRule)
  }
};

/**
 * Turns a NAM capture (or takes a .clo) into a Matribox Clone capture and writes it to one of the 10
 * CLONE slots, after the person confirms the overwrite. The assistant can open it filled in.
 */
export function MatriboxClones({ mb, t3k, proposal, onProposalEnd }: Props) {
  const { t, te } = useI18n();
  const names = mb.unit?.cloneNames ?? [];
  const { job, run, cancel, reset } = useCloneJob();
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState('');
  const [name, setName] = useState('');
  const [slot, setSlot] = useState(() => firstEmptyClone(names));
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [step, setStep] = useState<MbCloneStep | null>(null);
  const [done, setDone] = useState<{ slot: number; name: string } | null>(null);
  const section = useRef<HTMLElement>(null);
  const active = useRef<CloneProposal | null>(null);

  const settle = (result: 'uploaded' | 'cancelled' | Error) => {
    const p = active.current;
    if (!p) return;
    active.current = null;
    if (result instanceof Error) p.reject(result);
    else p.resolve(result);
    onProposalEnd();
  };
  const busy = mb.busy !== null || job.state === 'working' || loading;
  const ready = job.state === 'ready' ? job : null;
  const refusal = ready && !ready.check.ok ? (ready.check.problem ?? 'broken') : null;
  const canWrite = ready?.check.ok === true && validName(name) && !busy;

  const load = async (source: CloneSource): Promise<Uint8Array> => {
    if ('url' in source) return fetchCloneFile(source.url);
    const model = pickToneModel(await t3k.models(source.toneId), source.modelId);
    return t3k.download(model.url);
  };
  const convert = async (data: Uint8Array) => {
    setProblem(null);
    const result = await run(data);
    if (result === 'cancelled') return result;
    if ('error' in result) return result;
    return result.check.ok ? result : { error: `the converted capture was refused (${result.check.problem ?? 'broken'}) and was not offered` };
  };

  // The assistant's proposal: fill in, load, convert; the person confirms below (or cancels).
  // biome-ignore lint/correctness/useExhaustiveDependencies: it runs once per proposal
  useEffect(() => {
    if (!proposal) return;
    active.current = proposal;
    section.current?.scrollIntoView?.({ block: 'center' });
    mb.clearError();
    setDone(null);
    setProblem(null);
    setBytes(null);
    setName(proposal.name);
    setSlot(proposal.slot);
    setFileName('url' in proposal.source ? proposal.source.url : `TONE3000 #${proposal.source.toneId}`);
    reset();
    void (async () => {
      try {
        setLoading(true);
        const data = await load(proposal.source);
        if (active.current !== proposal) return;
        setBytes(data);
        setLoading(false);
        const result = await convert(data);
        if (active.current !== proposal) return;
        if (result === 'cancelled') return settle('cancelled');
        if ('error' in result) return settle(new Error(result.error));
        setConfirming(true);
      } catch (e) {
        if (active.current !== proposal) return;
        setLoading(false);
        setProblem(e instanceof Error ? e.message : String(e));
        settle(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  }, [proposal]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: on unmount only (settle reads refs)
  useEffect(() => () => settle('cancelled'), []);

  const pick = async (input: HTMLInputElement) => {
    const chosen = input.files?.[0];
    input.value = '';
    if (!chosen) return;
    settle('cancelled'); // the person went their own way
    reset();
    setDone(null);
    mb.clearError();
    setFileName(chosen.name);
    setName(cloneNameFromFile(chosen.name));
    setSlot(firstEmptyClone(names));
    const data = new Uint8Array(await chosen.arrayBuffer());
    setBytes(data);
    if (!isNamFile(data)) void convert(data); // a .clo is only checked: no wait to speak of
  };

  const write = async () => {
    if (!ready) return;
    const ok = await mb.uploadClone(slot, ready.clo, name, setStep);
    setStep(null);
    if (!ok) return;
    setConfirming(false);
    setDone({ slot: slot + 1, name });
    setBytes(null);
    setFileName('');
    reset();
    settle('uploaded');
  };
  const closeConfirm = () => {
    setConfirming(false);
    settle('cancelled');
  };
  const dismiss = () => {
    cancel();
    setLoading(false);
    settle('cancelled');
  };

  return (
    <section className="panel" aria-label={t('mbClone.title')} ref={section}>
      <div className="panel-head">
        <h2>{t('mbClone.title')}</h2>
      </div>
      <div className="mb-body">
        <p className="muted small">{t('mbClone.note')}</p>
        <ul className="mb-clones" aria-label={t('mbClone.slots')}>
          {Array.from({ length: MB_CLONE_SLOTS }, (_, i) => (
            <li key={i}>
              <strong>CLONE {i + 1}</strong> {isEmptyClone(i, names[i] ?? '') ? <span className="muted">{t('mbClone.empty')}</span> : (names[i] ?? '').trim()}
            </li>
          ))}
        </ul>
        {proposal && (
          <p className="small" role="status">
            {t('mbClone.proposal', { name: proposal.name, slot: proposal.slot + 1 })}{' '}
            <button type="button" className="btn-link" onClick={dismiss}>
              {t('mbClone.dismiss')}
            </button>
          </p>
        )}
        <div className="mb-head-actions">
          <FileButton className="btn" accept=".nam,.clo,application/json,application/octet-stream" pickLabel={t('mbClone.pick')} disabled={busy} onPick={(input) => void pick(input)}>
            {t('mbClone.choose')}
          </FileButton>
          {fileName && <span className="small">{fileName}</span>}
        </div>
        {fileName && (
          <div className="mb-clone-form">
            <label className="field">
              <span>{t('save.name')}</span>
              <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} aria-invalid={!validName(name)} autoComplete="off" spellCheck={false} disabled={busy} />
            </label>
            <label className="field">
              <span>{t('save.slot')}</span>
              <select value={slot} onChange={(e) => setSlot(Number(e.target.value))} disabled={busy}>
                {Array.from({ length: MB_CLONE_SLOTS }, (_, i) => (
                  <option key={i} value={i}>
                    CLONE {i + 1} · {isEmptyClone(i, names[i] ?? '') ? t('mbClone.empty') : (names[i] ?? '').trim()}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
        {fileName && !validName(name) && name.length > 0 && <p className="field-error">{t('mb.nameRule')}</p>}
        {bytes && isNamFile(bytes) && (job.state === 'idle' || job.state === 'failed') && !loading && (
          <div className="mb-head-actions">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void convert(bytes)}>
              {t('mbClone.convert')}
            </button>
          </div>
        )}
        {loading && (
          <p className="muted small" role="status">
            {t('mbClone.loading')}
          </p>
        )}
        {job.state === 'working' && (
          <>
            <ProgressBar
              progress={{
                step: job.stage === 'download' ? 'Downloading' : job.stage === 'check' ? 'Verifying' : 'Converting',
                done: Math.round(job.fraction * 100),
                total: job.stage === 'convert' ? 100 : 0,
              }}
            />
            <div className="mb-head-actions">
              <button type="button" className="btn" onClick={cancel}>
                {t('action.cancel')}
              </button>
            </div>
          </>
        )}
        {ready && !refusal && (
          <>
            <p className="small" role="status">
              {t('mbClone.ready', { rms: ready.check.rmsDb.toFixed(1), peak: ready.check.peak.toFixed(2) })}
            </p>
            <div className="mb-head-actions">
              <button type="button" className="btn btn-danger" disabled={!canWrite} onClick={() => setConfirming(true)}>
                {t('mbClone.write', { slot: slot + 1 })}
              </button>
            </div>
          </>
        )}
        {refusal && (
          <p className="alert" role="alert">
            {t(`mbClone.refused.${refusal}`)}
          </p>
        )}
        {(job.state === 'failed' ? job.error : problem) && (
          <p className="alert" role="alert">
            {te((job.state === 'failed' ? job.error : problem) ?? '')}
          </p>
        )}
        {done && (
          <p className="small" role="status">
            {t('mbClone.done', { slot: done.slot, name: done.name })}
          </p>
        )}
        <Tone3000SignIn t3k={t3k} />
      </div>
      <MatriboxCloneConfirm
        open={confirming}
        slot={slot + 1}
        name={name}
        current={isEmptyClone(slot, names[slot] ?? '') ? null : (names[slot] ?? '').trim()}
        busy={mb.busy === 'Uploading'}
        step={step}
        error={mb.error}
        onConfirm={() => void write()}
        onClose={closeConfirm}
      />
    </section>
  );
}
