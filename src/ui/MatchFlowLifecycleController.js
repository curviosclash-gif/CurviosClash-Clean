import { createRoundEndRecorderAdapter, getLastRoundGhostClip } from './MatchFlowTransitionHotspots.js';
import {
    GAME_STATE_IDS,
    normalizeGameStateId,
} from '../shared/contracts/GameStateIds.js';

export class MatchFlowLifecycleController {
    constructor(deps = {}) {
        this.matchFlowUiController = deps.matchFlowUiController || null;
        this.runtime = deps.runtime || deps.game || this.matchFlowUiController?.game || null;
        this.runtimePort = deps.runtimePort || this.matchFlowUiController?.runtimePort || null;
        this.sessionOrchestrator = deps.sessionOrchestrator || this.matchFlowUiController?.sessionOrchestrator || null;
        this.telemetryController = deps.telemetryController || this.matchFlowUiController?.telemetryController || null;
        this.coordinateRoundEnd = typeof deps.coordinateRoundEnd === 'function'
            ? deps.coordinateRoundEnd
            : null;
        this.deriveRoundStartTransition = typeof deps.deriveRoundStartTransition === 'function'
            ? deps.deriveRoundStartTransition
            : null;
        this.deriveReturnToMenuTransition = typeof deps.deriveReturnToMenuTransition === 'function'
            ? deps.deriveReturnToMenuTransition
            : null;
    }

    get game() {
        return this.runtime;
    }

    get controller() {
        return this.matchFlowUiController;
    }

    _resolveGhostRouteContext() {
        const game = this.game;
        const explicitRouteId = String(game?.arena?.currentMapDefinition?.parcours?.routeId || '').trim();
        const runtimeRouteId = String(game?.arena?.runtimeMapDefinition?.parcours?.routeId || '').trim();
        const fallbackMapKeys = [
            game?.arena?.currentMapKey,
            game?.runtimeConfig?.session?.mapKey,
            game?.settings?.mapKey,
            game?.mapKey,
        ];
        const routeAliases = [];
        const seen = new Set();
        const pushCandidate = (value) => {
            const candidate = String(value || '').trim();
            if (!candidate || seen.has(candidate)) return;
            seen.add(candidate);
            routeAliases.push(candidate);
        };

        pushCandidate(explicitRouteId);
        pushCandidate(runtimeRouteId);
        for (let i = 0; i < fallbackMapKeys.length; i += 1) {
            pushCandidate(fallbackMapKeys[i]);
        }

        return {
            routeId: routeAliases[0] || '',
            routeAliases,
        };
    }

    _resolveGhostRouteId() {
        return this._resolveGhostRouteContext().routeId;
    }

    _requestGhostPlaybackForActiveRoute() {
        const routeContext = this._resolveGhostRouteContext();
        const routeId = routeContext.routeId;
        if (!routeId || typeof this.runtimePort?.applyArcadeParcoursEvent !== 'function') {
            return null;
        }
        return this.runtimePort.applyArcadeParcoursEvent({
            type: 'ghost_start',
            routeId,
            routeAliases: routeContext.routeAliases,
            source: 'match_round_start',
        });
    }

    _normalizeGhostClipForLibrary(ghostClip = null) {
        if (!ghostClip || typeof ghostClip !== 'object') return null;
        const sourceDuration = Number(ghostClip.sourceDuration);
        if (!Number.isFinite(sourceDuration) || sourceDuration <= 0) return null;
        return {
            ...ghostClip,
            sourceDuration,
            displayDuration: sourceDuration,
        };
    }

    _persistRoundGhostForActiveRoute() {
        const game = this.game;
        const routeContext = this._resolveGhostRouteContext();
        const routeId = routeContext.routeId;
        if (!routeId || typeof this.runtimePort?.applyArcadeParcoursEvent !== 'function') {
            return null;
        }
        const rawGhostClip = getLastRoundGhostClip(this.runtimePort, game, {
            maxSourceDuration: Number.POSITIVE_INFINITY,
            displayDuration: game.roundPause,
        });
        const ghostClip = this._normalizeGhostClipForLibrary(rawGhostClip);
        if (!ghostClip) return null;
        const totalTimeMs = Math.max(1, Math.round(ghostClip.sourceDuration * 1000));
        return this.runtimePort.applyArcadeParcoursEvent({
            type: 'finish',
            routeId,
            routeAliases: routeContext.routeAliases,
            totalTimeMs,
            penaltyTimeMs: 0,
            segmentSplitsMs: [],
            ghostClip,
            persistLibraryOnly: true,
            source: 'match_round_end',
        });
    }

    startRound() {
        const controller = this.controller;
        const game = this.game;
        const roundStartTransition = this.deriveRoundStartTransition?.() || {};
        controller.applyLifecycleTransition(roundStartTransition);
        game.entityManager?.clearLastRoundGhost?.();
        controller._clearArcadeOverlayPanel();

        if (game.ui.crosshairP1) {
            game.ui.crosshairP1.style.display = 'none';
        }
        if (game.ui.crosshairP2) {
            game.ui.crosshairP2.style.display = 'none';
        }

        this.sessionOrchestrator?.resetRoundRuntime?.();
        this._requestGhostPlaybackForActiveRoute();

        game.gameLoop.setTimeScale(1.0);
        controller.applyMatchUiState(roundStartTransition.uiState);
        game.hudRuntimeSystem.updateScoreHud();
        game.crosshairSystem?.updateCrosshairs?.();
    }

    onRoundEnd(winner, outcome = null) {
        const controller = this.controller;
        const game = this.game;
        game.state = GAME_STATE_IDS.ROUND_END;
        game.roundPause = 3.0;

        const roundEndPlan = this.coordinateRoundEnd
            ? this.coordinateRoundEnd(this.buildRoundEndCoordinatorRequest(winner, outcome))
            : {};
        const ghostClip = getLastRoundGhostClip(this.runtimePort, game, {
            displayDuration: game.roundPause,
        });
        this._persistRoundGhostForActiveRoute();
        const huntSummary = controller._getMatchRuntimeProjection()?.hunt?.scoreboardSummary || '';
        if (huntSummary) {
            if (!roundEndPlan.uiState) roundEndPlan.uiState = {};
            const baseText = String(roundEndPlan.uiState.messageText || '').trim();
            roundEndPlan.uiState.messageText = baseText ? `${baseText}\n${huntSummary}` : huntSummary;
        }
        this.applyRoundEndCoordinatorPlan(roundEndPlan);
        this.telemetryController?.recordRoundEndTelemetry?.(roundEndPlan);
        if (ghostClip) {
            game.entityManager?.playLastRoundGhost?.(ghostClip);
        } else {
            game.entityManager?.clearLastRoundGhost?.();
        }
    }

    buildRoundEndCoordinatorRequest(winner, outcome = null) {
        const game = this.game;
        const normalizedOutcome = outcome && typeof outcome === 'object' ? outcome : {};
        return {
            recorder: createRoundEndRecorderAdapter(this.runtimePort, game),
            winner,
            players: game.entityManager ? game.entityManager.players : [],
            roundStateController: game.roundStateController,
            humanPlayerCount: game.entityManager?.getHumanPlayers
                ? game.entityManager.getHumanPlayers().length
                : 0,
            totalBots: game.numBots,
            winsNeeded: game.winsNeeded,
            outcomeReason: typeof normalizedOutcome.reason === 'string' ? normalizedOutcome.reason : '',
            parcours: normalizedOutcome.parcours || null,
            logger: console,
        };
    }

    applyRoundEndCoordinatorPlan(roundEndPlan) {
        this.applyRoundEndControllerTransitionState(roundEndPlan?.transition);
        this.applyRoundEndCoordinatorEffects(roundEndPlan?.effectsPlan);
        this.applyRoundEndCoordinatorUiState(roundEndPlan?.uiState);
    }

    applyRoundEndCoordinatorEffects(effectsPlan) {
        const game = this.game;
        if (!effectsPlan?.shouldUpdateHud) return;
        game.hudRuntimeSystem.updateScoreHud();
    }

    applyRoundEndCoordinatorUiState(uiState) {
        if (!uiState) return;
        this.controller.applyMatchUiState(uiState);
    }

    applyRoundEndControllerTransitionState(roundEndTransition) {
        const game = this.game;
        if (!roundEndTransition) return;
        game.roundPause = roundEndTransition.roundPause;
        game.state = normalizeGameStateId(roundEndTransition.nextState, GAME_STATE_IDS.ROUND_END);
    }

    applyReturnToMenuUi(options = {}) {
        const controller = this.controller;
        const game = this.game;
        const returnTransition = this.deriveReturnToMenuTransition?.() || {};
        controller._clearArcadeOverlayPanel();
        controller.applyLifecycleTransition(returnTransition);
        controller.applyMatchUiState(returnTransition.uiState);
        controller.resetCrosshairUi();
        if (options?.showMenuPanel === false) {
            return returnTransition;
        }
        const panelId = String(options?.panelId || 'submenu-game').trim() || 'submenu-game';
        const trigger = String(options?.trigger || options?.reason || 'return_to_menu').trim() || 'return_to_menu';
        if (this.runtimePort?.showMenuPanel) {
            this.runtimePort.showMenuPanel(panelId, { trigger });
        } else {
            game._showMainNav?.();
        }
        if (this.runtimePort?.syncUi) {
            this.runtimePort.syncUi();
        } else {
            game.uiManager?.syncAll?.();
        }
        return returnTransition;
    }

    returnToMenu(options = {}) {
        if (this.runtimePort?.returnToMenu) {
            return this.runtimePort.returnToMenu(options);
        }
        return this.applyReturnToMenuUi(options);
    }
}
