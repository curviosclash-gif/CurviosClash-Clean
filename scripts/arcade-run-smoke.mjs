import process from 'node:process';

import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { createArcadeRoundStateController } from '../src/state/arcade/ArcadeRoundStateController.js';
import { createArcadeEncounterDirector } from '../src/entities/directors/ArcadeEncounterDirector.js';
import { createAirframeMasteryState, awardAirframeXp } from '../src/entities/arcade/AirframeMasteryOps.js';
import {
    createArcadeBlueprintFromVehicleConfig,
    validateArcadeBlueprint,
} from '../src/entities/arcade/ArcadeBlueprintSchema.js';

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function createStoreStub() {
    const memory = new Map();
    return {
        memory,
        loadJsonRecord(key, fallback = null) {
            return memory.has(key) ? memory.get(key) : fallback;
        },
        saveJsonRecord(key, value) {
            memory.set(key, JSON.parse(JSON.stringify(value)));
            return true;
        },
    };
}

function createReplayRecorderStub() {
    const calls = [];
    return {
        calls,
        isRecording: false,
        startRecording() {
            calls.push({ type: 'start' });
            this.isRecording = true;
        },
        stopRecording() {
            calls.push({ type: 'stop' });
            this.isRecording = false;
            return { matchId: 'arcade-replay-smoke-1' };
        },
    };
}

function runArcadeRuntimeFlowCase() {
    const store = createStoreStub();
    const settingsManager = { store };
    const replayRecorder = createReplayRecorderStub();
    let nowMs = 1000;
    const runtime = new ArcadeRunRuntime({
        settingsManager,
        replayRecorder,
        now: () => nowMs,
        logger: { log() {}, warn() {} },
    });

    const settings = {
        localSettings: {
            modePath: 'arcade',
        },
        mode: '1p',
        mapKey: 'arena3',
        numBots: 4,
        winsNeeded: 3,
        botDifficulty: 'NORMAL',
        arcade: {
            seed: 4242,
            sectorCount: 2,
            comboWindowMs: 4000,
            comboDecayPerSecond: 1,
            maxMultiplier: 6,
            replayHooksEnabled: true,
        },
    };
    const runtimeConfig = createRuntimeConfigSnapshot(settings);
    runtime.configure(runtimeConfig);
    assert(runtime.isEnabled() === true, 'Arcade runtime should be enabled');

    const initial = runtime.startRun();
    assert(initial?.runId, 'Arcade run id missing');
    assert(initial?.phase === 'sector_active', `Expected sector_active, got ${initial?.phase}`);
    assert(replayRecorder.calls.length === 1, 'Replay start should be called once');

    const baseController = {
        defaultRoundPause: 3,
        deriveOnRoundEndPlan() {
            return {
                outcome: { state: 'ROUND_END' },
                transition: {
                    roundPause: 3,
                    nextState: 'ROUND_END',
                    overlayMessageText: 'Fallback',
                    overlayMessageSub: '',
                },
            };
        },
        deriveRoundEndTick(inputs = {}) {
            if (inputs.enterPressed || Number(inputs.roundPause) <= 0) {
                return { action: 'START_ROUND' };
            }
            return { action: 'WAIT' };
        },
        deriveMatchEndTick(inputs = {}) {
            if (inputs.escapePressed) return { action: 'RETURN_TO_MENU' };
            return { action: 'RESTART_MATCH' };
        },
    };

    const roundController = createArcadeRoundStateController({
        baseController,
        arcadeRuntime: runtime,
    });

    nowMs += 2000;
    const firstPlan = roundController.deriveOnRoundEndPlan([], { winsNeeded: 2 });
    assert(firstPlan?.transition?.nextState === 'ROUND_END', 'First sector should transition to ROUND_END');
    runtime.handleRoundEndTelemetry({
        state: 'ROUND_END',
        duration: 28,
        selfCollisions: 0,
        itemUses: 1,
        stuckEvents: 0,
    });
    const afterFirst = runtime.getStateSnapshot();
    assert(afterFirst?.score?.total > 0, 'First sector should award score');
    assert(afterFirst?.phase === 'intermission', `Expected intermission, got ${afterFirst?.phase}`);

    roundController.deriveRoundEndTick({ enterPressed: true, roundPause: 0 });
    const secondSector = runtime.getStateSnapshot();
    assert(
        secondSector?.phase === 'sector_active' || secondSector?.phase === 'sudden_death',
        `Expected sector_active or sudden_death, got ${secondSector?.phase}`
    );
    assert(secondSector?.sectorIndex === 2, `Expected sectorIndex=2, got ${secondSector?.sectorIndex}`);

    nowMs += 2000;
    const secondPlan = roundController.deriveOnRoundEndPlan([], { winsNeeded: 2 });
    assert(secondPlan?.transition?.nextState === 'MATCH_END', 'Second sector should end run with MATCH_END');
    runtime.handleRoundEndTelemetry({
        state: 'MATCH_END',
        duration: 35,
        selfCollisions: 1,
        itemUses: 0,
        stuckEvents: 0,
    });

    const finalized = runtime.getStateSnapshot();
    const records = runtime.getRecordsSnapshot();
    assert(finalized?.phase === 'finished', `Expected finished, got ${finalized?.phase}`);
    assert(records?.runsPlayed === 1, `Expected runsPlayed=1, got ${records?.runsPlayed}`);
    assert(records?.bestScore > 0, 'Expected bestScore > 0');
    assert(records?.replay?.lastRunId === 'arcade-replay-smoke-1', 'Expected replay id in records');
    assert(replayRecorder.calls.length === 2, 'Replay recorder should start and stop once');

    return {
        runId: finalized.runId,
        finishedPhase: finalized.phase,
        finalScore: finalized.score.total,
        sectors: finalized.completedSectors,
        records: {
            runsPlayed: records.runsPlayed,
            bestScore: records.bestScore,
            lastRunReplayId: records.replay.lastRunId,
        },
    };
}

function runEncounterDirectorCase() {
    const first = createArcadeEncounterDirector({ seed: 'smoke-seed', sectorCount: 4, difficulty: 'normal' });
    const second = createArcadeEncounterDirector({ seed: 'smoke-seed', sectorCount: 4, difficulty: 'normal' });
    const firstSnapshot = first.getSnapshot();
    const secondSnapshot = second.getSnapshot();
    assert(
        JSON.stringify(firstSnapshot.plan.sequence) === JSON.stringify(secondSnapshot.plan.sequence),
        'Encounter sequence should be deterministic for same seed'
    );

    const firstSector = first.peekNextSector();
    assert(firstSector?.sectorNumber === 1, 'First sector number should be 1');
    first.consumeNextSector({ outcome: 'cleared' });
    const afterConsume = first.getSnapshot();
    assert(afterConsume.cursor === 1, `Expected cursor=1, got ${afterConsume.cursor}`);
    assert(afterConsume.completed.length === 1, `Expected completed length=1, got ${afterConsume.completed.length}`);

    return {
        seed: firstSnapshot.plan.seed,
        sectorCount: firstSnapshot.plan.sectorCount,
        firstSector: firstSector?.templateId || '',
        remainingAfterConsume: afterConsume.remaining,
    };
}

function runMasteryAndBlueprintCase() {
    const baseMastery = createAirframeMasteryState('ship5', { airframeXp: 0 });
    const upgradedMastery = awardAirframeXp(baseMastery, 1600);
    assert(upgradedMastery.airframeLevel > baseMastery.airframeLevel, 'Airframe level should increase after XP');

    const blueprint = createArcadeBlueprintFromVehicleConfig({
        id: 'smoke_runner',
        label: 'Smoke Runner',
        parts: [
            { name: 'Core Body', geo: 'box', size: [1.2, 0.9, 2.4], pos: [0, 0, 0] },
            { name: 'Nose Cone', geo: 'cone', size: [0.35, 1.0], pos: [0, 0, -1.7] },
            { name: 'L-Wing', geo: 'box', size: [1.5, 0.1, 0.8], pos: [-1.2, 0, 0.2] },
            { name: 'R-Wing', geo: 'box', size: [1.5, 0.1, 0.8], pos: [1.2, 0, 0.2] },
            { name: 'L-Engine', geo: 'engine', size: [0.18, 0.16, 0.45], pos: [-1.0, 0, 1.0] },
            { name: 'R-Engine', geo: 'engine', size: [0.18, 0.16, 0.45], pos: [1.0, 0, 1.0] },
            { name: 'Utility Sensor', geo: 'sphere', size: [0.22], pos: [0, 0.2, -0.6] },
        ],
    }, {
        hitboxClass: 'compact',
        editorBudget: 120,
        massBudget: 110,
        powerBudget: 120,
        heatBudget: 110,
    });
    const validation = validateArcadeBlueprint(blueprint);
    assert(validation.ok === true, `Blueprint validation failed: ${validation.errors.join(', ')}`);

    return {
        mastery: {
            baseLevel: baseMastery.airframeLevel,
            upgradedLevel: upgradedMastery.airframeLevel,
            unlockedFamilies: upgradedMastery.unlockedPartFamilies.length,
        },
        blueprint: {
            id: blueprint.blueprintId,
            partCount: blueprint.stats.partCount,
            budgetUsed: blueprint.stats.budgetUsed,
            validationOk: validation.ok,
        },
    };
}

function main() {
    const summary = {
        runtimeFlow: runArcadeRuntimeFlowCase(),
        encounterDirector: runEncounterDirectorCase(),
        masteryAndBlueprint: runMasteryAndBlueprintCase(),
    };
    console.log(JSON.stringify({ ok: true, summary }, null, 2));
}

try {
    main();
} catch (error) {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
}
