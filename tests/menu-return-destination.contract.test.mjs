import assert from 'node:assert/strict';
import test from 'node:test';

import { MatchFlowLifecycleController } from '../src/ui/MatchFlowLifecycleController.js';

function returnFromMatch(sessionType, splitScreenVariant, options = {}) {
    const calls = [];
    const game = {
        settings: { localSettings: { sessionType, splitScreenVariant } },
        gameLoop: { setTimeScale() {} },
        fourPlayerPlanar: { openSetup() { calls.push(['openFourPlayerSetup']); } },
    };
    const controller = new MatchFlowLifecycleController({
        game,
        matchFlowUiController: {
            _clearArcadeOverlayPanel() {},
            applyLifecycleTransition() {},
            applyMatchUiState() {},
            resetCrosshairUi() {},
        },
        runtimePort: {
            showMenuPanel(panelId) { calls.push(['showMenuPanel', panelId]); },
            syncUi() { calls.push(['syncUi']); },
        },
        deriveReturnToMenuTransition: () => ({ uiState: {} }),
    });
    controller.applyReturnToMenuUi(options);
    return calls;
}

test('four-player matches return to their setup module', () => {
    assert.deepEqual(returnFromMatch('splitscreen', 'four_player_planar'), [
        ['showMenuPanel', 'submenu-custom'],
        ['syncUi'],
        ['openFourPlayerSetup'],
    ]);
});

test('ordinary local and multiplayer matches keep their own return destinations', () => {
    assert.deepEqual(returnFromMatch('splitscreen', 'standard'), [
        ['showMenuPanel', 'submenu-game'], ['syncUi'],
    ]);
    assert.deepEqual(returnFromMatch('multiplayer', 'standard'), [
        ['showMenuPanel', 'submenu-multiplayer'], ['syncUi'],
    ]);
});

test('explicit destinations still override the default route', () => {
    assert.deepEqual(returnFromMatch('splitscreen', 'four_player_planar', { panelId: 'submenu-settings' }), [
        ['showMenuPanel', 'submenu-settings'], ['syncUi'],
    ]);
});
