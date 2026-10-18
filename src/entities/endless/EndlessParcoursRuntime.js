import { normalizeEndlessSeedMode } from '../../shared/contracts/EndlessParcoursSeedContract.js';
import { createEndlessBiomeResources } from './EndlessParcoursBiomeResources.js';
import { resolveEndlessAreaTier, resolveEndlessAreaThreat } from '../../shared/contracts/EndlessParcoursPacingContract.js';
import { ENDLESS_RING, createEndlessRingState, prepareEndlessRingSegment, finishEndlessRingSegment } from './EndlessParcoursRingOps.js';
import {
    instantiateEndlessModule,
    removeEndlessModule,
    deactivateEndlessBotsInModule,
    syncEndlessModules,
    syncEndlessCycleCollidersForRuntime,
} from './EndlessParcoursStreamingOps.js';
import { prepareEndlessSetpieces, updateEndlessSetpieces } from './EndlessParcoursSetpieceOps.js';
import { trackArcadeColorEvent } from '../../shared/contracts/ArcadeColorProgressContract.js';
import * as THREE from 'three';
import {
    calculateEndlessScore,
    ENDLESS_PARCOURS_SCORE,
    ENDLESS_PARCOURS_END_REASONS,
    ENDLESS_PARCOURS_MODULE_LENGTH,
} from '../../shared/contracts/EndlessParcoursContract.js';
import {
    ENDLESS_PARCOURS_ELITE,
    ENDLESS_PARCOURS_STREAK,
    resolveEndlessSpeedMultiplier,
    resolveEndlessVoidWarning,
} from '../../shared/contracts/EndlessParcoursStageContract.js';
import { normalizeEndlessParcoursRecords } from '../../state/arcade/EndlessParcoursRecords.js';
import { EndlessParcoursExclusionZone } from './EndlessParcoursExclusionZone.js';
import { EndlessParcoursWaterSource } from './EndlessParcoursWater.js';
import { getEndlessHunterRoute, syncEndlessHunterSpeeds } from './EndlessParcoursHunterOps.js';
import { EndlessParcoursPath } from './EndlessParcoursPath.js';
import { createEndlessPathSample } from './EndlessParcoursPathMetric.js';
import { resolveEndlessCoursePoint } from './EndlessParcoursCourseSpace.js';
import { ENDLESS_PARCOURS_WAVE_TIMING } from '../../shared/contracts/EndlessParcoursWaveContract.js';
import {
    resolveModuleCenterAtZ,
} from './EndlessParcoursModuleBuilder.js';
import {
    buildEndlessDebugSnapshot,
    buildEndlessHudState,
} from './EndlessParcoursProjection.js';
import {
    collectEndlessRunXp,
    finalizeEndlessRun,
    resolveEndlessStartSpeed,
    retryEndlessSettlement,
    setEndlessRecordStore,
    setEndlessRunProfile,
} from './EndlessParcoursProgressionOps.js';
import {
    createEndlessBotSlots,
    createEndlessRuntimeState,
} from './EndlessParcoursRuntimeState.js';
import {
    clearEndlessElite,
    findSafeEndlessSpawnAnchor,
    isEndlessAnchorDirectionAllowed,
} from './EndlessParcoursBotDirectorOps.js';
import { reconcileEndlessBots } from './EndlessParcoursSlotOps.js';
import {
    advanceEndlessWave,
    beginEndlessAttackWave,
    reserveEndlessWaveSlots,
    onEndlessExchangeSlotFreed,
} from './EndlessParcoursWaveOps.js';
import {
    breakEndlessStreak,
    handleEndlessCheckpointCrossing,
    registerEndlessStreakEvent,
    tryEndlessRevive,
    updateEndlessStreak,
} from './EndlessParcoursRunOps.js';
import {
    registerEndlessObjectiveCheckpoint,
    registerEndlessPlayerDamage,
    syncEndlessFlightObjective,
    updateEndlessSideRoute,
} from './EndlessParcoursObjectiveOps.js';
import {
    applyEndlessStagePalette,
    createEndlessMaterials,
    switchEndlessStage,
    updateEndlessStageEffects,
} from './EndlessParcoursStageOps.js';

const BOT_SPAWN_MIN_DISTANCE_SQ = 18 * 18;
let endlessRunSequence = 0;

function safeDateIso() {
    try { return new Date().toISOString(); } catch { return ''; }
}

export class EndlessParcoursRuntime {
    // Der Laufzustand kommt gebuendelt aus createEndlessRuntimeState. Die Felder,
    // die diese Klasse selbst liest, werden hier deklariert, damit der
    // Typcheck sie kennt - die Werte setzt der Konstruktor.
    /** @type {number} */ survivalSeconds;
    /** @type {number} */ botKills;
    /** @type {number} */ eliteKills;
    /** @type {number} */ bonusScore;
    /** @type {number} */ combatBonusScore;
    /** @type {number} */ pacingAreaBlock;

    constructor({
        baseSeed = 1,
        seedMode = 'free',
        renderer = null,
        arena = null,
        powerupManager = null,
        entityManager = null,
        audio = null,
        wallClockIso = safeDateIso,
    } = {}) {
        Object.assign(this, createEndlessRuntimeState());
        this.baseSeed = Math.max(1, Number(baseSeed) >>> 0);
        this.seedMode = normalizeEndlessSeedMode(seedMode);
        this._recordScopeKey = '';
        this.renderer = renderer;
        this.arena = arena;
        this.powerupManager = powerupManager;
        this.entityManager = entityManager;
        this.audio = audio;
        this.wallClockIso = typeof wallClockIso === 'function' ? wallClockIso : safeDateIso;
        endlessRunSequence += 1;
        const runTimestamp = Date.parse(this.wallClockIso());
        const runTimePart = Number.isFinite(runTimestamp) ? runTimestamp.toString(36) : 'unknown';
        this.runId = `endless-${this.baseSeed.toString(36)}-${runTimePart}-${endlessRunSequence.toString(36)}`;
        this.activeModules = new Map();
        this._setpieceBank = null;
        this._setpieceElapsedSeconds = 0;
        this._ringState = createEndlessRingState(entityManager?.humanPlayers?.[0]);
        this._hunterRoutes = new Map();
        this._hunterFrame = createEndlessPathSample();
        this._hunterSpeedOptions = { speed: 1 };
        this._records = normalizeEndlessParcoursRecords();
        this._startSpeed = resolveEndlessStartSpeed(entityManager?.humanPlayers?.[0], 1);
        this._path = new EndlessParcoursPath({ baseSeed: this.baseSeed });
        this._courseProjection = createEndlessPathSample();
        this._courseSample = createEndlessPathSample();
        this._projectionBounds = { minModuleIndex: 0, maxModuleIndex: 0 };
        this.currentProgressMeters = 0;
        this._sideRouteStates = new Map();
        this._rewardedSideRoutes = new Set();
        this._tmpDirection = new THREE.Vector3();
        this._tmpDelta = new THREE.Vector3();
        this._tmpSpawnPosition = new THREE.Vector3();
        this._tmpSpawnDirection = new THREE.Vector3(0, 0, 1);
        this._candidateSpawnAnchor = { id: '', x: 0, y: 0, z: 0, ahead: false, portId: '', side: '' };
        this._selectedSpawnAnchor = { id: '', x: 0, y: 0, z: 0, ahead: false, portId: '', side: '' };
        this._ringGeometry = new THREE.TorusGeometry(ENDLESS_RING.radius, ENDLESS_RING.thickness, ENDLESS_RING.radialSegments, ENDLESS_RING.tubularSegments);
        this._ringGeometry.userData.__sharedNoDispose = true;
        this._sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
        this._sharedGeometry.userData = { __sharedNoDispose: true };
        this._materials = createEndlessMaterials();
        this._biomeResources = createEndlessBiomeResources();
        this._botSlots = createEndlessBotSlots(entityManager?.bots);
        this.entityManager.endlessParcoursRuntime = this;
        this.arena?.enterStaticStreamingMode?.({
            minX: -1000,
            maxX: 1000,
            minY: -1000,
            maxY: 1000,
            minZ: -1000,
            maxZ: 1_000_000,
        });
        this._activePaletteTier = 0;
        applyEndlessStagePalette(this._materials, 0);
        this._syncModules(0);
        this._previousExclusionZoneSource = this.arena?.exclusionZoneSource;
        this._exclusionZoneSource = new EndlessParcoursExclusionZone(this);
        if (this.arena) this.arena.exclusionZoneSource = this._exclusionZoneSource;
        this._previousWaterZoneSource = this.arena?.waterZoneSource;
        this._waterZoneSource = new EndlessParcoursWaterSource(this);
        if (this.arena) this.arena.waterZoneSource = this._waterZoneSource;
    }

    setRecordStore(store) {
        return setEndlessRecordStore(this, store);
    }

    setRunProfile(options = {}) {
        return setEndlessRunProfile(this, options);
    }

    collectRunXp(kind, count = 1) {
        return collectEndlessRunXp(this, kind, count);
    }

    retrySettlement() {
        return retryEndlessSettlement(this);
    }

    getPathMetric() { return this._path.getMetric(); }

    prepareSetpieces(options = {}) { return prepareEndlessSetpieces(this, options); }
    updateGeometry(dt) { updateEndlessSetpieces(this, dt); syncEndlessHunterSpeeds(this); }
    getBotRouteSnapshot(playerIndex) { return getEndlessHunterRoute(this, playerIndex); }

    getRecordScore() {
        return Math.max(0, Number(this._records.bestByRunScope?.[this._recordScopeKey]?.score) || 0);
    }

    getRecordDistanceMeters() {
        return Math.max(0, Number(this._records.bestDistanceByRunScope?.[this._recordScopeKey]?.distanceMeters) || 0);
    }

    getCoursePoint(moduleIndex, x = 0, y = 0, localZ = 0, out = this._courseSample) {
        const module = this._path.getModule(moduleIndex);
        return resolveEndlessCoursePoint(module, x, y, localZ, out);
    }

    projectCoursePoint(point, out = this._courseProjection) {
        if (!Number.isFinite(point?.z)) return null;
        const index = Math.max(0, Math.floor(point.z / ENDLESS_PARCOURS_MODULE_LENGTH));
        if (this._path.getMetric().getModuleCount() <= index + 1) {
            this._path.getModule(index + 1);
        }
        this._projectionBounds.minModuleIndex = Math.max(0, index - 1);
        this._projectionBounds.maxModuleIndex = index + 1;
        return this._path.getMetric().projectPoint(point, out, this._projectionBounds);
    }

    getRecordsSnapshot() {
        return normalizeEndlessParcoursRecords(this._records);
    }

    getInitialHumanSpawn() {
        const frame = this.getCoursePoint(0, 0, 8, 8);
        return {
            position: new THREE.Vector3().copy(frame.position),
            direction: new THREE.Vector3().copy(frame.tangent),
        };
    }

    handleGameplayEvent(event = null) {
        if (!event || this._disposed || this._finalized) return;
        if (!event.runId || event.runId === this.runId) trackArcadeColorEvent(this._colorProgress, event);
        if (String(event.type || '').toLowerCase() === 'damage') {
            registerEndlessPlayerDamage(this);
            breakEndlessStreak(this);
        }
    }

    onCheckpointPassed(index) {
        if (Math.floor(Number(index) || 0) <= 0) return;
        const module = this._path.getModule(index);
        registerEndlessObjectiveCheckpoint(this, index, module.area);
    }

    /**
     * Der Rekordmarker steht mitten in der Strecke. Weil der Rekord erst nach dem
     * Konstruktor geladen wird, traegt er sich hier fuer schon gebaute Bausteine nach.
     */
    _refreshRecordMarkers() {
        const record = this.getRecordDistanceMeters();
        if (record <= 0) return;
        for (const [index, instance] of this.activeModules) {
            if (instance.recordMarker) continue;
            const range = this._path.getMetric().getStationRange(index);
            if (record < range.startS || record >= range.endS) continue;
            this._removeModule(instance);
            this.activeModules.set(index, this._instantiateModule(instance.module));
        }
    }

    handlePlayerDeath(player, cause = 'UNKNOWN', options = {}) {
        if (this._disposed || this._finalized || !player) return;
        if (!player.isBot) {
            if (tryEndlessRevive(this, player)) return;
            this._pendingFinalReason = String(cause || '').toUpperCase() === ENDLESS_PARCOURS_END_REASONS.VOID
                ? ENDLESS_PARCOURS_END_REASONS.VOID
                : ENDLESS_PARCOURS_END_REASONS.PLAYER_DEATH;
            return;
        }
        const slotState = this._botSlots.find((entry) => entry.player === player);
        if (!slotState || !['active', 'retreating', 'exchange_retreat'].includes(slotState.state)) return;
        if (options?.activationGeneration != null
            && Number(options.activationGeneration) !== slotState.activationGeneration) return;
        if (options?.botSlot != null && Number(options.botSlot) !== slotState.slot) return;
        if (options?.runId != null && String(options.runId) !== this.runId) return;
        const wasExchange = slotState.state === 'exchange_retreat';
        const wasElite = player.isEndlessElite === true;
        clearEndlessElite(player);
        this.entityManager?.deactivateBotSlot?.(slotState.slot, 'bot_eliminated');
        slotState.state = 'idle';
        slotState.plannedAnchor = null;
        slotState.plannedElite = false;
        slotState.telegraphedAt = -1;
        slotState.eligibleAt = this.elapsedCombatSeconds + ENDLESS_PARCOURS_WAVE_TIMING.reinforcementSeconds;
        slotState.ambushId = '';
        player.endlessForcedRetreat = false;
        player.endlessRetreatReason = '';
        if (wasExchange) onEndlessExchangeSlotFreed(this, slotState);
        reserveEndlessWaveSlots(this);
        if (!options?.killer || options.killer.isBot === true) return;
        this.botKills += 1;
        const combatBonusBefore = this.bonusScore;
        this.collectRunXp('kill', 1);
        registerEndlessStreakEvent(this, 'kill', ENDLESS_PARCOURS_STREAK.killBaseScore);
        this.combatBonusScore += this.bonusScore - combatBonusBefore;
        if (!wasElite) return;
        this.eliteKills += 1;
        this.bonusScore += Math.max(
            0,
            ENDLESS_PARCOURS_ELITE.killScore - ENDLESS_PARCOURS_SCORE.kill
        );
        this.combatBonusScore += Math.max(0, ENDLESS_PARCOURS_ELITE.killScore - ENDLESS_PARCOURS_SCORE.kill);
        this.audio?.play?.('FIGHT_LEAD');
        this.entityManager?._notifyPlayerFeedback?.(options.killer, 'Anführer bezwungen');
    }

    _instantiateModule(module) {
        return instantiateEndlessModule(this, module);
    }

    _removeModule(instance, options = {}) {
        return removeEndlessModule(this, instance, options);
    }

    _deactivateBotsInModule(module, options = {}) {
        return deactivateEndlessBotsInModule(this, module, options);
    }

    _syncModules(currentModuleIndex) {
        return syncEndlessModules(this, currentModuleIndex);
    }

    _syncCycleColliders() {
        return syncEndlessCycleCollidersForRuntime(this);
    }

    /**
     * Korridormitte an einer Weltposition. Ohne diese Umrechnung waeren
     * Sturzgrenze und Seitenwaende in einer geknickten Passage falsch platziert.
     */
    _resolveCenterAtZ(worldZ) {
        const index = Math.max(0, Math.floor((Number(worldZ) || 0) / ENDLESS_PARCOURS_MODULE_LENGTH));
        const instance = this.activeModules.get(index);
        if (!instance) return { x: 0, y: 0 };
        return resolveModuleCenterAtZ(instance.module, worldZ);
    }

    _isSpawnAnchorSafe(anchor, human) {
        this._tmpSpawnPosition.set(anchor.x, anchor.y, anchor.z);
        const players = this.entityManager?.players || [];
        for (let index = 0; index < players.length; index += 1) {
            const player = players[index];
            if (!player?.alive || player.entitySlotActive === false) continue;
            if (player.position.distanceToSquared(this._tmpSpawnPosition) < BOT_SPAWN_MIN_DISTANCE_SQ) return false;
        }
        if (this.arena?.checkCollisionFast?.(this._tmpSpawnPosition, 2.5)) return false;
        if (!human?.alive) return true;
        human.getDirection(this._tmpDirection).normalize();
        this._tmpDelta.subVectors(this._tmpSpawnPosition, human.position);
        const distance = this._tmpDelta.length();
        if (distance <= 0.03) return false;
        const forwardDot = this._tmpDirection.dot(this._tmpDelta.divideScalar(distance));
        return isEndlessAnchorDirectionAllowed(this, anchor, human, forwardDot, distance);
    }

    _findSafeSpawnAnchor(slotState, options = {}) {
        return findSafeEndlessSpawnAnchor(this, slotState, options);
    }

    _announceEscalation() {
        const tier = resolveEndlessAreaTier(this.pacingAreaBlock);
        switchEndlessStage(this, this.combatStarted ? tier : 0);
        const threat = resolveEndlessAreaThreat(this.pacingAreaBlock);
        if (threat === this._lastThreatLevel) return;
        this._lastThreatLevel = threat;
        const human = this.entityManager?.humanPlayers?.[0] || null;
        this.entityManager?._notifyPlayerFeedback?.(human, `Bedrohungsstufe: ${threat}`);
    }

    _updateProgress(player) {
        const projected = this.projectCoursePoint(player?.position);
        if (!projected) return false;
        const progress = projected.s;
        this.currentProgressMeters = progress;
        this.currentModuleIndex = projected.moduleIndex;
        this._syncModules(this.currentModuleIndex);
        if (this._exclusionZoneSource.isOutside(player)) return false;
        this.pacingAreaBlock = Math.max(this.pacingAreaBlock, this.activeModules.get(this.currentModuleIndex).module.areaBlock);
        handleEndlessCheckpointCrossing(this, progress);
        if (progress <= this.maxProgressMeters) return true;
        this.maxProgressMeters = progress;
        const completed = this.currentModuleIndex;
        if (completed > this.completedModules) {
            this.completedModules = completed;
            player?.setControlOptions?.({ speed: this._startSpeed * resolveEndlessSpeedMultiplier(completed) });
        }
        if (!this.combatStarted && completed >= 1) {
            this.combatStarted = true;
            this.elapsedCombatSeconds = 0;
            this._lastThreatLevel = 'EASY';
            beginEndlessAttackWave(this, 1);
        }
        return true;
    }

    /**
     * Beobachtet Treffer und Aufnahmen am Spieler. So bleibt die Serie ohne
     * zusaetzlichen Ereignis-Kanal an das Kampfgeschehen gekoppelt.
     */
    _trackHumanEvents(human) {
        const hp = Number(human?.hp);
        const shield = Number(human?.shieldHP);
        if (Number.isFinite(hp)) {
            if (this._lastHumanHp !== null && hp < this._lastHumanHp) {
                registerEndlessPlayerDamage(this);
                breakEndlessStreak(this);
            }
            this._lastHumanHp = hp;
        }
        if (Number.isFinite(shield)) {
            if (this._lastHumanShield !== null && shield < this._lastHumanShield) {
                registerEndlessPlayerDamage(this);
                breakEndlessStreak(this);
            }
            this._lastHumanShield = shield;
        }
        const inventory = (Array.isArray(human?.inventory) ? human.inventory.length : 0)
            + (Array.isArray(human?.rocketInventory) ? human.rocketInventory.length : 0);
        if (this._lastInventoryCount !== null && inventory > this._lastInventoryCount) {
            registerEndlessStreakEvent(this, 'pickup', ENDLESS_PARCOURS_STREAK.pickupBaseScore);
        }
        this._lastInventoryCount = inventory;
    }

    _updateWarnings(human, dt) {
        if (this.spawnWarning) {
            this.spawnWarning.remaining -= dt;
            if (this.spawnWarning.remaining <= 0) this.spawnWarning = null;
        }
        const previous = this.voidWarning.warning === true;
        this.voidWarning = resolveEndlessVoidWarning(this.currentProgressMeters, this.maxProgressMeters);
        if (this.voidWarning.warning && !previous && this.voidWarning.remainingMeters > 0) {
            this.audio?.play?.('PARCOURS_WRONG');
            this.entityManager?._notifyPlayerFeedback?.(human, 'Zurückgefallen - sofort vorwärts');
        }
    }

    _isOutsideCourse() {
        // Leaving the shell uses the exclusion grace and salvos. Falling irrecoverably
        // behind the streamed course retains its independent progress limit.
        return this.voidWarning.remainingMeters <= 0;
    }

    tick(dt = 0) {
        if (this._disposed || this._finalized) return this._summary;
        const safeDt = Math.max(0, Number(dt) || 0);
        const human = this.entityManager?.humanPlayers?.[0] || null;
        this.survivalSeconds += safeDt;
        if (this.combatStarted) this._trackHumanEvents(human);
        prepareEndlessRingSegment(this, human);
        const insideCourse = this._updateProgress(human);
        finishEndlessRingSegment(this, human);
        if (this._pendingFinalReason) return this.finalize(this._pendingFinalReason);
        if (!human?.alive) return this.finalize(ENDLESS_PARCOURS_END_REASONS.PLAYER_DEATH);
        this._updateWarnings(human, safeDt);
        if (this._isOutsideCourse()) {
            this.entityManager?._killPlayer?.(human, ENDLESS_PARCOURS_END_REASONS.VOID);
            if (!this._pendingFinalReason && human.alive !== true) {
                return this.finalize(ENDLESS_PARCOURS_END_REASONS.VOID);
            }
        }
        if (this.combatStarted) {
            this.elapsedCombatSeconds += safeDt;
            const module = this.activeModules.get(this.currentModuleIndex)?.module;
            if (insideCourse) {
                if (module) syncEndlessFlightObjective(this, module.moduleIndex, module.area);
                updateEndlessSideRoute(this, human);
            }
            updateEndlessStreak(this);
            advanceEndlessWave(this, safeDt);
            this._announceEscalation();
            this._syncCycleColliders();
            reconcileEndlessBots(this);
        }
        updateEndlessStageEffects(this, safeDt);
        this.score = calculateEndlessScore(this);
        return null;
    }

    update(dt = 0) {
        return this.tick(dt);
    }

    /**
     * @param {string} [reason] Grund aus ENDLESS_PARCOURS_END_REASONS
     * @param {{ persist?: boolean, requestRoundEnd?: boolean }} [options]
     */
    finalize(reason = ENDLESS_PARCOURS_END_REASONS.PLAYER_DEATH, options = {}) {
        return finalizeEndlessRun(this, reason, options);
    }

    getHudState() {
        if (this._disposed) return null;
        return buildEndlessHudState(this);
    }

    getDebugSnapshot() {
        return buildEndlessDebugSnapshot(this);
    }

    dispose() {
        if (this._disposed) return;
        if (!this._finalized) this.finalize(ENDLESS_PARCOURS_END_REASONS.ABORT, { persist: false, requestRoundEnd: false });
        for (let index = 0; index < this._botSlots.length; index += 1) {
            clearEndlessElite(this._botSlots[index].player);
            this.entityManager?.deactivateBotSlot?.(this._botSlots[index].slot, 'runtime_dispose');
            this._botSlots[index].state = 'idle';
        }
        for (const instance of this.activeModules.values()) this._removeModule(instance);
        this.activeModules.clear();
        this._hunterRoutes.clear();
        this._setpieceBank?.dispose();
        this._sideRouteStates.clear();
        this._rewardedSideRoutes.clear();
        if (this.arena?.exclusionZoneSource === this._exclusionZoneSource) {
            this.arena.exclusionZoneSource = this._previousExclusionZoneSource;
        }
        if (this.arena?.waterZoneSource === this._waterZoneSource) {
            this.arena.waterZoneSource = this._previousWaterZoneSource;
        }
        this.arena?.exitStaticStreamingMode?.();
        this._ringGeometry?.dispose?.();
        this._sharedGeometry?.dispose?.();
        for (const material of Object.values(this._materials)) material?.dispose?.();
        this._biomeResources.dispose();
        if (this.entityManager?.endlessParcoursRuntime === this) this.entityManager.endlessParcoursRuntime = null;
        this._path.dispose();
        this._disposed = true;
    }
}
