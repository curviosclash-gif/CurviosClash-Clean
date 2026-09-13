import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { NOTRE_DAME_FIRE_MAPS } from '../src/core/config/maps/presets/notre_dame_fire/index.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';

const map = NOTRE_DAME_FIRE_MAPS.notre_dame_fire;
const SCALE = CONFIG_SECTIONS.ARENA.MAP_SCALE;

function harness() {
    const entityManager = {
        arena: { currentMapDefinition: map },
        entityRuntimeConfig: CONFIG_SECTIONS,
        _simulationClockMs: 0,
    };
    const system = new ParcoursProgressSystem(entityManager);
    const player = {
        index: 0,
        alive: true,
        isBot: false,
        hitboxRadius: 1.1,
        position: {
            x: map.playerSpawn.x * SCALE,
            y: map.playerSpawn.y * SCALE,
            z: map.playerSpawn.z * SCALE,
        },
    };
    system.startRound([player]);
    system.onPlayerSpawn(player, { reason: 'round_start' });
    return { system, player };
}

function cross(system, player, entry, now) {
    const length = Math.hypot(...entry.forward) || 1;
    const unit = entry.forward.map((value) => value / length);
    const previous = {
        x: entry.pos[0] - unit[0] * entry.radius * 0.5,
        y: entry.pos[1] - unit[1] * entry.radius * 0.5,
        z: entry.pos[2] - unit[2] * entry.radius * 0.5,
    };
    player.position = {
        x: entry.pos[0] + unit[0] * entry.radius * 0.5,
        y: entry.pos[1] + unit[1] * entry.radius * 0.5,
        z: entry.pos[2] + unit[2] * entry.radius * 0.5,
    };
    return system.updatePlayerProgress(player, previous, now);
}

test('all four fire-route choices complete fourteen stages and persist for two checkpoints', () => {
    for (let choices = 0; choices < 4; choices += 1) {
        const { system, player } = harness();
        const route = system.getRouteSnapshot();
        assert.equal(route.totalCheckpoints, 14);
        let now = 1000;
        let branchIndex = 0;
        const crossed = [];

        while (system.getPlayerProgressSnapshot(0, now).nextCheckpointIndex < route.totalCheckpoints) {
            const progress = system.getPlayerProgressSnapshot(0, now);
            const expected = progress.expectedCheckpointIds;
            assert.ok(expected.length > 0);
            const choice = expected.length > 1 ? ((choices >> branchIndex++) & 1) : 0;
            const checkpoint = route.checkpoints.find((entry) => entry.id === expected[choice]);
            assert.ok(checkpoint);
            assert.equal(cross(system, player, checkpoint, now)?.type, 'checkpoint');
            crossed.push(checkpoint.id);
            now += 500;
        }

        const finish = cross(system, player, route.finish, now);
        assert.equal(finish?.type, 'finish');
        assert.equal(system.getPlayerHudState(0, now).completed, true);
        assert.equal(system.getPlayerHudState(0, now).wrongOrderCount, 0);
        assert.equal(crossed.includes('FCP05_ROOF'), crossed.includes('FCP06_ROOF'));
        assert.equal(crossed.includes('FCP05_AISLE'), crossed.includes('FCP06_AISLE'));
        assert.equal(crossed.includes('FCP09_BREACH'), crossed.includes('FCP10_BREACH'));
        assert.equal(crossed.includes('FCP09_TRANSEPT'), crossed.includes('FCP10_TRANSEPT'));
    }
});

test('a chosen fire branch cannot switch lanes before its merge', () => {
    const { system, player } = harness();
    const route = system.getRouteSnapshot();
    let now = 1000;
    for (const id of ['FCP01', 'FCP02', 'FCP03', 'FCP04', 'FCP05_ROOF']) {
        const checkpoint = route.checkpoints.find((entry) => entry.id === id);
        assert.equal(cross(system, player, checkpoint, now)?.type, 'checkpoint');
        now += 800;
    }

    const progress = system.getPlayerProgressSnapshot(0, now);
    assert.deepEqual(progress.expectedCheckpointIds, ['FCP06_ROOF']);
    const laneSwitch = route.checkpoints.find((entry) => entry.id === 'FCP06_AISLE');
    assert.equal(cross(system, player, laneSwitch, now)?.type, 'wrong-order');
});
