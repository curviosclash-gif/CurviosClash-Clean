import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapHazardVisualController } from '../src/entities/arena/MapHazardVisualController.js';
import { MapHazardSystem } from '../src/entities/systems/MapHazardSystem.js';
import {
    MAP_HAZARD_LIMITS,
    isMapHazardActive,
    normalizeMapHazards,
} from '../src/shared/contracts/MapHazardContract.js';

const HAZARD = Object.freeze({
    id: 'test_fire',
    position: Object.freeze([0, 0, 0]),
    radius: 4,
    cycleSeconds: 10,
    telegraphSeconds: 2,
    activeSeconds: 1,
    phaseOffsetSeconds: 0,
    damage: 25,
});

test('map hazards are bounded, immutable and have deterministic phases', () => {
    const normalized = normalizeMapHazards(Array.from({ length: 20 }, (_, index) => ({
        ...HAZARD,
        id: `hazard_${index}`,
        radius: 1000,
        damage: 1000,
    })));
    assert.equal(normalized.length, MAP_HAZARD_LIMITS.maxHazards);
    assert.equal(normalized[0].radius, 40);
    assert.equal(normalized[0].damage, 100);
    assert.equal(Object.isFrozen(normalized), true);
    assert.equal(Object.isFrozen(normalized[0]), true);
    assert.equal(isMapHazardActive(HAZARD, 1.99), false);
    assert.equal(isMapHazardActive(HAZARD, 2), true);
    assert.equal(isMapHazardActive(HAZARD, 2.99), true);
    assert.equal(isMapHazardActive(HAZARD, 3), false);
    assert.equal(isMapHazardActive(HAZARD, 12.5), true);
});

test('hazard visuals telegraph, activate from absolute time and dispose idempotently', () => {
    const added = [];
    const removed = [];
    const controller = new MapHazardVisualController({
        addToScene: (object) => added.push(object),
        removeFromScene: (object) => removed.push(object),
    });
    const group = controller.build({ scaleAuthoredAnchors: true, mapHazards: [HAZARD] }, 3);
    const visual = controller.visuals[0];
    assert.equal(group.name, 'map-hazard-visuals');
    assert.equal(added.length, 1);
    assert.deepEqual(visual.mesh.position.toArray(), [0, 0, 0]);
    assert.equal(visual.mesh.scale.x, 12 * 0.92);

    controller.update(2.4);
    assert.equal(visual.mesh.visible, true);
    assert.equal(visual.material.color.getHex(), visual.hazard.activeColor);
    const activeOpacity = visual.material.opacity;
    controller.update(7);
    assert.equal(visual.mesh.visible, false);
    controller.update(2.4);
    assert.equal(visual.material.opacity, activeOpacity, 'absolute time restores the same pose');

    controller.dispose();
    controller.dispose();
    assert.deepEqual(removed, [group]);
});

test('hazards use swept collision and apply at most one hit per activation', () => {
    const damage = [];
    const manager = {
        arena: { currentMapDefinition: { mapHazards: [HAZARD] } },
        entityRuntimeConfig: { ARENA: { MAP_SCALE: 1 } },
        gameModeStrategy: { modeType: 'ARCADE' },
        _applyModeDamage(player, amount, cause) { damage.push({ player, amount, cause }); },
    };
    const system = new MapHazardSystem(manager);
    assert.equal(system.startRound(), 1);
    const player = {
        index: 0,
        alive: true,
        spawnProtectionTimer: 0,
        hitboxRadius: 1,
        position: new THREE.Vector3(20, 0, 0),
    };
    const previous = new THREE.Vector3(-20, 0, 0);

    assert.equal(system.updatePlayer(player, previous, 2.4), true);
    assert.equal(system.updatePlayer(player, previous, 2.6), false);
    assert.equal(damage.length, 1);
    assert.deepEqual(damage[0], { player, amount: 25, cause: 'FIRE_HAZARD' });
    assert.equal(system.updatePlayer(player, previous, 12.4), true);
    assert.equal(damage.length, 2);

    system.setNetworkReplica(true);
    assert.equal(system.updatePlayer(player, previous, 22.4), false);
    assert.equal(damage.length, 2, 'replicas only display host-authoritative hazard damage');
});

test('spawn protection blocks hazards and a classic shield absorbs one burst', () => {
    let damageCalls = 0;
    const audioEvents = [];
    const manager = {
        arena: { currentMapDefinition: { mapHazards: [HAZARD] } },
        entityRuntimeConfig: { ARENA: { MAP_SCALE: 1 } },
        gameModeStrategy: { modeType: 'CLASSIC' },
        audio: { play: (id) => audioEvents.push(id) },
        particles: { spawnHit() {} },
        _applyModeDamage() { damageCalls += 1; },
    };
    const system = new MapHazardSystem(manager);
    system.startRound();
    const player = {
        index: 3,
        alive: true,
        spawnProtectionTimer: 1,
        hitboxRadius: 1,
        hasShield: true,
        shieldHP: 1,
        position: new THREE.Vector3(0, 0, 0),
    };
    const previous = player.position.clone();
    assert.equal(system.updatePlayer(player, previous, 2.2), false);
    player.spawnProtectionTimer = 0;
    assert.equal(system.updatePlayer(player, previous, 2.2), true);
    assert.equal(player.hasShield, false);
    assert.equal(player.shieldHP, 0);
    assert.equal(damageCalls, 0);
    assert.deepEqual(audioEvents, ['SHIELD_HIT']);
});
