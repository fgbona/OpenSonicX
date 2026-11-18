import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@pocket-master/core'],
  reactStrictMode: true,
  // Self-contained server for the container image; traces files from the monorepo root.
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
};

export default config;
