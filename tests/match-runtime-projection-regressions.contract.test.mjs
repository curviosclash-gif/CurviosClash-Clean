import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMatchRuntimeProjection } from '../src/shared/contracts/MatchRuntimeProjectionContract.js';
import { pickSubset } from './helpers/object-subset.mjs';

// Moved from tests/core-targeted.spec.js (P3): the test took no `page` fixture and only
// normalizes a literal traversal payload through the projection contract. The test id stays
// in the title.

test('T14eb2: Match-Runtime-Projektion normalisiert Traversal-Signale fuer Cooldown, Inaktivstatus und Post-Portal-Fenster', () => {
    const projection = createMatchRuntimeProjection({
        players: [{
            playerIndex: 0,
            traversal: {
                portalsEnabled: false,
                portalCooldownRemaining: 1.4,
                gateCooldownRemaining: 0.75,
                gateCount: 3,
                exitPortal: {
                    totalCount: 2,
                    activeCount: 1,
                    inactiveCount: 1,
                },
                exitPortalCooldownRemaining: 0.25,
                postPortalActive: true,
                postPortalRemainingSeconds: 0.4,
                lastPortalTravelAtMs: 123456,
            },
        }],
    });

    const expectedTraversal = {
        portalsEnabled: false,
        portalCooldownRemaining: 1.4,
        gateCooldownRemaining: 0.75,
        gateCount: 3,
        exitPortal: {
            totalCount: 2,
            activeCount: 1,
            inactiveCount: 1,
        },
        exitPortalCooldownRemaining: 0.25,
        postPortalActive: true,
        postPortalRemainingSeconds: 0.4,
        lastPortalTravelAtMs: 123456,
    };

    assert.deepStrictEqual(pickSubset(projection.players[0].traversal, expectedTraversal), expectedTraversal);
});
