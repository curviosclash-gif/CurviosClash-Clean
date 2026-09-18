import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Quaternion, Vector3 } from 'three';

import { CollisionResponseSystem } from '../src/entities/systems/CollisionResponseSystem.js';

// Moved from tests/core-targeted-runtime.spec.js (P3): the test took no `page` fixture, it
// ran in Playwright's own node process against hand-built owner and player stubs, with
// `three` resolved from node_modules exactly as here. Only the runner changed. The test id
// stays in the title.
//
// The test replaces the global Math.random on purpose: the point is that bounceBot must not
// reach for it. node:test runs the tests of one file sequentially in a process of its own, and
// the finally block puts the original back, so no other test sees the trap.

test('T20am: Collision-Bounce nutzt Runtime-RNG statt unseeded Math.random', () => {
    const originalRandom = Math.random;
    let mathRandomCalls = 0;
    Math.random = () => {
        mathRandomCalls += 1;
        throw new Error('unseeded-random-called');
    };

    const runBounce = (samples) => {
        let sampleIndex = 0;
        let forcedGap = 0;
        const owner = {
            arena: {
                bounds: { minX: -10, maxX: 10, minY: -10, maxY: 10, minZ: -10, maxZ: 10 },
                checkCollision: () => false,
            },
            checkGlobalCollision: () => null,
            _tmpVec: new Vector3(),
            _tmpVec2: new Vector3(),
            _tmpDir: new Vector3(),
            botByPlayer: new Map(),
            runtimeRng: {
                next() {
                    const value = samples[sampleIndex];
                    sampleIndex += 1;
                    return value ?? 0.5;
                },
            },
            recorder: { logEvent() {} },
        };
        const player = {
            index: 0,
            position: new Vector3(0, 0, 0),
            quaternion: new Quaternion(),
            hitboxRadius: 1,
            trail: {
                forceGap(value) {
                    forcedGap = value;
                },
            },
            getDirection(out) {
                return out.set(0, 0, -1);
            },
        };

        new CollisionResponseSystem(owner).bounceBot(player, new Vector3(1, 0, 0), 'WALL', {
            normalBias: 0,
            randomScale: 0.45,
            preRotateShove: 0,
            extraPush: 0,
            trailGap: 0.31,
        });

        const forward = new Vector3(0, 0, -1).applyQuaternion(player.quaternion).normalize();
        return {
            x: Number(forward.x.toFixed(6)),
            y: Number(forward.y.toFixed(6)),
            z: Number(forward.z.toFixed(6)),
            consumedSamples: sampleIndex,
            forcedGap: Number(forcedGap.toFixed(2)),
        };
    };

    try {
        const first = runBounce([0.12, 0.74, 0.36]);
        const second = runBounce([0.12, 0.74, 0.36]);
        const third = runBounce([0.88, 0.24, 0.64]);

        assert.strictEqual(mathRandomCalls, 0);
        assert.deepStrictEqual(first, second);
        assert.notDeepStrictEqual(first, third);
        assert.strictEqual(first.consumedSamples, 3);
        assert.strictEqual(first.forcedGap, 0.31);
    } finally {
        Math.random = originalRandom;
    }
});
