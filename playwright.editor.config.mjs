import { defineConfig, devices } from '@playwright/test';

const TEST_HOST = String(process.env.TEST_HOST || '127.0.0.1');
const TEST_PORT = Number.parseInt(process.env.TEST_PORT || '5312', 10) || 5312;
const OUTPUT_DIR = String(process.env.PW_OUTPUT_DIR || 'test-results/editor-ui');

export default defineConfig({
    testDir: './tests',
    timeout: 90_000,
    retries: 0,
    workers: 1,
    outputDir: OUTPUT_DIR,
    use: {
        baseURL: `http://${TEST_HOST}:${TEST_PORT}`,
        trace: 'off',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
    ],
    webServer: {
        command: `npm run build && npx vite preview --host ${TEST_HOST} --port ${TEST_PORT} --strictPort`,
        url: `http://${TEST_HOST}:${TEST_PORT}/editor/map-editor-3d.html`,
        timeout: 180_000,
        reuseExistingServer: process.env.PW_REUSE_SERVER === '1',
    },
});
