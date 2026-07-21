import process from 'node:process';
import { performance } from 'node:perf_hooks';

import { RuntimePerfProfiler } from '../src/core/perf/RuntimePerfProfiler.js';
import { MATCH_KERNEL_FIXED_STEP_SECONDS } from '../src/shared/contracts/MatchKernelRuntimeContract.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { createHeadlessMatchKernelRuntime } from '../dev/training/src/state/HeadlessMatchKernelRuntime.js';

const DEFAULT_TICKS = 600;
const DEFAULT_WARMUP = 120;
const DEFAULT_THRESHOLD_MS = 30;

function parseArgs() {
    const args = process.argv.slice(2);
    const result = { ticks: DEFAULT_TICKS, warmup: DEFAULT_WARMUP, threshold: DEFAULT_THRESHOLD_MS, output: null };

    for (let i = 0; i < args.length; i++) {
        switch (args[i]) {
            case '--ticks':
                result.ticks = Math.max(1, parseInt(args[++i], 10) || DEFAULT_TICKS);
                break;
            case '--warmup':
                result.warmup = Math.max(0, parseInt(args[++i], 10) || DEFAULT_WARMUP);
                break;
            case '--threshold':
                result.threshold = Math.max(1, parseFloat(args[++i]) || DEFAULT_THRESHOLD_MS);
                break;
            case '--output':
                result.output = args[++i];
                break;
            case '--raw':
                result.raw = true;
                break;
            case '--subsystem-stats':
                result.subsystemStats = true;
                break;
        }
    }
    return result;
}

async function main() {
    const opts = parseArgs();

    const settings = {
        localSettings: { modePath: 'normal', sessionType: 'single' },
        mode: '1p',
        mapKey: 'standard',
        gameMode: 'CLASSIC',
        numBots: 1,
        winsNeeded: 3,
        botDifficulty: 'NORMAL',
        gameplay: { planarMode: false },
        portalsEnabled: false,
    };

    const runtimeConfig = createRuntimeConfigSnapshot(settings);

    const runtime = await createHeadlessMatchKernelRuntime({
        settings,
        runtimeConfig,
        requestedMapKey: 'standard',
        profile: {
            sessionId: `perf-snapshot-${Date.now()}`,
            fixedStepSeconds: MATCH_KERNEL_FIXED_STEP_SECONDS,
            deterministic: true,
        },
    });

    const profiler = new RuntimePerfProfiler({
        spikeThresholdMs: opts.threshold,
        logSpikes: false,
    });

    const emptyFrame = { players: [], commands: [] };
    let timestampMs = 0;

    for (let i = 0; i < opts.warmup; i++) {
        runtime.step(emptyFrame, {
            tickIndex: runtime.kernel.tickIndex,
            fixedStepSeconds: MATCH_KERNEL_FIXED_STEP_SECONDS,
            frameId: i,
        });
        timestampMs += MATCH_KERNEL_FIXED_STEP_SECONDS * 1000;
    }

    profiler.reset();

    for (let i = 0; i < opts.ticks; i++) {
        const frameStartMs = performance.now();
        profiler.beginFrame(0, timestampMs);

        const updateStart = profiler.startSample();
        runtime.step(emptyFrame, {
            tickIndex: runtime.kernel.tickIndex,
            fixedStepSeconds: MATCH_KERNEL_FIXED_STEP_SECONDS,
            frameId: opts.warmup + i,
        });
        profiler.endSample('update', updateStart);

        if (opts.subsystemStats) {
            const session = runtime.session;
            if (session?.entityManager?.lastCollisionMs !== undefined) {
                profiler.recordSubsystemDuration('collision', session.entityManager.lastCollisionMs);
            }
        }

        profiler.endFrame(performance.now() - frameStartMs, timestampMs);
        timestampMs += MATCH_KERNEL_FIXED_STEP_SECONDS * 1000;
    }

    const snapshot = profiler.getSnapshot({
        windowSize: Math.min(300, opts.ticks),
        spikeEventsLimit: 12,
    });

    const report = {
        generatedAt: new Date().toISOString(),
        config: { ticks: opts.ticks, warmup: opts.warmup, thresholdMs: opts.threshold },
        snapshot,
        kernelState: {
            lifecycle: runtime.kernel.lifecycle,
            tickIndex: runtime.kernel.tickIndex,
        },
    };

    if (opts.raw) {
        process.stdout.write(JSON.stringify(report));
    } else {
        process.stdout.write(JSON.stringify(report, null, 2));
    }

    runtime.dispose();
}

main().catch((err) => {
    console.error('perf-snapshot failed:', err);
    process.exit(1);
});
