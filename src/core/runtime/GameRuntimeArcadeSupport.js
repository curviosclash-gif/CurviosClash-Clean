import { createArcadeRoundStateController } from '../../state/arcade/ArcadeRoundStateController.js';
import {
    buildArcadeSectorPlan,
    resolveArcadeSectorRuntimeProfile,
} from '../../entities/directors/ArcadeEncounterCatalog.js';
import { resolveMapSequence } from '../../state/arcade/ArcadeMapProgression.js';
import { getRuntimeMapCatalog } from '../../shared/contracts/RuntimeMapCatalogContract.js';
import { ArcadeRunRuntime } from '../arcade/ArcadeRunRuntime.js';
import { ReplayRecorder } from '../replay/ReplayRecorder.js';

export class GameRuntimeArcadeSupport {
    constructor({
        getGame = null,
        getRuntimeState = null,
        nowMs = undefined,
        logger = console,
        applySectorRuntimeProfile = null,
    } = {}) {
        this._getGame = typeof getGame === 'function' ? getGame : () => null;
        this._getRuntimeState = typeof getRuntimeState === 'function' ? getRuntimeState : () => null;
        this._baseRoundStateController = this.getRuntimeState()?.roundStateController
            || this.game?.roundStateController
            || null;
        this._arcadeRoundStateController = null;
        this._boundGameplayEntityManager = null;
        this._arcadeReplayRecorder = new ReplayRecorder();
        this._applySectorRuntimeProfile = typeof applySectorRuntimeProfile === 'function'
            ? applySectorRuntimeProfile
            : null;
        this._preparedEncounterPlan = null;
        this._pendingSectorTransition = null;
        this.arcadeRunRuntime = new ArcadeRunRuntime({
            settingsManager: this.game?.settingsManager || null,
            replayRecorder: this._arcadeReplayRecorder,
            now: nowMs,
            logger,
        });
        this._arcadeGameplayEventHandler = (event) => this.arcadeRunRuntime.applyGameplayEvent(event);

        const withArcadeStrategy = (handler) => {
            const strategy = this.getRuntimeState()?.entityManager?.gameModeStrategy
                || this.game?.entityManager?.gameModeStrategy
                || null;
            if (strategy) {
                handler(strategy);
            }
        };

        this.arcadeRunRuntime.setModifierChangedHandler((modifierId) => withArcadeStrategy((strategy) => strategy.setActiveModifier?.(modifierId)));
        this.arcadeRunRuntime.setVehicleUpgradesHandler((bonuses) => withArcadeStrategy((strategy) => strategy.applyVehicleUpgrades?.(bonuses)));
        this.arcadeRunRuntime.setSuddenDeathEnteredHandler(() => withArcadeStrategy((strategy) => strategy.enterSuddenDeath?.()));
        this.arcadeRunRuntime.setMapTransitionHandler((transition) => {
            this._pendingSectorTransition = transition && typeof transition === 'object'
                ? { ...transition }
                : null;
        });
    }

    get game() {
        return this._getGame();
    }

    getRuntimeState() {
        return this._getRuntimeState();
    }

    _activateRoundController() {
        const runtimeState = this.getRuntimeState();
        if (!runtimeState?.roundStateController) {
            return;
        }
        if (!this._baseRoundStateController) {
            this._baseRoundStateController = runtimeState.roundStateController;
        }
        if (!this._arcadeRoundStateController) {
            this._arcadeRoundStateController = createArcadeRoundStateController({
                baseController: this._baseRoundStateController,
                arcadeRuntime: this.arcadeRunRuntime,
            });
        }
        runtimeState.roundStateController = this._arcadeRoundStateController;
    }

    _deactivateRoundController() {
        const runtimeState = this.getRuntimeState();
        if (runtimeState && this._baseRoundStateController) {
            runtimeState.roundStateController = this._baseRoundStateController;
        }
    }

    syncRuntimeConfig() {
        const runtimeConfig = this.getRuntimeState()?.runtimeConfig || null;
        if (!runtimeConfig) {
            return;
        }
        this.arcadeRunRuntime.configure(runtimeConfig);
        if (runtimeConfig?.arcade?.enabled) {
            this._activateRoundController();
            return;
        }
        this._deactivateRoundController();
        this._unbindGameplayCallback();
        this.resetRunState({ preserveRecords: true });
    }

    _bindGameplayCallback(runtimeState = this.getRuntimeState()) {
        const entityManager = runtimeState?.entityManager || null;
        if (this._boundGameplayEntityManager && this._boundGameplayEntityManager !== entityManager) {
            this._unbindGameplayCallback();
        }
        if (!entityManager) return;
        entityManager.onArcadeGameplayEvent = this._arcadeGameplayEventHandler;
        this._boundGameplayEntityManager = entityManager;
    }

    _unbindGameplayCallback() {
        if (this._boundGameplayEntityManager?.onArcadeGameplayEvent === this._arcadeGameplayEventHandler) {
            this._boundGameplayEntityManager.onArcadeGameplayEvent = null;
        }
        this._boundGameplayEntityManager = null;
    }

    _bindParcoursCallbacks(runtimeState = this.getRuntimeState()) {
        const parcoursSystem = runtimeState?.entityManager?._parcoursProgressSystem;
        if (parcoursSystem && typeof parcoursSystem.setXpEventCallback === 'function') {
            parcoursSystem.setXpEventCallback(
                (eventType, playerIndex) => this.arcadeRunRuntime.applyParcoursXpEvent(eventType, playerIndex)
            );
        }
        if (parcoursSystem && typeof parcoursSystem.setLeaderboardCallback === 'function') {
            parcoursSystem.setLeaderboardCallback(
                (data) => this.arcadeRunRuntime.applyParcoursLeaderboardEvent(data)
            );
        }
        if (parcoursSystem && typeof parcoursSystem.setGhostRecorder === 'function') {
            parcoursSystem.setGhostRecorder(this.arcadeRunRuntime.getGhostRecorder?.() || null);
        }
        if (typeof this.arcadeRunRuntime.setGhostPlaybackHandler === 'function') {
            const entityManager = runtimeState?.entityManager || null;
            this.arcadeRunRuntime.setGhostPlaybackHandler(
                (clip) => entityManager?.playLastRoundGhost?.(clip)
            );
        }
    }

    _resolveActiveVehicleId(runtimeConfig = null) {
        return String(
            runtimeConfig?.player?.vehicles?.PLAYER_1
            || this.game?.settings?.vehicles?.PLAYER_1
            || 'ship5'
        ).trim() || 'ship5';
    }

    _buildEncounterPlan(runtimeConfig) {
        return buildArcadeSectorPlan({
            seed: runtimeConfig?.arcade?.seed,
            sectorCount: runtimeConfig?.arcade?.sectorCount,
            difficulty: runtimeConfig?.bot?.activeDifficulty || runtimeConfig?.bot?.difficulty || 'normal',
        });
    }

    prepareMatchStartRuntime() {
        const runtimeState = this.getRuntimeState();
        const runtimeConfig = runtimeState?.runtimeConfig || null;
        if (!runtimeConfig?.arcade?.enabled) {
            this._preparedEncounterPlan = null;
            this._pendingSectorTransition = null;
            return null;
        }

        this.arcadeRunRuntime.setActiveVehicle(this._resolveActiveVehicleId(runtimeConfig));
        const existing = this.arcadeRunRuntime.getStateSnapshot?.();
        let profile = null;
        if (existing && String(existing.phase || '').toLowerCase() !== 'finished') {
            profile = this.arcadeRunRuntime.getSectorRuntimeProfile?.(existing.sectorIndex, {
                fallbackBotCount: runtimeConfig?.session?.numBots,
                fallbackDifficulty: runtimeConfig?.bot?.activeDifficulty,
            }) || null;
        } else {
            const encounterPlan = this._buildEncounterPlan(runtimeConfig);
            this._preparedEncounterPlan = encounterPlan;
            const mapSequence = resolveMapSequence(
                encounterPlan,
                runtimeConfig?.arcade?.seed,
                getRuntimeMapCatalog()
            );
            profile = resolveArcadeSectorRuntimeProfile(encounterPlan.sequence?.[0], {
                sectorIndex: 1,
                mapKey: mapSequence[0],
                fallbackBotCount: runtimeConfig?.session?.numBots,
                fallbackDifficulty: runtimeConfig?.bot?.activeDifficulty,
            });
        }

        if (profile) {
            this._applySectorRuntimeProfile?.(profile);
        }
        return profile;
    }

    consumePendingSectorTransition() {
        const transition = this._pendingSectorTransition;
        this._pendingSectorTransition = null;
        if (!transition) return null;

        const runtimeState = this.getRuntimeState();
        const runtimeConfig = runtimeState?.runtimeConfig || null;
        const currentMapKey = String(runtimeConfig?.session?.mapKey || runtimeState?.mapKey || '').trim();
        const currentBotCount = Math.max(0, Math.trunc(Number(runtimeConfig?.session?.numBots) || 0));
        const nextMapKey = String(transition.toMap || transition.mapKey || currentMapKey).trim() || currentMapKey;
        const nextBotCount = Math.max(0, Math.trunc(Number(transition.botCount) || 0));
        const requiresSessionRebuild = currentMapKey !== nextMapKey || currentBotCount !== nextBotCount;
        const resolvedTransition = {
            ...transition,
            mapKey: nextMapKey,
            toMap: nextMapKey,
            botCount: nextBotCount,
            requiresSessionRebuild,
        };
        this._applySectorRuntimeProfile?.(resolvedTransition);
        return resolvedTransition;
    }

    startRunIfEnabled() {
        const runtimeState = this.getRuntimeState();
        const runtimeConfig = runtimeState?.runtimeConfig || null;
        this._bindParcoursCallbacks(runtimeState);
        if (!runtimeConfig?.arcade?.enabled) {
            return null;
        }
        this._bindGameplayCallback(runtimeState);
        this.arcadeRunRuntime.setActiveVehicle(this._resolveActiveVehicleId(runtimeConfig));
        const strategy = runtimeState?.entityManager?.gameModeStrategy || null;
        this.arcadeRunRuntime.setStrategy(strategy);
        const existing = this.arcadeRunRuntime.getStateSnapshot?.();
        if (existing && String(existing.phase || '').toLowerCase() !== 'finished') {
            return existing;
        }
        const encounterPlan = this._preparedEncounterPlan || this._buildEncounterPlan(runtimeConfig);
        this._preparedEncounterPlan = null;

        const startOptions = {
            entityManager: runtimeState?.entityManager || null,
            roundStateController: runtimeState?.roundStateController || null,
            playerCount: Math.max(1, Number(runtimeState?.numHumans) || 1),
            encounterPlan,
            strategy,
        };
        return runtimeConfig?.arcade?.dailyChallenge === true
            ? this.arcadeRunRuntime.startDailyChallenge(startOptions)
            : this.arcadeRunRuntime.startRun(startOptions);
    }

    resetRunState(options = undefined) {
        this._preparedEncounterPlan = null;
        this._pendingSectorTransition = null;
        return this.arcadeRunRuntime.resetRunState({
            preserveRecords: true,
            ...(options && typeof options === 'object' ? options : {}),
        });
    }

    getRunState() {
        return this.arcadeRunRuntime.getStateSnapshot?.() || null;
    }

    getMenuSurfaceState() {
        return this.arcadeRunRuntime.getMenuSurfaceState?.() || null;
    }

    tickSuddenDeath(dt = 0) {
        // This established per-frame arcade seam also advances time-based missions.
        this.arcadeRunRuntime.tickGameplay?.(dt);
        const hudState = this.arcadeRunRuntime.getHudState?.();
        if (!hudState || String(hudState.phase || '') !== 'sudden_death') {
            return null;
        }
        const strategy = this.getRuntimeState()?.entityManager?.gameModeStrategy
            || this.game?.entityManager?.gameModeStrategy
            || null;
        if (typeof strategy?.tickSuddenDeath !== 'function') {
            return null;
        }
        return strategy.tickSuddenDeath(Math.max(0, Number(dt) || 0));
    }

    selectIntermissionChoice(choiceId) {
        return this.arcadeRunRuntime.selectIntermissionChoice?.(choiceId);
    }

    selectReward(rewardId) {
        return this.arcadeRunRuntime.selectReward?.(rewardId);
    }

    requestReplayPlayback() {
        return this.arcadeRunRuntime.requestReplayPlayback?.();
    }

    applyParcoursEvent(data = null) {
        return this.arcadeRunRuntime.applyParcoursLeaderboardEvent(data);
    }

    recordRoundEndTelemetry(payload = null, { recordMenuTelemetry = null } = {}) {
        this.arcadeRunRuntime.handleRoundEndTelemetry(payload);
        return typeof recordMenuTelemetry === 'function'
            ? recordMenuTelemetry('round_end', payload)
            : undefined;
    }

    recordMatchEndTelemetry(payload = null, { recordMenuTelemetry = null } = {}) {
        this.arcadeRunRuntime.handleMatchEndTelemetry(payload);
        return typeof recordMenuTelemetry === 'function'
            ? recordMenuTelemetry('match_end', payload)
            : undefined;
    }
}
