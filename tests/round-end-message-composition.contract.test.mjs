import assert from 'node:assert/strict';
import test from 'node:test';

import { MatchFlowLifecycleController } from '../src/ui/MatchFlowLifecycleController.js';
import { RoundStateController } from '../src/state/RoundStateController.js';
import { coordinateRoundEnd } from '../src/ui/MatchFlowRoundEndCoordinator.js';

const HUNT_SUMMARY = 'P1 K0/T0/A0 | Bot 2 K0/T0/A0 | Bot 3 K0/T0/A0';

function createLifecycleControllerHarness(huntProjection) {
    const appliedUiStates = [];
    const controller = {
        _getMatchRuntimeProjection() {
            return { hunt: huntProjection };
        },
        applyMatchUiState(uiState) {
            appliedUiStates.push(uiState);
        },
    };
    const lifecycleController = new MatchFlowLifecycleController({
        matchFlowUiController: controller,
        game: {},
        runtimePort: {},
        coordinateRoundEnd: () => ({
            uiState: { messageText: 'Bot 3 gewinnt die Runde' },
        }),
    });
    return { lifecycleController, appliedUiStates };
}

test('round end keeps the hunt scoreboard out of non-hunt modes', () => {
    const { lifecycleController, appliedUiStates } = createLifecycleControllerHarness({
        active: false,
        scoreboardSummary: HUNT_SUMMARY,
    });

    lifecycleController.onRoundEnd({ name: 'Bot 3' });

    assert.equal(appliedUiStates.length, 1);
    const messageText = String(appliedUiStates[0]?.messageText || '');
    assert.equal(messageText, 'Bot 3 gewinnt die Runde');
    assert.doesNotMatch(messageText, /K\d+\/T\d+\/A\d+/);
});

test('round end leaves the hunt kills to the standings table even while hunt is active', () => {
    const { lifecycleController, appliedUiStates } = createLifecycleControllerHarness({
        active: true,
        scoreboardSummary: HUNT_SUMMARY,
    });

    lifecycleController.onRoundEnd({ name: 'Bot 3' });

    assert.equal(appliedUiStates.length, 1);
    // The standings table of the result board carries kills, deaths and assists per player;
    // the headline must not repeat them as one long line.
    assert.equal(String(appliedUiStates[0]?.messageText || ''), 'Bot 3 gewinnt die Runde');
});

test('round end derives and applies one terminal state after clearing slow motion and killcam', () => {
    const events = [];
    const winner = { index: 0, score: 2, name: 'Solo', isBot: false };
    const roundStateController = new RoundStateController();
    const game = {
        entityManager: {
            players: [winner],
            getHumanPlayers: () => [winner],
            resetKillcamFrameCapture() { events.push('killcam-reset'); },
            clearLastRoundGhost() {},
        },
        roundStateController,
        numBots: 0,
        winsNeeded: 3,
        gameLoop: { setTimeScale(value) { events.push(`time-scale:${value}`); } },
        hudRuntimeSystem: { updateScoreHud() { events.push('hud-update'); } },
    };
    const uiController = {
        _getMatchRuntimeProjection: () => ({}),
        applyMatchUiState(uiState) { events.push(`ui:${uiState.messageText}`); },
    };
    const runtimePort = {
        enterRoundEnd() { events.push('preliminary-round-end'); },
        applyRoundEndTransition(transition) { events.push(`transition:${transition.nextState}`); },
    };
    const lifecycleController = new MatchFlowLifecycleController({
        matchFlowUiController: uiController,
        game,
        runtimePort,
        coordinateRoundEnd(request) {
            const plan = coordinateRoundEnd({ ...request, logger: { log() {} } });
            events.push(`derive:${plan.outcome.state}`);
            return plan;
        },
    });

    lifecycleController.onRoundEnd(winner, { reason: 'TIME_LIMIT' });

    assert.deepEqual(events, [
        'time-scale:1',
        'killcam-reset',
        'derive:MATCH_END',
        'transition:MATCH_END',
        'hud-update',
        'ui:Solo gewinnt das Match',
    ]);
    assert.equal(winner.score, 3, 'the winning round is scored once before the match-end decision');
});
