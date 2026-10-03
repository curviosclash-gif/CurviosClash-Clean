// Playtest 02.10.2026: after the last ring the progress still named that ring as the next goal, and
// flying through it again on the way to the finish counted as "Falsche Reihenfolge" (with its time
// penalty where the route has one). Once every ring is passed only the finish is left.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { NEON_CARNIVAL_MAP } from '../src/core/config/maps/presets/neon_carnival.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';

function cross(system, player, entry, nowMs) {
    const length = Math.hypot(...entry.forward) || 1;
    const forward = entry.forward.map((value) => value / length);
    const distance = entry.radius * 0.5;
    const previous = { x: entry.pos[0] - forward[0] * distance, y: entry.pos[1] - forward[1] * distance, z: entry.pos[2] - forward[2] * distance };
    player.position.set(entry.pos[0] + forward[0] * distance, entry.pos[1] + forward[1] * distance, entry.pos[2] + forward[2] * distance);
    return system.updatePlayerProgress(player, previous, nowMs);
}

function createHarness() {
    const map = Object.values(NEON_CARNIVAL_MAP)[0] || NEON_CARNIVAL_MAP;
    const player = { index: 0, isBot: false, alive: true, hitboxRadius: 1.1, position: new THREE.Vector3(), inventory: [] };
    const feedback = [];
    const entityManager = {
        arena: { currentMapDefinition: map },
        activeGameMode: 'ARCADE',
        entityRuntimeConfig: CONFIG_SECTIONS,
        players: [player],
        _simulationClockMs: 0,
        _notifyPlayerFeedback(_player, message) { feedback.push(message); },
        recorder: { logEvent() {} },
    };
    const system = new ParcoursProgressSystem(entityManager);
    system.startRound([player]);
    return { system, player, feedback };
}

test('after the last ring the finish is the expected goal and re-crossing a ring is no wrong order', () => {
    const { system, player, feedback } = createHarness();
    const route = system._route;
    assert.ok(route && route.finish, 'the map has a parcours with a finish');
    let now = 1000;
    for (let i = 0; i < route.totalCheckpoints; i += 1) {
        const snapshot = system.getPlayerProgressSnapshot(0, now);
        const entry = route.checkpoints.find((candidate) => candidate.id === snapshot.expectedCheckpointIds[0]);
        const result = cross(system, player, entry, now);
        assert.equal(result?.type, 'checkpoint', `${entry.id} counts`);
        now += 2000;
    }
    const afterLast = system.getPlayerProgressSnapshot(0, now);
    assert.equal(afterLast.completed, false);
    assert.deepEqual(afterLast.expectedCheckpointIds, [route.finish.id], 'the finish is next, not the last ring');

    const lastRing = route.checkpoints.find((entry) => entry.id === afterLast.passedCheckpointIds.at(-1));
    const again = cross(system, player, lastRing, now + 500);
    assert.notEqual(again?.type, 'wrong-order', 're-crossing a passed ring on the way to the finish is harmless');
    const state = system.getPlayerProgressSnapshot(0, now + 600);
    assert.equal(state.wrongOrderCount, 0);
    assert.equal(state.penaltyTimeMs, 0);
    assert.equal(feedback.some((message) => /Falsche Reihenfolge/.test(message)), false);

    const finish = cross(system, player, route.finish, now + 3000);
    assert.equal(finish?.type, 'finish');
    assert.equal(system.getPlayerProgressSnapshot(0, now + 3100).completed, true);
});
