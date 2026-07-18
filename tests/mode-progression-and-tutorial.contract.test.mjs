import assert from 'node:assert/strict';
import test from 'node:test';

import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { CONFIG } from '../src/core/Config.js';
import { PARCOURS_MAPS } from '../src/core/config/maps/presets/parcours_maps.js';
import { resolveArenaMapSelection } from '../src/entities/CustomMapLoader.js';
import { HuntModeStrategy } from '../src/modes/HuntModeStrategy.js';
import {
    evaluateFightHangarParts,
    resolveFightPartTradeoff,
} from '../src/shared/contracts/FightHangarBalanceContract.js';
import {
    CLASSIC_TUTORIAL_CONTRACT_VERSION,
    CLASSIC_TUTORIAL_HINTS,
    CLASSIC_TUTORIAL_ROUTE_ID,
    createCompletedClassicTutorialState,
    isClassicTutorialRoute,
    resolveClassicTutorialHint,
} from '../src/shared/contracts/ClassicTutorialContract.js';
import { resolveMapSinglePlayerScenario } from '../src/shared/contracts/MapSinglePlayerScenarioContract.js';
import { createArcadeVehicleProfile, addXp } from '../src/state/arcade/ArcadeVehicleProfile.js';
import { createDefaultHangarBuild } from '../src/ui/hangar/HangarBuildDraftState.js';
import { validateFightHangarBuild } from '../src/ui/hangar/FightHangarValidation.js';

test('Fight parts exchange every improvement for an equally weighted disadvantage', () => {
    for (const colorId of ['blue', 'green', 'gold', 'cyan', 'violet']) {
        const tradeoff = resolveFightPartTradeoff({ colorId, tier: 'T3' });
        assert.equal(tradeoff.balanceScore, 0);
        assert.ok(Object.values(tradeoff).some((value) => Number(value) > 0));
        assert.ok(Object.values(tradeoff).some((value) => Number(value) < 0));
    }
    const result = evaluateFightHangarParts([
        { colorId: 'blue', tier: 'T3' },
        { colorId: 'gold', tier: 'T2' },
        { colorId: 'green', tier: 'T2' },
    ]);
    assert.equal(result.ok, true);
    assert.equal(result.balanceScore, 0);
});

test('Fight hangar accepts neutral sidegrades and keeps the build in the fight data space', () => {
    const build = createDefaultHangarBuild('ship5', { mode: 'fight', nowMs: 10 });
    build.slots.nose = 'stone_blue_t2';
    const validation = validateFightHangarBuild(build);
    assert.equal(validation.ok, true);
    assert.equal(validation.build.mode, 'fight');
    assert.equal(validation.balanceScore, 0);
    assert.ok(validation.bonuses.speedBonusPct > 0);
    assert.ok(validation.bonuses.turningBonusPct < 0);
});

test('Fight loadouts are projected only for Fight and cannot leak into Classic or Arcade', () => {
    const settings = {
        gameMode: 'CLASSIC',
        vehicles: { PLAYER_1: 'ship5', PLAYER_2: 'ship5' },
        localSettings: {
            sessionType: 'single',
            modePath: 'normal',
            fightHangar: {
                activeBonusesByVehicle: {
                    ship5: { speedBonusPct: 30, turningBonusPct: -30, maxHpBonus: 60 },
                },
            },
        },
    };
    assert.equal(createRuntimeConfigSnapshot(settings).player.fightLoadouts, null);
    settings.localSettings.modePath = 'arcade';
    assert.equal(createRuntimeConfigSnapshot(settings).player.fightLoadouts, null);
    settings.localSettings.modePath = 'fight';
    const fight = createRuntimeConfigSnapshot(settings);
    assert.deepEqual(fight.player.fightLoadouts.PLAYER_1, {
        speedBonusPct: 30,
        turningBonusPct: -30,
        maxHpBonus: 60,
    });
});

test('Fight spawn bonuses are deterministic across respawns', () => {
    const strategy = new HuntModeStrategy();
    const player = {
        fightLoadout: { speedBonusPct: 10, turningBonusPct: -10, maxHpBonus: 20 },
        baseSpeed: 40,
        speed: 40,
        turnSpeed: 4,
        maxHp: 100,
        hp: 100,
    };
    strategy.applySpawnStatBonuses(player);
    assert.equal(player.baseSpeed, 44);
    assert.equal(player.turnSpeed, 3.6);
    assert.equal(player.maxHp, 120);
    player.maxHp = 100;
    strategy.applySpawnStatBonuses(player);
    assert.equal(player.baseSpeed, 44);
    assert.equal(player.turnSpeed, 3.6);
    assert.equal(player.maxHp, 120);
});

test('Arcade progression remains permanent and scoped per ship', () => {
    const shipA = addXp(createArcadeVehicleProfile('ship1', 10), 500, 20).profile;
    const shipB = createArcadeVehicleProfile('ship2', 10);
    assert.equal(shipA.vehicleId, 'ship1');
    assert.ok(shipA.level > shipB.level);
    assert.equal(shipB.xp, 0);
});

test('Classic tutorial is a bot-free Classic parcours with versioned completion', () => {
    const map = PARCOURS_MAPS.tutorial_classic;
    const scenario = resolveMapSinglePlayerScenario(map);
    assert.equal(map.parcours.routeId, CLASSIC_TUTORIAL_ROUTE_ID);
    assert.equal(scenario.modePath, 'normal');
    assert.equal(scenario.gameMode, 'CLASSIC');
    assert.equal(scenario.botCount, 0);
    assert.equal(isClassicTutorialRoute(map.parcours.routeId), true);
    assert.equal(resolveClassicTutorialHint(0, false), CLASSIC_TUTORIAL_HINTS[0]);
    const completion = createCompletedClassicTutorialState(null, 1234);
    assert.equal(completion.schemaVersion, CLASSIC_TUTORIAL_CONTRACT_VERSION);
    assert.equal(completion.completed, true);
    assert.equal(completion.completedAtMs, 1234);
    assert.equal(CONFIG.MAPS.tutorial_classic, map);
    assert.equal(resolveArenaMapSelection('tutorial_classic').effectiveMapKey, 'tutorial_classic');
    assert.equal(map.hiddenFromMapPicker, true);
    assert.equal(map.scaleAuthoredAnchors, true);
});
