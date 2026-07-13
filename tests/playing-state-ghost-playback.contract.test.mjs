import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createPlayingStateRuntimeAccess,
    PlayingStateSystem,
} from '../src/core/PlayingStateSystem.js';

test('createPlayingStateRuntimeAccess forwards ghost playback updates to entity manager', () => {
    const calls = [];
    const runtimeAccess = createPlayingStateRuntimeAccess({
        entityManager: {
            updateLastRoundGhostPlayback(dt) {
                calls.push(dt);
            },
        },
    });

    runtimeAccess.updateLastRoundGhostPlayback(0.25);
    assert.deepEqual(calls, [0.25]);
});

test('PlayingStateSystem update ticks ghost playback in legacy simulation path', () => {
    const calls = [];
    const entityManager = {
        update(dt, input, renderFrameId) {
            calls.push(['entity-update', dt, input, renderFrameId]);
        },
        updateLastRoundGhostPlayback(dt) {
            calls.push(['ghost-update', dt]);
        },
    };
    const runtimeAccess = {
        getEntityManager: () => entityManager,
        getRenderFrameId: () => 7,
        getInput: () => null,
        getPowerupManager: () => ({ update() {} }),
        getParticles: () => ({ update() {} }),
        getArena: () => ({ update() {} }),
        updateLastRoundGhostPlayback(dt) {
            entityManager.updateLastRoundGhostPlayback(dt);
        },
    };
    const system = new PlayingStateSystem(runtimeAccess);

    system.update(0.5);

    assert.deepEqual(calls, [
        ['entity-update', 0.5, null, 7],
        ['ghost-update', 0.5],
    ]);
});

test('PlayingStateSystem update ticks ghost playback in kernel simulation path', () => {
    const calls = [];
    const entityManager = {
        update() {
            calls.push(['entity-update']);
        },
        updateLastRoundGhostPlayback(dt) {
            calls.push(['ghost-update', dt]);
        },
    };
    const runtimeAccess = {
        getEntityManager: () => entityManager,
        getRenderFrameId: () => 3,
        updateLastRoundGhostPlayback(dt) {
            entityManager.updateLastRoundGhostPlayback(dt);
        },
    };
    const system = new PlayingStateSystem(runtimeAccess);
    system.setKernelAdapter({
        tick(dt, renderFrameId) {
            calls.push(['kernel-tick', dt, renderFrameId]);
        },
    });

    system.update(0.2);

    assert.deepEqual(calls, [
        ['kernel-tick', 0.2, 3],
        ['ghost-update', 0.2],
    ]);
});
