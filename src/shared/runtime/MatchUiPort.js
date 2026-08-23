function getMatchFlowUiController(game) {
    return game?.runtimeBundle?.components?.matchFlowUiController
        || game?.sessionRuntime?.handles?.matchFlowUiController
        || null;
}

export function createMatchUiPort(game) {
    const controller = () => getMatchFlowUiController(game);
    return {
        prepareMatchStartProjection: () => controller()?.prepareMatchStartProjection?.(),
        waitForMatchLoadingFrame: () => controller()?.waitForMatchLoadingFrame?.(),
        configureMatchInputSources: () => controller()?.configureMatchInputSources?.(),
        completeMatchStartProjection: (initializedMatch) => controller()?.completeMatchStartProjection?.(initializedMatch),
        bindMatchStartRuntime: () => controller()?.bindMatchStartRuntime?.(),
        onRoundEnd: (winner, outcome = null) => controller()?.onRoundEnd?.(winner, outcome),
        applyPauseMatchProjection: () => controller()?.applyPauseProjection?.(),
        applyResumeMatchProjection: (options = undefined) => controller()?.applyResumeProjection?.(options),
        applyDisconnectConfirmationProjection: () => controller()?.applyDisconnectConfirmationProjection?.(),
        startRound: () => controller()?.startRound?.(),
        applyReturnToMenuUi: (options = undefined) => controller()?.applyReturnToMenuUi?.(options),
        setupPauseOverlayListeners: () => controller()?.setupPauseOverlayListeners?.(),
    };
}
