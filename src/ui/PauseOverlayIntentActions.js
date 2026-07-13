import {
    canExecutePauseOverlayIntentFromSource,
    capturePauseOverlayIntentLease,
    createPauseOverlayIntentSnapshot,
    PAUSE_OVERLAY_INTENT_TYPES,
} from '../shared/runtime/UiIntentAtomicity.js';

export function isPauseOverlayActive(matchFlowSnapshot = null, gameStateId = '') {
    return createPauseOverlayIntentSnapshot(matchFlowSnapshot, gameStateId)?.isPaused === true;
}

export function resumeFromPauseIntent(controller) {
    const matchFlowSnapshot = controller?._getMatchFlowSnapshot?.() || null;
    const gameStateId = controller?.game?.state;
    const pauseLease = capturePauseOverlayIntentLease(
        matchFlowSnapshot,
        gameStateId,
        PAUSE_OVERLAY_INTENT_TYPES.RESUME_MATCH
    );
    if (!canExecutePauseOverlayIntentFromSource(
        matchFlowSnapshot,
        gameStateId,
        pauseLease,
        PAUSE_OVERLAY_INTENT_TYPES.RESUME_MATCH
    )) {
        return false;
    }
    if (controller?.runtimePort?.resumeMatch) {
        return controller.runtimePort.resumeMatch({ pauseLease });
    }
    return applyResumeProjectionIntent(controller, { pauseLease });
}

export function applyResumeProjectionIntent(controller, options = undefined) {
    if (!canExecutePauseOverlayIntentFromSource(
        controller?._getMatchFlowSnapshot?.() || null,
        controller?.game?.state,
        options?.pauseLease || null,
        PAUSE_OVERLAY_INTENT_TYPES.RESUME_MATCH
    )) {
        return false;
    }
    controller?._restorePauseButtonLabels?.();
    controller?.hideHostPausedOverlay?.();

    const resumeTransition = controller?.createResumeTransition?.();
    controller?._hideSettings?.();
    controller?.matchFlowUiController?.applyLifecycleTransition?.(resumeTransition);
    controller?.matchFlowUiController?.applyMatchUiState?.(resumeTransition?.uiState);
    controller?.game?.gameLoop?.requestDeltaReset?.('pause-resume');
    return true;
}

export function returnToMenuFromPauseIntent(controller) {
    const matchFlowSnapshot = controller?._getMatchFlowSnapshot?.() || null;
    const gameStateId = controller?.game?.state;
    const pauseLease = capturePauseOverlayIntentLease(
        matchFlowSnapshot,
        gameStateId,
        PAUSE_OVERLAY_INTENT_TYPES.RETURN_TO_MENU
    );
    if (!canExecutePauseOverlayIntentFromSource(
        matchFlowSnapshot,
        gameStateId,
        pauseLease,
        PAUSE_OVERLAY_INTENT_TYPES.RETURN_TO_MENU
    )) {
        return false;
    }
    const menuOptions = {
        panelId: 'submenu-game',
        reason: 'pause_menu_return',
        trigger: 'pause_menu_return',
        pauseLease,
    };
    if (controller?.runtimePort?.returnToMenu) {
        return controller.runtimePort.returnToMenu(menuOptions);
    }
    if (!canExecutePauseOverlayIntentFromSource(
        controller?._getMatchFlowSnapshot?.() || null,
        controller?.game?.state,
        pauseLease,
        PAUSE_OVERLAY_INTENT_TYPES.RETURN_TO_MENU
    )) {
        return false;
    }
    controller?._hideSettings?.();
    controller?.hideHostPausedOverlay?.();
    controller?._restorePauseButtonLabels?.();
    controller?.matchFlowUiController?.applyReturnToMenuUi?.(menuOptions);
    return true;
}
