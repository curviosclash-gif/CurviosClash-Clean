// Shared harness for the round-end / match-end tick contract tests.

import { createInteractiveMatchKernel } from '../../src/state/MatchKernel.js';
import { createMatchKernelInteractiveAdapter } from '../../src/core/MatchKernelInteractiveAdapter.js';
import { RoundStateTickSystem } from '../../src/state/RoundStateTickSystem.js';
import { createRoundStateController } from '../../src/state/RoundStateController.js';

/**
 * Counting input stub. `wasPressed` mimics the real InputManager: a pressed key is
 * reported exactly once and consumed. Every call is counted, so a second reader shows up.
 */
export function createCountingInput() {
    const pressed = new Set();
    const callsByKey = new Map();
    return {
        press(key) {
            pressed.add(key);
        },
        callCount(key) {
            return callsByKey.get(key) || 0;
        },
        wasPressed(key) {
            callsByKey.set(key, (callsByKey.get(key) || 0) + 1);
            if (!pressed.has(key)) return false;
            pressed.delete(key);
            return true;
        },
        isDown() {
            return false;
        },
        getPlayerInput() {
            return null;
        },
    };
}

/**
 * createRoundStateHarness – interactive round-state tick wiring with a real MatchKernel,
 * a real interactive adapter and a real round state controller.
 */
export function createRoundStateHarness({ roundPause = 3 } = {}) {
    const input = createCountingInput();
    const kernel = createInteractiveMatchKernel({ simPorts: {} });
    kernel.boot({ roundIndex: 0 });

    const calls = { returnToMenu: 0, restartRound: 0, startMatch: 0, uiStates: 0, cameraUpdates: 0 };
    const game = {
        state: 'ROUND_END',
        input,
        roundPause,
        roundStateController: createRoundStateController({ defaultRoundPause: 3 }),
        gameLoop: { renderFrameId: 7 },
        entityManager: {
            updateCameras() {
                calls.cameraUpdates += 1;
            },
            updateLastRoundGhostPlayback() {},
        },
        matchFlowUiController: {
            applyMatchUiState() {
                calls.uiStates += 1;
            },
        },
    };
    const adapter = createMatchKernelInteractiveAdapter({ game, kernel });
    game.playingStateSystem = { getKernelAdapter: () => adapter };

    const system = new RoundStateTickSystem({
        game,
        lifecyclePort: {
            returnToMenu() {
                calls.returnToMenu += 1;
            },
            restartRound() {
                calls.restartRound += 1;
            },
        },
        runtimeIntentPort: {
            startMatch() {
                calls.startMatch += 1;
            },
        },
    });

    return { input, kernel, adapter, game, system, calls };
}
