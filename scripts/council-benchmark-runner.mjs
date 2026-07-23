import { randomUUID } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
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

function stableSnapshot(snapshot) {
    return JSON.stringify(Object.fromEntries(Object.entries(snapshot).sort(([left], [right]) => left.localeCompare(right))));
}

export async function createBenchmarkDryRun({
    repositoryRoot = process.cwd(),
    tempRoot = path.join(tmpdir(), 'opencode', 'council-benchmarks'),
    runId = randomUUID(),
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
    return {
        harnessVersion: BENCHMARK_MANIFEST_VERSION,
        mode: 'DRY_RUN',
        runId,
        runRoot,
        passed: cases.length === 3 && cases.every((entry) => entry.identicalVisibleInputs),
        cases,
        externalModelCalls: 0,
        durationMs: Date.now() - startedAt,
    };
}

async function defaultExecuteArm({ benchmarkCase, arm, snapshot, stateRoot, repositoryRoot, timeoutMs, councilOrchestrationTimeoutMs, listModels }) {
    if (arm === 'deepseek-v4-pro') {
        const execution = await runDeepSeekV4ProAgent({
            snapshot,
            repositoryRoot,
            stateRoot,
            timeoutMs,
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
        timeoutMs: arm === 'coding-council'
            ? (timeoutMs || snapshot.publicCase.timeoutSeconds * 1000) + councilOrchestrationTimeoutMs
            : timeoutMs || snapshot.publicCase.timeoutSeconds * 1000,
        benchmarkCase,
    });
}

export async function runBenchmarkHarnessSmoke(options = {}) {
    const startedAt = Date.now();
    const repositoryRoot = path.resolve(options.repositoryRoot || process.cwd());
    const dryRun = await createBenchmarkDryRun({ ...options, repositoryRoot });
    const deepseek = await preflightDeepSeekV4Pro({ listModels: options.listModels, timeoutMs: options.timeoutMs });
    const executeArm = options.executeArm || defaultExecuteArm;
    const councilOrchestrationTimeoutMs = options.councilOrchestrationTimeoutMs ?? 900_000;
    const armRuns = [];
    let worktreeChanged = false;
    for (const benchmarkCase of dryRun.cases) {
        for (const [index, arm] of benchmarkCase.arms.entries()) {
            const snapshot = benchmarkCase.snapshots[index];
            if (worktreeChanged) {
                armRuns.push({ caseId: benchmarkCase.id, arm, status: 'NOT_RUN', reason: 'WORKTREE_CHANGED_EXTERNALLY' });
                continue;
            }
            if (deepseek.status !== 'READY') {
                armRuns.push({
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
                });
                continue;
            }
            const before = stableSnapshot(captureWorkingTreeSnapshot(repositoryRoot));
            const stateRoot = path.join(dryRun.runRoot, 'state', benchmarkCase.id, arm);
            let execution;
            try {
                execution = await executeArm({
                    benchmarkCase,
                    arm,
                    snapshot,
                    stateRoot,
                    repositoryRoot,
                    timeoutMs: options.timeoutMs || snapshot.publicCase.timeoutSeconds * 1000,
                    councilOrchestrationTimeoutMs,
                    listModels: options.listModels,
                });
            } catch (error) {
                execution = { status: 'INFRASTRUCTURE_ERROR', reason: 'ARM_EXECUTOR_THROW', detail: error?.message };
            }
            const after = stableSnapshot(captureWorkingTreeSnapshot(repositoryRoot));
            if (before !== after) {
                worktreeChanged = true;
                execution = { ...execution, status: 'INFRASTRUCTURE_ERROR', reason: 'WORKTREE_CHANGED_EXTERNALLY' };
            }
            armRuns.push({ caseId: benchmarkCase.id, arm, ...execution });
        }
    }
    const passed = dryRun.passed && deepseek.status === 'READY'
        && armRuns.length === dryRun.cases.length * 2
        && armRuns.every((entry) => entry.status === 'COMPLETED');
    const tokens = armRuns.reduce((total, entry) => ({
        input: total.input + Number(entry.inputTokens || 0),
        output: total.output + Number(entry.outputTokens || 0),
    }), { input: 0, output: 0 });
    return {
        harnessVersion: BENCHMARK_MANIFEST_VERSION,
        mode: 'NON_GRADED_SMOKE',
        runId: dryRun.runId,
        runRoot: dryRun.runRoot,
        councilOrchestrationTimeoutMs,
        passed,
        baselineEligible: passed,
        dryRunPassed: dryRun.passed,
        cases: dryRun.cases.length,
        armRuns,
        validRuns: armRuns.filter((entry) => entry.status === 'COMPLETED').length,
        invalidRuns: armRuns.filter((entry) => entry.status === 'INVALID_OUTPUT').length,
        infrastructureErrors: armRuns.filter((entry) => entry.status === 'INFRASTRUCTURE_ERROR').length,
        tokens,
        durationMs: Date.now() - startedAt,
        exitReason: passed
            ? 'SMOKE_COMPLETED'
            : worktreeChanged
                ? 'WORKTREE_CHANGED_EXTERNALLY'
                : deepseek.reason || 'ARM_EXECUTION_FAILED',
    };
}

async function main(argv) {
    const command = argv[0] || 'dry-run';
    const report = command === 'dry-run'
        ? await createBenchmarkDryRun()
        : command === 'smoke'
            ? await runBenchmarkHarnessSmoke()
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
