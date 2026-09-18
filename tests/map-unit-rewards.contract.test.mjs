import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { pickMapUnitLoot, rewardMapUnitDestruction } from '../src/entities/systems/map-units/MapUnitRewardOps.js';
import { HuntScoring } from '../src/hunt/HuntScoring.js';
import { XP_REWARD_TABLE, calculateSectorXp } from '../src/state/arcade/ArcadeXpRewards.js';
import { createMatchRuntimeProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';

const LOOT = { ROCKET_MEDIUM: 0.6, ROCKET_HEAVY: 0.3, ROCKET_MEGA: 0.1 };

test('the loot table draws by relative chance and falls back to the most likely rocket', () => {
    assert.equal(pickMapUnitLoot(LOOT, 0), 'ROCKET_MEDIUM');
    assert.equal(pickMapUnitLoot(LOOT, 0.59), 'ROCKET_MEDIUM');
    assert.equal(pickMapUnitLoot(LOOT, 0.61), 'ROCKET_HEAVY');
    assert.equal(pickMapUnitLoot(LOOT, 0.95), 'ROCKET_MEGA');
    assert.equal(pickMapUnitLoot(LOOT, 1), 'ROCKET_MEGA', 'a roll of 1 stays inside the table');
    assert.equal(pickMapUnitLoot(LOOT, null), 'ROCKET_MEDIUM', 'no seeded roll, no surprise');
    assert.equal(pickMapUnitLoot({ ROCKET_WEAK: 2, ROCKET_HEAVY: 2 }, 0.6), 'ROCKET_HEAVY', 'chances are relative');
    assert.equal(pickMapUnitLoot({}, 0.3), '');
});

function createTank() {
    return {
        id: 'tank_a',
        deaths: 1,
        definition: { loot: LOOT },
        position: new THREE.Vector3(10, 2.1, 20),
        groundPosition: new THREE.Vector3(10, 0, 20),
    };
}

test('a destroyed tank drops one rocket where it stood and credits its destroyer', () => {
    const spawned = [];
    const credited = [];
    const feedback = [];
    const system = {
        entityManager: {
            gameModeStrategy: { runtimeRng: { next: () => 0.7 } },
            powerupManager: { spawnAtAnchor: (anchor) => { spawned.push(anchor); return {}; } },
            _huntScoring: { registerUnitDestroyed: (index) => credited.push(index) },
            _notifyPlayerFeedback: (player, text) => feedback.push({ player, text }),
        },
    };
    const human = { index: 0, isBot: false };
    rewardMapUnitDestruction(system, createTank(), human);
    assert.deepEqual(spawned, [{ type: 'ROCKET_HEAVY', x: 10, y: 2.1, z: 20, ownerId: 'map-unit:tank_a:1' }]);
    assert.deepEqual(credited, [0]);
    assert.deepEqual(feedback, [{ player: human, text: 'Panzer zerstört' }]);

    rewardMapUnitDestruction(system, createTank(), { index: 2, isBot: true });
    assert.deepEqual(credited, [0, 2], 'bots are counted too');
    assert.equal(feedback.length, 1, 'but only humans get the message');

    rewardMapUnitDestruction(system, createTank(), null);
    assert.equal(spawned.length, 3, 'loot drops even when nobody gets the credit');
    assert.deepEqual(credited, [0, 2]);
});

test('destroyed tanks ride the scoreboard rows but are never kills', () => {
    const scoring = new HuntScoring(() => 0);
    scoring.registerUnitDestroyed(1);
    scoring.registerUnitDestroyed(1);
    scoring.registerUnitDestroyed(-1);
    const rows = scoring.getScoreboard([{ index: 0 }, { index: 1 }]);
    const row = rows.find((entry) => entry.playerIndex === 1);
    assert.equal(row.unitsDestroyed, 2);
    assert.equal(row.kills, 0);
    assert.equal(rows[0].playerIndex, 0, 'tanks do not change the ranking');

    const copy = new HuntScoring(() => 0);
    copy.applyScoreboard(rows);
    assert.equal(copy.getScoreboard([{ index: 1 }])[0].unitsDestroyed, 2, 'a client keeps the host count');
    copy.applyScoreboard([{ playerIndex: 0, kills: 1 }]);
    assert.equal(copy.getScoreboard([{ index: 0 }])[0].unitsDestroyed, 0, 'an older host snapshot reads as 0');
});

test('the runtime projection carries the count and arcade pays 30 xp per tank', () => {
    const projection = createMatchRuntimeProjection({
        hunt: { scoreboardRows: [{ playerIndex: 0, unitsDestroyed: 3 }, { playerIndex: 1, unitsDestroyed: -2 }] },
    });
    assert.deepEqual(projection.hunt.scoreboardRows.map((row) => row.unitsDestroyed), [3, 0]);

    assert.equal(XP_REWARD_TABLE.unitDestroyedBase, 30);
    const base = calculateSectorXp({ kills: 0 });
    assert.equal(calculateSectorXp({ kills: 0, unitsDestroyed: 2 }) - base, 60);
    assert.equal(calculateSectorXp({ kills: 0, unitsDestroyed: 'x' }), base, 'old telemetry without the field pays as before');
});
