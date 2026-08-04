import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { preflightDeepSeekV4Pro, runDeepSeekV4ProAgent } from './council-benchmark-deepseek.mjs';
import { runCouncilBenchmarkArm } from './council-benchmark-opencode.mjs';
import {
    BENCHMARK_MANIFEST_VERSION,
    createBenchmarkSnapshot,
    validateManifestSources,
} from './council-benchmark-manifest.mjs';
import { diffSnapshotFiles } from './council-loop-policy.mjs';
import { captureWorkingTreeSnapshot } from './council-runner.mjs';

export const LOCAL_BENCHMARK_MANIFEST = path.join('tests', 'council-test-loop', 'benchmark-manifest.private.json');

export async function loadLocalBenchmarkManifest(repositoryRoot = process.cwd()) {
    const manifestPath = path.resolve(repositoryRoot, LOCAL_BENCHMARK_MANIFEST);
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    return validateManifestSources(manifest, repositoryRoot);
}

function armsForCase(benchmarkCase) {
    return benchmarkCase.scope === 'repair'
        ? ['coding-council', 'deepseek-v4-pro']
        : ['read-only-council', 'deepseek-v4-pro'];
}

async function persistBenchmarkReport(report) {
    const resultFile = path.join(report.runRoot, 'result.json');
    const persisted = { ...report, resultFile };
    const temporaryFile = path.join(report.runRoot, `.result-${process.pid}-${randomUUID()}.json.tmp`);
    await writeFile(temporaryFile, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8');
    await rename(temporaryFile, resultFile);
    return persisted;
}

export async function createBenchmarkDryRun({
    repositoryRoot = process.cwd(),
    tempRoot = path.join(tmpdir(), 'opencode', 'council-benchmarks'),
    runId = randomUUID(),
    persistResult = true,
} = {}) {
    const startedAt = Date.now();
    const runRoot = path.join(path.resolve(tempRoot), 'runs', runId);
    await mkdir(runRoot, { recursive: true });
    const manifest = await loadLocalBenchmarkManifest(repositoryRoot);
    const cases = [];
    for (const benchmarkCase of manifest.cases) {
        const arms = armsForCase(benchmarkCase);
        const snapshots = [];
        for (const arm of arms) {
            snapshots.push(await createBenchmarkSnapshot({ benchmarkCase, repositoryRoot, tempRoot: runRoot, arm }));
        }
        const [first, second] = snapshots;
        const identicalVisibleInputs = first.digest === second.digest
            && JSON.stringify(first.publicCase) === JSON.stringify(second.publicCase)
            && JSON.stringify(first.files) === JSON.stringify(second.files);
        cases.push({
            id: benchmarkCase.id,
            taskType: benchmarkCase.taskType,
            negativeControl: benchmarkCase.negativeControl,
            arms,
            identicalVisibleInputs,
            snapshotDigest: first.digest,
            snapshots: snapshots.map(({ arm, root, digest, files, publicCase }) => ({ arm, root, digest, files, publicCase })),
        });
    }
    const report = {
        harnessVersion: BENCHMARK_MANIFEST_VERSION,
        mode: 'DRY_RUN',
        runId,
        runRoot,
        passed: cases.length === 3 && cases.every((entry) => entry.identicalVisibleInputs),
        cases,
        externalModelCalls: 0,
        durationMs: Date.now() - startedAt,
    };
    return persistResult ? persistBenchmarkReport(report) : report;
}

async function defaultExecuteArm({ benchmarkCase, arm, snapshot, stateRoot, repositoryRoot, timeoutMs, councilOrchestrationTimeoutMs, benchmarkDeadlineMs, listModels }) {
    const requestedTimeoutMs = arm === 'coding-council'
        ? timeoutMs + councilOrchestrationTimeoutMs
        : timeoutMs;
    const effectiveTimeoutMs = Math.max(1, Math.min(requestedTimeoutMs, benchmarkDeadlineMs - Date.now()));
    if (arm === 'deepseek-v4-pro') {
        const execution = await runDeepSeekV4ProAgent({
            snapshot,
            repositoryRoot,
            stateRoot,
            timeoutMs: effectiveTimeoutMs,
            listModels,
        });
        return {
            ...execution,
            inputTokens: execution.usage?.inputTokens ?? null,
            outputTokens: execution.usage?.outputTokens ?? null,
        };
    }
    return runCouncilBenchmarkArm({
        snapshot,
        arm,
        stateRoot,
        repositoryRoot,
        timeoutMs: effectiveTimeoutMs,
        benchmarkCase,
    });
}

export async function runBenchmarkHarnessSmoke(options = {}) {
    const startedAt = Date.now();
    const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
    const benchmarkTimeoutMs = options.benchmarkTimeoutMs ?? 900_000;
    if (!Number.isInteger(benchmarkTimeoutMs) || benchmarkTimeoutMs < 1) {
        throw new TypeError('benchmarkTimeoutMs must be a positive integer');
    }
    const benchmarkDeadlineMs = startedAt + benchmarkTimeoutMs;
    const dryRun = await createBenchmarkDryRun({ ...options, repositoryRoot, persistResult: false });
    const preflightTimeoutMs = Math.max(1, Math.min(options.timeoutMs ?? 15_000, benchmarkDeadlineMs - Date.now()));
    const deepseek = await preflightDeepSeekV4Pro({ listModels: options.listModels, timeoutMs: preflightTimeoutMs });
    const executeArm = options.executeArm || defaultExecuteArm;
    const captureSnapshot = options.captureWorkingTreeSnapshot || captureWorkingTreeSnapshot;
    const onProgress = options.onProgress || (() => {});
    const progressIntervalMs = options.progressIntervalMs ?? 30_000;
    if (!Number.isInteger(progressIntervalMs) || progressIntervalMs < 1) {
        throw new TypeError('progressIntervalMs must be a positive integer');
    }
    const councilOrchestrationTimeoutMs = options.councilOrchestrationTimeoutMs ?? 900_000;
    const armRuns = [];
    const totalArms = dryRun.cases.reduce((total, benchmarkCase) => total + benchmarkCase.arms.length, 0);
    let completedArms = 0;
    let worktreeChange = null;
    let benchmarkTimedOut = false;
    const emitProgress = (phase, detail = {}) => onProgress({
        scope: 'benchmark-smoke',
        phase,
        completed: completedArms,
        total: totalArms,
        elapsedMs: Date.now() - startedAt,
        ...detail,
    });
    emitProgress('ready', { deepseekStatus: deepseek.status });
    for (const benchmarkCase of dryRun.cases) {
        for (const [index, arm] of benchmarkCase.arms.entries()) {
            const snapshot = benchmarkCase.snapshots[index];
            if (worktreeChange) {
                const skipped = {
                    caseId: benchmarkCase.id,
                    arm,
                    status: 'NOT_RUN',
                    reason: 'WORKTREE_CHANGED_EXTERNALLY',
                    repositoryChangedFiles: worktreeChange.repositoryChangedFiles,
                    blockedBy: { caseId: worktreeChange.caseId, arm: worktreeChange.arm },
                };
                armRuns.push(skipped);
                completedArms += 1;
                emitProgress('arm-skipped', { caseId: benchmarkCase.id, arm, status: skipped.status, reason: skipped.reason });
                continue;
            }
            if (benchmarkTimedOut || Date.now() >= benchmarkDeadlineMs) {
                benchmarkTimedOut = true;
                const skipped = {
                    caseId: benchmarkCase.id,
                    arm,
                    status: 'NOT_RUN',
                    reason: 'BENCHMARK_TIMEOUT',
                };
                armRuns.push(skipped);
                completedArms += 1;
                emitProgress('arm-skipped', { caseId: benchmarkCase.id, arm, status: skipped.status, reason: skipped.reason });
                continue;
            }
            if (deepseek.status !== 'READY') {
                const blocked = {
                    caseId: benchmarkCase.id,
                    arm,
                    status: arm === 'deepseek-v4-pro' ? deepseek.status : 'BLOCKED_BY_PAIRED_INFRASTRUCTURE',
                    reason: arm === 'deepseek-v4-pro' ? deepseek.reason : 'PAIRED_DEEPSEEK_ARM_UNAVAILABLE',
                    model: arm === 'deepseek-v4-pro' ? 'deepseek-v4-pro' : null,
                    inputTokens: null,
                    outputTokens: null,
                    costUsd: null,
                    modelCalls: 0,
                    toolCalls: 0,
                };
                armRuns.push(blocked);
                completedArms += 1;
                emitProgress('arm-skipped', { caseId: benchmarkCase.id, arm, status: blocked.status, reason: blocked.reason });
                continue;
            }
            const before = captureSnapshot(repositoryRoot);
            const stateRoot = path.join(dryRun.runRoot, 'state', benchmarkCase.id, arm);
            let execution;
            const armStartedAt = Date.now();
            emitProgress('arm-start', { caseId: benchmarkCase.id, arm });
            const heartbeat = setInterval(() => {
                emitProgress('arm-running', { caseId: benchmarkCase.id, arm, armElapsedMs: Date.now() - armStartedAt });
            }, progressIntervalMs);
            try {
                const requestedTimeoutMs = options.timeoutMs || snapshot.publicCase.timeoutSeconds * 1000;
                execution = await executeArm({
                    benchmarkCase,
                    arm,
                    snapshot,
                    stateRoot,
                    repositoryRoot,
                    timeoutMs: Math.max(1, Math.min(requestedTimeoutMs, benchmarkDeadlineMs - Date.now())),
                    councilOrchestrationTimeoutMs,
                    benchmarkDeadlineMs,
                    listModels: options.listModels,
                });
            } catch (error) {
                execution = { status: 'INFRASTRUCTURE_ERROR', reason: 'ARM_EXECUTOR_THROW', detail: error?.message };
            } finally {
                clearInterval(heartbeat);
            }
            const after = captureSnapshot(repositoryRoot);
            const repositoryChangedFiles = diffSnapshotFiles(before, after);
            if (repositoryChangedFiles.length > 0) {
                worktreeChange = { caseId: benchmarkCase.id, arm, repositoryChangedFiles };
                execution = {
                    ...execution,
                    status: 'INFRASTRUCTURE_ERROR',
                    reason: 'WORKTREE_CHANGED_EXTERNALLY',
                    previousReason: execution.reason ?? null,
                    repositoryChangedFiles,
                };
            }
            armRuns.push({ caseId: benchmarkCase.id, arm, ...execution });
            if (Date.now() >= benchmarkDeadlineMs) benchmarkTimedOut = true;
            completedArms += 1;
            emitProgress('arm-complete', {
                caseId: benchmarkCase.id,
                arm,
                status: execution.status,
                reason: execution.reason ?? null,
                armElapsedMs: Date.now() - armStartedAt,
            });
        }
    }
    const passed = !benchmarkTimedOut && dryRun.passed && deepseek.status === 'READY'
        && armRuns.length === dryRun.cases.length * 2
        && armRuns.every((entry) => entry.status === 'COMPLETED');
    const tokens = armRuns.reduce((total, entry) => ({
        input: total.input + Number(entry.inputTokens || 0),
        output: total.output + Number(entry.outputTokens || 0),
    }), { input: 0, output: 0 });
    const specialistDetails = armRuns.flatMap((entry) => entry.validationDetails || []);
    const report = {
        harnessVersion: BENCHMARK_MANIFEST_VERSION,
        mode: 'NON_GRADED_SMOKE',
        runId: dryRun.runId,
        runRoot: dryRun.runRoot,
        councilOrchestrationTimeoutMs,
        benchmarkTimeoutMs,
        passed,
        baselineEligible: passed,
        dryRunPassed: dryRun.passed,
        cases: dryRun.cases.length,
        armRuns,
        validRuns: armRuns.filter((entry) => entry.status === 'COMPLETED').length,
        invalidRuns: armRuns.filter((entry) => entry.status === 'INVALID_OUTPUT').length,
        infrastructureErrors: armRuns.filter((entry) => entry.status === 'INFRASTRUCTURE_ERROR').length,
        notRunArms: armRuns.filter((entry) => entry.status === 'NOT_RUN').length,
        specialistReports: {
            total: specialistDetails.length,
            valid: specialistDetails.filter((entry) => entry.valid).length,
            invalid: specialistDetails.filter((entry) => !entry.valid).length,
            timedOut: specialistDetails.filter((entry) => entry.timedOut).length,
            infrastructureErrors: specialistDetails.filter((entry) => entry.exitReason === 'INFRASTRUCTURE_ERROR').length,
        },
        worktreeChange,
        tokens,
        durationMs: Date.now() - startedAt,
        exitReason: passed
            ? 'SMOKE_COMPLETED'
            : worktreeChange
                ? 'WORKTREE_CHANGED_EXTERNALLY'
                : benchmarkTimedOut
                    ? 'BENCHMARK_TIMEOUT'
                    : deepseek.reason || 'ARM_EXECUTION_FAILED',
    };
    const persisted = await persistBenchmarkReport(report);
    emitProgress('complete', { passed, exitReason: persisted.exitReason });
    return persisted;
}

async function main(argv) {
    const command = argv[0] || 'dry-run';
    const benchmarkTimeoutMs = Number.parseInt(process.env.COUNCIL_BENCHMARK_SMOKE_TIMEOUT_MS || '900000', 10);
    if (!Number.isInteger(benchmarkTimeoutMs) || benchmarkTimeoutMs < 1) {
        throw new TypeError('COUNCIL_BENCHMARK_SMOKE_TIMEOUT_MS must be a positive integer');
    }
    const report = command === 'dry-run'
        ? await createBenchmarkDryRun()
        : command === 'smoke'
            ? await runBenchmarkHarnessSmoke({
                benchmarkTimeoutMs,
                onProgress: (progress) => process.stderr.write(`PROGRESS ${JSON.stringify(progress)}\n`),
            })
            : null;
    if (!report) throw new Error('Usage: council-benchmark-runner.mjs <dry-run|smoke>');
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!report.passed && command === 'smoke') process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main(process.argv.slice(2)).catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
