import assert from 'node:assert/strict';
import test, { mock } from 'node:test';

import {
    startRuntimeStateBroadcast,
    stopRuntimeStateBroadcast,
} from '../src/core/runtime/RuntimeSessionLifecycleService.js';

/**
 * Stands in for the host facade after a round end: the tick pipeline stored the outcome
 * in `_lastRoundOutcome` and the game already switched to its result board, exactly as
 * the host does in the same frame. The session only records what it would send.
 */
function createHostFacade(state) {
    const sent = [];
    const players = [{ index: 0, alive: false }, { index: 1, alive: true }];
    const facade = {
        game: {
            state,
            roundStateController: null,
            entityManager: {
                players,
                _networkRoundSerial: 1,
                _lastRoundOutcome: { shouldEnd: true, winner: players[1], reason: 'ELIMINATION', parcours: null },
            },
        },
        session: { broadcastState: (snapshot) => sent.push(snapshot) },
    };
    return { facade, sent };
}

for (const state of ['ROUND_END', 'MATCH_END']) {
    test(`the host keeps sending its round result while it shows the ${state} board`, () => {
        mock.timers.enable({ apis: ['setInterval'] });
        const { facade, sent } = createHostFacade(state);
        try {
            startRuntimeStateBroadcast(facade);
            mock.timers.tick(500);
        } finally {
            stopRuntimeStateBroadcast(facade);
            mock.timers.reset();
        }

        const results = sent.filter((snapshot) => snapshot?.roundOutcome?.round === 1);
        assert.ok(
            results.length >= 3,
            `a lost snapshot must not cost the client its result board (sent ${results.length} results in 0.5 s)`
        );
    });
}

test('the host sends nothing while no match runs', () => {
    mock.timers.enable({ apis: ['setInterval'] });
    const { facade, sent } = createHostFacade('MENU');
    try {
        startRuntimeStateBroadcast(facade);
        mock.timers.tick(500);
    } finally {
        stopRuntimeStateBroadcast(facade);
        mock.timers.reset();
    }
    assert.equal(sent.length, 0);
});
