import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
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
