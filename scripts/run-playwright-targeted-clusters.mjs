import { spawn } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolvePlaywrightFailureTaxonomy } from '../tests/playwright-readiness.js';
import {
    PLAYWRIGHT_RUN_LOCK_TIMEOUT_EXIT_CODE,
    acquirePlaywrightRunLock,
    releasePlaywrightRunLockOnExit,
} from './playwright-run-lock.mjs';
import {
    PLAYWRIGHT_SUMMARY_PREFIX,
    formatPlaywrightSummaryLine,
    summarizePlaywrightResultsFile,
} from './summarize-playwright-results.mjs';
import {
    DESKTOP_E2E_CLUSTERS,
    HEAVY_DIAGNOSTIC_CLUSTERS,
} from './playwright-test-clusters.mjs';
import {
    resolveClusterUserDataRoot,
    resolveRemovableUserDataRoot,
} from './playwright-user-data-root.mjs';
import {
    assertEnoughFreeSpace,
    collectHygieneReport,
    formatHygieneLine,
} from './test-hygiene.mjs';
const PLAYWRIGHT_STARTUP_DIAGNOSTICS_FILE = 'playwright-startup-diagnostics.json';
const PLAYWRIGHT_SPAWN_DIAGNOSTICS_FILE = 'playwright-spawn-diagnostics.json';
const ALL_CLUSTERS = Object.freeze([
    ...DESKTOP_E2E_CLUSTERS,
    ...HEAVY_DIAGNOSTIC_CLUSTERS,
]);

const CLUSTER_INDEX = new Map();
for (const cluster of ALL_CLUSTERS) {
    CLUSTER_INDEX.set(cluster.id, cluster);
    for (const spec of cluster.specs) {
        CLUSTER_INDEX.set(spec, cluster);
        CLUSTER_INDEX.set(path.basename(spec), cluster);
        CLUSTER_INDEX.set(spec.replace(/\\/g, '/'), cluster);
    }
}

function sanitizeSlug(value, fallback) {
    const normalized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9-_./]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+|-+$/g, '');
    return normalized || fallback;
}

function toPositiveInt(rawValue, fallback, min = 1, max = 65_535) {
    const parsed = Number.parseInt(String(rawValue || ''), 10);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(min, Math.min(max, parsed));
}

function splitSelectorsAndPlaywrightArgs(argv) {
    const selectors = [];
    const playwrightArgs = [];
    let seenOption = false;

    for (const rawValue of argv) {
        const value = String(rawValue || '');
        if (value === '--print-clusters' || value === '--dry-run') {
            continue;
        }
        if (!seenOption && !value.startsWith('-')) {
            selectors.push(value);
            continue;
        }
        seenOption = true;
        playwrightArgs.push(value);
    }

    return { selectors, playwrightArgs };
}

export const CLUSTER_RUNNER_DEFAULT_TIMEOUT_ARG = '--timeout=240000';

/**
 * Splits the command line into cluster selectors, Playwright arguments and the two modes that
 * must never start a run. Kept pure so the contract test can prove that `--print-clusters`
 * only lists: it used to fall through into a real run because the default `--timeout` was
 * appended before the "is anything selected" check could ever be true.
 */
export function resolveClusterRunnerArgs(argv) {
    const rawArgs = argv.map((value) => String(value ?? ''));
    const shouldPrintClusters = rawArgs.includes('--print-clusters');
    const shouldDryRun = rawArgs.includes('--dry-run');
    const listOnly = shouldPrintClusters && !shouldDryRun;
    const { selectors, playwrightArgs } = splitSelectorsAndPlaywrightArgs(rawArgs);
    const hasExplicitTimeout = playwrightArgs.some((value) => value.startsWith('--timeout'));
    const resolvedPlaywrightArgs = listOnly || hasExplicitTimeout
        ? playwrightArgs
        : [...playwrightArgs, CLUSTER_RUNNER_DEFAULT_TIMEOUT_ARG];

    return { selectors, playwrightArgs: resolvedPlaywrightArgs, shouldPrintClusters, shouldDryRun, listOnly };
}

function resolveSelectedClusters(selectors) {
    if (selectors.length === 0) {
        return DESKTOP_E2E_CLUSTERS;
    }

    const resolved = [];
    const seen = new Set();
    const unknownSelectors = [];

    for (const selector of selectors) {
        const normalized = selector.replace(/\\/g, '/');
        const cluster = CLUSTER_INDEX.get(selector)
            || CLUSTER_INDEX.get(normalized)
            || CLUSTER_INDEX.get(path.basename(normalized));
        if (!cluster) {
            unknownSelectors.push(selector);
            continue;
        }
        if (seen.has(cluster.id)) {
            continue;
        }
        seen.add(cluster.id);
        resolved.push(cluster);
    }

    if (unknownSelectors.length > 0) {
        console.error('[playwright:desktop-e2e] unknown cluster selector(s):', unknownSelectors.join(', '));
        console.error('[playwright:desktop-e2e] known clusters:', ALL_CLUSTERS.map((cluster) => cluster.id).join(', '));
        process.exit(1);
    }

    return resolved;
}

function printClusters() {
    console.log('[playwright:desktop-e2e] cluster map');
    for (const cluster of ALL_CLUSTERS) {
        console.log(`- ${cluster.id}: ${cluster.specs.join(', ')}`);
    }
    // --skip-known is forwarded to the spec runner, which knows the concrete spec paths and
    // builds the --grep-invert from scripts/architecture/playwright-known-failures.json.
    console.log('[playwright:desktop-e2e] options: --dry-run, --skip-known, plus any Playwright argument');
}

function printDryRun(clusters, playwrightArgs) {
    console.log('[playwright:desktop-e2e] dry run');
    for (let index = 0; index < clusters.length; index += 1) {
        const cluster = clusters[index];
        const env = buildClusterEnv(cluster, index);
        console.log(`- ${cluster.id}: ${cluster.specs.join(', ')}`);
        console.log(`  TEST_PORT=${env.TEST_PORT || '(auto)'}`);
        console.log(`  PW_RUN_TAG=${env.PW_RUN_TAG}`);
        console.log(`  PW_RUN_PROFILE=${env.PW_RUN_PROFILE}`);
        console.log(`  PW_OUTPUT_DIR=${env.PW_OUTPUT_DIR}`);
        console.log(`  CURVIOS_USER_DATA_ROOT=${env.CURVIOS_USER_DATA_ROOT}`);
        console.log(`  args=${[...cluster.specs, ...playwrightArgs].join(' ') || '(none)'}`);
    }
}

function buildClusterEnv(cluster, index) {
    const baseRunTag = sanitizeSlug(
        process.env.PW_RUN_TAG || `desktop-e2e-clusters-${Date.now().toString(36)}`,
        `desktop-e2e-clusters-${process.pid}`
    );
    const clusterRunTag = sanitizeSlug(`${baseRunTag}-${cluster.id}`, cluster.id);
    const baseOutputDir = String(process.env.PW_OUTPUT_DIR || '').trim();
    const baseHtmlReportDir = String(process.env.PW_HTML_REPORT_DIR || '').trim();
    const outputDir = baseOutputDir
        ? path.join(baseOutputDir, cluster.id)
        : path.join('test-results', clusterRunTag);
    const htmlReportDir = baseHtmlReportDir
        ? path.join(baseHtmlReportDir, cluster.id)
        : path.join('playwright-report', clusterRunTag);
    const env = {
        ...process.env,
        PW_RUN_TAG: clusterRunTag,
        PW_RUN_PROFILE: cluster.runProfile || 'desktop-e2e',
        PW_OUTPUT_DIR: outputDir,
        PW_HTML_REPORT_DIR: htmlReportDir,
        PW_SERVER_LOG_OUT: '',
        PW_SERVER_LOG_ERR: '',
        PW_SERVER_LOG_PATHS: '',
        CURVIOS_USER_DATA_ROOT: String(process.env.CURVIOS_USER_DATA_ROOT || '').trim()
            || resolveClusterUserDataRoot(process.cwd(), clusterRunTag),
    };

    if (String(process.env.TEST_PORT || '').trim()) {
        const basePort = toPositiveInt(process.env.TEST_PORT, 5173, 1024, 65_520);
        env.TEST_PORT = String(basePort + index);
    }

    return env;
}

function serializeSpawnError(error) {
    return {
        code: error?.code || null,
        syscall: error?.syscall || null,
        path: error?.path || null,
        message: error?.message || String(error),
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
    };
}

async function writeClusterSpawnDiagnostics(cluster, env, payload) {
    const outputDir = path.resolve(env.PW_OUTPUT_DIR || path.join('test-results', cluster.id));
    await mkdir(outputDir, { recursive: true });
    const diagnosticsPath = path.resolve(outputDir, PLAYWRIGHT_SPAWN_DIAGNOSTICS_FILE);
    await writeFile(diagnosticsPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    return diagnosticsPath;
}

function runCluster(cluster, playwrightArgs, index, total) {
    const clusterArgs = [path.resolve('scripts', 'run-playwright-targeted.mjs'), ...cluster.specs, ...playwrightArgs];
    const clusterEnv = buildClusterEnv(cluster, index);
    console.log(`[playwright:desktop-e2e] (${index + 1}/${total}) ${cluster.id} -> ${cluster.specs.join(', ')}`);

    const spawnOnce = (command, args, extra = {}) => new Promise((resolve) => {
        const child = spawn(command, args, {
            stdio: 'inherit',
            env: clusterEnv,
            windowsHide: true,
            ...extra,
        });

        child.once('error', (error) => {
            resolve({
                cluster,
                code: 1,
                signal: null,
                outputDir: clusterEnv.PW_OUTPUT_DIR,
                userDataRoot: clusterEnv.CURVIOS_USER_DATA_ROOT,
                spawnError: serializeSpawnError(error),
            });
        });
        child.once('exit', (code, signal) => {
            resolve({
                cluster,
                code: code ?? 1,
                signal: signal || null,
                outputDir: clusterEnv.PW_OUTPUT_DIR,
                userDataRoot: clusterEnv.CURVIOS_USER_DATA_ROOT,
                spawnError: null,
            });
        });
    });

    return spawnOnce(process.execPath, clusterArgs).then(async (result) => {
        if (!result.spawnError) {
            return result;
        }
        if (!isWindowsSpawnPolicyError(result.spawnError)) {
            result.spawnDiagnosticsPath = await writeClusterSpawnDiagnostics(cluster, clusterEnv, {
                stage: 'cluster.spawn',
                fallbackAttempted: false,
                clusterId: cluster.id,
                command: process.execPath,
                args: clusterArgs,
                cwd: process.cwd(),
                runTag: clusterEnv.PW_RUN_TAG,
                testPort: clusterEnv.TEST_PORT || null,
                outputDir: clusterEnv.PW_OUTPUT_DIR,
                error: result.spawnError,
            });
            return result;
        }

        const fallback = resolveWindowsShellFallback(process.execPath, clusterArgs);
        const diagnosticsPath = await writeClusterSpawnDiagnostics(cluster, clusterEnv, {
            stage: 'cluster.spawn',
            fallbackAttempted: true,
            fallbackCommand: fallback.command,
            fallbackArgs: fallback.args,
            clusterId: cluster.id,
            command: process.execPath,
            args: clusterArgs,
            cwd: process.cwd(),
            runTag: clusterEnv.PW_RUN_TAG,
            testPort: clusterEnv.TEST_PORT || null,
            outputDir: clusterEnv.PW_OUTPUT_DIR,
            error: result.spawnError,
        });
        console.warn(
            `[playwright:desktop-e2e] ${cluster.id} direct spawn failed; ` +
            `retrying through cmd fallback. diagnostics=${diagnosticsPath}`
        );
        const fallbackResult = await spawnOnce(fallback.command, fallback.args);
        if (fallbackResult.spawnError) {
            fallbackResult.spawnDiagnosticsPath = diagnosticsPath;
        }
        return fallbackResult;
    });
}

const SUMMARY_COUNT_KEYS = Object.freeze(['passed', 'failed', 'skipped', 'didNotRun', 'flaky', 'known', 'new']);

/**
 * Reads the JSON reporter output of one cluster. The spec runner already printed and stored the
 * same summary, so this stays quiet and only collects the numbers for the roll-up line.
 */
function collectClusterSummary(cluster, outputDir) {
    const resolvedOutputDir = path.resolve(outputDir || path.join('test-results', cluster.id));
    const summary = summarizePlaywrightResultsFile(path.join(resolvedOutputDir, 'results.json'), {
        summaryPath: path.join(resolvedOutputDir, 'summary.txt'),
        log: () => {},
    });
    // A cluster without results.json (crashed before the reporter ran) must stay visible:
    // it is reported as missing instead of silently dropping out of the roll-up.
    return { clusterId: cluster.id, summary: summary || null };
}

/** Prints one line per cluster and the machine-readable total as the very last line. */
function printClusterSummaries(collected) {
    if (collected.length === 0) return;
    const totals = Object.fromEntries(SUMMARY_COUNT_KEYS.map((key) => [key, 0]));
    let missingClusters = 0;
    for (const entry of collected) {
        if (!entry.summary) {
            missingClusters += 1;
            console.log(`${PLAYWRIGHT_SUMMARY_PREFIX} ${entry.clusterId} no results.json (run ended before the reporter)`);
            continue;
        }
        for (const key of SUMMARY_COUNT_KEYS) totals[key] += Number(entry.summary[key]) || 0;
        console.log(formatPlaywrightSummaryLine(entry.summary, `${PLAYWRIGHT_SUMMARY_PREFIX} ${entry.clusterId}`));
    }
    const totalLine = formatPlaywrightSummaryLine(totals);
    console.log(missingClusters > 0 ? `${totalLine} missingClusters=${missingClusters}` : totalLine);
}

// Das Testprofil ist Wegwerfzustand: es bleibt nur fuer die Dauer des Laufs liegen,
// damit die Ergebnisordner nicht mit Chromium-Caches volllaufen.
async function removeClusterUserDataRoot(userDataRoot) {
    const removablePath = resolveRemovableUserDataRoot(userDataRoot, process.cwd());
    if (!removablePath) return;
    try {
        await rm(removablePath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        console.log(`[playwright:desktop-e2e] removed run profile ${removablePath}`);
    } catch (error) {
        console.warn(`[playwright:desktop-e2e] run profile cleanup skipped: ${error?.message || error}`);
    }
}

function toClusterContractDiagnostics(rawDiagnostics) {
    if (!rawDiagnostics || typeof rawDiagnostics !== 'object') return null;
    const directContract = rawDiagnostics?.readiness?.contract;
    if (directContract && typeof directContract === 'object') {
        return directContract;
    }
    const browserAttempts = Array.isArray(rawDiagnostics?.readiness?.browserPrewarm?.attempts)
        ? rawDiagnostics.readiness.browserPrewarm.attempts
        : [];
    return browserAttempts[browserAttempts.length - 1]?.readinessContract || null;
}

function collectServerLogPaths(rawDiagnostics) {
    if (!Array.isArray(rawDiagnostics?.serverLogs)) return [];
    const uniquePaths = new Set();
    for (const logEntry of rawDiagnostics.serverLogs) {
        const relativePath = String(logEntry?.path || '').trim();
        if (!relativePath) continue;
        uniquePaths.add(path.resolve(relativePath));
    }
    return [...uniquePaths];
}

async function classifyClusterFailure(result) {
    if (result.spawnError) {
        return {
            clusterId: result.cluster.id,
            failureClass: 'harness-spawn-error',
            failureReason: String(result.spawnError.code || result.spawnError.message || 'spawn_error'),
            runProfile: 'desktop-e2e',
            runTag: '',
            outputDir: path.resolve(result.outputDir || ''),
            diagnosticsPath: result.spawnDiagnosticsPath || null,
            serverLogPaths: [],
        };
    }

    const diagnosticsPath = path.resolve(result.outputDir || '', PLAYWRIGHT_STARTUP_DIAGNOSTICS_FILE);
    let diagnostics = null;
    try {
        diagnostics = JSON.parse(await readFile(diagnosticsPath, 'utf8'));
    } catch {
        diagnostics = null;
    }

    const contract = toClusterContractDiagnostics(diagnostics);
    const failureClass = resolvePlaywrightFailureTaxonomy({
        runProfile: 'desktop-e2e',
        stage: contract?.stage || 'idle',
        failureReason: contract?.failureReason || '',
        error: contract?.errorMessage || diagnostics?.error || null,
        pageClosed: contract?.appBoot?.pageClosed === true,
        serverReady: contract?.serverReady === true,
        shellReady: contract?.shellReady === true,
        appReady: contract?.appReady === true,
    }) || 'runtime-regression';
    const diagnosticsOutputDir = String(diagnostics?.outputDir || '').trim();
    const outputDir = diagnosticsOutputDir
        ? path.resolve(diagnosticsOutputDir)
        : path.resolve(result.outputDir || '');

    return {
        clusterId: result.cluster.id,
        failureClass,
        failureReason: String(contract?.failureReason || 'playwright_exit_non_zero'),
        runProfile: String(diagnostics?.runProfile || 'desktop-e2e'),
        runTag: String(diagnostics?.runTag || ''),
        outputDir,
        diagnosticsPath: diagnostics ? diagnosticsPath : null,
        serverLogPaths: collectServerLogPaths(diagnostics),
    };
}

async function main() {
    const { selectors, playwrightArgs, shouldPrintClusters, shouldDryRun, listOnly } = resolveClusterRunnerArgs(
        process.argv.slice(2)
    );
    const clusters = resolveSelectedClusters(selectors);

    if (shouldPrintClusters) {
        printClusters();
        if (listOnly) {
            return;
        }
    }

    if (shouldDryRun) {
        printDryRun(clusters, playwrightArgs);
        return;
    }

    // Ein volles Laufwerk bricht den Lauf sonst erst nach 20 Minuten mitten drin ab
    // (ENOSPC). Der Bericht ist eine Zeile und loescht nichts.
    const hygieneReport = collectHygieneReport();
    console.log(formatHygieneLine(hygieneReport));
    const freeSpace = assertEnoughFreeSpace(hygieneReport.freeBytes);
    if (!freeSpace.ok) {
        console.error(freeSpace.message);
        process.exit(1);
    }

    // Hold the machine-wide Playwright lock for the whole cluster list so no other session
    // squeezes a run in between two clusters; the spec runners inherit it through the env.
    const lock = await acquirePlaywrightRunLock({
        label: `desktop-e2e clusters ${clusters.map((cluster) => cluster.id).join(',')}`,
    });
    releasePlaywrightRunLockOnExit(lock.release);

    const failures = [];
    const summaries = [];
    for (let index = 0; index < clusters.length; index += 1) {
        const result = await runCluster(clusters[index], playwrightArgs, index, clusters.length);
        const collected = collectClusterSummary(clusters[index], result.outputDir);
        if (collected) summaries.push(collected);
        await removeClusterUserDataRoot(result.userDataRoot);
        if (result.signal) {
            printClusterSummaries(summaries);
            process.kill(process.pid, result.signal);
            return;
        }
        if (result.code !== 0) {
            const classifiedFailure = await classifyClusterFailure(result);
            failures.push(classifiedFailure);
            console.error(
                `[playwright:desktop-e2e] ${classifiedFailure.clusterId} classified as ` +
                `${classifiedFailure.failureClass} (${classifiedFailure.failureReason})`
            );
            console.error(
                `[playwright:desktop-e2e] artifact contract: ` +
                `mode=${classifiedFailure.runProfile} ` +
                `runTag=${classifiedFailure.runTag || 'n/a'} ` +
                `output=${classifiedFailure.outputDir || 'n/a'}`
            );
            if (classifiedFailure.diagnosticsPath) {
                console.error(`[playwright:desktop-e2e] diagnostics: ${classifiedFailure.diagnosticsPath}`);
            }
            for (const serverLogPath of classifiedFailure.serverLogPaths) {
                console.error(`[playwright:desktop-e2e] server-log: ${serverLogPath}`);
            }
        }
    }

    if (failures.length === 0) {
        printClusterSummaries(summaries);
        return;
    }

    {
        const bucketMap = new Map();
        for (const failure of failures) {
            if (!bucketMap.has(failure.failureClass)) {
                bucketMap.set(failure.failureClass, []);
            }
            bucketMap.get(failure.failureClass).push(failure.clusterId);
        }
        console.error(
            `[playwright:desktop-e2e] failing clusters: ${failures.map((failure) => (
                `${failure.clusterId}:${failure.failureClass}`
            )).join(', ')}`
        );
        for (const [failureClass, clusterIds] of bucketMap.entries()) {
            console.error(`[playwright:desktop-e2e] failure-taxonomy ${failureClass}: ${clusterIds.join(', ')}`);
        }
        for (const failure of failures) {
            console.error(
                `[playwright:desktop-e2e] ${failure.clusterId} artifacts: ` +
                `mode=${failure.runProfile} ` +
                `runTag=${failure.runTag || 'n/a'} ` +
                `diagnostics=${failure.diagnosticsPath || 'n/a'} ` +
                `output=${failure.outputDir || 'n/a'}`
            );
        }
        printClusterSummaries(summaries);
        process.exit(1);
    }
}

function isDirectRun() {
    const entry = String(process.argv[1] || '');
    if (!entry) return false;
    try {
        return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
    } catch {
        return false;
    }
}

if (isDirectRun()) {
    main().catch((error) => {
        // A lock timeout means the machine was busy, not that a test broke; hand code 75 through.
        if (error?.exitCode === PLAYWRIGHT_RUN_LOCK_TIMEOUT_EXIT_CODE) {
            console.error(error.message);
            process.exit(PLAYWRIGHT_RUN_LOCK_TIMEOUT_EXIT_CODE);
        }
        console.error('[playwright:desktop-e2e] cluster runner failed');
        console.error(error);
        process.exit(1);
    });
}
