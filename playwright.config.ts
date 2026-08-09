import { defineConfig } from '@playwright/test'
import 'dotenv/config'

// dev server 实际跑在 3001（3000 常被占用）。E2E_BASE_URL 可覆盖。
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3001'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // 用例之间共享同一个测试账号的单词本，串行跑避免互相踩数据
  workers: 1,
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run dev',
    url: BASE_URL + '/login',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
