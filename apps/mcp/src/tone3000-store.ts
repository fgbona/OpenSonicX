/**
 * TONE3000 sign-in for the MCP server: the publishable key from TONE3000_CLIENT_ID or
 * ~/.pocket-master-editor/tone3000.env, and the tokens in tone3000-token.json (owner-only).
 */
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { refreshTokens, type Tokens } from '@pocket-master/core';

export interface Tone3000Store {
  clientId(): Promise<string>;
  /** A usable access token, refreshed when it is about to expire; null when not signed in. */
  accessToken(): Promise<string | null>;
  save(tokens: Tokens): Promise<void>;
}

/**
 * The editor's own publishable key, written in by the release build (build.mjs, from the
 * repository variable TONE3000_CLIENT_ID); empty in a development build. It names the app, not
 * the user: every user still signs in with their own TONE3000 account.
 */
const BUNDLED_CLIENT_ID: string = process.env.BUNDLED_TONE3000_CLIENT_ID ?? '';

export function fileTone3000Store(home: string, fetch: typeof globalThis.fetch = globalThis.fetch, now: () => number = Date.now, bundledClientId: string = BUNDLED_CLIENT_ID): Tone3000Store {
  const tokenPath = join(home, 'tone3000-token.json');
  const save = async (tokens: Tokens) => {
    await mkdir(home, { recursive: true });
    await writeFile(tokenPath, JSON.stringify(tokens), { mode: 0o600 });
    await chmod(tokenPath, 0o600);
  };
  const clientId = async () => {
    const fromEnv = process.env.TONE3000_CLIENT_ID?.trim();
    if (fromEnv) return fromEnv;
    const text = await readFile(join(home, 'tone3000.env'), 'utf8').catch(() => '');
    // Like sourcing the file in a shell: the last assignment wins; the '...' placeholder is skipped.
    const value =
      text
        .split(/\r?\n/)
        .filter((l) => l.startsWith('TONE3000_CLIENT_ID='))
        .map((l) =>
          l
            .slice('TONE3000_CLIENT_ID='.length)
            .trim()
            .replace(/^['"]|['"]$/g, ''),
        )
        .filter((v) => v && v !== '...')
        .at(-1) ?? '';
    if (!value && bundledClientId) return bundledClientId;
    if (!value) {
      throw new Error(`no TONE3000 key: put TONE3000_CLIENT_ID=<publishable key> in ${join(home, 'tone3000.env')} (from tone3000.com/settings)`);
    }
    return value;
  };
  return {
    clientId,
    save,
    async accessToken() {
      let tokens: Tokens;
      try {
        tokens = JSON.parse(await readFile(tokenPath, 'utf8')) as Tokens;
      } catch {
        return null;
      }
      if (tokens.expiresAt - now() > 60_000) return tokens.accessToken;
      if (!tokens.refreshToken) return null;
      try {
        const fresh = await refreshTokens({ clientId: await clientId(), refreshToken: tokens.refreshToken }, fetch, now);
        await save(fresh);
        return fresh.accessToken;
      } catch {
        return null;
      }
    },
  };
}
