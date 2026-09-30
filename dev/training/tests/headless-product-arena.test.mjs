import test from 'node:test';

import { createRuntimeFixture } from '../scripts/headless-match-kernel-smoke.mjs';
import { createHeadlessLaneRuntime } from '../scripts/training-headless-lane-runner.mjs';
import { verifyHeadlessProductArena } from '../src/state/HeadlessProductMapConfig.js';

test('headless kernel smoke builds the product standard arena, not the silent fallback box', async () => {
    const { runtime } = await createRuntimeFixture();
    try {
        verifyHeadlessProductArena(runtime.session.entityManager.arena, 'standard');
    } finally {
        runtime.dispose();
    }
});

test('headless training lanes build the product arena of the requested map', async () => {
    for (const mapKey of ['standard', 'pillar_hall']) {
        const { runtime } = await createHeadlessLaneRuntime({ mapKey, sessionId: `lane-arena-${mapKey}` });
        try {
            verifyHeadlessProductArena(runtime.session.entityManager.arena, mapKey);
        } finally {
            runtime.dispose();
        }
    }
});
