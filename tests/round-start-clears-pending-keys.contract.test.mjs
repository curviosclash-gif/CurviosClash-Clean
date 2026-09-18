import assert from 'node:assert/strict';
import test from 'node:test';

import { MatchFlowLifecycleController } from '../src/ui/MatchFlowLifecycleController.js';
import { createMatchFlowUiControllerPort } from '../src/shared/runtime/UiControllerRuntimePorts.js';

// Found in the menu retest: Escape that closed the options stayed a pending key press, so the
// paused-game check of the next match consumed it and the match started paused.
test('a round start drops key presses left over from the menu', () => {
    const calls = [];
    const controller = {
        applyLifecycleTransition() {},
        _clearArcadeOverlayPanel() {},
        applyMatchUiState() {},
    };
    const game = {
        ui: {},
        gameLoop: { setTimeScale() {} },
        hudRuntimeSystem: { updateScoreHud() {} },
    };
    const lifecycle = new MatchFlowLifecycleController({
        matchFlowUiController: { game },
        runtime: game,
        runtimePort: { clearJustPressed: () => calls.push('clearJustPressed') },
        deriveRoundStartTransition: () => ({ uiState: {} }),
    });
    Object.defineProperty(lifecycle, 'controller', { value: controller });
    lifecycle._requestGhostPlaybackForActiveRoute = () => {};

    lifecycle.startRound();
    assert.deepEqual(calls, ['clearJustPressed']);
});

test('the match flow port forwards the input reset', () => {
    let cleared = 0;
    const port = createMatchFlowUiControllerPort({ inputPort: { clearJustPressed: () => { cleared += 1; } } });
    port.clearJustPressed();
    assert.equal(cleared, 1);
});
