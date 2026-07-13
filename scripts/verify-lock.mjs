import { spawn } from 'node:child_process';
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const MASTER_PLAN_PATH = path.resolve('docs', 'Umsetzungsplan.md');
const PLAN_LOCK_REGEX = /<!--\s*LOCK:\s*(.+?)\s*-->/gi;
const PLAYWRIGHT_SPAWN_DIAGNOSTICS_FILE = 'playwright-spawn-diagnostics.json';

function toPositiveInt(rawValue, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const numeric = Number.parseInt(String(rawValue || ''), 10);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeRunTag(value) {
    const normalized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9-_]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || `pid-${process.pid}`;
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

async function readJsonFile(filePath) {
    try {
        const raw = await readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

async function writeJsonFileExclusive(filePath, payload) {
    const handle = await open(filePath, 'wx');
    try {
        await handle.writeFile(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    } finally {
        await handle.close();
    }
}

function isProcessAlive(pid) {
    const numericPid = Number(pid);
    if (!Number.isInteger(numericPid) || numericPid <= 0) return false;
    try {
        process.kill(numericPid, 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}

async function acquireFileLock(lockPath, payload, options = {}) {
    const waitMs = toPositiveInt(options.waitMs, 300_000, 1_000, 3_600_000);
    const pollMs = toPositiveInt(options.pollMs, 250, 50, 10_000);
    const staleMs = toPositiveInt(options.staleMs, 600_000, 30_000, 86_400_000);
    const startedAt = Date.now();

    while (Date.now() - startedAt < waitMs) {
        try {
            await writeJsonFileExclusive(lockPath, payload);
            return payload;
        } catch (error) {
            if (error?.code !== 'EEXIST') {
                throw error;
            }

            const existingLock = await readJsonFile(lockPath);
            const existingStartedAt = Number(existingLock?.startedAt || 0);
            const lockAgeMs = Date.now() - (Number.isFinite(existingStartedAt) ? existingStartedAt : 0);
            const existingPid = Number(existingLock?.pid || 0);
            if (!isProcessAlive(existingPid) || lockAgeMs > staleMs) {
                await rm(lockPath, { force: true });
                continue;
            }

            await sleep(pollMs);
        }
    }

    const blockingLock = await readJsonFile(lockPath);
    throw new Error(
        `[verify-lock] Timed out waiting for lock ${lockPath}: ${JSON.stringify(blockingLock || {})}`
    );
}

async function releaseFileLock(lockPath, ownerToken) {
    if (!ownerToken) return;
    const payload = await readJsonFile(lockPath);
    if (payload?.ownerToken && payload.ownerToken !== ownerToken) {
        return;
    }
    await rm(lockPath, { force: true });
}

function resolvePlaywrightIsolationEnv(env = process.env) {
    const runTag = sanitizeRunTag(env.PW_RUN_TAG || `pid-${process.pid}-${Date.now().toString(36)}`);
    const defaultPortBase = toPositiveInt(env.PW_BASE_PORT, 5173, 1024, 60_000);
    const defaultPortSpan = toPositiveInt(env.PW_PORT_SPAN, 400, 10, 4_000);
    const defaultPort = defaultPortBase + (hashRunTag(runTag) % defaultPortSpan);
    const testPort = toPositiveInt(env.TEST_PORT, defaultPort, 1024, 65_535);
    const outputDir = String(env.PW_OUTPUT_DIR || `test-results/${runTag}`);
    const workers = toPositiveInt(env.PW_WORKERS, 1, 1, 32);

    return {
        runTag,
        testPort,
        outputDir,
        workers,
    };
}

function isWindowsSpawnPolicyError(error) {
    const code = String(error?.code || '').toUpperCase();
    return process.platform === 'win32' && (code === 'EPERM' || code === 'EACCES');
}

function quoteCmdArg(value) {
    const stringValue = String(value ?? '');
    if (stringValue.length === 0) return '""';
    if (!/[ \t"&|<>^()]/.test(stringValue)) {
        return stringValue;
    }
    return `"${stringValue.replace(/"/g, '""')}"`;
}

function resolveWindowsShellFallback(command, args) {
    return {
        command: process.env.ComSpec || 'cmd.exe',
        args: ['/d', '/s', '/c', [command, ...args].map((entry) => quoteCmdArg(entry)).join(' ')],
        shell: false,
    };
}

async function writePlaywrightSpawnDiagnostics(outputDir, payload) {
    const resolvedOutputDir = path.resolve(process.cwd(), outputDir || 'test-results');
    await mkdir(resolvedOutputDir, { recursive: true });
    const diagnosticsPath = path.resolve(resolvedOutputDir, PLAYWRIGHT_SPAWN_DIAGNOSTICS_FILE);
    await writeFile(`${diagnosticsPath}`, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return diagnosticsPath;
}

function formatSpawnError(error, diagnosticsPath) {
    return [
        '[verify-lock] Playwright child spawn failed',
        `code=${error?.code || 'unknown'}`,
        `syscall=${error?.syscall || 'spawn'}`,
        `path=${error?.path || 'n/a'}`,
        `diagnostics=${diagnosticsPath || 'n/a'}`,
        `message=${error?.message || String(error)}`,
    ].join(' ');
}

function escapeRegex(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toCrossPlatformPlaywrightFilter(value) {
    const stringValue = String(value || '');
    if (!/^[A-Za-z0-9_.\-\\/]+\.spec\.[cm]?[jt]sx?$/.test(stringValue)) {
        return stringValue;
    }
    const normalizedSegments = stringValue
        .split(/[\\/]+/)
        .filter(Boolean)
        .map((segment) => escapeRegex(segment));
    if (normalizedSegments.length === 0) {
        return stringValue;
    }
    return `${normalizedSegments.join('[\\\\/]')}$`;
}

function normalizePlaywrightCommandArgs(rawCommand, args) {
    const normalizedCommand = String(rawCommand || '').toLowerCase();
    const normalizedArgs = args.slice();
    let firstFilterIndex = -1;

    if (normalizedCommand === 'playwright' && String(normalizedArgs[0] || '').toLowerCase() === 'test') {
        firstFilterIndex = 1;
    } else if (
        normalizedCommand === 'npx'
        && String(normalizedArgs[0] || '').toLowerCase() === 'playwright'
        && String(normalizedArgs[1] || '').toLowerCase() === 'test'
    ) {
        firstFilterIndex = 2;
    }

    if (firstFilterIndex === -1) {
        return normalizedArgs;
    }

    for (let index = firstFilterIndex; index < normalizedArgs.length; index += 1) {
        const value = String(normalizedArgs[index] || '');
        if (value.startsWith('-')) break;
        normalizedArgs[index] = toCrossPlatformPlaywrightFilter(value);
    }

    return normalizedArgs;
}

function resolveCommand(commandArgs) {
    const [rawCommand, ...args] = commandArgs;
    if (!rawCommand) {
        throw new Error('[verify-lock] Missing command after --playwright');
    }

    const normalizedArgs = normalizePlaywrightCommandArgs(rawCommand, args);
    const normalized = String(rawCommand).toLowerCase();
    const isDirectPlaywright = normalized === 'playwright';
    const isNpxPlaywright = normalized === 'npx' && String(normalizedArgs[0] || '').toLowerCase() === 'playwright';

    if (isDirectPlaywright || isNpxPlaywright) {
        const playwrightArgs = isDirectPlaywright
            ? normalizedArgs
            : normalizedArgs.slice(1);
        return {
            command: process.execPath,
            args: [path.resolve('node_modules', '@playwright', 'test', 'cli.js'), ...playwrightArgs],
            shell: false,
            fallbackEligible: true,
        };
    }

    const useCmdShell = process.platform === 'win32'
        && (normalized === 'npx' || normalized === 'npm' || normalized === 'playwright');

    if (useCmdShell) {
        const commandLine = [rawCommand, ...normalizedArgs].map((entry) => quoteCmdArg(entry)).join(' ');
        return {
            command: process.env.ComSpec || 'cmd.exe',
            args: ['/d', '/s', '/c', commandLine],
            shell: false,
            fallbackEligible: false,
        };
    }

    return {
        command: rawCommand,
        args: normalizedArgs,
        shell: false,
        fallbackEligible: true,
    };
}

async function runWithPlaywrightIsolation(rawCommandArgs) {
    const commandArgs = rawCommandArgs[0] === '--'
        ? rawCommandArgs.slice(1)
        : rawCommandArgs.slice();
    const { command, args, shell, fallbackEligible } = resolveCommand(commandArgs);
    const isolatedEnv = resolvePlaywrightIsolationEnv(process.env);
    const lockPath = path.resolve(
        process.cwd(),
        String(process.env.PW_START_LOCK_PATH || '.playwright-start.lock')
    );
    const startedAt = Date.now();
    const ownerToken = `${process.pid}-${startedAt}-${Math.random().toString(36).slice(2, 10)}`;
    const lockPayload = {
        ownerToken,
        pid: process.pid,
        runTag: isolatedEnv.runTag,
        testPort: isolatedEnv.testPort,
        outputDir: isolatedEnv.outputDir,
        workers: isolatedEnv.workers,
        command: [command, ...args].join(' '),
        startedAt,
        startedAtIso: new Date(startedAt).toISOString(),
    };

    await acquireFileLock(lockPath, lockPayload, {
        waitMs: process.env.PW_START_LOCK_WAIT_MS,
        pollMs: process.env.PW_START_LOCK_POLL_MS,
        staleMs: process.env.PW_START_LOCK_STALE_MS,
    });

    console.log(`[verify-lock] Playwright start lock acquired: ${lockPath}`);
    console.log(
        `[verify-lock] TEST_PORT=${isolatedEnv.testPort} PW_RUN_TAG=${isolatedEnv.runTag} ` +
        `PW_OUTPUT_DIR=${isolatedEnv.outputDir} PW_WORKERS=${isolatedEnv.workers}`
    );

    const childEnv = {
        ...process.env,
        TEST_PORT: String(isolatedEnv.testPort),
        PW_RUN_TAG: isolatedEnv.runTag,
        PW_OUTPUT_DIR: isolatedEnv.outputDir,
        PW_WORKERS: String(isolatedEnv.workers),
    };

    let child = null;
    const forwardSignal = (signal) => {
        if (child && child.exitCode === null) {
            child.kill(signal);
        }
    };

    process.once('SIGINT', forwardSignal);
    process.once('SIGTERM', forwardSignal);

    try {
        const spawnOptions = {
            cwd: process.cwd(),
            stdio: 'inherit',
            env: childEnv,
            shell: shell === true,
            windowsHide: true,
        };

        const runSpawn = (spawnCommand, spawnArgs, options) => new Promise((resolve, reject) => {
            child = spawn(spawnCommand, spawnArgs, options);
            child.once('error', reject);
            child.once('exit', (code, signal) => {
                if (signal) {
                    reject(new Error(`[verify-lock] Child exited via signal ${signal}`));
                    return;
                }
                resolve(code ?? 0);
            });
        });

        let exitCode = 0;
        try {
            exitCode = await runSpawn(command, args, spawnOptions);
        } catch (error) {
            if (!fallbackEligible || !isWindowsSpawnPolicyError(error)) {
                const diagnosticsPath = await writePlaywrightSpawnDiagnostics(isolatedEnv.outputDir, {
                    stage: 'verify-lock.spawn',
                    fallbackAttempted: false,
                    command,
                    args,
                    cwd: process.cwd(),
                    runTag: isolatedEnv.runTag,
                    testPort: isolatedEnv.testPort,
                    outputDir: isolatedEnv.outputDir,
                    workers: isolatedEnv.workers,
                    error: {
                        code: error?.code || null,
                        syscall: error?.syscall || null,
                        path: error?.path || null,
                        message: error?.message || String(error),
                    },
                });
                throw new Error(formatSpawnError(error, diagnosticsPath));
            }

            const fallback = resolveWindowsShellFallback(command, args);
            const diagnosticsPath = await writePlaywrightSpawnDiagnostics(isolatedEnv.outputDir, {
                stage: 'verify-lock.spawn',
                fallbackAttempted: true,
                fallbackCommand: fallback.command,
                fallbackArgs: fallback.args,
                command,
                args,
                cwd: process.cwd(),
                runTag: isolatedEnv.runTag,
                testPort: isolatedEnv.testPort,
                outputDir: isolatedEnv.outputDir,
                workers: isolatedEnv.workers,
                error: {
                    code: error?.code || null,
                    syscall: error?.syscall || null,
                    path: error?.path || null,
                    message: error?.message || String(error),
                },
            });
            console.warn(`[verify-lock] direct spawn failed; retrying through cmd fallback. diagnostics=${diagnosticsPath}`);
            exitCode = await runSpawn(fallback.command, fallback.args, {
                cwd: process.cwd(),
                stdio: 'inherit',
                env: childEnv,
                shell: fallback.shell === true,
                windowsHide: true,
            });
        }

        if (exitCode !== 0) {
            process.exitCode = exitCode;
        }
    } finally {
        process.removeListener('SIGINT', forwardSignal);
        process.removeListener('SIGTERM', forwardSignal);
        await releaseFileLock(lockPath, ownerToken);
        console.log(`[verify-lock] Playwright start lock released: ${lockPath}`);
    }
}

async function verifyPlanLock() {
    try {
        const content = await readFile(MASTER_PLAN_PATH, 'utf8');
        const activeLocks = [...content.matchAll(PLAN_LOCK_REGEX)]
            .map((match) => String(match[1] || '').trim())
            .filter((lockName) => lockName && lockName !== 'frei');

        if (activeLocks.length === 0) {
            console.error('FEHLER: Kein aktiver LOCK-Eintrag in docs/Umsetzungsplan.md gefunden.');
            console.error('Bitte vor Commit einen passenden Block claimen oder den bestehenden Lock dokumentieren.');
            process.exitCode = 1;
            return;
        }

        console.log(`Lock-Protokoll eingehalten. Aktive Locks: ${activeLocks.join(', ')}`);
    } catch (error) {
        if (error?.code === 'ENOENT') {
            console.log('Umsetzungsplan nicht gefunden, Lock-Pruefung uebersprungen.');
            return;
        }
        throw error;
    }
}

async function main() {
    const args = process.argv.slice(2);
    if (args[0] === '--playwright') {
        await runWithPlaywrightIsolation(args.slice(1));
        return;
    }
    await verifyPlanLock();
}

main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
});
