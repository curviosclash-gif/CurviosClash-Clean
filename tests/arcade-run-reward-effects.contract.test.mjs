import assert from 'node:assert/strict';
import test from 'node:test';

import {
    deriveArcadeRunRewardEffects,
} from '../src/shared/contracts/ArcadeRunRewardEffectsContract.js';
import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { ArcadeRunRuntime } from '../src/core/arcade/ArcadeRunRuntime.js';
import { ARCADE_RUN_PHASES } from '../src/state/arcade/ArcadeRunState.js';

function rewardHistory(rewardId, count) {
    return Array.from({ length: count }, () => ({ rewardId }));
}

function selectRewardForNextSector(runtime, rewardId) {
    runtime._state.phase = ARCADE_RUN_PHASES.INTERMISSION;
    runtime._state.intermission = {
        selectedRewardId: rewardId,
        selectedChoiceId: null,
        rewardChoices: [{ id: rewardId }],
        choices: [],
        missionsCompleted: 0,
        missionsTotal: 0,
        nextSectorIndex: runtime._state.sectorIndex + 1,
    };
    runtime.beginNextSector();
}

test('run reward effects stack by reward and stop at their independent caps', () => {
    const threeThrusters = deriveArcadeRunRewardEffects(rewardHistory('run_speed_t1', 3));
    const fiveThrusters = deriveArcadeRunRewardEffects(rewardHistory('run_speed_t1', 5));
    const sixThrusters = deriveArcadeRunRewardEffects(rewardHistory('run_speed_t1', 6));
    const scannerCap = deriveArcadeRunRewardEffects(rewardHistory('run_pickup_t1', 10));

    assert.equal(threeThrusters.speedBonusPct, 12);
    assert.equal(fiveThrusters.speedBonusPct, 20);
    assert.equal(sixThrusters.speedBonusPct, 20);
    assert.equal(scannerCap.spawnRateMultiplier, 1.75);
});

test('run rewards remain separate from hangar caps and affect spawned vehicle stats', () => {
    const strategy = new ArcadeModeStrategy({ random: () => 0.5 });
    strategy.applyVehicleUpgrades({ speedBonusPct: 50, turningBonusPct: 0, maxHpBonus: 50 });
    strategy.applyRunRewardEffects(deriveArcadeRunRewardEffects([
        ...rewardHistory('run_speed_t1', 2),
        ...rewardHistory('run_armor_t1', 2),
    ]));
    const player = { hasShield: false, baseSpeed: 18, speed: 18 };

    strategy.resetPlayerHealth(player);
    strategy.applySpawnStatBonuses(player);

    assert.equal(strategy.getSpeedMultiplier(), 1.5 * 1.08);
    assert.equal(player.baseSpeed, 18 * 1.5 * 1.08);
    assert.equal(player.maxHp, 174);
});

test('runtime applies accumulated rewards to the next sector and clears them on reset', () => {
    const strategy = new ArcadeModeStrategy({ random: () => 0.5 });
    const runtime = new ArcadeRunRuntime({ now: () => 1000, strategy });
    runtime._enabled = true;
    runtime.startRun({ strategy });

    selectRewardForNextSector(runtime, 'run_speed_t1');
    selectRewardForNextSector(runtime, 'run_speed_t1');
    selectRewardForNextSector(runtime, 'run_combo_t1');
    selectRewardForNextSector(runtime, 'run_pickup_t1');
    const rewardedPlayer = { hasShield: false, baseSpeed: 18, speed: 18 };
    strategy.resetPlayerHealth(rewardedPlayer);
    strategy.applySpawnStatBonuses(rewardedPlayer);

    assert.equal(strategy.getSpeedMultiplier(), 1.08);
    assert.equal(rewardedPlayer.baseSpeed, 19.44);
    assert.equal(strategy.getSpawnRateMultiplier(), 1.15);
    assert.equal(runtime._state.config.comboWindowMs, 5800);
    assert.equal(runtime._state.rewardHistory.length, 4);

    runtime.resetRunState();

    assert.equal(strategy.getSpeedMultiplier(), 1);
    assert.equal(strategy.getSpawnRateMultiplier(), 1);
});

test('portal rewards cumulatively strengthen shield conversion', () => {
    const strategy = new ArcadeModeStrategy();
    strategy.applyRunRewardEffects(deriveArcadeRunRewardEffects(rewardHistory('run_portal_t1', 2)));
    const player = {
        alive: true,
        hp: 100,
        maxHp: 100,
        shieldHP: 0,
        maxShieldHp: 40,
    };

    const result = strategy.applyIntermissionHealing(player, {});

    assert.equal(result.requestedHeal, 12);
    assert.equal(result.shieldGranted, 9);
});
