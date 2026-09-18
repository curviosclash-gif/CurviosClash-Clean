import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMatchSession } from '../src/state/MatchSessionFactory.js';
import { Arena } from '../src/entities/Arena.js';
import { ParticleSystem } from '../src/entities/Particles.js';
import {
    applyMatchSessionState,
    createGameRuntimeBundle,
    getCurrentMatchSessionRefs,
} from '../src/core/runtime/GameRuntimeBundle.js';
import { GameRuntimeFacade } from '../src/core/GameRuntimeFacade.js';

// Moved from tests/core-targeted-regressions.spec.js (P3): renderer, audio and recorder
// are hand-built stubs, and the arena build is patched to fail on purpose. Nothing here
// needs a window, while the spec's `import('/src/...')` cannot resolve in dist-app.

test('V74.3 createMatchSession disposes partial session allocations on async init failure', async () => {
    const callLog = [];
    const originalBuild = Arena.prototype.build;
    const originalArenaDispose = Arena.prototype.dispose;
    const originalParticleDispose = ParticleSystem.prototype.dispose;

    Arena.prototype.build = () => Promise.reject(new Error('arena-build-fail'));
    Arena.prototype.dispose = function disposeArenaForTest() {
        callLog.push('arena.dispose');
    };
    ParticleSystem.prototype.dispose = function disposeParticlesForTest() {
        callLog.push('particles.dispose');
    };

    let errorMessage = null;
    try {
        await createMatchSession({
            renderer: {
                addToScene() { },
                removeFromScene() { },
                clearMatchScene() {
                    callLog.push('renderer.clearMatchScene');
                },
            },
            audio: {},
            recorder: {},
            settings: {
                mode: '1p',
                numBots: 0,
                winsNeeded: 3,
                gameplay: {},
                vehicles: {},
                invertPitch: {},
                cockpitCamera: {},
            },
            runtimeConfig: null,
            baseConfig: null,
            requestedMapKey: 'standard',
            currentSession: null,
        });
    } catch (error) {
        errorMessage = error?.message || null;
    } finally {
        Arena.prototype.build = originalBuild;
        Arena.prototype.dispose = originalArenaDispose;
        ParticleSystem.prototype.dispose = originalParticleDispose;
    }

    const result = { callLog, errorMessage };

    assert.strictEqual(result.errorMessage, 'arena-build-fail');
    assert.deepStrictEqual(result.callLog, [
        'arena.dispose',
        'particles.dispose',
        'renderer.clearMatchScene',
    ]);
});

test('V74.3 current match session refs include arena for replacement disposal', () => {
    const arena = { id: 'arena-ref' };
    const entityManager = { id: 'entity-manager-ref' };
    const powerupManager = { id: 'powerup-manager-ref' };
    const particles = { id: 'particle-ref' };
    const bundle = createGameRuntimeBundle();

    applyMatchSessionState(bundle, {
        arena,
        entityManager,
        powerupManager,
        particles,
    });

    const refs = getCurrentMatchSessionRefs(bundle);
    const result = {
        arenaMatches: refs?.arena === arena,
        entityMatches: refs?.entityManager === entityManager,
        powerupMatches: refs?.powerupManager === powerupManager,
        particleMatches: refs?.particles === particles,
    };

    assert.deepStrictEqual(result, {
        arenaMatches: true,
        entityMatches: true,
        powerupMatches: true,
        particleMatches: true,
    });
});

test('V74.3 GameRuntimeFacade suppresses menu cleanup when shutdown reuses pending finalize flow', async () => {
    const callLog = [];
    let resolveFinalize = null;
    const facade = new GameRuntimeFacade({
        game: {
            hudRuntimeSystem: {
                clearNetworkScoreboard() {
                    callLog.push('clearScoreboard');
                },
            },
        },
        ports: {
            sessionPort: {
                clearLastRoundGhost() {
                    callLog.push('clearGhost');
                },
                finalizeMatchSession(options) {
                    callLog.push(`finalize:${options?.reason || 'none'}`);
                    return new Promise((resolve) => {
                        resolveFinalize = () => {
                            callLog.push('finalizeResolved');
                            resolve(true);
                        };
                    });
                },
            },
            inputPort: {
                clearPlayerSources() {
                    callLog.push('clearInput');
                },
            },
            matchUiPort: {
                applyReturnToMenuUi(options) {
                    callLog.push(`applyUi:${options?.reason || 'none'}`);
                },
            },
        },
    });

    facade.teardownRuntimeSession = () => {
        callLog.push('teardownRuntime');
    };
    facade.scheduleMatchPrewarm = () => {
        callLog.push('schedulePrewarm');
    };
    facade._resetArcadeRunState = () => {
        callLog.push('resetArcade');
    };

    const returnPromise = facade.returnToMenu({ reason: 'return_to_menu' });
    facade.dispose();
    callLog.push('disposeRequested');
    resolveFinalize?.();
    const returnResult = await returnPromise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    const result = {
        callLog,
        returnResult,
    };

    assert.ok(result.returnResult);
    assert.strictEqual(result.callLog.filter((entry) => entry === 'finalize:return_to_menu').length, 1);
    for (const expected of [
        'clearGhost',
        'teardownRuntime',
        'clearInput',
        'clearScoreboard',
        'resetArcade',
        'disposeRequested',
        'finalizeResolved',
    ]) {
        assert.ok(result.callLog.includes(expected), `callLog should contain ${expected}`);
    }
    assert.ok(!result.callLog.includes('applyUi:return_to_menu'));
    assert.ok(!result.callLog.includes('schedulePrewarm'));
});
