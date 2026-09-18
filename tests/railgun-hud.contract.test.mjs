import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { RailgunBeamEffect } from '../src/entities/effects/RailgunBeamEffect.js';
import { RailgunSystem } from '../src/hunt/RailgunSystem.js';
import { applyPlayerPowerup } from '../src/entities/player/PlayerEffectOps.js';
import { createMatchRuntimeProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { resolveActiveEffectTimeLabel } from '../src/ui/ItemBarPresenter.js';

const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};

function createRenderer() {
    const scene = new Set();
    return { scene, addToScene: (object) => scene.add(object), removeFromScene: (object) => scene.delete(object) };
}

test('a beam rod spans the shot and fades within a third of a second', () => {
    const renderer = createRenderer();
    const effect = new RailgunBeamEffect(renderer);
    assert.equal(renderer.scene.size, 4, 'a pool of four rods');
    effect.show([0, 10, 0], [0, 10, -100]);
    const rod = [...renderer.scene].find((mesh) => mesh.visible);
    assert.deepEqual(rod.position.toArray(), [0, 10, -50]);
    assert.equal(rod.scale.z, 100);
    effect.update(0.2);
    assert.ok(rod.material.opacity > 0 && rod.material.opacity < 1);
    effect.update(0.2);
    assert.equal(rod.visible, false);
    effect.dispose();
    assert.equal(renderer.scene.size, 0);
});

test('a shot draws the rod and plays the sound', () => {
    const renderer = createRenderer();
    const sounds = [];
    const shooter = {
        index: 0, alive: true, position: new THREE.Vector3(0, 10, 0), entityRuntimeConfig: HUNT_MODE_CONFIG,
        activeEffects: [], inventory: [], rocketInventory: [], getAimDirection: (out) => out.set(0, 0, -1),
    };
    const manager = {
        players: [shooter], isFightOutcomeAuthority: true, entityRuntimeConfig: HUNT_MODE_CONFIG, renderer,
        audio: { play: (key) => sounds.push(key) },
    };
    shooter.entityManager = manager;
    applyPlayerPowerup(shooter, 'RAILGUN');
    const system = new RailgunSystem(manager);
    system.fire(shooter, 1.5, true);
    system.fire(shooter, 0.016, false);
    assert.equal([...renderer.scene].filter((mesh) => mesh.visible).length, 1);
    assert.deepEqual(sounds, ['SLINGSHOT']);
    system.update(1);
    assert.equal([...renderer.scene].filter((mesh) => mesh.visible).length, 0);
});

test('the item bar shows the shots and, while charging, the charge', () => {
    const projection = createMatchRuntimeProjection({
        players: [{ index: 0, railCharge: 0.75, activeEffects: [{ type: 'RAILGUN', remaining: 20, shots: 4 }] }],
    });
    const player = projection.players[0];
    assert.equal(player.railCharge, 0.75);
    assert.equal(player.activeEffects[0].shots, 4);
    assert.equal(resolveActiveEffectTimeLabel(player.activeEffects[0], player), '4 Schuss · 50 %');
    assert.equal(resolveActiveEffectTimeLabel(player.activeEffects[0], { railCharge: 0 }), '4 Schuss');
});
