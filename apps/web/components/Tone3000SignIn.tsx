'use client';

import type { useTone3000 } from '@/lib/useTone3000';
import { useI18n } from './I18n';

type Tone3000 = ReturnType<typeof useTone3000>;

/** The sign-in step of TONE3000's device login: the button, then the code to approve at tone3000.com. */
export function Tone3000Login({ t3k }: { t3k: Pick<Tone3000, 'login' | 'signIn'> }) {
  const { t } = useI18n();
  return t3k.login ? (
    <div className="t3k-login" role="status">
      <p>{t('t3k.code', { link: t3k.login.verificationUri, code: t3k.login.userCode })}</p>
      <p>
        <a className="btn btn-primary btn-small" href={t3k.login.verificationUriComplete} target="_blank" rel="noreferrer">
          {t3k.login.userCode}
        </a>{' '}
        <span className="muted small">{t('t3k.waiting')}</span>
      </p>
    </div>
  ) : (
    <button type="button" className="btn btn-primary" onClick={t3k.signIn}>
      {t('t3k.signIn')}
    </button>
  );
}

/** TONE3000 in the Clones panel: sign in so the assistant can search captures; nothing when the site has no key. */
export function Tone3000SignIn({ t3k }: { t3k: Tone3000 }) {
  const { t, te } = useI18n();
  if (!t3k.configured) return null;
  return (
    <div className="t3k-body">
      <p className="muted small">
        {t('mbClone.t3k')}{' '}
        <a href="https://www.tone3000.com" target="_blank" rel="noreferrer">
          TONE3000
        </a>
      </p>
      {t3k.signedIn ? (
        <div className="mb-head-actions">
          <span className="small" role="status">
            {t('mbClone.t3kSignedIn')}
          </span>
          <button type="button" className="btn btn-small" onClick={t3k.signOut}>
            {t('t3k.signOut')}
          </button>
        </div>
      ) : (
        <Tone3000Login t3k={t3k} />
      )}
      {t3k.error && (
        <p className="alert" role="alert">
          {te(t3k.error)}
        </p>
      )}
    </div>
  );
}
