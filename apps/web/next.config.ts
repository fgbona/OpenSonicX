import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@pocket-master/core'],
  reactStrictMode: true,
  // Self-contained server for the container image; traces files from the monorepo root.
  output: 'standalone',
  // The editor has no images to optimise, so Next never loads sharp (removed from the image in the Dockerfile).
  images: { unoptimized: true },
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
};

export default config;
