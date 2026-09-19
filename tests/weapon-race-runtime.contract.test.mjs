import assert from 'node:assert/strict';
import test from 'node:test';

import { ArcadeModeStrategy } from '../src/modes/ArcadeModeStrategy.js';
import { resolveArcadeParcoursRespawnFallback } from '../src/modes/ArcadeRunRulesOps.js';
import { WEAPON_RACE_GHOST_ROUTE_ID, WEAPON_RACE_WEAPON_STAGES } from '../src/shared/contracts/WeaponRaceContract.js';
import { createPlayerProgressState } from '../src/entities/systems/ParcoursProgressUtils.js';
import { applyParcoursDeathRespawn } from '../src/entities/systems/ParcoursRespawnOps.js';
import {
    applyWeaponRaceStage,
    clearWeaponRaceLoadout,
} from '../src/entities/arcade/WeaponRaceLoadoutOps.js';
import { createWeaponRaceRoute } from '../src/entities/arcade/WeaponRaceRouteOps.js';
import { resolveWeaponRaceGridSpawn } from '../src/entities/arcade/WeaponRaceSpawnOps.js';
import { WeaponRaceRuntime } from '../src/core/arcade/WeaponRaceRuntime.js';

function player(index, isBot = false) {
    return {
        index,
        isBot,
        inventory: ['SHIELD', 'LIGHTNING'],
        rocketInventory: ['ROCKET_GUIDED'],
        activeEffects: [
            { type: 'FLAMETHROWER', remaining: 20, fuelSeconds: 1 },
            { type: 'RAILGUN', remaining: 20, shots: 1 },
            { type: 'SPEED_UP', remaining: 4 },
        ],
        applyPowerup(type) {
            this.activeEffects.push({ type, remaining: 30 });
        },
    };
}

test('W7.5 every fixed checkpoint grants a fresh exclusive race weapon to humans and bots', () => {
    for (const isBot of [false, true]) {
        const racer = player(isBot ? 1 : 0, isBot);
        for (const stage of WEAPON_RACE_WEAPON_STAGES) {
            const result = applyWeaponRaceStage(racer, stage);
            assert.equal(result.applied, true);
            assert.equal(racer.weaponRaceWeaponId, stage.weaponId);
            assert.equal(racer.rocketInventory.length, stage.weaponId === 'rocket_medium' ? 3 : 0);
            assert.equal(racer.inventory.includes('LIGHTNING'), stage.weaponId === 'lightning');
            assert.ok(!racer.rocketInventory.includes('ROCKET_GUIDED'));
        }
        clearWeaponRaceLoadout(racer);
        assert.equal(racer.weaponRaceWeaponId, '');
        assert.deepEqual(racer.rocketInventory, []);
        assert.deepEqual(racer.inventory, ['SHIELD']);
        assert.deepEqual(racer.activeEffects, [{ type: 'SPEED_UP', remaining: 4 }]);
    }
});

test('W7.5 weapon race route keeps the assault map but separates its ghost and race rules', () => {
    const original = {
        routeId: 'assault_mg_rockets_v2',
        rules: { ordered: true, showGhost: false, wrongOrderPenaltyMs: 2000 },
        checkpoints: [{ id: 'CP01_START' }],
    };
    const route = createWeaponRaceRoute(original);

    assert.equal(route.routeId, WEAPON_RACE_GHOST_ROUTE_ID);
    assert.equal(route.rules.showGhost, true);
    assert.equal(route.rules.finishGraceMs, 15_000);
    assert.equal(route.rules.wrongOrderPenaltyMs, 0);
    assert.notEqual(route, original);
    assert.equal(original.routeId, 'assault_mg_rockets_v2');
});

test('W7.5 all five racers start on a fair grid behind the first checkpoint', () => {
    const route = { checkpoints: [{ id: 'CP01_START', routeIndex: 0, pos: [10, 5, 20], forward: [1, 0, 0] }] };
    const makeVector = () => ({ x: 0, y: 0, z: 0, clone: makeVector, set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; } });
    const spawns = Array.from({ length: 5 }, (_, index) => resolveWeaponRaceGridSpawn(route, { position: makeVector() }, index));
    assert.deepEqual(spawns.map((entry) => entry.position.x), [-1, -1, -1, -1, -1]);
    assert.equal(new Set(spawns.map((entry) => entry.position.z)).size, 5);
    assert.ok(spawns.every((entry) => entry.direction.x === 1));
});

test('W7.5 death returns to the last checkpoint after two seconds without exhausting progress', () => {
    const rules = resolveArcadeParcoursRespawnFallback('weapon_race', true);
    const route = {
        rules,
        totalCheckpoints: 5,
        checkpoints: [
            { id: 'CP01_START', pos: [0, 0, 0], forward: [1, 0, 0], radius: 5 },
            { id: 'CP03_MG', pos: [20, 0, 0], forward: [1, 0, 0], radius: 5 },
        ],
        entriesByCheckpointIndex: [[{ id: 'CP01_START', pos: [0, 0, 0], forward: [1, 0, 0], radius: 5 }], [], [{ id: 'CP03_MG', pos: [20, 0, 0], forward: [1, 0, 0], radius: 5 }]],
    };
    const state = createPlayerProgressState(5);
    state.nextCheckpointIndex = 3;
    state.stageCheckpointIds[2] = 'CP03_MG';

    const result = applyParcoursDeathRespawn(route, state, { hitboxRadius: 1 }, { now: 1000 });

    assert.equal(result.plan.checkpointId, 'CP03_MG');
    assert.equal(result.plan.delaySeconds, 2);
    assert.equal(result.plan.restartAtFirstCheckpoint, false);
    assert.equal(state.nextCheckpointIndex, 3);
});

test('W7.5 runtime awards checkpoint XP once, refreshes checkpoint weapons and ranks after grace', () => {
    const human = player(0, false);
    const bot = player(1, true);
    const runtime = new WeaponRaceRuntime({ now: () => 1000 });
    runtime.start({ entityManager: { players: [human, bot], humanPlayers: [human], _projectileSystem: { clearForOwner() {} } } });

    const first = runtime.handleCheckpoint({ playerIndex: 0, checkpointId: 'CP03_MG' });
    const repeat = runtime.handleCheckpoint({ playerIndex: 0, checkpointId: 'CP03_MG' });
    runtime.handleCheckpoint({ playerIndex: 1, checkpointId: 'CP05_ROCKET' });
    runtime.handleDeath({ playerIndex: 0 });

    assert.equal(first.awardedXp, 10);
    assert.equal(repeat.awardedXp, 0);
    assert.equal(human.weaponRaceWeaponId, 'flamethrower');
    assert.equal(bot.weaponRaceWeaponId, 'rocket_medium');
    runtime.handleFinish({ playerIndex: 1, finishedAtMs: 5000 });
    runtime.handleFinish({ playerIndex: 0, finishedAtMs: 6000 });
    assert.equal(runtime.handleNewBest(0).awardedXp, 40);
    assert.equal(runtime.handleNewBest(0).awardedXp, 0);
    assert.equal(runtime.getRoundOutcome(19_999), null);
    const outcome = runtime.getRoundOutcome(20_000);
    assert.equal(outcome.winner.index, 1);
    assert.deepEqual(outcome.standings.map((row) => row.playerId), ['1', '0']);
});

test('W7.5 checkpoint weapons stay visible as non-consumable scene markers', () => {
    const human = player(0, false);
    let added = null;
    let removed = null;
    const route = {
        checkpoints: WEAPON_RACE_WEAPON_STAGES.map((stage, index) => ({ id: stage.checkpointId, pos: [index * 10, 5, 0] })),
    };
    const entityManager = {
        players: [human], humanPlayers: [human],
        renderer: { addToScene(root) { added = root; }, removeFromScene(root) { removed = root; } },
        _projectileSystem: { clearForOwner() {} },
        _parcoursProgressSystem: { getRouteSnapshot: () => route },
    };
    const runtime = new WeaponRaceRuntime({ now: () => 1000 });
    runtime.start({ entityManager });
    assert.equal(added.children.length, WEAPON_RACE_WEAPON_STAGES.length);
    assert.ok(added.children.every((mesh) => mesh.name.startsWith('weapon-race-pickup:')));
    runtime.dispose();
    assert.equal(removed, added);
});

test('W7.5 Arcade strategy composes Hunt combat for weapon race bots', () => {
    const strategy = new ArcadeModeStrategy({ runType: 'weapon_race', combatProfile: 'hunt' });
    assert.equal(strategy.getCombatProfile(), 'hunt');
    assert.equal(strategy.getParcoursRespawnFallback().respawnDelaySeconds, 2);
    assert.deepEqual(strategy.filterSpawnableTypes(['ROCKET_HEAVY', 'SHIELD', 'SPEED_UP', 'LIGHTNING'], {}), ['SHIELD', 'SPEED_UP']);
});
