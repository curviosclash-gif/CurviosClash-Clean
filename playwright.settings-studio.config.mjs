import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests',
    testMatch: ['settings-studio-electron.interaction.mjs'],
    timeout: 60_000,
    fullyParallel: false,
    workers: 1,
    reporter: [['list']],
    outputDir: path.join(os.tmpdir(), `curvios-settings-studio-playwright-${process.pid}`),
    use: {
        trace: 'off',
        screenshot: 'off',
        video: 'off',
    },
});
