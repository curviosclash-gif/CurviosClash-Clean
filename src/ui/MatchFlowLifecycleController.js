import {
    createRoundEndRecorderAdapter,
    getLastRoundGhostClip,
    resolveGhostRouteContext,
} from './MatchFlowTransitionHotspots.js';
import { resolveLocalPlayerIndexes } from './postmatch/PostMatchStandingsBlock.js';
import { isWeaponRaceConfig } from '../shared/contracts/WeaponRaceContract.js';
import { SPLIT_SCREEN_VARIANTS } from '../four-player-planar/FourPlayerPlanarContract.js';
import { GAME_STATE_IDS } from '../shared/contracts/GameStateIds.js';

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
        return resolveGhostRouteContext(this.game);
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
        if (isWeaponRaceConfig(game?.runtimeConfig)) return null;
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
        // A key pressed in the menu or on the round-end board (Escape closing the options)
        // must not reach the new round, or the first paused-state check eats it and pauses.
        this.runtimePort?.clearJustPressed?.();
        game.entityManager?.clearLastRoundGhost?.();
        controller._clearArcadeOverlayPanel();

        if (game.ui.crosshairP1) {
            game.ui.crosshairP1.style.display = 'none';
        }
        if (game.ui.crosshairP2) {
            game.ui.crosshairP2.style.display = 'none';
        }
        game.crosshairSystem?.hideAllCrosshairs?.();

        this.sessionOrchestrator?.resetRoundRuntime?.();
        this._requestGhostPlaybackForActiveRoute();

        this._resetMatchScoreEvents();

        game.gameLoop.setTimeScale(1.0);
        controller.applyMatchUiState(roundStartTransition.uiState);
        game.hudRuntimeSystem.updateScoreHud();
        game.crosshairSystem?.updateCrosshairs?.();
    }

    onRoundEnd(winner, outcome = null) {
        const controller = this.controller;
        const game = this.game;
        // The round-end countdown and the ghost replay run on game time, so a slow
        // motion that was still active must not stretch three seconds into seven.
        game.gameLoop?.setTimeScale?.(1.0);
        // A killcam ends with its respawn countdown, which stands still on the result
        // board; left running it covers the board and freezes the round-end replay.
        game.entityManager?.resetKillcamFrameCapture?.();

        const roundEndPlan = this.coordinateRoundEnd
            ? this.coordinateRoundEnd(this.buildRoundEndCoordinatorRequest(winner, outcome))
            : {};
        const weaponRace = isWeaponRaceConfig(game?.runtimeConfig);
        const humanPlayerId = String(game?.entityManager?.humanPlayers?.[0]?.index ?? '');
        const humanFinishedWeaponRace = outcome?.parcours?.standings?.some?.(
            (row) => row?.playerId === humanPlayerId && row?.result === 'finished'
        ) === true;
        const ghostClip = !weaponRace || humanFinishedWeaponRace
            ? getLastRoundGhostClip(this.runtimePort, game, { displayDuration: game.roundPause })
            : null;
        this._persistRoundGhostForActiveRoute();
        // The hunt kills/deaths/assists used to hang below the headline as one long line; since
        // the result board's standings table carries those columns itself, the headline stays
        // the winner alone.
        // The plan already contains the final ROUND_END or MATCH_END state. Apply that decision
        // once; only use the legacy round-end entry when no transition could be derived.
        if (!roundEndPlan?.transition) {
            this.runtimePort?.enterRoundEnd?.();
        }
        this.applyRoundEndCoordinatorPlan(roundEndPlan);
        this.telemetryController?.recordRoundEndTelemetry?.(roundEndPlan);
        game.hudRuntimeSystem?.refreshArcadeHud?.();
        controller._syncArcadeOverlayPanel?.();
        if (ghostClip) {
            game.entityManager?.playLastRoundGhost?.(ghostClip);
        } else {
            game.entityManager?.clearLastRoundGhost?.();
        }
    }

    buildRoundEndCoordinatorRequest(winner, outcome = null) {
        const game = this.game;
        const normalizedOutcome = outcome && typeof outcome === 'object' ? outcome : {};
        const huntProjection = this.controller?._getMatchRuntimeProjection?.()?.hunt || null;
        const checkpointResetsByPlayer = Object.fromEntries((game.entityManager?.players || []).map((player) => [
            player.index,
            Math.max(0, Number(game.entityManager?.getParcoursHudState?.(player.index)?.resetCount) || 0),
        ]));
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
            winnerTeamId: typeof normalizedOutcome.winnerTeamId === 'string'
                ? normalizedOutcome.winnerTeamId
                : null,
            parcours: normalizedOutcome.parcours || null,
            huntScoreboard: this._resolveHuntScoreboard(),
            localPlayerIndexes: resolveLocalPlayerIndexes(game?.runtimeConfig?.session || null),
            checkpointResetsByPlayer,
            arcadeProgression: this.runtimePort?.getArcadePostMatchProgression?.() || null,
            escortSummary: huntProjection?.escortMode === true ? huntProjection.escort : null,
            logger: console,
        };
    }

    // Only HUNT keeps kills, deaths and assists; in every other mode the standings would show three
    // zeroes per player, so the board gets nothing and prints nothing.
    _resolveHuntScoreboard() {
        const huntProjection = this.controller?._getMatchRuntimeProjection?.()?.hunt || null;
        if (huntProjection?.active !== true) return null;
        return this.game?.entityManager?.getHuntScoreboard?.() || null;
    }

    applyRoundEndCoordinatorPlan(roundEndPlan) {
        this.applyRoundEndControllerTransitionState(roundEndPlan?.transition);
        this.applyRoundEndCoordinatorEffects(roundEndPlan?.effectsPlan);
        // The final score update can raise "Pn übernimmt die Führung"; on the match-end
        // board that banner would announce a lead in a match that is already decided.
        if (roundEndPlan?.transition?.nextState === GAME_STATE_IDS.MATCH_END) {
            this._resetMatchScoreEvents();
        }
        this.applyRoundEndCoordinatorUiState(roundEndPlan?.uiState);
    }

    _resetMatchScoreEvents() {
        const game = this.game;
        game.hudRuntimeSystem?.resetMatchScoreEvents?.();
        game.huntHud?.resetMatchScoreEvents?.();
        game.fourPlayerPlanar?.resetMatchScoreEvents?.();
        game.threePlayerSplit?.resetMatchScoreEvents?.();
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
        if (!roundEndTransition) return;
        this.runtimePort?.applyRoundEndTransition?.(roundEndTransition);
    }

    applyReturnToMenuUi(options = {}) {
        const controller = this.controller;
        const game = this.game;
        const returnTransition = this.deriveReturnToMenuTransition?.() || {};
        // Leaving a match mid slow motion must not carry the slowed clock into the menu.
        game.gameLoop?.setTimeScale?.(1.0);
        controller._clearArcadeOverlayPanel();
        controller.applyLifecycleTransition(returnTransition);
        controller.applyMatchUiState(returnTransition.uiState);
        controller.resetCrosshairUi();
        if (options?.showMenuPanel === false) {
            return returnTransition;
        }
        const localSettings = game.settings?.localSettings;
        const returnToFourPlayerSetup = localSettings?.sessionType === 'splitscreen'
            && localSettings?.splitScreenVariant === SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR;
        const defaultPanelId = localSettings?.sessionType === 'multiplayer'
            ? 'submenu-multiplayer'
            : (returnToFourPlayerSetup ? 'submenu-custom' : 'submenu-game');
        const panelId = String(options?.panelId || defaultPanelId).trim() || defaultPanelId;
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
        if (returnToFourPlayerSetup && panelId === 'submenu-custom') {
            game.fourPlayerPlanar?.openSetup?.();
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
