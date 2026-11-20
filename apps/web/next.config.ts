import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

// GitHub Pages serves the site under /<repository>: NEXT_BASE_PATH sets that prefix (empty elsewhere),
// and NEXT_PUBLIC_BASE_PATH hands it to code that builds URLs itself (the conversion worker).
const basePath = process.env.NEXT_BASE_PATH ?? '';

const config: NextConfig = {
  basePath,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  transpilePackages: ['@pocket-master/core'],
  reactStrictMode: true,
  // Self-contained server for the container image; NEXT_OUTPUT=export builds the static files
  // the desktop app (apps/desktop) serves instead.
  output: process.env.NEXT_OUTPUT === 'export' ? 'export' : 'standalone',
  // The editor has no images to optimise, so Next never loads sharp (removed from the image in the Dockerfile).
  images: { unoptimized: true },
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
};

export default config;
