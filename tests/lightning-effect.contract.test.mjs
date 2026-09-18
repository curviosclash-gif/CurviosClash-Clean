import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { CONFIG_BASE } from '../src/core/Config.js';
import { LightningStrikeEffect } from '../src/entities/effects/LightningStrikeEffect.js';
import { LightningStrikeSystem } from '../src/hunt/LightningStrikeSystem.js';

const BOUNDS = { minX: -100, maxX: 100, minY: 0, maxY: 200, minZ: -100, maxZ: 100 };
const HUNT_MODE_CONFIG = {
    ...CONFIG_BASE,
    HUNT: { ...CONFIG_BASE.HUNT, ENABLED: true, ACTIVE_MODE: 'HUNT', DEFAULT_MODE: 'HUNT' },
};

function createRenderer() {
    const scene = new Set();
    return { scene, addToScene: (object) => scene.add(object), removeFromScene: (object) => scene.delete(object) };
}

const visible = (renderer) => [...renderer.scene].filter((line) => line.visible);

test('warning bolts flicker only during the warning, inside the arena, high up', () => {
    const renderer = createRenderer();
    const effect = new LightningStrikeEffect(renderer);
    assert.equal(renderer.scene.size, 14, 'a fixed pool of six warning and eight strike bolts');
    effect.update(0.2, null, BOUNDS);
    assert.equal(visible(renderer).length, 0);

    let seen = 0;
    for (let i = 0; i < 20; i += 1) {
        effect.update(0.13, { remainingSeconds: 1, durationSeconds: 2 }, BOUNDS, 7);
        for (const bolt of visible(renderer)) {
            seen += 1;
            const positions = bolt.geometry.attributes.position;
            for (let p = 0; p < positions.count; p += 1) {
                assert.ok(positions.getY(p) >= 150 - 0.001, 'the warning stays in the sky');
                assert.ok(Math.abs(positions.getX(p)) <= 130 && Math.abs(positions.getZ(p)) <= 130);
            }
        }
    }
    assert.ok(seen > 20, 'bolts keep flickering');
    effect.update(0.1, null, BOUNDS);
    assert.equal(visible(renderer).length, 0, 'the warning ends with the strike');
});

test('the strike reaches from the top of the arena down to each target and fades', () => {
    const renderer = createRenderer();
    const effect = new LightningStrikeEffect(renderer);
    effect.strike([new THREE.Vector3(10, 40, -20), new THREE.Vector3(-30, 60, 5)], BOUNDS);
    const bolts = visible(renderer);
    assert.equal(bolts.length, 2);
    const positions = bolts[0].geometry.attributes.position;
    assert.deepEqual([positions.getX(0), positions.getY(0), positions.getZ(0)], [10, 200, -20]);
    const last = positions.count - 1;
    assert.deepEqual([positions.getX(last), positions.getY(last), positions.getZ(last)], [10, 40, -20]);
    effect.update(0.35, null, BOUNDS);
    assert.equal(visible(renderer).length, 0);
    effect.dispose();
    assert.equal(renderer.scene.size, 0);
});

test('a cast warns every human and the strike draws the bolt and plays the thunder', () => {
    const renderer = createRenderer();
    const feedback = [];
    const sounds = [];
    const caster = { index: 0, alive: true, isBot: false, hp: 100, position: new THREE.Vector3(0, 10, 0) };
    const target = {
        index: 1, alive: true, isBot: true, hp: 100, shieldHP: 0, spawnProtectionTimer: 0,
        position: new THREE.Vector3(20, 80, 0),
        takeDamage(amount) { this.hp -= amount; return { hpApplied: amount, remainingHp: this.hp, isDead: false }; },
    };
    const human = { ...target, index: 2, isBot: false, position: new THREE.Vector3(-20, 5, 0) };
    const system = new LightningStrikeSystem({
        players: [caster, target, human],
        entityRuntimeConfig: HUNT_MODE_CONFIG,
        renderer,
        arena: { bounds: BOUNDS },
        audio: { play: (key) => sounds.push(key) },
        _notifyPlayerFeedback: (player, text) => feedback.push({ index: player.index, text }),
    });
    system.activate(caster);
    assert.deepEqual(feedback, [{ index: 0, text: 'Blitz! Tief fliegen!' }, { index: 2, text: 'Blitz! Tief fliegen!' }]);
    system.update(1);
    assert.ok(visible(renderer).length > 0, 'warning bolts in the sky');
    system.update(1.1);
    assert.deepEqual(sounds, ['EXPLOSION']);
    const strikeBolts = visible(renderer).filter((line) => line.material.color.getHex() === 0xeaf4ff);
    assert.equal(strikeBolts.length, 1, 'one bolt for the one target');
    system.dispose();
    assert.equal(renderer.scene.size, 0);
});
