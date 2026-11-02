import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Shared by local Next production and Vercel's image optimizer.
    minimumCacheTTL: 60 * 60 * 24 * 7,
    maximumRedirects: 0,
    remotePatterns: ['daily-news', 'ai-digest', 'topic', 'deep-dive'].map((directory) => ({
      protocol: 'https' as const,
      hostname: 'qiniu.aiquannei.com',
      port: '',
      pathname: `/podcast/${directory}/**`,
    })),
  },
  async headers() {
    return [{
      // Public assets without content hashes; hashed /_next/static keeps Next's one-year policy.
      source: '/:asset([^/]+\\.(?:svg|png|jpe?g|webp|avif|ico|woff2?))',
      headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=604800' }],
    }];
  },
};

export default nextConfig;
