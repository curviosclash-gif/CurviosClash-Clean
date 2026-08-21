import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { EntityManager } from '../src/entities/EntityManager.js';
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
