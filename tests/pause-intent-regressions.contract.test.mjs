import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createMatchFlowSnapshot } from '../src/shared/contracts/SessionRuntimeSnapshotContract.js';
import {
    canExecutePauseOverlayIntent,
    createPauseOverlayIntentLease,
    executeAtomicUiIntent,
    PAUSE_OVERLAY_INTENT_TYPES,
} from '../src/shared/runtime/UiIntentAtomicity.js';
import { GAME_STATE_IDS } from '../src/shared/contracts/GameStateIds.js';
import { returnToMenuFromPauseIntent } from '../src/ui/PauseOverlayIntentActions.js';
import { PauseOverlayController } from '../src/ui/PauseOverlayController.js';
import { GameRuntimeSessionHandler } from '../src/core/runtime/GameRuntimeSessionHandler.js';

// Moved from tests/core-targeted-regressions.spec.js (P3): snapshots, ports and the
// overlay host are hand-built objects, no DOM node is touched. In the desktop profile
// the spec's `import('/src/...')` cannot resolve against the built renderer.

test('V87.4 executeAtomicUiIntent rejects async failures when no error handler is provided', async () => {
    let pendingPromise = null;
    let result = null;
    try {
        await executeAtomicUiIntent({
            currentPromise: pendingPromise,
            assignPendingPromise: (promise) => {
                pendingPromise = promise;
            },
            clearPendingPromise: (promise) => {
                if (pendingPromise === promise) {
                    pendingPromise = null;
                }
            },
            execute: () => Promise.reject(new Error('atomic_rejection')),
        });
        result = {
            resolved: true,
            pendingAfterSettle: pendingPromise !== null,
        };
    } catch (error) {
        result = {
            resolved: false,
            errorMessage: error?.message || '',
            pendingAfterSettle: pendingPromise !== null,
        };
    }

    assert.strictEqual(result.resolved, false);
    assert.strictEqual(result.errorMessage, 'atomic_rejection');
    assert.strictEqual(result.pendingAfterSettle, false);
});

test('V87.4 return-to-menu pause intents stay blocked when canReturnToMenu is missing from snapshots', () => {
    const snapshot = createMatchFlowSnapshot({
        sessionId: 'session-1',
        isPaused: true,
        lifecycleState: 'playing',
        finalizeState: 'idle',
        updatedAt: 3,
    });
    const lease = createPauseOverlayIntentLease(
        snapshot,
        PAUSE_OVERLAY_INTENT_TYPES.RETURN_TO_MENU
    );

    const result = {
        snapshotCanReturnToMenu: snapshot.canReturnToMenu,
        leaseIsNull: lease === null,
        canExecute: canExecutePauseOverlayIntent(
            snapshot,
            null,
            PAUSE_OVERLAY_INTENT_TYPES.RETURN_TO_MENU
        ),
    };

    assert.strictEqual(result.snapshotCanReturnToMenu, false);
    assert.strictEqual(result.leaseIsNull, true);
    assert.strictEqual(result.canExecute, false);
});

test('V87.4 return-to-menu pause intents avoid UI side effects when the runtime path rejects them', () => {
    let hideSettingsCalls = 0;
    let hideHostOverlayCalls = 0;
    let restoreLabelsCalls = 0;
    const snapshot = {
        sessionId: 'session-1',
        isPaused: true,
        canReturnToMenu: true,
        lifecycleState: 'playing',
        finalizeState: 'idle',
        updatedAt: 1,
    };

    const resultValue = returnToMenuFromPauseIntent({
        game: { state: GAME_STATE_IDS.PAUSED },
        runtimePort: {
            returnToMenu() {
                return false;
            },
        },
        _getMatchFlowSnapshot() {
            return { ...snapshot };
        },
        _hideSettings() {
            hideSettingsCalls += 1;
        },
        hideHostPausedOverlay() {
            hideHostOverlayCalls += 1;
        },
        _restorePauseButtonLabels() {
            restoreLabelsCalls += 1;
        },
    });

    const result = {
        resultValue,
        hideSettingsCalls,
        hideHostOverlayCalls,
        restoreLabelsCalls,
    };

    assert.strictEqual(result.resultValue, false);
    assert.strictEqual(result.hideSettingsCalls, 0);
    assert.strictEqual(result.hideHostOverlayCalls, 0);
    assert.strictEqual(result.restoreLabelsCalls, 0);
});

// The Playwright version handed eleven document.createElement nodes to game.ui. They were
// scenery: the controller constructor touches no DOM, setupListeners() is never called, and
// both intent paths return before any UI access once the handler refuses the stale lease.
// Plain objects therefore change nothing about what is asserted (leases and call counters).
test('V87.4 PauseOverlayController and GameRuntimeSessionHandler reject stale pause intent leases for resume and return-to-menu', () => {
    const game = {
        state: GAME_STATE_IDS.PAUSED,
        ui: {
            pauseOverlay: {},
            pauseResumeButton: {},
            pauseSettingsButton: {},
            pauseSettingsBackButton: {},
            pauseMenuButton: {},
            pauseSettingsPanel: {},
            pauseKeybindP1: {},
            pauseKeybindP2: {},
            pauseAutoRollToggle: {},
            pauseInvertP1: {},
            pauseInvertP2: {},
        },
        settings: {
            autoRoll: false,
            invertPitch: { PLAYER_1: false, PLAYER_2: false },
        },
        gameLoop: {
            requestDeltaReset() { },
        },
    };

    let currentSnapshot = {
        sessionId: 'session-1',
        isPaused: true,
        canReturnToMenu: true,
        lifecycleState: 'playing',
        finalizeState: 'idle',
        updatedAt: 1,
    };
    const seenResumeLeases = [];
    const seenReturnLeases = [];
    let resumeProjectionCalls = 0;
    let finalizeCalls = 0;

    const facade = {
        finalizeMatch(options = {}) {
            finalizeCalls += 1;
            return options;
        },
        getPorts() {
            return {
                runtimeProjectionPort: {
                    getMatchFlowSnapshot: () => ({ ...currentSnapshot }),
                },
                matchUiPort: {
                    applyResumeMatchProjection() {
                        resumeProjectionCalls += 1;
                        currentSnapshot = {
                            ...currentSnapshot,
                            isPaused: false,
                            lifecycleState: 'playing',
                            updatedAt: currentSnapshot.updatedAt + 1,
                        };
                        game.state = GAME_STATE_IDS.PLAYING;
                        return true;
                    },
                },
            };
        },
    };

    const handler = new GameRuntimeSessionHandler({ facade, logger: console });
    const controller = new PauseOverlayController({
        matchFlowUiController: {
            game,
            applyLifecycleTransition() { },
            applyMatchUiState() { },
            applyReturnToMenuUi() {
                throw new Error('fallback return UI should stay behind runtime intent path');
            },
        },
        game,
        ports: {
            runtimeProjectionPort: {
                getMatchFlowSnapshot: () => ({ ...currentSnapshot }),
                getSessionRuntimeSnapshot: () => ({ isHost: true }),
            },
            runtimeIntentPort: {
                resumeMatch(options = undefined) {
                    seenResumeLeases.push(options?.pauseLease || null);
                    currentSnapshot = {
                        ...currentSnapshot,
                        isPaused: false,
                        lifecycleState: 'playing',
                        updatedAt: currentSnapshot.updatedAt + 1,
                    };
                    game.state = GAME_STATE_IDS.PLAYING;
                    return handler.resumeMatch(options);
                },
                returnToMenu(options = undefined) {
                    seenReturnLeases.push(options?.pauseLease || null);
                    currentSnapshot = {
                        ...currentSnapshot,
                        canReturnToMenu: false,
                        finalizeState: 'finalizing',
                        updatedAt: currentSnapshot.updatedAt + 1,
                    };
                    return handler.returnToMenu(options);
                },
            },
        },
    });

    const staleResumeResult = controller.resumeFromPause();
    currentSnapshot = {
        sessionId: 'session-1',
        isPaused: true,
        canReturnToMenu: true,
        lifecycleState: 'playing',
        finalizeState: 'idle',
        updatedAt: 10,
    };
    game.state = GAME_STATE_IDS.PAUSED;
    const staleReturnResult = controller.returnToMenuFromPause();

    const result = {
        staleResumeResult,
        staleReturnResult,
        seenResumeLeaseUpdatedAt: Number(seenResumeLeases[0]?.updatedAt || 0),
        seenReturnLeaseUpdatedAt: Number(seenReturnLeases[0]?.updatedAt || 0),
        seenResumeLeasePaused: seenResumeLeases[0]?.isPaused === true,
        seenReturnLeaseCanReturn: seenReturnLeases[0]?.canReturnToMenu === true,
        resumeProjectionCalls,
        finalizeCalls,
    };

    assert.strictEqual(result.staleResumeResult, false);
    assert.strictEqual(result.staleReturnResult, false);
    assert.strictEqual(result.seenResumeLeaseUpdatedAt, 1);
    assert.strictEqual(result.seenReturnLeaseUpdatedAt, 10);
    assert.strictEqual(result.seenResumeLeasePaused, true);
    assert.strictEqual(result.seenReturnLeaseCanReturn, true);
    assert.strictEqual(result.resumeProjectionCalls, 0);
    assert.strictEqual(result.finalizeCalls, 0);
});