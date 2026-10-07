import { defineConfig, devices } from '@playwright/test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// End-to-end tests run the real sync server serving the built app (npm run build first).
const PORT = 8790;
const dataDir = mkdtempSync(join(tmpdir(), 'tally-e2e-'));
const localChromium = '/opt/pw-browsers/chromium';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    launchOptions: existsSync(localChromium) && !process.env.CI ? { executablePath: localChromium } : {},
  },
  projects: [
    { name: 'phone', use: { ...devices['Pixel 7'], browserName: 'chromium' }, testIgnore: /desktop|sync/ },
    { name: 'desktop', use: { viewport: { width: 1280, height: 860 } }, testMatch: /desktop|sync/ },
  ],
  webServer: {
    command: `node ../server/src/index.js serve`,
    url: `http://127.0.0.1:${PORT}/api/v1/health`,
    reuseExistingServer: false,
    env: { TALLY_PORT: String(PORT), TALLY_HOST: '127.0.0.1', TALLY_DATA_DIR: dataDir, TALLY_STATIC_DIR: join(process.cwd(), 'dist') },
  },
});
