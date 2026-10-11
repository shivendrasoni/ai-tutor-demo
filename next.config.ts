import type { NextConfig } from 'next';

// NEXT_DIST_DIR lets parallel e2e runs keep separate build caches (see playwright.config.ts).
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
