// ============================================
// HudRuntimeSystem.js - HUD runtime orchestration
// ============================================

import { ArcadeMissionHUD } from './arcade/ArcadeMissionHUD.js';
import { resolveLocalHudTile } from './LocalHudPlayers.js';
import { ArcadeScoreHUD } from './arcade/ArcadeScoreHUD.js';
import { ParcoursOverlayController } from './arcade/ParcoursOverlayController.js';
import { updateActiveEffectBar, updateItemBar, updateRocketBar } from './ItemBarPresenter.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';
import { syncHudSlowMoClass } from './HudSlowMoIndicator.js';
import { MatchScoreHudPresenter } from './MatchScoreHudPresenter.js';
import { updateTraversalStatus } from './TraversalHudPresenter.js';
import {
    clearParcoursPanel,
    renderParcoursPanel,
    resolveParcoursPanelRefs,
    setParcoursPanelVisible,
} from './ParcoursHudPresenter.js';

const PARCOURS_MINIMAP_INTERVAL_SECONDS = 0.1;

export class HudRuntimeSystem {
    constructor(deps = {}) {
        this.game = deps.game || null;
        this.ports = deps.ports || null;
        this._hudP2Visible = null;
        this._fighterHudTimer = 0;
        this._parcoursMinimapTimer = PARCOURS_MINIMAP_INTERVAL_SECONDS;
        this._scorePresenter = null;
        this._arcadeMissionHud = null;
        this._arcadeScoreHud = null;
        this._arcadeSuddenDeathOverlay = null;
        this._arcadeSectorTransitionOverlay = null;
        this._arcadeTransitionVisibleUntilMs = 0;
        this._lastArcadeSectorIndex = 0;
        this._parcoursOverlay = null;
        this._parcoursMinimapProjection = { parcours: null, players: null };
        this._tutorialCompletionPersisted = false;
        this._hudMode = null;
        this._slowMoActive = null;
    }

    _getMatchRuntimeProjection() {
        return this.ports?.runtimeProjectionPort?.getMatchRuntimeProjection?.() || null;
    }

    _findProjectedPlayer(projection, playerIndex) {
        if (!Array.isArray(projection?.players)) return null;
        return projection.players.find((player) => player?.playerIndex === playerIndex) || null;
    }

    _findProjectedLockTarget(projection, playerIndex) {
        if (!Array.isArray(projection?.lockTargets)) return null;
        return projection.lockTargets.find((entry) => entry?.playerIndex === playerIndex) || null;
    }

    /**
     * Returns the local player index (0 for host / single-player).
     */
    _getLocalPlayerIndex(projection = null) {
        if (Number.isInteger(projection?.localPlayerIndex)) {
            return projection.localPlayerIndex;
        }
        const localSessionPlayer = Array.isArray(projection?.sessionPlayers)
            ? projection.sessionPlayers.find((player) => player?.isLocal === true)
            : null;
        if (Number.isInteger(localSessionPlayer?.playerIndex) && localSessionPlayer.playerIndex >= 0) {
            return localSessionPlayer.playerIndex;
        }
        return 0;
    }

    /**
     * Returns true if this is a network session.
     */
    _isNetworkSession(projection = null) {
        if (typeof projection?.isNetworkSession === 'boolean') {
            return projection.isNetworkSession;
        }
        return !!this.game?.runtimeConfig?.session?.networkEnabled;
    }

    _syncHudMode(projection = null) {
        const hud = this.game?.ui?.hud;
        if (!hud) return;
        const slowMoPlayers = projection?.players || this.game?.entityManager?.players;
        this._slowMoActive = syncHudSlowMoClass(hud, slowMoPlayers, this._slowMoActive);
        const requestedMode = String(this.game?.settings?.localSettings?.modePath || 'normal')
            .trim()
            .toLowerCase();
        const mode = requestedMode === 'fight' || requestedMode === 'arcade'
            ? requestedMode
            : 'normal';
        if (mode === this._hudMode) return;
        this._scorePresenter?.resetEvent();
        hud.dataset.hudMode = mode;
        this._hudMode = mode;
    }

    _getScorePresenter() {
        const hud = this.game?.ui?.hud;
        if (!hud) return null;
        if (!this._scorePresenter) this._scorePresenter = new MatchScoreHudPresenter(hud);
        return this._scorePresenter;
    }

    resetMatchScoreEvents() {
        this._scorePresenter?.resetEvent();
    }

    updateScoreHud(projection = null) {
        const game = this.game;
        const runtimeProjection = projection || this._getMatchRuntimeProjection();

        // Network mode: update N-player scoreboard
        if (this._isNetworkSession(runtimeProjection)) {
            this._getScorePresenter()?.updateNetwork(
                runtimeProjection,
                game.entityManager?.players,
                this._getLocalPlayerIndex(runtimeProjection)
            );
            this._scorePresenter?.hideClassic();
            // Still update local player's item bar
            const localIdx = Math.max(0, this._getLocalPlayerIndex(runtimeProjection));
            const localPlayer = this._findProjectedPlayer(runtimeProjection, localIdx)
                || game.entityManager?.players?.[localIdx];
            if (localPlayer && game.ui.p1Items) {
                this._updateItemBar(game.ui.p1Items, localPlayer, runtimeProjection, 0);
                updateTraversalStatus(game.ui.p1TraversalStatus, localPlayer);
            }
            // The top-left tile shows the own player, counted like the scoreboard.
            const tile = resolveLocalHudTile(runtimeProjection);
            if (tile && game.ui.p1Name && game.ui.p1Name.textContent !== tile.name) game.ui.p1Name.textContent = tile.name;
            if (tile && game.ui.p1Score && game.ui.p1Score.textContent !== tile.score) game.ui.p1Score.textContent = tile.score;
            return;
        }

        // Original local scoreboard logic
        const humans = Array.isArray(runtimeProjection?.players)
            ? runtimeProjection.players.filter((player) => player?.isBot !== true)
            : (game.entityManager?.getHumanPlayers ? game.entityManager.getHumanPlayers() : []);
        const isClassic = this._hudMode === 'normal' && runtimeProjection?.hunt?.active !== true;
        if (isClassic) {
            const players = Array.isArray(runtimeProjection?.players)
                ? runtimeProjection.players
                : game.entityManager?.players || [];
            this._getScorePresenter()?.updateClassic(players);
        } else {
            this._scorePresenter?.hideClassic();
        }

        if (humans.length > 0) {
            const p1Score = String(humans[0].score);
            if (game.ui.p1Score.textContent !== p1Score) {
                game.ui.p1Score.textContent = p1Score;
            }
            this._updateItemBar(game.ui.p1Items, humans[0], runtimeProjection, 0);
            updateTraversalStatus(game.ui.p1TraversalStatus, humans[0]);
        }

        if (humans.length > 1) {
            const p2Score = String(humans[1].score);
            if (game.ui.p2Score.textContent !== p2Score) {
                game.ui.p2Score.textContent = p2Score;
            }
            this._updateItemBar(game.ui.p2Items, humans[1], runtimeProjection, 1);
            updateTraversalStatus(game.ui.p2TraversalStatus, humans[1]);
        }
    }

    /**
     * Removes the network scoreboard DOM element (e.g. when returning to menu).
     */
    clearNetworkScoreboard() {
        this._scorePresenter?.reset();
        this._setParcoursHudVisible(false);
        this._hideArcadeHud();
        // The minimap canvas hangs on document.body, outside the HUD, so hiding the HUD misses it.
        this._parcoursOverlay?.hideMinimap?.();
        this._parcoursOverlay?.hideFlashes?.();
    }

    _ensureArcadeHud() {
        const parent = this.game?.ui?.hud || document.body;
        if (!this._arcadeMissionHud) {
            this._arcadeMissionHud = new ArcadeMissionHUD(parent);
        }
        if (!this._arcadeScoreHud) {
            this._arcadeScoreHud = new ArcadeScoreHUD(parent);
        }
    }

    _hideArcadeHud() {
        this._arcadeMissionHud?.hide?.();
        this._arcadeScoreHud?.hide?.();
        this._hideArcadeFeedbackOverlays();
    }

    _ensureParcoursOverlay() {
        if (!this._parcoursOverlay) this._parcoursOverlay = new ParcoursOverlayController();
        return this._parcoursOverlay;
    }

    _ensureArcadeFeedbackOverlays() {
        if (!this._arcadeSuddenDeathOverlay) {
            const overlay = document.createElement('div');
            overlay.id = 'arcade-sudden-death-overlay';
            overlay.className = 'hidden';
            document.body.appendChild(overlay);
            this._arcadeSuddenDeathOverlay = overlay;
        }
        if (!this._arcadeSectorTransitionOverlay) {
            const overlay = document.createElement('div');
            overlay.id = 'arcade-sector-transition-overlay';
            overlay.className = 'hidden';
            document.body.appendChild(overlay);
            this._arcadeSectorTransitionOverlay = overlay;
        }
    }

    _hideArcadeFeedbackOverlays() {
        if (this._arcadeSuddenDeathOverlay) {
            this._arcadeSuddenDeathOverlay.classList.add('hidden');
        }
        if (this._arcadeSectorTransitionOverlay) {
            this._arcadeSectorTransitionOverlay.classList.add('hidden');
        }
        this._arcadeTransitionVisibleUntilMs = 0;
        this._lastArcadeSectorIndex = 0;
    }

    // Round end settles the sector score after the last playing tick, and no playing tick runs
    // during the intermission, so the arcade panel is redrawn once from a fresh projection.
    refreshArcadeHud() {
        this._updateArcadeHud(this._getMatchRuntimeProjection());
    }

    _updateArcadeHud(projection = null) {
        const hudState = projection?.arcade || null;
        if (!hudState || hudState.phase === 'finished') {
            this._hideArcadeHud();
            return;
        }

        this._ensureArcadeHud();
        this._arcadeScoreHud?.update?.(hudState);
        this._arcadeMissionHud?.update?.(hudState.missionState, hudState.objectiveState);
        this._ensureArcadeFeedbackOverlays();

        const nowMs = Math.max(0, Number(hudState.nowMs) || Date.now());
        const overlay = this._ensureParcoursOverlay();
        overlay.tickXp(hudState, nowMs);
        overlay.tickSplitDelta(hudState, nowMs);
        overlay.tickPenalty(hudState, nowMs);
        const suddenDeathActive = String(hudState.phase || '') === 'sudden_death';
        this._arcadeSuddenDeathOverlay?.classList?.toggle('hidden', !suddenDeathActive);

        const sectorIndex = Math.max(0, Math.floor(Number(hudState.sectorIndex) || 0));
        const sectorChanged = sectorIndex > 0 && sectorIndex !== this._lastArcadeSectorIndex;
        // 82.8.3: Show vehicle stats banner on sector start
        overlay.tickStatsFlash(hudState, nowMs, sectorChanged);
        if (sectorChanged) {
            this._arcadeTransitionVisibleUntilMs = nowMs + 1200;
            if (this._arcadeSectorTransitionOverlay) {
                const mapKey = String(hudState.currentMapKey || '').trim() || 'unknown';
                this._arcadeSectorTransitionOverlay.textContent = `Sektor ${sectorIndex}  |  ${mapKey}`;
                this._arcadeSectorTransitionOverlay.classList.remove('hidden');
            }
        }
        this._lastArcadeSectorIndex = sectorIndex;
        if (this._arcadeSectorTransitionOverlay) {
            this._arcadeSectorTransitionOverlay.classList.toggle('hidden', nowMs >= this._arcadeTransitionVisibleUntilMs);
        }

    }

    // Each split-screen player owns one parcours panel; refs are grouped so the
    // same render path serves both without duplicating the formatting rules.
    _getParcoursPanelRefs(playerIndex) {
        return resolveParcoursPanelRefs(this.game?.ui, playerIndex);
    }

    _setParcoursHudVisible(isVisible, refs = null) {
        setParcoursPanelVisible(refs || this._getParcoursPanelRefs(0), isVisible);
    }

    _clearParcoursHud(refs = null) {
        clearParcoursPanel(refs || this._getParcoursPanelRefs(0));
    }

    /** Writes one parcours panel. Tutorial progress persists only for the primary panel. */
    _renderParcoursPanel(refs, hudState, isPrimary) {
        const persistTutorial = isPrimary && !this._tutorialCompletionPersisted;
        if (renderParcoursPanel(refs, hudState, this.game, persistTutorial)) {
            this._tutorialCompletionPersisted = true;
        }
    }

    _updateParcoursHud(projection = null, updateMinimap = true) {
        const game = this.game;
        const primaryRefs = this._getParcoursPanelRefs(0);
        if (!primaryRefs) return;

        const hudState = projection?.parcours
            || (game?.entityManager
                ? game.entityManager.getParcoursHudState(
                    this._isNetworkSession(projection)
                        ? Math.max(0, this._getLocalPlayerIndex(projection))
                        : 0
                )
                : null);
        this._updateSecondaryParcoursHud(projection);
        if (!hudState?.enabled) {
            this._setParcoursHudVisible(false, primaryRefs);
            this._clearParcoursHud(primaryRefs);
            this._parcoursOverlay?.hideMinimap?.();
            return;
        }

        this._setParcoursHudVisible(true, primaryRefs);
        if (updateMinimap) {
            const minimapProjection = projection?.parcours === hudState
                ? projection
                : this._parcoursMinimapProjection;
            if (minimapProjection === this._parcoursMinimapProjection) {
                minimapProjection.parcours = hudState;
                minimapProjection.players = projection?.players || null;
            }
            this._ensureParcoursOverlay().tickMinimap(
                game?.entityManager,
                minimapProjection,
                this._isNetworkSession(projection)
                    ? Math.max(0, this._getLocalPlayerIndex(projection))
                    : 0
            );
        }
        this._renderParcoursPanel(primaryRefs, hudState, true);
    }

    /**
     * Second local player's parcours panel. Only ever shown in local
     * split-screen; network sessions render a single local view.
     */
    _updateSecondaryParcoursHud(projection = null) {
        const refs = this._getParcoursPanelRefs(1);
        if (!refs) return;

        const isSplitScreen = this.game?.ui?.hud?.classList?.contains('split-screen') === true;
        const hudState = isSplitScreen && !this._isNetworkSession(projection)
            ? this.game?.entityManager?.getParcoursHudState?.(1) || null
            : null;

        if (!hudState?.enabled) {
            this._setParcoursHudVisible(false, refs);
            this._clearParcoursHud(refs);
            return;
        }

        this._setParcoursHudVisible(true, refs);
        this._renderParcoursPanel(refs, hudState, false);
    }

    /**
     * Resolves the live key bindings for a player so item slots can show the
     * key that actually fires them (items are cycled, never number-selected).
     */
    _getPlayerKeyBindings(playerIndex) {
        const scope = playerIndex === 1 ? 'PLAYER_2' : 'PLAYER_1';
        return this.game?.inputManager?.bindings?.[scope]
            || this.game?.settings?.controls?.[scope]
            || null;
    }

    _updateItemBar(container, player, projection = null, playerIndex = 0) {
        if (!this._rocketBars) this._rocketBars = new Map();
        let rocketBar = this._rocketBars.get(container);
        if (!rocketBar) {
            rocketBar = document.createElement('div');
            rocketBar.className = 'item-bar rocket-bar';
            container.parentNode?.insertBefore(rocketBar, container);
            this._rocketBars.set(container, rocketBar);
        }
        updateRocketBar(rocketBar, player, projection, resolveGameplayConfig(this.game), this._getPlayerKeyBindings(playerIndex));
        updateItemBar(
            container,
            player,
            projection,
            resolveGameplayConfig(this.game),
            this._getPlayerKeyBindings(playerIndex)
        );
        this._updateCooldownIndicator(container, player);
        this._updateActiveEffectBar(container, player, projection?.globalFog);
    }

    _updateActiveEffectBar(container, player, globalFog = null) {
        if (!this._activeEffectBars) this._activeEffectBars = new WeakMap();
        let effectBar = this._activeEffectBars.get(container);
        if (!effectBar) {
            effectBar = document.createElement('div');
            effectBar.className = 'active-effect-bar hidden';
            effectBar.setAttribute?.('role', 'status');
            effectBar.setAttribute?.('aria-label', 'Aktive Effekte');
            container.parentNode?.insertBefore(effectBar, container.nextSibling);
            this._activeEffectBars.set(container, effectBar);
        }
        updateActiveEffectBar(effectBar, player, globalFog);
    }

    _updateCooldownIndicator(container, player) {
        if (!this._cooldownIndicators) this._cooldownIndicators = new WeakMap();
        let indicator = this._cooldownIndicators.get(container);
        if (!indicator) {
            indicator = document.createElement('div');
            indicator.className = 'item-cooldown-global hidden';
            container.parentNode?.insertBefore(indicator, container.nextSibling);
            this._cooldownIndicators.set(container, indicator);
        }
        const remaining = Math.max(
            0,
            Number(player?.shootCooldown) || 0,
            Number(player?.itemUseCooldownRemaining) || 0
        );
        // One decimal is shown, so anything below 0.05 s would read "0.0s".
        if (remaining >= 0.05) {
            indicator.textContent = remaining.toFixed(1) + 's';
            indicator.classList.remove('hidden');
        } else {
            indicator.classList.add('hidden');
        }
    }

    _setHudP2Visibility(isVisible) {
        if (this._hudP2Visible === isVisible) return;
        this._hudP2Visible = isVisible;
        if (this.ports?.uiFeedbackPort?.toggleP2Hud) {
            this.ports.uiFeedbackPort.toggleP2Hud(isVisible);
            return;
        }
        this.game.hudP2.setVisibility(isVisible);
    }

    _resolveScoreHudInterval() {
        const configured = Number(this.game?.runtimeConfig?.uiHotpath?.scoreInventoryInterval);
        return Number.isFinite(configured) && configured > 0 ? configured : 0.2;
    }

    _resolveFighterHudInterval() {
        const configured = Number(this.game?.runtimeConfig?.uiHotpath?.fighterHudInterval);
        return Number.isFinite(configured) && configured > 0 ? configured : 0.05;
    }

    _consumeInterval(timerKey, dt, interval) {
        const elapsed = this[timerKey] + dt;
        if (elapsed < interval) {
            this[timerKey] = elapsed;
            return 0;
        }
        this[timerKey] = elapsed % interval;
        return elapsed;
    }

    updatePlayingHudTick(dt, runtimeProjection = null) {
        const game = this.game;
        if (!game.entityManager) return;
        const projection = runtimeProjection || this._getMatchRuntimeProjection();
        this._syncHudMode(projection);
        const updateMinimap = this._consumeInterval(
            '_parcoursMinimapTimer',
            dt,
            PARCOURS_MINIMAP_INTERVAL_SECONDS
        ) > 0;
        this._updateParcoursHud(projection, updateMinimap);

        // Score/Inventory laufen auf eigener, konservativer Tick-Frequenz.
        const scoreHudInterval = this._resolveScoreHudInterval();
        game._hudTimer += dt;
        if (game._hudTimer >= scoreHudInterval) {
            game._hudTimer %= scoreHudInterval;
            this.updateScoreHud(projection);
        }

        const fighterHudInterval = this._resolveFighterHudInterval();
        const fighterElapsed = this._consumeInterval('_fighterHudTimer', dt, fighterHudInterval);
        if (fighterElapsed > 0) {
            this._updateArcadeHud(projection);
        }

        // FIGHTER HUD UPDATE
        const localHumans = Math.max(1, Number(projection?.localHumanCount || game.numHumans) || 1);
        const networkSession = this._isNetworkSession(projection);
        // In network mode only 1 local player — no P2 HUD
        this._setHudP2Visibility(!networkSession && localHumans >= 2);
        if (fighterElapsed <= 0) return;

        if (networkSession) {
            // Show only the local player's fighter HUD
            const localIdx = Math.max(0, this._getLocalPlayerIndex(projection));
            const localPlayer = this._findProjectedPlayer(projection, localIdx)
                || game.entityManager.players[localIdx];
            if (localPlayer) {
                game.hudP1.update(localPlayer, fighterElapsed, {
                    lockTarget: this._findProjectedLockTarget(projection, localIdx),
                });
            }
        } else {
            const p1 = this._findProjectedPlayer(projection, 0) || game.entityManager.players[0];
            if (p1) {
                game.hudP1.update(p1, fighterElapsed, {
                    lockTarget: this._findProjectedLockTarget(projection, 0),
                });
            }

            if (localHumans >= 2) {
                const p2 = this._findProjectedPlayer(projection, 1) || game.entityManager.players[1];
                if (p2) {
                    game.hudP2.update(p2, fighterElapsed, {
                        lockTarget: this._findProjectedLockTarget(projection, 1),
                    });
                }
            }
        }
    }

    dispose() {
        if (this._rocketBars) {
            for (const rocketBar of this._rocketBars.values()) rocketBar?.remove?.();
            this._rocketBars.clear();
        }
        this.clearNetworkScoreboard();
        this._scorePresenter?.dispose();
        this._scorePresenter = null;
        this._arcadeMissionHud?.dispose?.();
        this._arcadeScoreHud?.dispose?.();
        this._arcadeMissionHud = null;
        this._arcadeScoreHud = null;
        if (this._arcadeSuddenDeathOverlay?.parentElement) {
            this._arcadeSuddenDeathOverlay.parentElement.removeChild(this._arcadeSuddenDeathOverlay);
        }
        if (this._arcadeSectorTransitionOverlay?.parentElement) {
            this._arcadeSectorTransitionOverlay.parentElement.removeChild(this._arcadeSectorTransitionOverlay);
        }
        this._arcadeSuddenDeathOverlay = null;
        this._arcadeSectorTransitionOverlay = null;
        this._arcadeTransitionVisibleUntilMs = 0;
        this._lastArcadeSectorIndex = 0;
        this._parcoursOverlay?.dispose?.();
        this._parcoursOverlay = null;
        if (this.game?.ui?.hud?.dataset) {
            delete this.game.ui.hud.dataset.hudMode;
        }
        this.game?.ui?.hud?.classList?.remove('slowmo-active');
        this._hudMode = null;
        this._slowMoActive = null;
    }
}
