// @ts-check
import { defineConfig, devices } from '@playwright/test';
import {
    applyPlaywrightRunProfileEnv,
    PLAYWRIGHT_DEFAULT_RUN_PROFILE,
    resolvePlaywrightRunProfile,
} from './scripts/playwright-run-profile.mjs';

const isCI = !!process.env.CI;
const runProfile = applyPlaywrightRunProfileEnv(
    process.env,
    process.env.PW_RUN_PROFILE || PLAYWRIGHT_DEFAULT_RUN_PROFILE
);
const hasExplicitAppMode = String(process.env.VITE_APP_MODE || '').trim().length > 0;
if (!hasExplicitAppMode) {
    process.env.VITE_APP_MODE = runProfile.name.startsWith('desktop-') ? 'app' : 'web';
}

function toPositiveInt(rawValue, fallback, min = 1, max = 65_535) {
    const numeric = Number.parseInt(String(rawValue || ''), 10);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function hashRunTag(value) {
    let hash = 0;
    const source = String(value || '');
    for (let i = 0; i < source.length; i++) {
        hash = ((hash << 5) - hash) + source.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function sanitizeRunTag(value) {
    const normalized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || `pid-${process.pid}`;
}

function resolveIsolatedPlaywrightEnv(profile) {
    const fallbackRunTag = `${profile.name}-pid-${process.pid}-${Date.now().toString(36)}`;
    const runTag = sanitizeRunTag(process.env.PW_RUN_TAG || fallbackRunTag);
    const defaultPortBase = toPositiveInt(process.env.PW_BASE_PORT, 5173, 1024, 60_000);
    const defaultPortSpan = toPositiveInt(process.env.PW_PORT_SPAN, 400, 10, 4000);
    const defaultPort = defaultPortBase + (hashRunTag(runTag) % defaultPortSpan);
    const testPort = toPositiveInt(process.env.TEST_PORT, defaultPort, 1024, 65_535);
    const outputDir = String(process.env.PW_OUTPUT_DIR || `test-results/${runTag}`);
    const workers = toPositiveInt(process.env.PW_WORKERS, 1, 1, 32);

    process.env.PW_RUN_TAG = runTag;
    process.env.TEST_PORT = String(testPort);
    process.env.PW_OUTPUT_DIR = outputDir;
    process.env.PW_WORKERS = String(workers);

    return {
        runTag,
        testPort,
        outputDir,
        workers,
    };
}

const isolatedEnv = resolveIsolatedPlaywrightEnv(runProfile);
const TEST_PORT = isolatedEnv.testPort;
const TEST_HOST = String(process.env.TEST_HOST || '127.0.0.1');
process.env.TEST_HOST = TEST_HOST;
const serverMode = resolvePlaywrightRunProfile(runProfile.name).serverMode;
const runTag = isolatedEnv.runTag;
const outputDir = isolatedEnv.outputDir;
const htmlReportDir = String(process.env.PW_HTML_REPORT_DIR || `playwright-report/${runTag}`);
const workers = isolatedEnv.workers;
const serverLogBase = `tmp-vite-${runTag}`;
process.env.PW_SERVER_LOG_OUT = String(process.env.PW_SERVER_LOG_OUT || `${serverLogBase}.out.log`);
process.env.PW_SERVER_LOG_ERR = String(process.env.PW_SERVER_LOG_ERR || `${serverLogBase}.err.log`);
process.env.PW_SERVER_LOG_PATHS = String(
    process.env.PW_SERVER_LOG_PATHS
    || `${process.env.PW_SERVER_LOG_OUT};${process.env.PW_SERVER_LOG_ERR}`
);
const useGlobalWarmup = runProfile.useGlobalWarmup;
const traceMode = process.env.PW_TRACE === '1'
    ? 'retain-on-failure'
    : (isCI ? 'retain-on-failure' : 'off');
const webServerCommand = serverMode === 'dev'
    ? `node node_modules/vite/bin/vite.js --host ${TEST_HOST} --port ${TEST_PORT} --strictPort --clearScreen false --logLevel error`
    : `node scripts/playwright-preview-server.mjs --host ${TEST_HOST} --port ${TEST_PORT}`;
const reporters = process.env.PW_HTML_REPORT === '1' || isCI
    ? [['list'], ['html', { open: 'never', outputFolder: htmlReportDir }]]
    : [['list']];

export default defineConfig({
    testDir: './tests',
    testMatch: ['**/*.spec.js'],
    timeout: 60_000,
    metadata: {
        runProfile: runProfile.name,
        serverMode,
    },
    fullyParallel: false,
    forbidOnly: isCI,
    retries: 1,
    workers,
    outputDir,
    globalSetup: useGlobalWarmup ? './tests/playwright.global-setup.js' : undefined,
    globalTeardown: useGlobalWarmup ? './tests/playwright.global-teardown.js' : undefined,
    reporter: reporters,
    use: {
        baseURL: `http://${TEST_HOST}:${TEST_PORT}`,
        trace: traceMode,
    },
    projects: [
        {
            name: runProfile.projectName,
            use: (() => {
                const device = devices['Desktop Chrome'];
                const existingArgs = Array.isArray(device?.launchOptions?.args) ? device.launchOptions.args : [];
                return {
                    ...device,
                    launchOptions: {
                        ...(device?.launchOptions || {}),
                        args: [...existingArgs, '--no-proxy-server'],
                    },
                };
            })(),
        },
    ],
    webServer: {
        command: webServerCommand,
        url: `http://${TEST_HOST}:${TEST_PORT}`,
        timeout: 300_000,
        reuseExistingServer: !isCI && process.env.PW_REUSE_SERVER === '1',
    },
});
