import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e', testMatch: ['podcast.spec.ts', 'device-translation.spec.ts'], workers: 1,
  timeout: 45_000, expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:3107', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'webkit-mobile', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: 'node e2e/fixtures/podcast-auth-server.mjs', url: 'http://127.0.0.1:54329', reuseExistingServer: false },
    { command: 'npx next dev --port 3107', url: 'http://localhost:3107/login', reuseExistingServer: false,
      env: { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54329', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'podcast-test-only', ALLOWED_EMAILS: '' } },
  ],
})
