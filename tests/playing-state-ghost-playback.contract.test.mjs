import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createPlayingStateRuntimeAccess,
    PlayingStateSystem,
} from '../src/core/PlayingStateSystem.js';
import { createInteractiveMatchKernel } from '../src/state/MatchKernel.js';
import { createMatchKernelInteractiveAdapter } from '../src/core/MatchKernelInteractiveAdapter.js';

function attachKernel(system, runtimeAccess, simPorts) {
    const kernel = createInteractiveMatchKernel({ simPorts });
    kernel.boot();
    const adapter = createMatchKernelInteractiveAdapter({ game: {}, kernel });
    system.setKernelAdapter(adapter);
    runtimeAccess.getCurrentMatchKernel = () => kernel;
    runtimeAccess.getCurrentMatchKernelAdapter = () => adapter;
    return { kernel, adapter };
}


test('PlayingStateSystem does not simulate with a detached or stale adapter', () => {
    let directUpdates = 0;
    const entityManager = { update() { directUpdates += 1; } };
    const runtimeAccess = {
        getEntityManager: () => entityManager,
        getCurrentMatchKernel: () => null,
        getCurrentMatchKernelAdapter: () => null,
    };
    const system = new PlayingStateSystem(runtimeAccess);
    const kernel = createInteractiveMatchKernel({ simPorts: { entityManager } });
    kernel.boot();
    system.setKernelAdapter(createMatchKernelInteractiveAdapter({ game: {}, kernel }));

    system.update(1 / 60);

    assert.equal(kernel.tickIndex, 0);
    assert.equal(directUpdates, 0);
});
test('Escape pause handling runs before the single kernel simulation tick', () => {
    let pauses = 0;
    let ghostTicks = 0;
    const entityManager = { updateLastRoundGhostPlayback() { ghostTicks += 1; } };
    const runtimeAccess = {
        getEntityManager: () => entityManager,
        getPausePressed: () => true,
        actionPauseMatch() { pauses += 1; },
    };
    const system = new PlayingStateSystem(runtimeAccess);
    const { kernel } = attachKernel(system, runtimeAccess, { entityManager });

    system.update(1 / 60);

    assert.equal(pauses, 1);
    assert.equal(kernel.tickIndex, 0);
    assert.equal(ghostTicks, 0);
});
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

test('PlayingStateSystem ticks ghost playback after one real kernel simulation tick', () => {
    const calls = [];
    const entityManager = {
        update(dt, input, renderFrameId) { calls.push(['entity-update', dt, renderFrameId]); },
        updateLastRoundGhostPlayback(dt) { calls.push(['ghost-update', dt]); },
    };
    const runtimeAccess = {
        getEntityManager: () => entityManager,
        getRenderFrameId: () => 7,
        updateLastRoundGhostPlayback(dt) { entityManager.updateLastRoundGhostPlayback(dt); },
    };
    const system = new PlayingStateSystem(runtimeAccess);
    const { kernel } = attachKernel(system, runtimeAccess, { entityManager });

    system.update(0.5);

    assert.equal(kernel.tickIndex, 1);
    assert.deepEqual(calls, [['entity-update', 0.5, 7], ['ghost-update', 0.5]]);
});

test('PlayingStateSystem ticks ghost playback once through the real interactive adapter', () => {
    const calls = [];
    const entityManager = {
        update() { calls.push(['entity-update']); },
        updateLastRoundGhostPlayback(dt) { calls.push(['ghost-update', dt]); },
    };
    const runtimeAccess = {
        getEntityManager: () => entityManager,
        getRenderFrameId: () => 3,
        updateLastRoundGhostPlayback(dt) { entityManager.updateLastRoundGhostPlayback(dt); },
    };
    const system = new PlayingStateSystem(runtimeAccess);
    const { kernel } = attachKernel(system, runtimeAccess, { entityManager });

    system.update(0.2);

    assert.equal(kernel.tickIndex, 1);
    assert.deepEqual(calls, [['entity-update'], ['ghost-update', 0.2]]);
});

test('PlayingStateSystem builds one runtime projection per tick and shares it with HUD and crosshair', () => {
    const sharedProjection = { contractVersion: 'match-runtime-projection.v1', players: [] };
    let projectionBuilds = 0;
    let hudProjection = null;
    let crosshairProjection = null;
    const entityManager = {
        update() {},
        renderInterpolatedTransforms() {},
        updateCameras() {},
    };
    const projectionPort = {
        getMatchRuntimeProjection() {
            projectionBuilds += 1;
            return sharedProjection;
        },
        getMatchRenderProjection() {
            return null;
        },
    };
    const runtimeAccess = {
        getEntityManager: () => entityManager,
        getRenderFrameId: () => 4,
        getRuntimeProjectionPort: () => projectionPort,
        actionUpdatePlayingHudTick(_dt, projection) { hudProjection = projection; },
        getRenderer: () => ({ cameraRigSystem: { setFrameTiming() {} } }),
        getFixedStep: () => 1 / 60,
        getCrosshairSystem: () => ({ updateCrosshairs(projection) { crosshairProjection = projection; } }),
    };
    const system = new PlayingStateSystem(runtimeAccess);
    attachKernel(system, runtimeAccess, { entityManager });

    system.update(1 / 60);
    system.render(1, 1 / 60);

    assert.equal(projectionBuilds, 1);
    assert.equal(system.getMatchRuntimeProjection(), sharedProjection);
    assert.equal(hudProjection, sharedProjection);
    assert.equal(crosshairProjection, sharedProjection);
});
