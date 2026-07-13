#!/usr/bin/env node
import { access, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { HeadlessBoundaryController } from './training-headless-lane-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const PYTHON_ROOT = path.join(REPO_ROOT, 'python');
const PPO_ROOT = path.join(REPO_ROOT, 'data', 'training', 'ppo');
const CONTRACT_SMOKE_ARTIFACT_PATH = path.join(PPO_ROOT, 'contract_smoke.json');
const LANE_BASELINE_ARTIFACT_PATH = path.join(PPO_ROOT, 'lane_baseline.json');

const DEFAULT_LANE_STEPS = 100;
const DEFAULT_SEED = 91;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function round(value, digits = 3) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return null;
    }
    const factor = 10 ** digits;
    return Math.round(numeric * factor) / factor;
}

function summarizeSamples(samples) {
    if (!Array.isArray(samples) || samples.length === 0) {
        return {
            count: 0,
            min: null,
            max: null,
            average: null,
            median: null,
        };
    }
    const sorted = [...samples].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
    const total = sorted.reduce((sum, entry) => sum + entry, 0);
    return {
        count: sorted.length,
        min: round(sorted[0]),
        max: round(sorted[sorted.length - 1]),
        average: round(total / sorted.length),
        median: round(median),
    };
}

async function resolvePythonExecutable() {
    const preferred = process.env.BT91_PYTHON_EXE
        ? path.resolve(REPO_ROOT, process.env.BT91_PYTHON_EXE)
        : path.join(PYTHON_ROOT, '.venv', 'Scripts', 'python.exe');
    try {
        await access(preferred);
        return preferred;
    } catch {
        return process.env.BT91_PYTHON_EXE || 'python';
    }
}

function choosePort() {
    const fromEnv = Number(process.env.BT91_BRIDGE_PORT);
    if (Number.isInteger(fromEnv) && fromEnv >= 1024 && fromEnv <= 65_535) {
        return fromEnv;
    }
    return 9_700 + Math.floor(Math.random() * 200);
}

function summarizePacket(packet) {
    return {
        type: packet?.type || null,
        delivered: packet?.delivered === true,
        stepIndex: packet?.transition?.stepIndex ?? null,
        done: packet?.transition?.done ?? null,
        truncated: packet?.transition?.truncated ?? null,
        reward: round(packet?.transition?.reward),
        domainId: packet?.payload?.info?.domain?.domainId || null,
        observationLength: packet?.payload?.observationLength ?? null,
    };
}

function createSidecarHandle(pythonExecutable, port) {
    const sidecarStdout = [];
    const sidecarStderr = [];
    const child = spawn(
        pythonExecutable,
        [
            '-u',
            path.join('python', 'scripts', 'headless_bridge_sidecar.py'),
            '--host', '127.0.0.1',
            '--port', String(port),
            '--session-id', 'bt91-headless-bridge-smoke',
        ],
        {
            cwd: REPO_ROOT,
            stdio: ['ignore', 'pipe', 'pipe'],
        }
    );
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => {
        sidecarStdout.push(String(chunk));
    });
    child.stderr?.on('data', (chunk) => {
        sidecarStderr.push(String(chunk));
    });
    return {
        child,
        getStdout() {
            return sidecarStdout.join('').trim();
        },
        getStderr() {
            return sidecarStderr.join('').trim();
        },
    };
}

async function stopSidecar(handle) {
    if (!handle?.child || handle.child.killed) {
        return;
    }
    handle.child.kill();
    await new Promise((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        handle.child.once('exit', () => {
            clearTimeout(timer);
            resolve();
        });
    });
}

async function runSmoke() {
    const port = choosePort();
    const pythonExecutable = await resolvePythonExecutable();
    const sidecarHandle = createSidecarHandle(pythonExecutable, port);
    const controller = new HeadlessBoundaryController({
        port,
        maxSteps: DEFAULT_LANE_STEPS,
        seed: DEFAULT_SEED,
        sessionId: 'bt91-headless-bridge-smoke',
        episodeIdPrefix: 'bt91-headless',
    });

    try {
        const bootStartedAt = performance.now();
        await controller.initialize();
        const bootLatencyMs = round(performance.now() - bootStartedAt);
        const readyPayload = controller.readyPayload;
        const resetResult = await controller.reset();
        const resetPacket = resetResult.packet;

        const actionLatencies = [];
        const stepLatencies = [];
        const stepSamples = [];
        let finalPacket = resetPacket;

        for (let step = 1; step <= DEFAULT_LANE_STEPS; step += 1) {
            const stepResult = await controller.step();
            actionLatencies.push(stepResult.actionLatencyMs);
            stepLatencies.push(stepResult.ackLatencyMs);
            finalPacket = stepResult.packet;

            if (step === 1 || step === 50 || step === DEFAULT_LANE_STEPS) {
                stepSamples.push({
                    step,
                    action: {
                        yawLeft: !!stepResult.resolvedAction?.yawLeft,
                        yawRight: !!stepResult.resolvedAction?.yawRight,
                        boost: !!stepResult.resolvedAction?.boost,
                    },
                    transition: summarizePacket(finalPacket),
                    ackLatencyMs: stepResult.ackLatencyMs,
                });
            }
        }

        const statsStartedAt = performance.now();
        const statsResult = await controller.stats();
        const statsLatencyMs = round(performance.now() - statsStartedAt);
        const statsResponse = statsResult.stats;
        assert(statsResponse?.ok === true, `trainer-stats-request failed: ${JSON.stringify(statsResponse)}`);
        assert(Number(statsResponse?.contractSmoke?.validationFailures || 0) === 0, 'sidecar reported contract validation failures');
        assert(Number(statsResponse?.messageCounts?.['training-step'] || 0) >= DEFAULT_LANE_STEPS, 'sidecar saw fewer than 100 training-step messages');
        assert(Number(statsResponse?.messageCounts?.['training-reset'] || 0) >= 1, 'sidecar did not see training-reset');
        assert(Number(statsResponse?.messageCounts?.['bot-action-request'] || 0) >= DEFAULT_LANE_STEPS, 'sidecar did not see bot-action-request');
        assert(finalPacket?.transition?.stepIndex === DEFAULT_LANE_STEPS, `expected final stepIndex ${DEFAULT_LANE_STEPS}, got ${finalPacket?.transition?.stepIndex}`);
        assert(finalPacket?.transition?.truncated === true, 'expected final lane transition to truncate at the 100-step budget');

        const contractSmokeArtifact = {
            ok: true,
            generatedAt: new Date().toISOString(),
            scope: {
                workerCount: 1,
                stepsTarget: DEFAULT_LANE_STEPS,
                stepsCompleted: finalPacket?.transition?.stepIndex ?? 0,
                contractVersion: finalPacket?.payload?.contractVersion || null,
                observationSchemaVersion: finalPacket?.payload?.observationSchemaVersion || null,
                observationLength: finalPacket?.payload?.observationLength || null,
            },
            handshake: {
                readyPayload,
                bootLatencyMs,
                resetAckLatencyMs: resetResult.ackLatencyMs,
                statsLatencyMs,
            },
            runtime: {
                ...statsResult.runtime,
                mapKey: controller.runtime?.session?.effectiveMapKey || controller.runtimeConfig?.session?.mapKey || null,
                activeGameMode: controller.runtimeConfig?.session?.activeGameMode || null,
                planarMode: !!controller.runtimeConfig?.gameplay?.planarMode,
            },
            sidecar: {
                pythonExecutable,
                messageCounts: statsResponse?.messageCounts || null,
                processingLatencyMs: statsResponse?.processingLatencyMs || null,
                contractSmoke: statsResponse?.contractSmoke || null,
            },
            transport: {
                reset: summarizePacket(resetPacket),
                finalStep: summarizePacket(finalPacket),
                bridgeTelemetry: statsResult.bridgeTelemetry || null,
            },
            sampleSteps: stepSamples,
        };

        const laneBaselineArtifact = {
            ok: true,
            generatedAt: contractSmokeArtifact.generatedAt,
            lane: {
                workerCount: 1,
                deterministic: true,
                seed: DEFAULT_SEED,
                stepsTarget: DEFAULT_LANE_STEPS,
                stepsCompleted: finalPacket?.transition?.stepIndex ?? 0,
            },
            latencyMs: {
                boot: bootLatencyMs,
                resetAck: resetResult.ackLatencyMs,
                action: summarizeSamples(actionLatencies),
                trainingStepAck: summarizeSamples(stepLatencies),
                stats: statsLatencyMs,
                sidecarProcessing: statsResponse?.processingLatencyMs || null,
            },
            handover: {
                nextBlock: 'BT92',
                notes: [
                    'exactly one headless worker lane only',
                    '100-step baseline closes via max-steps truncation',
                    '2-/4-worker, multi-env, VecEnv and PPO baseline remain outside BT91',
                ],
            },
        };

        await mkdir(PPO_ROOT, { recursive: true });
        await writeFile(CONTRACT_SMOKE_ARTIFACT_PATH, `${JSON.stringify(contractSmokeArtifact, null, 2)}\n`, 'utf8');
        await writeFile(LANE_BASELINE_ARTIFACT_PATH, `${JSON.stringify(laneBaselineArtifact, null, 2)}\n`, 'utf8');

        console.log(JSON.stringify({
            ok: true,
            contractSmokeArtifact: path.relative(REPO_ROOT, CONTRACT_SMOKE_ARTIFACT_PATH),
            laneBaselineArtifact: path.relative(REPO_ROOT, LANE_BASELINE_ARTIFACT_PATH),
            stepsCompleted: finalPacket?.transition?.stepIndex ?? 0,
            bootLatencyMs,
            resetAckLatencyMs: resetResult.ackLatencyMs,
            averageStepAckLatencyMs: summarizeSamples(stepLatencies).average,
        }, null, 2));
    } finally {
        try {
            await controller.close();
        } finally {
            await stopSidecar(sidecarHandle);
        }
    }
}

runSmoke().catch((error) => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
});
