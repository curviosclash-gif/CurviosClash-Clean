import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { MapUnitSystem } from '../src/entities/systems/MapUnitSystem.js';
import { MAP_UNIT_WRECK_SECONDS } from '../src/entities/systems/map-units/MapUnitWreckOps.js';

/** A stand-in for the loaded GLB, with the one part a wreck needs. */
function fakeLibrary() {
    const parts = new Map();
    for (const name of ['tank_hull', 'tank_track_left', 'tank_track_right', 'tank_turret', 'tank_barrel', 'tank_wreck']) {
        parts.set(name, new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    }
    return { parts };
}

function createSystem({ withModel = true, respawnSeconds = 0 } = {}) {
    const scene = new Set();
    const owner = {
        players: [],
        _targetableRegistry: { collect: () => [] },
        gameModeStrategy: { modeType: 'HUNT', getPickupModeType: () => 'HUNT' },
        arena: {
            currentMapDefinition: {
                mapUnits: [{ id: 'patrol', path: [[0, 0, 0], [240, 0, 0]], respawnSeconds, allowedModes: ['HUNT'] }],
            },
        },
        renderer: { addToScene: (object) => scene.add(object), removeFromScene: (object) => scene.delete(object) },
    };
    const system = new MapUnitSystem(owner);
    if (withModel) system._modelLibrary = fakeLibrary();
    system.startRound();
    return { system, scene };
}

function wrecksIn(scene) {
    return [...scene].filter((object) => object.userData?.mapUnitWreck === true);
}

test('a destroyed tank leaves a wreck behind instead of vanishing', () => {
    const { system, scene } = createSystem();
    system.update(1);
    const unit = system.units[0];
    const where = unit.groundPosition.clone();

    unit.takeDamage(500, { sourcePlayer: null });

    assert.equal(unit.alive, false);
    assert.equal(system.getTargets().length, 0, 'a wreck is not something you can shoot');
    const wrecks = wrecksIn(scene);
    assert.equal(wrecks.length, 1);
    assert.ok(wrecks[0].position.distanceTo(where) < 0.001, 'it stands where the tank stood');
    assert.equal(wrecks[0].rotation.y, unit.yaw, 'and faces the way the tank faced');
});

test('the wreck burns down and clears the ground again', () => {
    const { system, scene } = createSystem();
    system.units[0].takeDamage(500, { sourcePlayer: null });
    assert.equal(wrecksIn(scene).length, 1);

    for (let step = 0; step < Math.round((MAP_UNIT_WRECK_SECONDS - 0.5) * 60); step += 1) system.update(1 / 60);
    assert.equal(wrecksIn(scene).length, 1, 'it is still there a moment before its time');

    for (let step = 0; step < 60; step += 1) system.update(1 / 60);
    assert.equal(wrecksIn(scene).length, 0, 'and gone afterwards');
});

test('a tank coming back takes its own wreck with it', () => {
    const { system, scene } = createSystem({ respawnSeconds: 2 });
    system.units[0].takeDamage(500, { sourcePlayer: null });
    assert.equal(wrecksIn(scene).length, 1);

    for (let step = 0; step < 150; step += 1) system.update(1 / 60);
    assert.equal(system.units[0].alive, true, 'the tank is back');
    assert.equal(wrecksIn(scene).length, 0, 'so its wreck is gone, even before it burned down');
});

test('without a model there is simply no wreck', () => {
    const { system, scene } = createSystem({ withModel: false });
    system.units[0].takeDamage(500, { sourcePlayer: null });
    assert.equal(wrecksIn(scene).length, 0);
    assert.equal(system.units[0].alive, false, 'the tank still dies properly');
});

test('the end of a round clears the wrecks with everything else', () => {
    const { system, scene } = createSystem();
    system.units[0].takeDamage(500, { sourcePlayer: null });
    assert.equal(wrecksIn(scene).length, 1);
    system.clear();
    assert.equal(scene.size, 0, 'nothing of the tank is left in the scene');
});

test('a new round starts without the wrecks of the last one', () => {
    const { system, scene } = createSystem();
    system.units[0].takeDamage(500, { sourcePlayer: null });
    system.startRound();
    assert.equal(wrecksIn(scene).length, 0);
    assert.equal(system.units[0].alive, true);
});
