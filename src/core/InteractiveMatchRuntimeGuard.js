import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';

function getMissingInteractiveMatchRuntimeKeys(game) {
    const missing = [];
    if (!game?.entityManager || typeof game.entityManager.update !== 'function') missing.push('entityManager');
    if (!game?.powerupManager || typeof game.powerupManager.update !== 'function') missing.push('powerupManager');
    if (!game?.particles || typeof game.particles.update !== 'function') missing.push('particles');
    if (!game?.arena || typeof game.arena.update !== 'function') missing.push('arena');
    if (!game?.hudRuntimeSystem || typeof game.hudRuntimeSystem.updatePlayingHudTick !== 'function') missing.push('hudRuntimeSystem');
    return missing;
}

export function ensureInteractiveMatchRuntime(game) {
    const missing = getMissingInteractiveMatchRuntimeKeys(game);
    if (missing.length === 0) {
        if (game) {
            game._missingInteractiveMatchRuntimeReported = false;
        }
        return true;
    }

    const sessionOrchestrator = game?.runtimeBundle?.components?.matchSessionOrchestrator || null;
    if (sessionOrchestrator?._pendingSessionInit || sessionOrchestrator?._pendingFinalize) {
        return false;
    }

    if (!game?._missingInteractiveMatchRuntimeReported) {
        console.warn('[Game] Missing interactive match runtime', {
            state: game?.state || null,
            missing,
        });
        if (game) {
            game._missingInteractiveMatchRuntimeReported = true;
        }
    }

    if (game?.matchFlowUiController?.applyReturnToMenuUi) {
        game.matchFlowUiController.applyReturnToMenuUi({
            panelId: 'submenu-game',
            reason: 'missing_match_runtime',
            trigger: 'missing_match_runtime',
        });
    } else if (game) {
        game.state = GAME_STATE_IDS.MENU;
    }
    return false;
}
