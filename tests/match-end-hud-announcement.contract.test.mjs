import assert from 'node:assert/strict';
import test from 'node:test';

import { MatchFlowLifecycleController } from '../src/ui/MatchFlowLifecycleController.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';

function createRoundEndHarness(nextState) {
    const events = [];
    const hud = (name) => ({
        resetMatchScoreEvents() { events.push(`${name}:reset`); },
    });
    const game = {
        runtimeConfig: {},
        entityManager: { players: [], clearLastRoundGhost() {} },
        gameLoop: { setTimeScale() {} },
        hudRuntimeSystem: {
            ...hud('classic'),
            // The final score update is what raises "Pn übernimmt die Führung".
            updateScoreHud() { events.push('classic:score'); },
        },
        huntHud: hud('fight'),
        fourPlayerPlanar: hud('split4'),
        threePlayerSplit: hud('split3'),
    };
    const controller = new MatchFlowLifecycleController({
        matchFlowUiController: {
            applyMatchUiState() { events.push('ui'); },
            _syncArcadeOverlayPanel() {},
        },
        game,
        runtimePort: { applyRoundEndTransition() {} },
        coordinateRoundEnd: () => ({
            transition: { nextState, roundPause: 3 },
            effectsPlan: { shouldUpdateHud: true },
            uiState: {},
        }),
    });
    return { controller, events };
}

test('match end clears the lead announcement the final score update raised', () => {
    const { controller, events } = createRoundEndHarness(GAME_STATE_IDS.MATCH_END);

    controller.onRoundEnd({ index: 0 }, { reason: 'ELIMINATION' });

    const scoreAt = events.indexOf('classic:score');
    assert.ok(scoreAt >= 0, 'round end must still update the score HUD');
    for (const name of ['classic', 'fight', 'split4', 'split3']) {
        assert.ok(events.indexOf(`${name}:reset`) > scoreAt,
            `${name} announcement must be cleared after the final score update`);
    }
});

test('round end between rounds keeps the lead announcement', () => {
    const { controller, events } = createRoundEndHarness(GAME_STATE_IDS.ROUND_END);

    controller.onRoundEnd({ index: 0 }, { reason: 'ELIMINATION' });

    assert.deepEqual(events.filter((event) => event.endsWith(':reset')), []);
});
