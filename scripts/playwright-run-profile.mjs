import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
    PLAYWRIGHT_RUN_LOCK_TIMEOUT_EXIT_CODE,
    acquirePlaywrightRunLock,
    releasePlaywrightRunLockOnExit,
} from './playwright-run-lock.mjs';
import { summarizePlaywrightResultsFile } from './summarize-playwright-results.mjs';

/**
 * Prints the machine-readable `[playwright:summary]` line for a finished run and mirrors it
 * into the run folder. The wrapper keeps Playwright's own exit code; the summary is evidence,
 * not a second verdict.
 */
export function reportPlaywrightRunSummary(env = process.env) {
    const outputDir = String(env.PW_OUTPUT_DIR || '').trim();
    if (!outputDir) return null;
    const resultsPath = String(env.PW_RESULTS_JSON || '').trim() || path.join(outputDir, 'results.json');
    return summarizePlaywrightResultsFile(resultsPath, {
        summaryPath: path.join(outputDir, 'summary.txt'),
    });
}

export const PLAYWRIGHT_DEFAULT_RUN_PROFILE = 'desktop-smoke';

const PLAYWRIGHT_RUN_PROFILE_ALIASES = Object.freeze({
    'preview-smoke': 'desktop-smoke',
    'dev-runtime': 'desktop-e2e',
    'browser-contract': 'browser-compat',
});

export const PLAYWRIGHT_RUN_PROFILES = Object.freeze({
    'desktop-smoke': Object.freeze({
        name: 'desktop-smoke',
        projectName: 'desktop-smoke',
        runtimeKind: 'electron',
        serverMode: 'electron',
        useExternalWebServer: false,
        useGlobalWarmup: false,
        moduleWarmupEnabled: false,
    }),
    'desktop-e2e': Object.freeze({
        name: 'desktop-e2e',
        projectName: 'desktop-e2e',
        runtimeKind: 'electron',
        serverMode: 'electron',
        useExternalWebServer: false,
        useGlobalWarmup: false,
        moduleWarmupEnabled: false,
    }),
    'browser-compat': Object.freeze({
        name: 'browser-compat',
        projectName: 'browser-compat',
        runtimeKind: 'browser',
        serverMode: 'dev',
        useExternalWebServer: true,
        useGlobalWarmup: true,
        moduleWarmupEnabled: false,
    }),
});

function toCrossPlatformTestFilter(value) {
    const stringValue = String(value || '');
    if (!/^[A-Za-z0-9_.\-\\/]+\.spec\.[cm]?[jt]sx?$/.test(stringValue)) {
        return stringValue;
    }
    return stringValue.split(/[\\/]+/).filter(Boolean).join('/');
}

function normalizePlaywrightCliArg(value) {
    const stringValue = String(value || '');
    if (stringValue === '-g') return '--grep';
    if (stringValue.startsWith('-g=')) return `--grep=${stringValue.slice(3)}`;
    return stringValue;
}

export function resolvePlaywrightCommand(argv) {
    const testArgs = ['test', ...argv.map((value) => normalizePlaywrightCliArg(value))];
    for (let index = 1; index < testArgs.length; index += 1) {
        const value = String(testArgs[index] || '');
        if (value.startsWith('-')) break;
        testArgs[index] = toCrossPlatformTestFilter(value);
    }
    return {
        command: process.execPath,
        args: [path.resolve('node_modules', '@playwright', 'test', 'cli.js'), ...testArgs],
        shell: false,
    };
}

function hasExplicitBrowserContractSelection(argv) {
    for (let index = 0; index < argv.length; index += 1) {
        const value = String(argv[index] || '');
        if (!value) continue;
        if (!value.startsWith('-')) return true;
        if ((value === '-g' || value === '--grep' || value === '--grep-invert') && String(argv[index + 1] || '').trim()) {
            return true;
        }
        if (value.startsWith('-g=') || value.startsWith('--grep=') || value.startsWith('--grep-invert=')) {
            return value.includes('=')
                && value.slice(value.indexOf('=') + 1).trim().length > 0;
        }
    }
    return false;
}

export function resolvePlaywrightRunProfile(rawValue, fallbackName = PLAYWRIGHT_DEFAULT_RUN_PROFILE) {
    const normalized = String(rawValue || '').trim().toLowerCase();
    const canonicalName = PLAYWRIGHT_RUN_PROFILE_ALIASES[normalized] || normalized;
    if (canonicalName && PLAYWRIGHT_RUN_PROFILES[canonicalName]) {
        return PLAYWRIGHT_RUN_PROFILES[canonicalName];
    }
    return PLAYWRIGHT_RUN_PROFILES[fallbackName] || PLAYWRIGHT_RUN_PROFILES[PLAYWRIGHT_DEFAULT_RUN_PROFILE];
}

export function applyPlaywrightRunProfileEnv(env, rawValue) {
    const profile = resolvePlaywrightRunProfile(rawValue);
    env.PW_RUN_PROFILE = profile.name;
    env.PW_SERVER_MODE = profile.serverMode;
    env.PW_PREWARM = profile.useGlobalWarmup ? '1' : '0';
    env.PW_MODULE_WARMUP = profile.moduleWarmupEnabled ? '1' : '0';
    return profile;
}

export async function runPlaywrightProfile(profileName, argv, options = {}) {
    const profile = resolvePlaywrightRunProfile(profileName);
    if (options.requireExplicitSelection && !hasExplicitBrowserContractSelection(argv)) {
        console.error(
            `[playwright:${profile.name}] requires an explicit spec path or --grep selector ` +
            'to avoid accidentally running every browser suite.'
        );
        process.exit(1);
    }

    // One Playwright run per machine: wait for the lock before touching the GPU. A cluster
    // runner already holds it for its spec runners, which then inherit instead of waiting.
    let lock;
    try {
        lock = await acquirePlaywrightRunLock({ label: `${profile.name} ${argv.join(' ')}`.trim() });
    } catch (error) {
        console.error(error?.message || String(error));
        // Exit code 75 (EX_TEMPFAIL) says "the machine was busy", never "a test failed".
        process.exit(error?.exitCode === PLAYWRIGHT_RUN_LOCK_TIMEOUT_EXIT_CODE
            ? PLAYWRIGHT_RUN_LOCK_TIMEOUT_EXIT_CODE
            : 1);
    }
    releasePlaywrightRunLockOnExit(lock.release);

    const command = resolvePlaywrightCommand(argv);
    const env = { ...process.env };
    applyPlaywrightRunProfileEnv(env, profile.name);
    // Pin run tag and output folder here so the wrapper knows where the JSON reporter will
    // write; playwright.config.js otherwise invents both inside the CLI process.
    if (!String(env.PW_RUN_TAG || '').trim()) {
        env.PW_RUN_TAG = `${profile.name}-pid-${process.pid}-${Date.now().toString(36)}`;
    }
    if (!String(env.PW_OUTPUT_DIR || '').trim()) {
        env.PW_OUTPUT_DIR = path.join('test-results', env.PW_RUN_TAG);
    }

    const child = spawn(command.command, command.args, {
        stdio: 'inherit',
        env,
        shell: command.shell === true,
        windowsHide: true,
    });

    child.on('error', (error) => {
        console.error(
            `[playwright:${profile.name}] CLI spawn failed ` +
            `code=${error?.code || 'unknown'} path=${error?.path || command.command} ` +
            `message=${error?.message || String(error)}`
        );
        process.exit(1);
    });

    child.on('exit', (code, signal) => {
        lock.release();
        reportPlaywrightRunSummary(env);
        if (signal) {
            process.kill(process.pid, signal);
            return;
        }
        process.exit(code ?? 1);
    });
}
