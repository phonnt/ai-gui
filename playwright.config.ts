import { defineConfig } from '@playwright/test';

const SERVER_PORT = Number(process.env.AI_GUI_E2E_SERVER_PORT ?? 8899);
const WEB_PORT = Number(process.env.AI_GUI_E2E_WEB_PORT ?? 5199);

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: 0,
  reporter: 'line',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `AI_GUI_PORT=${SERVER_PORT} bun src/index.ts`,
      cwd: 'apps/server',
      port: SERVER_PORT,
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: `AI_GUI_PORT=${SERVER_PORT} bunx vite --port ${WEB_PORT} --strictPort`,
      cwd: 'apps/web',
      port: WEB_PORT,
      reuseExistingServer: true,
      timeout: 60_000,
      env: { AI_GUI_PORT: String(SERVER_PORT) },
    },
  ],
});
