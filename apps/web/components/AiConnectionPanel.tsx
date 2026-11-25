'use client';

import { useEffect, useState } from 'react';
import { AI_TOOLS, runAiTool, useDesktopAi, type AiState, type DesktopAi } from '@/lib/aiBridge';
import { Fold } from './Fold';
import { useI18n } from './I18n';

/**
 * The desktop app's AI connection: an MCP client on this computer (Claude Code) drives the editor's
 * live session. Off until turned on; shown only inside the desktop app.
 */
export function AiConnectionPanel() {
  const ai = useDesktopAi();
  return ai ? <Panel ai={ai} /> : null;
}

function Panel({ ai }: { ai: DesktopAi }) {
  const { t } = useI18n();
  const [state, setState] = useState<AiState | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    void ai.state().then(setState);
    const offState = ai.onState(setState);
    // The editor answers the connection's tool calls while the app runs (they fail while it is off).
    const offServe = ai.serve(AI_TOOLS, runAiTool);
    return () => {
      offState();
      offServe();
    };
  }, [ai]);
  const copy = async (what: 'token' | 'command' | 'url') => {
    if (await ai.copy(what)) setCopied(what);
  };
  const update = (next: Promise<AiState | null>) => void next.then((s) => s && setState(s));

  const on = state?.enabled === true;
  const port = state?.port ?? null;
  const url = port === null ? null : `http://127.0.0.1:${port}/mcp`;
  const command = url && state?.maskedToken ? `claude mcp add --transport http opensonicx ${url} --header "Authorization: Bearer ${state.maskedToken}"` : null;
  return (
    <Fold title={t('ai.title')} note={on ? t('ai.on') : t('ai.off')} open={on}>
      <div className="ai-connection">
        <p className="muted small">{t('ai.intro')}</p>
        <label className="check">
          <input type="checkbox" checked={on} disabled={state === null} onChange={(e) => update(ai.setEnabled(e.target.checked))} />
          <span>{t('ai.enable')}</span>
        </label>
        {state?.error && (
          <p className="alert" role="alert">
            {t('ai.error', { reason: state.error })}
          </p>
        )}
        {on && url && (
          <>
            <dl className="ai-facts">
              <dt>{t('ai.endpoint')}</dt>
              <dd>
                <code>{url}</code>{' '}
                <button type="button" className="btn btn-small" onClick={() => void copy('url')}>
                  {t('ai.copy')}
                </button>
                {port !== state?.defaultPort && <span className="muted small"> {t('ai.portBusy', { port: state?.defaultPort ?? '' })}</span>}
              </dd>
              <dt>{t('ai.token')}</dt>
              <dd>
                <code>{state?.maskedToken}</code>{' '}
                <button type="button" className="btn btn-small" onClick={() => void copy('token')}>
                  {t('ai.copy')}
                </button>{' '}
                <button
                  type="button"
                  className="btn btn-small"
                  onClick={() => {
                    setCopied(null);
                    update(ai.regenerate());
                  }}
                >
                  {t('ai.regenerate')}
                </button>
              </dd>
              <dt>{t('ai.status')}</dt>
              <dd role="status">{state?.lastRequestAt ? t('ai.lastRequest', { time: new Date(state.lastRequestAt).toLocaleTimeString() }) : t('ai.noRequests')}</dd>
            </dl>
            <h3 className="ai-setup-title">{t('ai.setup')}</h3>
            <p className="muted small">{t('ai.setupHint')}</p>
            <pre className="ai-command">
              <code>{command}</code>
            </pre>
            <p>
              <button type="button" className="btn" onClick={() => void copy('command')}>
                {t('ai.copyCommand')}
              </button>
              {copied && (
                <span className="muted small" role="status">
                  {' '}
                  {t('ai.copied')}
                </span>
              )}
            </p>
            <p className="muted small">{t('ai.safety')}</p>
          </>
        )}
      </div>
    </Fold>
  );
}
