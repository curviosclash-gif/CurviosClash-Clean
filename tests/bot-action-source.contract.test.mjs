import assert from 'node:assert/strict';
import test from 'node:test';

import { ObservationBridgePolicy } from '../src/entities/ai/ObservationBridgePolicy.js';

test('bridge policy reports the action path actually used and resets per round', () => {
    const policy = new ObservationBridgePolicy({
        autoLoadCheckpoint: false,
        fallbackPolicy: { update: () => ({ yawLeft: true }) },
        resolveAction: () => ({ yawRight: true }),
    });
    const player = { inventory: [] };
    const context = { observation: [], players: [], projectiles: [] };

    policy.update(1 / 60, player, context);
    assert.deepEqual(policy.getActionSourceSnapshot(), {
        last: 'local',
        counts: { checkpoint: 0, bridge: 0, local: 1, fallback: 0 },
    });

    policy._resolveAction = () => null;
    policy.update(1 / 60, player, context);
    assert.deepEqual(policy.getActionSourceSnapshot(), {
        last: 'fallback',
        counts: { checkpoint: 0, bridge: 0, local: 1, fallback: 1 },
    });

    policy.resetRound();
    assert.deepEqual(policy.getActionSourceSnapshot(), {
        last: null,
        counts: { checkpoint: 0, bridge: 0, local: 0, fallback: 0 },
    });
});
