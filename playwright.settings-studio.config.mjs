import path from 'node:path';
import { defineConfig } from '@playwright/test';

const outputDir = process.env.PW_OUTPUT_DIR || path.join('test-results', 'settings-studio');

export default defineConfig({
    testDir: './tests',
    testMatch: ['settings-studio-workspace.interaction.mjs', 'settings-studio-electron.interaction.mjs', 'applied-map-balancing-electron.interaction.mjs'],
    timeout: 60_000,
    fullyParallel: false,
    workers: 1,
    reporter: [['list'], ['json', { outputFile: process.env.PW_RESULTS_JSON || path.join(outputDir, 'results.json') }]],
    outputDir,
    use: {
        trace: 'off',
        screenshot: 'off',
        video: 'off',
    },
});
