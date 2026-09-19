import test from 'node:test';
import assert from 'node:assert/strict';

import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import {
    applyArcadeComboDecay,
    applyArcadeSectorScore,
} from '../src/state/arcade/ArcadeScoreOps.js';
import {
    beginArcadeSector,
    completeArcadeSector,
    createArcadeRunState,
} from '../src/state/arcade/ArcadeRunState.js';
import {
    createArcadeVehicleProfile,
    getMasteryPerks,
    xpForLevel,
} from '../src/state/arcade/ArcadeVehicleProfile.js';
import {
    createMissionInstance,
    createSectorMissionState,
} from '../src/state/arcade/ArcadeMissionState.js';

function createCompletedSectorState() {
    const state = completeArcadeSector(beginArcadeSector(createArcadeRunState({
        config: { enabled: true, comboWindowMs: 1000, comboDecayPerSecond: 2 },
        nowMs: 0,
        runId: 'arcade-mastery-score-test',
    }), 0), 1000);
    state.encounterSequence = [{ templateId: 'sector_intro' }];
    return state;
}

test('vehicle levels do not raise awarded sector score', () => {
    const payload = { duration: 20, kills: 2, selfCollisions: 0, itemUses: 0, stuckEvents: 0 };
    const plain = applyArcadeSectorScore(createCompletedSectorState(), payload, {
        nowMs: 2000,
        masteryPerks: getMasteryPerks(1),
    });
    const mastered = applyArcadeSectorScore(createCompletedSectorState(), payload, {
        nowMs: 2000,
        masteryPerks: getMasteryPerks(5),
    });

    assert.equal(mastered.score.lastSectorPoints, plain.score.lastSectorPoints);
});

test('vehicle levels do not slow combo decay', () => {
    const score = { combo: 20, multiplier: 8, lastComboAtMs: 1000 };
    const config = { comboWindowMs: 1000, comboDecayPerSecond: 2, maxMultiplier: 8 };
    const plain = applyArcadeComboDecay(score, config, 7000, getMasteryPerks(1));
    const mastered = applyArcadeComboDecay(score, config, 7000, getMasteryPerks(10));

    assert.equal(mastered.combo, plain.combo);
});

test('mission score ignores vehicle level', () => {
    const runtime = new ArcadeRunRuntime({ now: () => 1000 });
    runtime._enabled = true;
    runtime._state = beginArcadeSector(createArcadeRunState({
        config: { enabled: true },
        nowMs: 0,
        runId: 'arcade-mastery-mission-test',
    }), 0);
    runtime._state.masteryPerks = getMasteryPerks(5);
    runtime._missionState = createSectorMissionState([
        createMissionInstance('KILL_COUNT', { target: 1 }),
    ]);

    runtime.applyGameplayEvent({ type: 'kill', count: 1 });

    assert.equal(runtime._state.score.lastMissionBonus, 500);
});

test('parcours level-up keeps passive bonuses disabled', () => {
    const runtime = new ArcadeRunRuntime({ now: () => 1000 });
    const profile = createArcadeVehicleProfile('ship1', 0);
    profile.level = 4;
    profile.xp = xpForLevel(5) - 1;
    runtime._enabled = true;
    runtime._activeVehicleId = 'ship1';
    runtime._vehicleProfiles = { ship1: profile };
    runtime._state = createArcadeRunState({ config: { enabled: true }, nowMs: 0 });
    runtime._state.masteryPerks = getMasteryPerks(4);

    runtime.applyParcoursXpEvent('checkpoint');

    assert.equal(runtime._vehicleProfiles.ship1.level, 5);
    assert.equal(runtime._state.masteryPerks.scoreBonusPct, 0);
});
