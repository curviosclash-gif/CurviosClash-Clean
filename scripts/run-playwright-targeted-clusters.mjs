import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { resolvePlaywrightFailureTaxonomy } from '../tests/playwright-readiness.js';

const DESKTOP_E2E_CLUSTERS = Object.freeze([
    { id: 'core-shell', specs: ['tests/core-targeted.spec.js'] },
    { id: 'core-platform', specs: ['tests/core-targeted-platform.spec.js'] },
    { id: 'core-surface', specs: ['tests/core-targeted-surface.spec.js'] },
    { id: 'core-runtime', specs: ['tests/core-targeted-runtime.spec.js'] },
]);

const HEAVY_DIAGNOSTIC_CLUSTERS = Object.freeze([
    { id: 'core-regressions', specs: ['tests/core-targeted-regressions.spec.js'] },
    { id: 'physics-core', specs: ['tests/physics-core.spec.js'] },
    { id: 'physics-hunt', specs: ['tests/physics-hunt.spec.js'] },
    { id: 'physics-policy', specs: ['tests/physics-policy.spec.js'] },
    { id: 'arcade-blueprint', specs: ['tests/arcade-blueprint.spec.js'] },
    { id: 'bot-targeting', specs: ['tests/bot-targeting.spec.js'] },
]);
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
}

function printDryRun(clusters, playwrightArgs) {
    console.log('[playwright:desktop-e2e] dry run');
    for (let index = 0; index < clusters.length; index += 1) {
        const cluster = clusters[index];
        const env = buildClusterEnv(cluster, index);
        console.log(`- ${cluster.id}: ${cluster.specs.join(', ')}`);
        console.log(`  TEST_PORT=${env.TEST_PORT || '(auto)'}`);
        console.log(`  PW_RUN_TAG=${env.PW_RUN_TAG}`);
        console.log(`  PW_OUTPUT_DIR=${env.PW_OUTPUT_DIR}`);
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
        PW_OUTPUT_DIR: outputDir,
        PW_HTML_REPORT_DIR: htmlReportDir,
        PW_SERVER_LOG_OUT: '',
        PW_SERVER_LOG_ERR: '',
        PW_SERVER_LOG_PATHS: '',
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
                spawnError: serializeSpawnError(error),
            });
        });
        child.once('exit', (code, signal) => {
            resolve({
                cluster,
                code: code ?? 1,
                signal: signal || null,
                outputDir: clusterEnv.PW_OUTPUT_DIR,
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
    const shouldPrintClusters = process.argv.includes('--print-clusters');
    const shouldDryRun = process.argv.includes('--dry-run');
    const { selectors, playwrightArgs } = splitSelectorsAndPlaywrightArgs(process.argv.slice(2));
    const clusters = resolveSelectedClusters(selectors);

    if (shouldPrintClusters) {
        printClusters();
        if (!shouldDryRun && playwrightArgs.length === 0 && selectors.length === 0) {
            return;
        }
    }

    if (shouldDryRun) {
        printDryRun(clusters, playwrightArgs);
        return;
    }

    const failures = [];
    for (let index = 0; index < clusters.length; index += 1) {
        const result = await runCluster(clusters[index], playwrightArgs, index, clusters.length);
        if (result.signal) {
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

    if (failures.length > 0) {
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
        process.exit(1);
    }
}

main().catch((error) => {
    console.error('[playwright:desktop-e2e] cluster runner failed');
    console.error(error);
    process.exit(1);
});
