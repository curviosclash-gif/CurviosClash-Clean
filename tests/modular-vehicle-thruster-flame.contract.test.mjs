import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';

import { PlayerView } from '../src/entities/player/PlayerView.js';
import { createVehicleMesh } from '../src/entities/vehicle-registry.js';

/**
 * The view as createModel leaves it, without shield, aura and renderer: the flame update in
 * updateVisuals only needs the vehicle inside the player group and the collected flames.
 * The Pfeil is a Vehicle Lab ship whose two flames are named after the part
 * ("L Triebwerksflamme") and carry their own orange colour and size.
 */
function createArrowView(playerState = {}) {
    const player = { index: 0, alive: true, isBoosting: false, waterSubmerged: false, ...playerState };
    const view = new PlayerView(player, null);
    view.group = new THREE.Group();
    view.vehicleMesh = createVehicleMesh('arrow', 0x44aaff);
    view.group.add(view.vehicleMesh);
    view._collectFlames();
    return view;
}

function findPartFlames(mesh) {
    const flames = [];
    mesh.traverse((child) => {
        if (child.userData?.config?.geo === 'flame') flames.push(child);
    });
    return flames;
}

function hueOf(color) {
    const hsl = { h: 0, s: 0, l: 0 };
    color.getHSL(hsl);
    return hsl.h;
}

test('the part flames of a modular ship stretch while boosting and keep their own colour', () => {
    const cruise = createArrowView();
    const boost = createArrowView({ isBoosting: true });
    for (let frame = 0; frame < 3; frame += 1) {
        cruise.updateVisuals(0.016, { emitParticles: false });
        boost.updateVisuals(0.016, { emitParticles: false });
    }
    const cruiseFlames = findPartFlames(cruise.vehicleMesh);
    const boostFlames = findPartFlames(boost.vehicleMesh);
    assert.equal(cruiseFlames.length, 2, 'the Pfeil carries two part flames');

    for (let index = 0; index < cruiseFlames.length; index += 1) {
        const cruiseFlame = cruiseFlames[index];
        const boostFlame = boostFlames[index];
        const authored = new THREE.Color(cruiseFlame.userData.config.color);
        assert.equal(cruiseFlame.material.color.getHex(), authored.getHex(), 'a cruising flame keeps its authored colour');
        assert.deepEqual(cruiseFlame.scale.toArray(), [1, 1, 1], 'a cruising flame keeps its authored size');
        assert.ok(boostFlame.scale.z > cruiseFlame.scale.z * 1.4, `the boost flame grows longer (${boostFlame.scale.z} vs ${cruiseFlame.scale.z})`);
        assert.equal(boostFlame.scale.x, cruiseFlame.scale.x, 'the boost flame keeps the part width');
        assert.ok(Math.abs(hueOf(boostFlame.material.color) - hueOf(authored)) < 0.02, 'the boost flame stays in its own colour family');
        assert.notEqual(boostFlame.material.color.getHex(), authored.getHex(), 'the boost flame burns brighter');
    }
});

test('the part flames of a modular ship go out under water', () => {
    const view = createArrowView({ waterSubmerged: true });
    view.updateVisuals(0.016, { emitParticles: false });
    const flames = findPartFlames(view.vehicleMesh);
    assert.deepEqual(flames.map((flame) => flame.visible), [false, false], 'no flame burns under water');
});
