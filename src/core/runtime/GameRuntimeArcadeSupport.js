import { createArcadeRoundStateController } from '../../state/arcade/ArcadeRoundStateController.js';
import { buildArcadeSectorPlan, resolveArcadeSectorRuntimeProfile } from '../../entities/directors/ArcadeEncounterCatalog.js';
import { resolveMapSequence } from '../../state/arcade/ArcadeMapProgression.js';
import { getRuntimeMapCatalog } from '../../shared/contracts/RuntimeMapCatalogContract.js';
import { ArcadeRunRuntime } from '../arcade/ArcadeRunRuntime.js';
import { ReplayRecorder } from '../replay/ReplayRecorder.js';
import { isEndlessParcoursConfig } from '../../shared/contracts/EndlessParcoursContract.js';
import { ARENA_WAVES_BOT_CAPACITY, isArenaWavesConfig } from '../../shared/contracts/ArenaWavesContract.js';
import { ArenaWavesRuntime } from '../arcade/ArenaWavesRuntime.js';
import { getArcadeObjectiveRuntimeState } from '../arcade/ArcadeObjectiveRuntimeOps.js';
import { resolveObjectiveTargetIndex } from '../../entities/systems/ObjectiveTargetMarkerOps.js';
import { FIVE_PORTALS_MAPS, isFivePortalsConfig } from '../../shared/contracts/FivePortalsContract.js';
import { FivePortalsRuntime } from '../arcade/FivePortalsRuntime.js';
import { applyArcadeRuntimeCosmetics } from '../arcade/ArcadeRuntimeCosmeticOps.js';
import { WEAPON_RACE_BOT_COUNT, WEAPON_RACE_MAP_KEY, isWeaponRaceConfig } from '../../shared/contracts/WeaponRaceContract.js';
import { WeaponRaceRuntime } from '../arcade/WeaponRaceRuntime.js';
import { buildObjectiveParticipants, configureArcadeRunRuntime, handleWeaponRaceLeaderboard, lockSelectedMapToFirstSector, requestObjectiveRoundEnd } from './GameRuntimeArcadeSupportOps.js';

export class GameRuntimeArcadeSupport {
    constructor({
        getGame = null,
        getRuntimeState = null,
        nowMs = undefined,
        logger = console,
        applySectorRuntimeProfile = null,
        requestRunAdvance = null,
    } = {}) {
        this._getGame = typeof getGame === 'function' ? getGame : () => null;
        this._getRuntimeState = typeof getRuntimeState === 'function' ? getRuntimeState : () => null;
        this._nowMs = typeof nowMs === 'function' ? nowMs : () => Date.now();
        this._baseRoundStateController = this.getRuntimeState()?.roundStateController
            || this.game?.roundStateController
            || null;
        this._arcadeRoundStateController = null;
        this._boundGameplayEntityManager = null;
        this._arcadeReplayRecorder = new ReplayRecorder();
        this._applySectorRuntimeProfile = typeof applySectorRuntimeProfile === 'function'
            ? applySectorRuntimeProfile
            : null;
        this._requestRunAdvance = typeof requestRunAdvance === 'function' ? requestRunAdvance : () => {};
        this._preparedEncounterPlan = null;
        this._pendingSectorTransition = null;
        // Ein Sektorwechsel, der Karte oder Bot-Anzahl aendert, baut die Laufzeitsitzung
        // neu auf. Deren Teardown raeumt sonst den laufenden Run mit ab, obwohl er
        // zwischen zwei Sektoren steht und weiterlaufen soll.
        this._sectorRebuildInFlight = false;
        this.arcadeRunRuntime = new ArcadeRunRuntime({
            settingsManager: this.game?.settingsManager || null,
            replayRecorder: this._arcadeReplayRecorder,
            now: this._nowMs,
            logger,
            getObjectiveParticipants: () => buildObjectiveParticipants(
                this.getRuntimeState()?.entityManager || this.game?.entityManager
            ),
            getMissionCapabilities: () => ({
                hasItems: Number(this.getRuntimeState()?.runtimeConfig?.powerup?.maxOnField) > 0,
                hasHealing: false,
            }),
            requestRoundEnd: (request) => requestObjectiveRoundEnd(
                this.getRuntimeState()?.entityManager || this.game?.entityManager,
                request
            ),
        });
        this.arenaWavesRuntime = new ArenaWavesRuntime({
            now: this._nowMs,
            getRecordStore: () => this.game?.settingsManager?.getPlayerRecordStorePort?.() || null,
            requestMapTransition: (transition) => { this._pendingSectorTransition = transition; },
        });
        this.fivePortalsRuntime = new FivePortalsRuntime({
            getRecordStore: () => this.game?.settingsManager?.getPlayerRecordStorePort?.() || null,
            requestMapTransition: (transition) => { this._pendingSectorTransition = transition; },
            requestAdvance: () => this._requestRunAdvance(),
        });
        this.weaponRaceRuntime = new WeaponRaceRuntime({
            now: this._nowMs,
            getRecordStore: () => this.game?.settingsManager?.getPlayerRecordStorePort?.() || null,
        });
        this._arcadeGameplayEventHandler = (event) => {
            if (isWeaponRaceConfig(this.getRuntimeState()?.runtimeConfig)) return this.weaponRaceRuntime.handleGameplayEvent(event);
            if (isFivePortalsConfig(this.getRuntimeState()?.runtimeConfig)) return this.fivePortalsRuntime.handleGameplayEvent(event);
            if (isArenaWavesConfig(this.getRuntimeState()?.runtimeConfig)) return this.arenaWavesRuntime.handleGameplayEvent(event);
            const endless = this._getEndlessRuntime();
            if (endless) return endless.handleGameplayEvent?.(event);
            return this.arcadeRunRuntime.applyGameplayEvent(event);
        };

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

    _getEndlessRuntime(runtimeState = this.getRuntimeState()) {
        return runtimeState?.endlessParcoursRuntime
            || runtimeState?.entityManager?.endlessParcoursRuntime
            || this.game?.entityManager?.endlessParcoursRuntime
            || null;
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
        if (isFivePortalsConfig(runtimeConfig)) {
            this._deactivateRoundController();
            return;
        }
        configureArcadeRunRuntime(this.arcadeRunRuntime, runtimeConfig);
        if (runtimeConfig?.arcade?.enabled && !isEndlessParcoursConfig(runtimeConfig)) {
            this._activateRoundController();
            return;
        }
        this._deactivateRoundController();
        if (isEndlessParcoursConfig(runtimeConfig)) return;
        this._unbindGameplayCallback();
        // Arcade ist abgeschaltet: hier gibt es keinen Sektorwechsel zu schuetzen.
        this.resetRunState({ preserveRecords: true, force: true });
    }

    _bindGameplayCallback(runtimeState = this.getRuntimeState()) {
        const entityManager = runtimeState?.entityManager || null;
        if (this._boundGameplayEntityManager && this._boundGameplayEntityManager !== entityManager) {
            this._unbindGameplayCallback();
        }
        if (!entityManager) return;
        entityManager.gameModeStrategy?.setNowMsSource?.(this._nowMs);
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
        const fivePortals = isFivePortalsConfig(runtimeState?.runtimeConfig);
        const weaponRace = isWeaponRaceConfig(runtimeState?.runtimeConfig);
        if (parcoursSystem && typeof parcoursSystem.setXpEventCallback === 'function') {
            parcoursSystem.setXpEventCallback(
                weaponRace ? (eventType, playerIndex, context) => (eventType === 'checkpoint'
                    ? this.weaponRaceRuntime.handleCheckpoint({ playerIndex, checkpointId: context?.checkpointId })
                    : this.weaponRaceRuntime.handleFinish({ playerIndex, finishedAtMs: context?.finishedAtMs }))
                    : fivePortals ? (eventType, playerIndex) => this.fivePortalsRuntime.handleXpEvent(eventType, playerIndex)
                    : (eventType, playerIndex) => this.arcadeRunRuntime.applyParcoursXpEvent(eventType, playerIndex)
            );
        }
        if (parcoursSystem && typeof parcoursSystem.setLeaderboardCallback === 'function') {
            parcoursSystem.setLeaderboardCallback(
                weaponRace ? (data) => handleWeaponRaceLeaderboard(this, runtimeState, data)
                    : fivePortals ? (data) => this.fivePortalsRuntime.handleParcoursEvent(data)
                    : (data) => this.arcadeRunRuntime.applyParcoursLeaderboardEvent(data)
            );
        }
        parcoursSystem?.setAttemptResetCallback?.(fivePortals ? () => this.fivePortalsRuntime.handleAttemptReset() : null);
        parcoursSystem?.setDeathCallback?.(weaponRace ? (data) => this.weaponRaceRuntime.handleDeath(data) : null);
        parcoursSystem?.setSpawnCallback?.(weaponRace ? (data) => this.weaponRaceRuntime.handleDeath(data) : null);
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
        const plan = buildArcadeSectorPlan({
            seed: runtimeConfig?.arcade?.seed,
            sectorCount: runtimeConfig?.arcade?.sectorCount,
            difficulty: runtimeConfig?.arcade?.nightmare === true
                ? 'nightmare'
                : (runtimeConfig?.bot?.activeDifficulty || runtimeConfig?.bot?.difficulty || 'normal'),
        });
        return lockSelectedMapToFirstSector(plan, runtimeConfig, getRuntimeMapCatalog());
    }

    prepareMatchStartRuntime() {
        const runtimeState = this.getRuntimeState();
        const runtimeConfig = runtimeState?.runtimeConfig || null;
        if (!runtimeConfig?.arcade?.enabled) {
            this._preparedEncounterPlan = null;
            this._pendingSectorTransition = null;
            return null;
        }
        if (isFivePortalsConfig(runtimeConfig)) {
            this._preparedEncounterPlan = null;
            this._pendingSectorTransition = null;
            const state = this.fivePortalsRuntime.getHudState();
            return { mapKey: FIVE_PORTALS_MAPS[state.phase === 'idle' || state.phase === 'finished' ? 0 : state.mapIndex], botCount: 0, fivePortals: true };
        }
        if (isArenaWavesConfig(runtimeConfig)) {
            this._preparedEncounterPlan = null;
            this._pendingSectorTransition = null;
            return { mapKey: 'notre_dame_arena', botCount: ARENA_WAVES_BOT_CAPACITY, arenaWaves: true };
        }
        if (isWeaponRaceConfig(runtimeConfig)) {
            this._preparedEncounterPlan = null;
            this._pendingSectorTransition = null;
            this.arcadeRunRuntime.setActiveVehicle(this._resolveActiveVehicleId(runtimeConfig));
            return { mapKey: WEAPON_RACE_MAP_KEY, botCount: WEAPON_RACE_BOT_COUNT, weaponRace: true };
        }
        if (isEndlessParcoursConfig(runtimeConfig)) {
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
        this._sectorRebuildInFlight = requiresSessionRebuild;
        this._applySectorRuntimeProfile?.(resolvedTransition);
        return resolvedTransition;
    }

    startRunIfEnabled() {
        const runtimeState = this.getRuntimeState();
        const runtimeConfig = runtimeState?.runtimeConfig || null;
        this._bindParcoursCallbacks(runtimeState);
        applyArcadeRuntimeCosmetics(this, runtimeState, runtimeConfig);
        if (!runtimeConfig?.arcade?.enabled) {
            return null;
        }
        if (isFivePortalsConfig(runtimeConfig)) {
            this._bindGameplayCallback(runtimeState);
            const started = this.fivePortalsRuntime.start(runtimeState?.entityManager || null,
                { vehicleId: this._resolveActiveVehicleId(runtimeConfig) });
            this._sectorRebuildInFlight = false;
            return started;
        }
        if (isArenaWavesConfig(runtimeConfig)) {
            this._bindGameplayCallback(runtimeState);
            const existing = this.arenaWavesRuntime.getHudState();
            if (existing.phase !== 'idle' && existing.phase !== 'finished') {
                const rebound = this.arenaWavesRuntime.start({
                    entityManager: runtimeState?.entityManager || null,
                    strategy: runtimeState?.entityManager?.gameModeStrategy || null,
                });
                this._sectorRebuildInFlight = false;
                return rebound;
            }
            const started = this.arenaWavesRuntime.start({
                entityManager: runtimeState?.entityManager || null,
                strategy: runtimeState?.entityManager?.gameModeStrategy || null,
                seed: runtimeConfig?.arcade?.seed,
                vehicleId: this._resolveActiveVehicleId(runtimeConfig),
                selectedMachineGunId: runtimeState?.entityManager?.humanPlayers?.[0]?.fightLoadout?.machineGunId,
            });
            this._sectorRebuildInFlight = false;
            return started;
        }
        if (isWeaponRaceConfig(runtimeConfig)) {
            this._bindGameplayCallback(runtimeState);
            const started = this.weaponRaceRuntime.start({
                entityManager: runtimeState?.entityManager || null,
                vehicleId: this._resolveActiveVehicleId(runtimeConfig),
            });
            this._sectorRebuildInFlight = false;
            return started;
        }
        if (isEndlessParcoursConfig(runtimeConfig)) {
            this._bindGameplayCallback(runtimeState);
            const runtime = this._getEndlessRuntime(runtimeState);
            const recordStore = this.game?.settingsManager?.getPlayerRecordStorePort?.() || null;
            runtime?.setRecordStore?.(recordStore);
            runtime?.setRunProfile?.({
                recordStore,
                vehicleId: this._resolveActiveVehicleId(runtimeConfig),
                strategy: runtimeState?.entityManager?.gameModeStrategy || null,
            });
            return runtime?.getHudState?.() || null;
        }
        this._bindGameplayCallback(runtimeState);
        this.arcadeRunRuntime.setActiveVehicle(this._resolveActiveVehicleId(runtimeConfig));
        const strategy = runtimeState?.entityManager?.gameModeStrategy || null;
        this.arcadeRunRuntime.setStrategy(strategy);
        // Die neue Sitzung steht; ab hier darf ein Reset den Run wieder verwerfen.
        this._sectorRebuildInFlight = false;
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
        // Zwischen zwei Sektoren laeuft der Run weiter, auch wenn die Sitzung dafuer
        // neu aufgebaut wird. Nur ein ausdrueckliches force (Matchende, Rueckkehr ins
        // Menue, abgeschalteter Arcade-Modus) verwirft ihn.
        if (this._sectorRebuildInFlight && options?.force !== true) {
            return isFivePortalsConfig(this.getRuntimeState()?.runtimeConfig)
                ? this.fivePortalsRuntime.getHudState()
                : (isArenaWavesConfig(this.getRuntimeState()?.runtimeConfig)
                ? this.arenaWavesRuntime.getHudState()
                : (this.arcadeRunRuntime.getStateSnapshot?.() || null));
        }
        this._sectorRebuildInFlight = false;
        this._preparedEncounterPlan = null;
        this._pendingSectorTransition = null;
        const fivePortalsState = this.fivePortalsRuntime.getHudState();
        if (isFivePortalsConfig(this.getRuntimeState()?.runtimeConfig)
            || fivePortalsState.phase !== 'idle') {
            this.fivePortalsRuntime.dispose();
            this.arcadeRunRuntime.resetRunState({ preserveRecords: true });
            return this.fivePortalsRuntime.getHudState();
        }
        const arenaState = this.arenaWavesRuntime.getHudState?.() || null;
        if (isArenaWavesConfig(this.getRuntimeState()?.runtimeConfig)
            || (arenaState?.runType === 'arena_waves' && arenaState.phase !== 'idle')) {
            this.arenaWavesRuntime.dispose();
            return this.arenaWavesRuntime.getHudState();
        }
        const weaponRaceState = this.weaponRaceRuntime.getHudState?.() || null;
        if (isWeaponRaceConfig(this.getRuntimeState()?.runtimeConfig)
            || (weaponRaceState?.runType === 'weapon_race' && weaponRaceState.phase !== 'idle')) {
            this.weaponRaceRuntime.dispose();
            this.arcadeRunRuntime.resetRunState({ preserveRecords: true });
            return this.weaponRaceRuntime.getHudState();
        }
        return this.arcadeRunRuntime.resetRunState({
            preserveRecords: true,
            ...(options && typeof options === 'object' ? options : {}),
        });
    }

    getRunState() {
        if (isWeaponRaceConfig(this.getRuntimeState()?.runtimeConfig)) return this.weaponRaceRuntime.getHudState();
        if (isFivePortalsConfig(this.getRuntimeState()?.runtimeConfig)) return this.fivePortalsRuntime.getHudState();
        if (isArenaWavesConfig(this.getRuntimeState()?.runtimeConfig)) return this.arenaWavesRuntime.getHudState();
        const endless = this._getEndlessRuntime();
        if (endless) return endless.getHudState?.() || null;
        return this.arcadeRunRuntime.getStateSnapshot?.() || null;
    }

    getMenuSurfaceState() {
        if (isWeaponRaceConfig(this.getRuntimeState()?.runtimeConfig)) return this.weaponRaceRuntime.getHudState();
        if (isFivePortalsConfig(this.getRuntimeState()?.runtimeConfig)) return this.fivePortalsRuntime.getHudState();
        if (isArenaWavesConfig(this.getRuntimeState()?.runtimeConfig)) return this.arenaWavesRuntime.getHudState();
        const endless = this._getEndlessRuntime();
        if (endless) return endless.getHudState?.() || null;
        return this.arcadeRunRuntime.getMenuSurfaceState?.() || null;
    }

    /**
     * Pushes the bounty target into the entity layer. Entities must not read
     * arcade state themselves, so core hands over a plain player index here.
     */
    _syncObjectiveTargetMarker(runtimeState = this.getRuntimeState()) {
        const markerSystem = runtimeState?.entityManager?._objectiveTargetMarkerSystem
            || this.game?.entityManager?._objectiveTargetMarkerSystem
            || null;
        if (!markerSystem) return null;
        return markerSystem.setTarget(
            resolveObjectiveTargetIndex(getArcadeObjectiveRuntimeState(this.arcadeRunRuntime))
        );
    }

    tickSuddenDeath(dt = 0) {
        if (isWeaponRaceConfig(this.getRuntimeState()?.runtimeConfig)) {
            this.weaponRaceRuntime.update(this._nowMs());
            return null;
        }
        if (isFivePortalsConfig(this.getRuntimeState()?.runtimeConfig)) return null;
        if (isArenaWavesConfig(this.getRuntimeState()?.runtimeConfig)) {
            this.arenaWavesRuntime.update(dt);
            return null;
        }
        if (this._getEndlessRuntime()) return null;
        // This established per-frame arcade seam also advances time-based missions.
        this.arcadeRunRuntime.tickGameplay?.(dt);
        this._syncObjectiveTargetMarker();
        if (this.arcadeRunRuntime.getPhase?.() !== 'sudden_death') {
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
        if (isArenaWavesConfig(this.getRuntimeState()?.runtimeConfig)) return this.arenaWavesRuntime.selectChoice(choiceId);
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
        const enrichedPayload = payload && typeof payload === 'object'
            ? { ...payload, arcade: this.arcadeRunRuntime.getTelemetrySnapshot?.(payload.reason) || null }
            : payload;
        return typeof recordMenuTelemetry === 'function'
            ? recordMenuTelemetry('round_end', enrichedPayload)
            : undefined;
    }

    recordMatchEndTelemetry(payload = null, { recordMenuTelemetry = null } = {}) {
        this.arcadeRunRuntime.handleMatchEndTelemetry(payload);
        const enrichedPayload = payload && typeof payload === 'object'
            ? { ...payload, arcade: this.arcadeRunRuntime.getTelemetrySnapshot?.(payload.reason) || null }
            : payload;
        return typeof recordMenuTelemetry === 'function'
            ? recordMenuTelemetry('match_end', enrichedPayload)
            : undefined;
    }
}
