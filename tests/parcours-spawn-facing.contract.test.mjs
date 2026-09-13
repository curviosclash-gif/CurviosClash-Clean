import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_SECTIONS } from '../src/core/config/ConfigSections.js';
import { PARCOURS_MAPS } from '../src/core/config/maps/presets/parcours_maps.js';
import { EntitySpawnOps } from '../src/entities/runtime/EntitySpawnOps.js';
import { ParcoursProgressSystem } from '../src/entities/systems/ParcoursProgressSystem.js';

/**
 * Stands for EntityManager around a real map. The safe-direction sampler answers -z, which is
 * what the desktop run on 2026-09-09 measured on parcours_rift: the ship spawned 30 units in
 * front of ring 1 and flew off along -z, 90 degrees past it. spawnAll starts the parcours
 * round before it spawns anyone, so the harness does the same.
 */
function createSpawnHarness(mapDefinition = PARCOURS_MAPS.parcours_rift) {
    const spawned = [];
    let spawnPosition = new THREE.Vector3();
    const owner = {
        arena: { currentMapDefinition: mapDefinition },
        activeGameMode: 'ARCADE',
        entityRuntimeConfig: CONFIG_SECTIONS,
        players: [],
        _simulationClockMs: 0,
        _findSpawnPosition: () => spawnPosition.clone(),
        _findSafeSpawnDirection: () => new THREE.Vector3(0, 0, -1),
        recorder: null,
    };
    owner._parcoursProgressSystem = new ParcoursProgressSystem(owner);
    const createPlayer = (isBot) => {
        const player = {
            index: owner.players.length,
            isBot,
            hitboxRadius: 1,
            spawn(position, direction) {
                spawned.push({ isBot, direction: direction ? direction.toArray() : null });
            },
        };
        owner.players.push(player);
        return player;
    };
    const human = createPlayer(false);
    const bot = createPlayer(true);
    owner._parcoursProgressSystem.startRound(owner.players);
    const spawnOps = new EntitySpawnOps(owner);
    const spawnAt = (player, position) => {
        spawnPosition = position;
        spawnOps.spawnPlayer(player, { planarSpawnLevel: null });
        return spawned.at(-1).direction;
    };
    return { bot, human, route: owner._parcoursProgressSystem.getRouteSnapshot(), spawnAt };
}

function firstRing(route) {
    return route.checkpoints.find((entry) => entry.routeIndex === 0);
}

test('a human spawning in front of the first ring faces it instead of the widest free lane', () => {
    const { human, route, spawnAt } = createSpawnHarness();
    const ring = firstRing(route);
    const direction = spawnAt(human, new THREE.Vector3(ring.pos[0] - 30, ring.pos[1], ring.pos[2]));

    assert.ok(direction[0] > 0.99, `the ship faces ring 1 in +x, got ${direction.join(', ')}`);
    assert.ok(Math.abs(direction[1]) < 1e-9, 'the start direction stays level');
});

test('a human spawning past the first ring faces along the route instead of turning back', () => {
    const { human, route, spawnAt } = createSpawnHarness();
    const ring = firstRing(route);
    const direction = spawnAt(human, new THREE.Vector3(ring.pos[0] + 30, ring.pos[1], ring.pos[2]));

    assert.ok(direction[0] > 0.99, `the ship keeps the ring's forward direction, got ${direction.join(', ')}`);
});

test('bots keep the safe spawn direction on a route', () => {
    const { bot, route, spawnAt } = createSpawnHarness();
    const ring = firstRing(route);
    const direction = spawnAt(bot, new THREE.Vector3(ring.pos[0] - 30, ring.pos[1], ring.pos[2]));

    assert.deepEqual(direction, [0, 0, -1], 'bots are not steered by the route');
});

test('a map without a route keeps the safe spawn direction', () => {
    const { human, spawnAt } = createSpawnHarness({ name: 'plain arena' });
    const direction = spawnAt(human, new THREE.Vector3(0, 10, 0));

    assert.deepEqual(direction, [0, 0, -1], 'no route, no steering');
});
