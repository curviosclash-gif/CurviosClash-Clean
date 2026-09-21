// ============================================
// ParcoursHudPresenter.js - parcours panel rendering
// ============================================
// One panel per local player: in split-screen each player reads their own
// checkpoint progress instead of sharing a single panel across both views.

import {
    createCompletedClassicTutorialState,
    isClassicTutorialRoute,
    resolveClassicTutorialHint,
} from '../shared/contracts/ClassicTutorialContract.js';

export function formatParcoursDurationMs(value) {
    const ms = Math.max(0, Number(value) || 0);
    const seconds = ms / 1000;
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
}

/** Groups the DOM refs of one parcours panel, or null when it is not mounted. */
export function resolveParcoursPanelRefs(ui, playerIndex) {
    if (!ui) return null;
    if (playerIndex === 1) {
        if (!ui.p2ParcoursHud) return null;
        return {
            root: ui.p2ParcoursHud,
            route: ui.p2ParcoursRoute,
            progress: ui.p2ParcoursProgress,
            timer: ui.p2ParcoursTimer,
            status: ui.p2ParcoursStatus,
        };
    }
    if (!ui.parcoursHud) return null;
    return {
        root: ui.parcoursHud,
        route: ui.parcoursRoute,
        progress: ui.parcoursProgress,
        timer: ui.parcoursTimer,
        status: ui.parcoursStatus,
    };
}

export function setParcoursPanelVisible(refs, isVisible) {
    if (!refs?.root) return;
    refs.root.classList.toggle('hidden', !isVisible);
}

export function clearParcoursPanel(refs) {
    if (!refs) return;
    if (refs.progress) refs.progress.textContent = 'CP 0/0';
    if (refs.timer) refs.timer.textContent = '0.00s';
    if (refs.status) {
        refs.status.textContent = '';
        refs.status.classList.remove('success');
    }
}

/**
 * Writes one parcours panel from its player's hud state.
 *
 * @param {object} refs - Panel refs from resolveParcoursPanelRefs.
 * @param {object} hudState - Per-player parcours hud state.
 * @param {object|null} game - Game runtime; only used to persist tutorial completion.
 * @param {boolean} persistTutorial - True for the primary panel only, so the
 *   classic tutorial is not marked complete twice in split-screen.
 * @returns {boolean} True when tutorial completion was persisted by this call.
 */
export function renderParcoursPanel(refs, hudState, game, persistTutorial) {
    let persistedTutorial = false;
    const routeLabel = String(hudState.routeId || 'parcours').replace(/_/g, ' ');
    if (refs.route) refs.route.textContent = routeLabel;

    const total = Math.max(0, Number(hudState.totalCheckpoints) || 0);
    const current = Math.max(0, Math.min(total, Number(hudState.currentCheckpoint) || 0));
    if (refs.progress) {
        refs.progress.textContent = `CP ${current}/${total}`;
    }

    if (refs.timer) {
        if (hudState.completed) {
            refs.timer.textContent = `Finish ${formatParcoursDurationMs(hudState.completionTimeMs)}`;
        } else {
            refs.timer.textContent = `Segment ${formatParcoursDurationMs(hudState.segmentElapsedMs)}`;
        }
    }

    if (!refs.status) return persistedTutorial;
    let statusText = '';
    let isSuccess = false;
    if (hudState.completed) {
        statusText = 'Parcours abgeschlossen';
        isSuccess = true;
    } else if (hudState.hasError && hudState.errorMessage) {
        statusText = hudState.errorMessage;
    } else if (Array.isArray(hudState.expectedCheckpointLabels)
        && hudState.expectedCheckpointLabels.length > 1) {
        statusText = `Wegwahl: ${hudState.expectedCheckpointLabels.join(' · ')}`;
    }
    if (isClassicTutorialRoute(hudState.routeId)) {
        statusText = resolveClassicTutorialHint(current, hudState.completed);
        isSuccess = hudState.completed === true;
        if (persistTutorial && hudState.completed) {
            const settings = game?.settings;
            if (settings) {
                if (!settings.localSettings || typeof settings.localSettings !== 'object') settings.localSettings = {};
                settings.localSettings.classicTutorial = createCompletedClassicTutorialState(
                    settings.localSettings.classicTutorial
                );
                if (typeof game._saveSettings === 'function') game._saveSettings();
                else game.settingsManager?.saveSettings?.(settings);
            }
            persistedTutorial = true;
        }
    }
    refs.status.textContent = statusText;
    refs.status.classList.toggle('success', isSuccess);
    return persistedTutorial;
}
