import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { StaticTurretSystem } from '../src/entities/systems/StaticTurretSystem.js';
import { createMapUnitAssets, createMapUnitVisual, updateMapUnitVisual } from '../src/entities/systems/map-units/MapUnitVisualOps.js';
import { applyAuthoredMapUnitBody } from '../src/entities/systems/map-units/MapUnitModelCache.js';
import {
    MAP_UNIT_DUST_INTERVAL,
    MAP_UNIT_RECOIL_SECONDS,
    MAP_UNIT_RECOIL_DISTANCE,
} from '../src/entities/systems/map-units/MapUnitMotionFxOps.js';

function createDrivingWorld({ speed = 12, scaleAuthoredAnchors = false } = {}) {
    const puffs = [];
    const scene = new Set();
    const manager = {
        players: [],
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        runtimeConfig: { ARENA: { MAP_SCALE: 3 } },
        arena: {
            currentMapDefinition: {
                scaleAuthoredAnchors,
                mapUnits: [{ id: 'patrol', path: [[0, 0, 0], [0, 0, 4000]], speed, allowedModes: ['HUNT'] }],
            },
        },
        particles: { spawn: (position, ...rest) => puffs.push({ position: position.clone(), rest }) },
        renderer: { addToScene: (object) => scene.add(object), removeFromScene: (object) => scene.delete(object) },
    };
    const system = new MapUnitSystem(manager);
    system.startRound();
    return { system, puffs, manager };
}

function fakeLibrary() {
    const material = new THREE.MeshStandardMaterial();
    const parts = new Map();
    for (const [name, at] of [
        ['tank_hull', [0, 1, 0]], ['tank_track_left', [-2.75, 0.7, 0]], ['tank_track_right', [2.75, 0.7, 0]],
        ['tank_turret', [0, 2.6, 0]], ['tank_barrel', [0, 2.45, 3.1]], ['tank_wreck', [0, 0.8, 0]],
    ]) {
        const geometry = new THREE.BoxGeometry(1, 1, 1);
        geometry.translate(...at);
        parts.set(name, new THREE.Mesh(geometry, material));
    }
    return { parts };
}

test('a driving tank kicks up dust at a steady distance', () => {
    const { system, puffs } = createDrivingWorld();
    // Ten seconds at twelve a second is 120 units of ground covered.
    for (let step = 0; step < 600; step += 1) system.update(1 / 60);
    const expected = Math.floor(120 / MAP_UNIT_DUST_INTERVAL);
    assert.ok(Math.abs(puffs.length - expected) <= 1, `expected about ${expected} puffs, got ${puffs.length}`);
});

test('a standing tank raises no dust', () => {
    const { system, puffs } = createDrivingWorld({ speed: 1 });
    system.units[0].speed = 0;
    for (let step = 0; step < 600; step += 1) system.update(1 / 60);
    assert.equal(puffs.length, 0);
});

test('the dust follows the tank along the ground', () => {
    const { system, puffs } = createDrivingWorld();
    for (let step = 0; step < 600; step += 1) system.update(1 / 60);
    assert.ok(puffs.length > 2);
    assert.ok(puffs[0].position.z < puffs[puffs.length - 1].position.z, 'the trail runs the way the tank drove');
    for (const puff of puffs) {
        assert.ok(Math.abs(puff.position.y) < 1.5, 'dust comes off the ground, not off the turret');
    }
});

test('a scaled map spaces the dust out with everything else', () => {
    const plain = createDrivingWorld();
    const scaled = createDrivingWorld({ speed: 4, scaleAuthoredAnchors: true });
    for (let step = 0; step < 600; step += 1) {
        plain.system.update(1 / 60);
        scaled.system.update(1 / 60);
    }
    assert.equal(scaled.system.units[0].speed, 12, 'authored 4 on a scale 3 map drives at 12');
    assert.ok(scaled.puffs.length * 2 < plain.puffs.length, 'a three times bigger tank leaves fewer, bigger marks');
});

test('firing the gun kicks the barrel back', () => {
    const shots = [];
    const manager = {
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        isFightOutcomeAuthority: true,
        arena: {
            checkCollisionFast: () => false,
            currentMapDefinition: {
                mapUnits: [{ id: 'tank_a', path: [[0, 0, 0], [0, 0, 500]], speed: 1, weapons: { mg: false } }],
            },
        },
        players: [{
            index: 0, alive: true, isBot: false, hp: 100, spawnProtectionTimer: 0,
            position: new THREE.Vector3(0, 2, 20), takeDamage: () => ({ hpApplied: 0, isDead: false }),
        }],
        _projectileSystem: { spawnExternalProjectile: (shot) => { shots.push(shot); return {}; } },
    };
    manager.humanPlayers = manager.players;
    manager._staticTurretSystem = new StaticTurretSystem(manager);
    const system = new MapUnitSystem(manager);
    system.startRound();
    const tank = system.units[0];

    assert.equal(tank.recoilRemaining, 0, 'a cold gun sits still');
    for (let elapsed = 0; elapsed < 6 && shots.length === 0; elapsed += 0.05) system.update(0.05);
    assert.equal(shots.length, 1, 'the rocket went off');
    assert.ok(tank.recoilRemaining > 0, 'and the barrel is thrown back');

    for (let elapsed = 0; elapsed <= MAP_UNIT_RECOIL_SECONDS; elapsed += 0.05) system.update(0.05);
    assert.equal(tank.recoilRemaining, 0, 'the barrel has come all the way forward again');
});

test('the recoil moves the authored barrel and nothing else', () => {
    const scene = new Set();
    const renderer = { addToScene: (object) => scene.add(object), removeFromScene: (object) => scene.delete(object) };
    const root = createMapUnitVisual(renderer, createMapUnitAssets(), 1);
    applyAuthoredMapUnitBody(root, fakeLibrary());
    const barrel = root.userData.headPivot.children.find((child) => child.userData?.mapUnitPart === 'tank_barrel');
    const turret = root.userData.headPivot.children.find((child) => child.userData?.mapUnitPart === 'tank_turret');
    const turretZ = turret.position.z;

    const unit = {
        root, kind: 'tank', yaw: 0, hp: 150, maxHp: 150,
        groundPosition: new THREE.Vector3(), recoilRemaining: MAP_UNIT_RECOIL_SECONDS,
    };
    updateMapUnitVisual(unit);
    assert.ok(barrel.position.z < -MAP_UNIT_RECOIL_DISTANCE * 0.9, `the gun is pushed back, was ${barrel.position.z}`);
    assert.equal(turret.position.z, turretZ, 'the turret does not move with it');

    unit.recoilRemaining = 0;
    updateMapUnitVisual(unit);
    assert.ok(Math.abs(barrel.position.z) < 0.0001, 'and it comes all the way back');
});

test('a tank still on the box model survives a shot', () => {
    const scene = new Set();
    const renderer = { addToScene: (object) => scene.add(object), removeFromScene: (object) => scene.delete(object) };
    const root = createMapUnitVisual(renderer, createMapUnitAssets(), 1);
    const unit = {
        root, kind: 'tank', yaw: 0, hp: 150, maxHp: 150,
        groundPosition: new THREE.Vector3(), recoilRemaining: MAP_UNIT_RECOIL_SECONDS,
    };
    updateMapUnitVisual(unit);
    assert.equal(root.userData.authoredBody, false);
});
