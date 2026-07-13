import process from 'node:process';

import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import {
    MATCH_KERNEL_FIXED_STEP_SECONDS,
    MATCH_KERNEL_SURFACES,
    MATCH_KERNEL_TICK_DRIVERS,
} from '../src/shared/contracts/MatchKernelRuntimeContract.js';
import {
    createHeadlessMatchKernelRuntime,
    MATCH_KERNEL_HEADLESS_RUNTIME_CONTRACT_VERSION,
} from '../src/state/HeadlessMatchKernelRuntime.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function createSmokeSettings() {
    return {
        localSettings: {
            modePath: 'normal',
            sessionType: 'single',
        },
        mode: '1p',
        mapKey: 'standard',
        gameMode: 'CLASSIC',
        numBots: 1,
        winsNeeded: 3,
        botDifficulty: 'NORMAL',
        gameplay: {
            planarMode: false,
        },
        portalsEnabled: false,
    };
}

async function createRuntimeFixture() {
    const settings = createSmokeSettings();
    const runtimeConfig = createRuntimeConfigSnapshot(settings);
    const runtime = await Promise.resolve(createHeadlessMatchKernelRuntime({
        settings,
        runtimeConfig,
        requestedMapKey: runtimeConfig?.session?.mapKey,
        profile: {
            sessionId: 'v84-headless-kernel-smoke',
            fixedStepSeconds: MATCH_KERNEL_FIXED_STEP_SECONDS,
            deterministic: true,
        },
    }));
    return { runtime, settings, runtimeConfig };
}

async function runHeadlessKernelFlow() {
    const { runtime, runtimeConfig } = await createRuntimeFixture();
    const kernel = runtime?.kernel || null;
    const session = runtime?.session || null;
    const renderer = runtime?.renderer || null;
    const trainingDescriptor = runtime?.getConsumerDescriptors?.()?.training || null;

    assert(runtime?.contractVersion === MATCH_KERNEL_HEADLESS_RUNTIME_CONTRACT_VERSION, 'headless runtime contract mismatch');
    assert(kernel, 'headless runtime should expose a kernel');
    assert(session?.entityManager, 'headless runtime should expose an entityManager');
    assert(kernel.lifecycle === 'running', `expected running kernel lifecycle, got ${kernel?.lifecycle}`);
    assert(kernel.surface === MATCH_KERNEL_SURFACES.HEADLESS, `expected headless surface, got ${kernel?.surface}`);
    assert(kernel.profile?.tickDriver === MATCH_KERNEL_TICK_DRIVERS.MANUAL, `expected manual tick driver, got ${kernel?.profile?.tickDriver}`);
    assert(session.entityManager.players.length === 2, `expected 2 spawned players, got ${session.entityManager.players.length}`);
    assert(trainingDescriptor?.profile?.surface === MATCH_KERNEL_SURFACES.HEADLESS, 'training consumer should mirror headless surface');

    const matchStart = {
        lifecycle: kernel.lifecycle,
        surface: kernel.surface,
        tickDriver: kernel.profile?.tickDriver || null,
        matchId: kernel.profile?.matchId || null,
        modeId: kernel.profile?.modeId || null,
        mapKey: runtimeConfig?.session?.mapKey || null,
        playerCount: session.entityManager.players.length,
    };

    const tickResult = runtime.step(
        {
            players: [
                {
                    actions: {
                        boost: true,
                        yawLeft: true,
                    },
                },
            ],
        },
        {
            tickIndex: kernel.tickIndex,
            fixedStepSeconds: MATCH_KERNEL_FIXED_STEP_SECONDS,
            frameId: 1,
            wallClockMs: 16,
            highResTimestampMs: 16,
        }
    );

    assert(tickResult?.lifecycle === 'running', `expected running tick lifecycle, got ${tickResult?.lifecycle}`);
    assert(tickResult?.surface === MATCH_KERNEL_SURFACES.HEADLESS, `expected headless tick surface, got ${tickResult?.surface}`);
    assert(tickResult?.tickIndex === 1, `expected first tick index to be 1, got ${tickResult?.tickIndex}`);
    assert(kernel.tickIndex === 1, `kernel tickIndex should advance to 1, got ${kernel?.tickIndex}`);

    const tick = {
        tickIndex: tickResult.tickIndex,
        lifecycle: tickResult.lifecycle,
        fixedStepSeconds: tickResult.fixedStepSeconds,
        frameId: 1,
    };

    runtime.dispose();

    assert(kernel.lifecycle === 'disposed', `expected disposed kernel lifecycle, got ${kernel?.lifecycle}`);
    assert(kernel.profile === null, 'kernel profile should be cleared during dispose');
    assert(session.entityManager.players.length === 0, `expected players to be cleared during dispose, got ${session.entityManager.players.length}`);
    assert(renderer?.cameras?.length === 0, `expected headless renderer cameras to be cleared, got ${renderer?.cameras?.length}`);
    assert(runtime?.getConsumerDescriptors?.()?.training?.profile === null, 'training consumer should be released during dispose');

    const cleanup = {
        lifecycle: kernel.lifecycle,
        remainingPlayers: session.entityManager.players.length,
        remainingCameras: renderer?.cameras?.length || 0,
    };

    return {
        matchStart,
        tick,
        cleanup,
    };
}

async function main() {
    const summary = await runHeadlessKernelFlow();
    console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

const SMOKE_TIMEOUT_MS = 15000;
const safetyTimer = setTimeout(() => {
    console.error('[headless-smoke] timeout after ' + SMOKE_TIMEOUT_MS + 'ms — forcing exit');
    process.exit(2);
}, SMOKE_TIMEOUT_MS);
safetyTimer.unref?.();

main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exit(1);
});
