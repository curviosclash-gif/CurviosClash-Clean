import assert from 'node:assert/strict';
import test from 'node:test';

import { MatchFlowLifecycleController } from '../src/ui/MatchFlowLifecycleController.js';

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

test('round end still appends the hunt scoreboard while hunt is active', () => {
    const { lifecycleController, appliedUiStates } = createLifecycleControllerHarness({
        active: true,
        scoreboardSummary: HUNT_SUMMARY,
    });

    lifecycleController.onRoundEnd({ name: 'Bot 3' });

    assert.equal(appliedUiStates.length, 1);
    assert.equal(
        String(appliedUiStates[0]?.messageText || ''),
        `Bot 3 gewinnt die Runde\n${HUNT_SUMMARY}`,
    );
});
