import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

// В CI/sandbox-окружениях Chromium может быть предустановлен вне версии Playwright —
// путь можно передать через PLAYWRIGHT_CHROMIUM_PATH.
const chromiumPath =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ??
  (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

export default defineConfig({
  testDir: './e2e',
  use: {
    baseURL: 'http://localhost:3000',
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ?? 'postgresql://finance:finance@localhost:5432/finance_os',
      AUTH_JWT_SECRET: process.env.AUTH_JWT_SECRET ?? 'dev-only-secret',
    },
  },
});
