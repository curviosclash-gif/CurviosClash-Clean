import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { EntityManager } from '../src/entities/EntityManager.js';
import { resolveWorldAudioOptions } from '../src/entities/audio/WorldAudioOptions.js';
import { createEntityRuntimeSupport } from '../src/entities/runtime/EntityRuntimeSupportAssembly.js';

function createPlayer({ index, isBot, position }) {
    return {
        index,
        isBot,
        alive: true,
        color: 0xffffff,
        position,
        kill() { this.alive = false; },
    };
}

test('bot deaths keep their visible world explosion audible', () => {
    const events = [];
    const localPlayer = createPlayer({ index: 0, isBot: false, position: new THREE.Vector3(0, 0, 0) });
    const bot = createPlayer({ index: 1, isBot: true, position: new THREE.Vector3(3, 4, 12) });
    const owner = {
        players: [localPlayer, bot],
        gameModeStrategy: { hasScoring: () => false },
        isFightOutcomeAuthority: true,
        _parcoursProgressSystem: null,
        _projectileSystem: { clearRocketTrailsForOwner() {} },
        _respawnSystem: { onPlayerDied() {} },
        _killcamSystem: null,
        particles: { spawnExplosion() {} },
        audio: { play(type, options) { events.push({ type, options }); } },
        recorder: null,
        _eventBus: { emitPlayerDied() {} },
        onArcadeGameplayEvent: null,
    };

    EntityManager.prototype._killPlayer.call(owner, bot, 'WALL');

    assert.deepEqual(events, [{ type: 'EXPLOSION', options: { distance: 13 } }]);
});

test('bot rocket impacts keep their visible world explosion audible', () => {
    const events = [];
    const localPlayer = createPlayer({ index: 0, isBot: false, position: new THREE.Vector3(0, 0, 0) });
    const bot = createPlayer({ index: 1, isBot: true, position: new THREE.Vector3(20, 0, 0) });
    const owner = {
        renderer: null,
        arena: null,
        players: [localPlayer, bot],
        audio: { play(type, options) { events.push({ type, options }); } },
        particles: { spawnRocketImpact() {} },
        recorder: null,
        entityRuntimeConfig: null,
        runtimeProfiler: null,
    };
    const support = createEntityRuntimeSupport(owner);

    support.projectileSystem.onProjectileHit(
        new THREE.Vector3(0, 0, 10),
        0xffffff,
        bot,
        { type: 'ROCKET_MEDIUM' }
    );

    assert.deepEqual(events, [{ type: 'ROCKET_IMPACT', options: { distance: 10 } }]);
});

test('world explosions resolve HRTF coordinates from the active camera', () => {
    const camera = {
        position: new THREE.Vector3(0, 0, 0),
        quaternion: new THREE.Quaternion(),
    };
    const owner = {
        players: [createPlayer({ index: 0, isBot: false, position: new THREE.Vector3() })],
        renderer: {
            cameras: [camera],
            viewportSystem: { localPlayerIndex: 0 },
        },
    };

    assert.deepEqual(resolveWorldAudioOptions(owner, new THREE.Vector3(10, 0, 0)), {
        distance: 10,
        pan: 1,
        spatialPosition: { x: 10, y: 0, z: 0 },
    });
    assert.deepEqual(resolveWorldAudioOptions(owner, new THREE.Vector3(0, 0, -10)), {
        distance: 10,
        pan: 0,
        spatialPosition: { x: 0, y: 0, z: -10 },
    });

    camera.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const rotated = resolveWorldAudioOptions(owner, new THREE.Vector3(0, 0, -10));
    assert.ok(Math.abs(rotated.pan - 1) < 1e-12);
    assert.ok(Math.abs(rotated.spatialPosition.x - 10) < 1e-12);
    assert.ok(Math.abs(rotated.spatialPosition.z) < 1e-12);
});
