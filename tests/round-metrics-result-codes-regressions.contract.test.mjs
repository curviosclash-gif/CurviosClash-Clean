import assert from 'node:assert/strict';
import { test } from 'node:test';

import { RoundMetricsStore } from '../src/state/recorder/RoundMetricsStore.js';

// Moved from tests/core-targeted.spec.js (P3): the test took no `page` fixture and only feeds
// literal event strings into the metrics store. The test id stays in the title.

test('T14ec: Recorder-Metriken behalten Gameplay-Result-Codes ueber Item-, Portal- und Gate-Events', () => {
    const store = new RoundMetricsStore({ timeProvider: () => 12 });
    store.startRound([]);
    store.registerEventType('ITEM_USE', 'mode=shoot type=ROCKET_HEAVY code=item.shoot.success ok=1');
    store.registerEventType('ITEM_PICKUP', 'mode=pickup type=SHIELD code=item.pickup.success ok=1');
    store.registerEventType('PORTAL_USE', 'mode=portal type=PORTAL code=portal.travel ok=1');
    store.registerEventType('GATE_TRIGGER', 'mode=gate type=BOOST code=gate.trigger.boost ok=1');
    store.finalizeRound(null, []);

    const metrics = store.getAggregateMetrics();

    assert.strictEqual(metrics.itemUseTypeTotals.ROCKET_HEAVY, 1);
    assert.strictEqual(metrics.actionResultCodeTotals['item.shoot.success'], 1);
    assert.strictEqual(metrics.actionResultCodeTotals['item.pickup.success'], 1);
    assert.strictEqual(metrics.actionResultCodeTotals['portal.travel'], 1);
    assert.strictEqual(metrics.actionResultCodeTotals['gate.trigger.boost'], 1);
});
