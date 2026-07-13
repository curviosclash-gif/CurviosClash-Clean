import { defineConfig, devices } from '@playwright/test';

const testPort = Number.parseInt(process.env.TEST_PORT || '5291', 10) || 5291;

export default defineConfig({
    testDir: './tests',
    timeout: 90_000,
    retries: 0,
    workers: 1,
    use: {
        baseURL: `http://127.0.0.1:${testPort}`,
        trace: 'off',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: `npm run dev -- --port ${testPort} --strictPort --host 127.0.0.1`,
        url: `http://127.0.0.1:${testPort}`,
        timeout: 120_000,
        reuseExistingServer: false,
    },
});
