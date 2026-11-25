// Builds the web app as a static export into web/, then bundles the main process into dist/.
// The release passes NEXT_PUBLIC_TONE3000_CLIENT_ID, as for the container image.
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { build } from 'esbuild';

execFileSync('npm', ['run', 'build', '-w', '@pocket-master/web'], {
  cwd: '../..',
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, NEXT_OUTPUT: 'export' },
});
rmSync('web', { recursive: true, force: true });
cpSync('../web/out', 'web', { recursive: true });

await build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: 'dist/main.cjs',
  external: ['electron'],
});
// The page's only bridge to the app (sandboxed: one bundled file, electron its only import).
await build({
  entryPoints: ['src/preload.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: 'dist/preload.cjs',
  external: ['electron'],
});
