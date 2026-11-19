// Bundles the server; the release passes TONE3000_CLIENT_ID so the package carries the editor's
// publishable TONE3000 key (an app id meant to be embedded; users still sign in themselves).
import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts', 'src/convert-worker.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: 'dist',
  external: ['@julusian/midi', '@modelcontextprotocol/sdk', 'zod'],
  define: { 'process.env.BUNDLED_TONE3000_CLIENT_ID': JSON.stringify(process.env.TONE3000_CLIENT_ID?.trim() ?? '') },
});
