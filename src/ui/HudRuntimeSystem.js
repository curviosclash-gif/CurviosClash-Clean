// ============================================
// HudRuntimeSystem.js - HUD runtime orchestration
// ============================================

import { ArcadeMissionHUD } from './arcade/ArcadeMissionHUD.js';
import { ArcadeScoreHUD } from './arcade/ArcadeScoreHUD.js';
import { ParcoursOverlayController } from './arcade/ParcoursOverlayController.js';
import { updateItemBar } from './ItemBarPresenter.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';
import { updateTraversalStatus } from './TraversalHudPresenter.js';
import {
    createCompletedClassicTutorialState,
    isClassicTutorialRoute,
    resolveClassicTutorialHint,
} from '../shared/contracts/ClassicTutorialContract.js';

function formatParcoursDurationMs(value) {
    const ms = Math.max(0, Number(value) || 0);
    const seconds = ms / 1000;
    return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`;
}

export class HudRuntimeSystem {
    constructor(deps = {}) {
        this.game = deps.game || null;
        this.ports = deps.ports || null;
        this._hudP2Visible = null;
        this._fighterHudTimer = 0;
        /** @type {HTMLElement|null} */
        this._scoreboardContainer = null;
        this._arcadeMissionHud = null;
        this._arcadeScoreHud = null;
        this._arcadeSuddenDeathOverlay = null;
        this._arcadeSectorTransitionOverlay = null;
        this._arcadeTransitionVisibleUntilMs = 0;
        this._lastArcadeSectorIndex = 0;
        this._parcoursOverlay = null;
        this._tutorialCompletionPersisted = false;
    }

    _getMatchRuntimeProjection() {
        return this.ports?.runtimeProjectionPort?.getMatchRuntimeProjection?.() || null;
    }

    _findProjectedPlayer(projection, playerIndex) {
        if (!Array.isArray(projection?.players)) return null;
        return projection.players.find((player) => player?.playerIndex === playerIndex) || null;
    }

    _findProjectedSessionPlayer(projection, playerIndex) {
        if (!Array.isArray(projection?.sessionPlayers)) return null;
        return projection.sessionPlayers.find((player) => player?.playerIndex === playerIndex) || null;
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

    updateScoreHud(projection = null) {
        const game = this.game;
        const runtimeProjection = projection || this._getMatchRuntimeProjection();

        // Network mode: update N-player scoreboard
        if (this._isNetworkSession(runtimeProjection)) {
            this._updateNetworkScoreboard(runtimeProjection);
            // Still update local player's item bar
            const localIdx = Math.max(0, this._getLocalPlayerIndex(runtimeProjection));
            const localPlayer = this._findProjectedPlayer(runtimeProjection, localIdx)
                || game.entityManager?.players?.[localIdx];
            if (localPlayer && game.ui.p1Items) {
                this._updateItemBar(game.ui.p1Items, localPlayer, runtimeProjection);
                updateTraversalStatus(game.ui.p1TraversalStatus, localPlayer);
            }
            return;
        }

        // Original local scoreboard logic
        const humans = Array.isArray(runtimeProjection?.players)
            ? runtimeProjection.players.filter((player) => player?.isBot !== true)
            : (game.entityManager?.getHumanPlayers ? game.entityManager.getHumanPlayers() : []);

        if (humans.length > 0) {
            const p1Score = String(humans[0].score);
            if (game.ui.p1Score.textContent !== p1Score) {
                game.ui.p1Score.textContent = p1Score;
            }
            this._updateItemBar(game.ui.p1Items, humans[0], runtimeProjection);
            updateTraversalStatus(game.ui.p1TraversalStatus, humans[0]);
        }

        if (humans.length > 1) {
            const p2Score = String(humans[1].score);
            if (game.ui.p2Score.textContent !== p2Score) {
                game.ui.p2Score.textContent = p2Score;
            }
            this._updateItemBar(game.ui.p2Items, humans[1], runtimeProjection);
            updateTraversalStatus(game.ui.p2TraversalStatus, humans[1]);
        }
    }

    /**
     * Renders a dynamic N-player scoreboard for network sessions (up to 10 players).
     * Shows all players with score and ping indicator.
     */
    _updateNetworkScoreboard(projection = null) {
        const game = this.game;
        const players = Array.isArray(projection?.players) ? projection.players : game.entityManager?.players;
        if (!players || players.length === 0) return;

        const container = this._ensureScoreboardContainer();
        if (!container) return;

        // Ensure we have enough rows
        while (container.children.length < players.length) {
            const row = document.createElement('div');
            row.className = 'mp-scoreboard-row';
            const name = document.createElement('span');
            name.className = 'mp-sb-name';
            const score = document.createElement('span');
            score.className = 'mp-sb-score';
            const ping = document.createElement('span');
            ping.className = 'mp-sb-ping';
            row.appendChild(name);
            row.appendChild(score);
            row.appendChild(ping);
            container.appendChild(row);
        }
        while (container.children.length > players.length) {
            container.removeChild(container.lastChild);
        }

        const sessionPlayers = Array.isArray(projection?.sessionPlayers)
            ? projection.sessionPlayers
            : [];

        for (let i = 0; i < players.length; i++) {
            const p = players[i];
            const row = container.children[i];
            const nameEl = row.children[0];
            const scoreEl = row.children[1];
            const pingEl = row.children[2];

            const idx = p.playerIndex ?? p.index ?? i;
            const label = p.isBot ? `Bot ${idx + 1}` : `P${idx + 1}`;
            if (nameEl.textContent !== label) nameEl.textContent = label;

            const scoreStr = String(p.score ?? 0);
            if (scoreEl.textContent !== scoreStr) scoreEl.textContent = scoreStr;

            // Ping from session peer data (if available)
            const playerIndex = p?.playerIndex ?? p?.index ?? i;
            const peer = this._findProjectedSessionPlayer(projection, playerIndex)
                || sessionPlayers.find((sp) => (sp?.playerIndex ?? sp?.index) === playerIndex);
            const pingMs = peer?.pingMs ?? peer?.ping ?? (p.isBot ? 0 : -1);
            const pingLabel = pingMs >= 0 ? `${pingMs}ms` : '';
            if (pingEl.textContent !== pingLabel) pingEl.textContent = pingLabel;
        }
    }

    _ensureScoreboardContainer() {
        if (this._scoreboardContainer) return this._scoreboardContainer;
        const hud = this.game?.ui?.hud;
        if (!hud) return null;
        let container = hud.querySelector('.mp-scoreboard');
        if (!container) {
            container = document.createElement('div');
            container.className = 'mp-scoreboard';
            hud.appendChild(container);
        }
        this._scoreboardContainer = container;
        return container;
    }

    /**
     * Removes the network scoreboard DOM element (e.g. when returning to menu).
     */
    clearNetworkScoreboard() {
        if (this._scoreboardContainer) {
            this._scoreboardContainer.remove();
            this._scoreboardContainer = null;
        }
        this._setParcoursHudVisible(false);
        this._hideArcadeHud();
    }

    _ensureArcadeHud() {
        if (!this._arcadeMissionHud) {
            this._arcadeMissionHud = new ArcadeMissionHUD(document.body);
        }
        if (!this._arcadeScoreHud) {
            this._arcadeScoreHud = new ArcadeScoreHUD(document.body);
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

    _updateArcadeHud(projection = null) {
        const hudState = projection?.arcade || null;
        if (!hudState || hudState.phase === 'finished') {
            this._hideArcadeHud();
            return;
        }

        this._ensureArcadeHud();
        this._arcadeScoreHud?.update?.(hudState);
        this._arcadeMissionHud?.update?.(hudState.missionState);
        this._ensureArcadeFeedbackOverlays();

        const nowMs = Math.max(0, Number(hudState.nowMs) || Date.now());
        const overlay = this._ensureParcoursOverlay();
        overlay.tickXp(hudState, nowMs);
        overlay.tickSplitDelta(hudState, nowMs);
        overlay.tickPenalty(hudState, nowMs);
        overlay.tickMinimap(this.game?.entityManager, projection, this._getLocalPlayerIndex(projection));
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

    _setParcoursHudVisible(isVisible) {
        const root = this.game?.ui?.parcoursHud;
        if (!root) return;
        root.classList.toggle('hidden', !isVisible);
    }

    _clearParcoursHud() {
        const ui = this.game?.ui;
        if (!ui) return;
        if (ui.parcoursProgress) ui.parcoursProgress.textContent = 'CP 0/0';
        if (ui.parcoursTimer) ui.parcoursTimer.textContent = '0.00s';
        if (ui.parcoursStatus) {
            ui.parcoursStatus.textContent = '';
            ui.parcoursStatus.classList.remove('success');
        }
    }

    _updateParcoursHud(projection = null) {
        const game = this.game;
        const ui = game?.ui;
        if (!ui?.parcoursHud) return;

        const hudState = projection?.parcours
            || (game?.entityManager
                ? game.entityManager.getParcoursHudState(
                    this._isNetworkSession(projection)
                        ? Math.max(0, this._getLocalPlayerIndex(projection))
                        : 0
                )
                : null);
        if (!hudState?.enabled) {
            this._setParcoursHudVisible(false);
            this._clearParcoursHud();
            return;
        }

        this._setParcoursHudVisible(true);
        this._ensureParcoursOverlay().tickMinimap(
            game?.entityManager,
            { ...projection, parcours: hudState },
            this._isNetworkSession(projection)
                ? Math.max(0, this._getLocalPlayerIndex(projection))
                : 0
        );
        const routeLabel = String(hudState.routeId || 'parcours').replace(/_/g, ' ');
        if (ui.parcoursRoute) ui.parcoursRoute.textContent = routeLabel;

        const total = Math.max(0, Number(hudState.totalCheckpoints) || 0);
        const current = Math.max(0, Math.min(total, Number(hudState.currentCheckpoint) || 0));
        if (ui.parcoursProgress) {
            ui.parcoursProgress.textContent = `CP ${current}/${total}`;
        }

        if (ui.parcoursTimer) {
            if (hudState.completed) {
                ui.parcoursTimer.textContent = `Finish ${formatParcoursDurationMs(hudState.completionTimeMs)}`;
            } else {
                ui.parcoursTimer.textContent = `Segment ${formatParcoursDurationMs(hudState.segmentElapsedMs)}`;
            }
        }

        if (ui.parcoursStatus) {
            let statusText = '';
            let isSuccess = false;
            if (hudState.completed) {
                statusText = 'Parcours abgeschlossen';
                isSuccess = true;
            } else if (hudState.hasError && hudState.errorMessage) {
                statusText = hudState.errorMessage;
            }
            if (isClassicTutorialRoute(hudState.routeId)) {
                statusText = resolveClassicTutorialHint(current, hudState.completed);
                isSuccess = hudState.completed === true;
                if (hudState.completed && !this._tutorialCompletionPersisted) {
                    this._tutorialCompletionPersisted = true;
                    const settings = game?.settings;
                    if (settings) {
                        if (!settings.localSettings || typeof settings.localSettings !== 'object') settings.localSettings = {};
                        settings.localSettings.classicTutorial = createCompletedClassicTutorialState(
                            settings.localSettings.classicTutorial
                        );
                        game.settingsManager?.saveSettings?.(settings);
                    }
                }
            }
            ui.parcoursStatus.textContent = statusText;
            ui.parcoursStatus.classList.toggle('success', isSuccess);
        }
    }

    _updateItemBar(container, player, projection = null) {
        updateItemBar(container, player, projection, resolveGameplayConfig(this.game));
        this._updateCooldownIndicator(container, player);
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
        if (remaining > 0.001) {
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
        const configuredInterval = Number(this.game?.runtimeConfig?.uiHotpath?.scoreInventoryInterval);
        if (Number.isFinite(configuredInterval) && configuredInterval > 0) {
            return configuredInterval;
        }
        return 0.2;
    }

    _resolveFighterHudInterval() {
        const configuredInterval = Number(this.game?.runtimeConfig?.uiHotpath?.fighterHudInterval);
        if (Number.isFinite(configuredInterval) && configuredInterval > 0) {
            return configuredInterval;
        }
        return 0.05;
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
        this._updateParcoursHud(projection);

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
        this.clearNetworkScoreboard();
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
    }
}
