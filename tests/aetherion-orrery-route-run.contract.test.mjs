import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { AETHERION_ORRERY_MAP } from '../src/core/config/maps/presets/aetherion_orrery.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';

const map = AETHERION_ORRERY_MAP.aetherion_orrery;
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
        position: { x: map.playerSpawn.x * SCALE, y: map.playerSpawn.y * SCALE, z: map.playerSpawn.z * SCALE },
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

test('both authored Aetherion lane choices complete all twelve stages', () => {
    for (const branchChoice of [0, 1]) {
        const { system, player } = harness();
        const route = system.getRouteSnapshot();
        const stages = new Map();
        for (const checkpoint of route.checkpoints) {
            const entries = stages.get(checkpoint.routeIndex) || [];
            entries.push(checkpoint);
            stages.set(checkpoint.routeIndex, entries);
        }
        assert.equal(route.totalCheckpoints, 12);
        let now = 1000;
        const ids = [];
        for (const entries of [...stages.values()].sort((a, b) => a[0].routeIndex - b[0].routeIndex)) {
            const result = cross(system, player, entries[Math.min(branchChoice, entries.length - 1)], now);
            ids.push(result?.checkpointId || '');
            now += 500;
        }
        const finish = cross(system, player, route.finish, now);
        const hud = system.getPlayerHudState(0, now);
        assert.ok(ids.every(Boolean), `lane ${branchChoice} validates ${JSON.stringify(ids)}`);
        assert.equal(finish?.type, 'finish');
        assert.equal(hud.completed, true);
        assert.equal(hud.currentCheckpoint, 12);
        assert.equal(hud.wrongOrderCount, 0);
    }
});
