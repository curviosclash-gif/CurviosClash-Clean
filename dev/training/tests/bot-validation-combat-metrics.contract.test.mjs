import assert from 'node:assert/strict';
import test from 'node:test';

import { buildBotValidationCombatMetrics } from '../src/state/validation/BotValidationCombatMetrics.js';

test('MG hit rate uses successful shots while cooldown and overheat stay separate', () => {
    const metrics = buildBotValidationCombatMetrics([
        {
            itemUseModeCounts: { mg: 9 },
            actionResultCodeCounts: {
                'mg.shoot.success': 3,
                'mg.shoot.cooldown': 4,
                'mg.shoot.overheated': 2,
            },
            mgHits: 2,
        },
        {
            itemUseModeCounts: { mg: 3 },
            actionResultCodeCounts: { 'mg.shoot.success': 1, 'mg.shoot.cooldown': 1 },
            mgHits: 1,
        },
    ]);
    assert.deepEqual(metrics, {
        mgShotRequests: 12,
        mgShots: 4,
        mgCooldownBlocks: 5,
        mgOverheatBlocks: 2,
        mgOtherBlocks: 1,
        mgHits: 3,
        mgHitRate: 0.75,
    });
});

test('MG hit rate is zero when no shot succeeds', () => {
    const metrics = buildBotValidationCombatMetrics([{
        itemUseModeCounts: { mg: 4 },
        actionResultCodeCounts: { 'mg.shoot.cooldown': 4 },
        mgHits: 0,
    }]);
    assert.equal(metrics.mgShots, 0);
    assert.equal(metrics.mgHitRate, 0);
    assert.equal(metrics.mgCooldownBlocks, 4);
});
