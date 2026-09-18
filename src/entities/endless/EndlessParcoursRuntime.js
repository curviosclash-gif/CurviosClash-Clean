import * as THREE from 'three';
import {
    calculateEndlessScore,
    ENDLESS_PARCOURS_ACTIVE_WINDOW,
    ENDLESS_PARCOURS_END_REASONS,
    ENDLESS_PARCOURS_MODULE_LENGTH,
    resolveEndlessDesiredBotCount,
    resolveEndlessDifficultyTier,
    resolveEndlessThreatLevel,
} from '../../shared/contracts/EndlessParcoursContract.js';
import {
    ENDLESS_PARCOURS_ELITE,
    ENDLESS_PARCOURS_STREAK,
    resolveEndlessSpeedMultiplier,
    resolveEndlessVoidWarning,
} from '../../shared/contracts/EndlessParcoursStageContract.js';
import { normalizeEndlessParcoursRecords } from '../../state/arcade/EndlessParcoursRecords.js';
import { ENDLESS_COURSE_HALF_WIDTH } from './EndlessParcoursConnectors.js';
import { EndlessParcoursPath } from './EndlessParcoursPath.js';
import {
    buildEndlessModuleInstance,
    resolveEndlessActiveColliders,
    resolveModuleCenterAtZ,
    syncEndlessCycleColliders,
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
    onEndlessExchangeSlotFreed,
} from './EndlessParcoursWaveOps.js';
import {
    breakEndlessStreak,
    handleEndlessCheckpointCrossing,
    registerEndlessShakeoff,
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

const COURSE_VOID_MARGIN = 15;
const COURSE_MIN_Y = -24;
const COURSE_MAX_Y = 64;
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

    constructor({
        baseSeed = 1,
        renderer = null,
        arena = null,
        powerupManager = null,
        entityManager = null,
        audio = null,
        wallClockIso = safeDateIso,
    } = {}) {
        Object.assign(this, createEndlessRuntimeState());
        this.baseSeed = Math.max(1, Number(baseSeed) >>> 0);
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
        this._records = normalizeEndlessParcoursRecords();
        this._startSpeed = resolveEndlessStartSpeed(entityManager?.humanPlayers?.[0], 1);
        this._path = new EndlessParcoursPath({ baseSeed: this.baseSeed });
        this._sideRouteStates = new Map();
        this._rewardedSideRoutes = new Set();
        this._tmpDirection = new THREE.Vector3();
        this._tmpDelta = new THREE.Vector3();
        this._tmpSpawnPosition = new THREE.Vector3();
        this._tmpSpawnDirection = new THREE.Vector3(0, 0, 1);
        this._candidateSpawnAnchor = { id: '', x: 0, y: 0, z: 0, ahead: false };
        this._selectedSpawnAnchor = { id: '', x: 0, y: 0, z: 0, ahead: false };
        this._sharedGeometry = new THREE.BoxGeometry(1, 1, 1);
        this._sharedGeometry.userData = { __sharedNoDispose: true };
        this._materials = createEndlessMaterials();
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
        this._syncModules(0, 1);
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

    getRecordsSnapshot() {
        return normalizeEndlessParcoursRecords(this._records);
    }

    getInitialHumanSpawn() {
        return {
            position: new THREE.Vector3(0, 8, 8),
            direction: new THREE.Vector3(0, 0, 1),
        };
    }

    handleGameplayEvent(event = null) {
        if (!event || this._disposed || this._finalized) return;
        if (String(event.type || '').toLowerCase() === 'damage') {
            registerEndlessPlayerDamage(this);
            breakEndlessStreak(this);
        }
    }

    onCheckpointPassed(index) {
        if (Math.floor(Number(index) || 0) <= 0) return;
        const module = this._path.getModule(index, resolveEndlessDifficultyTier(this.elapsedCombatSeconds));
        registerEndlessObjectiveCheckpoint(this, index, module.area);
    }

    /**
     * Der Rekordmarker steht mitten in der Strecke. Weil der Rekord erst nach dem
     * Konstruktor geladen wird, traegt er sich hier fuer schon gebaute Bausteine nach.
     */
    _refreshRecordMarkers() {
        const record = Math.max(0, Number(
            this._records?.bestDistance?.distanceMeters ?? this._records?.best?.distanceMeters
        ) || 0);
        if (record <= 0) return;
        for (const [index, instance] of this.activeModules) {
            if (instance.recordMarker) continue;
            const { originZ, length } = instance.module;
            if (record < originZ || record >= originZ + length) continue;
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
        slotState.eligibleAt = 0;
        player.endlessForcedRetreat = false;
        player.endlessRetreatReason = '';
        if (wasExchange) onEndlessExchangeSlotFreed(this, slotState);
        if (!options?.killer || options.killer.isBot === true) return;
        this.botKills += 1;
        this.collectRunXp('kill', 1);
        registerEndlessStreakEvent(this, 'kill', ENDLESS_PARCOURS_STREAK.killBaseScore);
        if (!wasElite) return;
        this.eliteKills += 1;
        this.bonusScore += Math.max(
            0,
            ENDLESS_PARCOURS_ELITE.killScore - ENDLESS_PARCOURS_STREAK.killBaseScore
        );
        this.audio?.play?.('FIGHT_LEAD');
        this.entityManager?._notifyPlayerFeedback?.(options.killer, 'Anführer bezwungen');
    }

    _instantiateModule(module) {
        const instance = buildEndlessModuleInstance({
            module,
            geometry: this._sharedGeometry,
            materials: this._materials,
            recordDistanceMeters: this._records?.bestDistance?.distanceMeters
                ?? this._records?.best?.distanceMeters
                ?? 0,
        });
        syncEndlessCycleColliders(instance, this.elapsedCombatSeconds, this._materials);
        this.renderer?.addToScene?.(instance.group);
        this.arena?.registerStaticColliderBatch?.(instance.ownerId, resolveEndlessActiveColliders(instance));
        for (let index = 0; index < module.pickups.length; index += 1) {
            const pickup = module.pickups[index];
            const center = resolveModuleCenterAtZ(module, module.originZ + pickup.z);
            this.powerupManager?.spawnAtAnchor?.({
                ownerId: instance.ownerId,
                id: pickup.id,
                type: pickup.type,
                x: center.x + pickup.x,
                y: center.y + pickup.y - 8,
                z: module.originZ + pickup.z,
            });
        }
        return instance;
    }

    _removeModule(instance, options = {}) {
        if (!instance) return;
        const { ownerId, module, group } = instance;
        this._deactivateBotsInModule(module, options);
        this.powerupManager?.removeByOwnerId?.(ownerId);
        this.entityManager?._projectileSystem?.clearInBounds?.(
            -1000,
            1000,
            module.originZ,
            module.originZ + module.length
        );
        this.entityManager?._lockOnCache?.clear?.();
        this.arena?.unregisterStaticColliderBatch?.(ownerId);
        this.renderer?.removeFromScene?.(group);
    }

    _deactivateBotsInModule(module, options = {}) {
        let shaken = 0;
        for (let index = 0; index < this._botSlots.length; index += 1) {
            const state = this._botSlots[index];
            const z = Number(state.player?.position?.z);
            if (state.state !== 'active' || !Number.isFinite(z)) continue;
            if (z < module.originZ || z > module.originZ + module.length) continue;
            clearEndlessElite(state.player);
            this.entityManager?.deactivateBotSlot?.(state.slot, 'module_unloaded');
            state.state = 'idle';
            state.plannedAnchor = null;
            state.telegraphedAt = -1;
            state.eligibleAt = 0;
            if (options.awardShakeoff === true
                && module.originZ + module.length < this.maxProgressMeters) shaken += 1;
        }
        if (shaken > 0 && this.combatStarted) registerEndlessShakeoff(this, shaken);
    }

    _syncModules(currentModuleIndex, difficultyTier) {
        const minIndex = Math.max(0, currentModuleIndex - ENDLESS_PARCOURS_ACTIVE_WINDOW.behind);
        const maxIndex = currentModuleIndex + ENDLESS_PARCOURS_ACTIVE_WINDOW.ahead;
        for (let index = minIndex; index <= maxIndex; index += 1) {
            if (this.activeModules.has(index)) continue;
            this.activeModules.set(index, this._instantiateModule(this._path.getModule(index, difficultyTier)));
        }
        for (const [index, instance] of this.activeModules) {
            if (index >= minIndex && index <= maxIndex) continue;
            this._removeModule(instance, { awardShakeoff: index < minIndex });
            this.activeModules.delete(index);
        }
    }

    _syncCycleColliders() {
        for (const instance of this.activeModules.values()) {
            if (!syncEndlessCycleColliders(instance, this.elapsedCombatSeconds, this._materials)) continue;
            this.arena?.registerStaticColliderBatch?.(instance.ownerId, resolveEndlessActiveColliders(instance));
        }
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
        const tier = resolveEndlessDifficultyTier(this.elapsedCombatSeconds);
        switchEndlessStage(this, this.combatStarted ? tier : 0);
        const threat = resolveEndlessThreatLevel(this.elapsedCombatSeconds);
        const botTarget = resolveEndlessDesiredBotCount(this.elapsedCombatSeconds);
        if (threat === this._lastThreatLevel && botTarget === this._lastAnnouncedBotTarget) return;
        this._lastThreatLevel = threat;
        this._lastAnnouncedBotTarget = botTarget;
        const human = this.entityManager?.humanPlayers?.[0] || null;
        this.entityManager?._notifyPlayerFeedback?.(human, `Bedrohungsstufe: ${threat} | Jäger: ${botTarget}`);
    }

    _updateProgress(player) {
        const progress = Math.max(0, Number(player?.position?.z) || 0);
        this.currentModuleIndex = Math.max(0, Math.floor(progress / ENDLESS_PARCOURS_MODULE_LENGTH));
        if (progress <= this.maxProgressMeters) return;
        this.maxProgressMeters = progress;
        handleEndlessCheckpointCrossing(this, progress);
        const completed = Math.max(0, Math.floor(progress / ENDLESS_PARCOURS_MODULE_LENGTH));
        if (completed > this.completedModules) {
            this.completedModules = completed;
            player?.setControlOptions?.({ speed: this._startSpeed * resolveEndlessSpeedMultiplier(completed) });
        }
        if (!this.combatStarted && progress >= ENDLESS_PARCOURS_MODULE_LENGTH) {
            this.combatStarted = true;
            this.elapsedCombatSeconds = 0;
            this._lastThreatLevel = 'EASY';
            beginEndlessAttackWave(this, 1);
        }
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
        this.voidWarning = resolveEndlessVoidWarning(Number(human?.position?.z) || 0, this.maxProgressMeters);
        if (this.voidWarning.warning && !previous && this.voidWarning.remainingMeters > 0) {
            this.audio?.play?.('PARCOURS_WRONG');
            this.entityManager?._notifyPlayerFeedback?.(human, 'Zurückgefallen - sofort vorwärts');
        }
    }

    _isOutsideCourse(player) {
        const x = Number(player?.position?.x) || 0;
        const y = Number(player?.position?.y) || 0;
        const z = Number(player?.position?.z) || 0;
        const center = this._resolveCenterAtZ(z);
        return Math.abs(x - center.x) > ENDLESS_COURSE_HALF_WIDTH + COURSE_VOID_MARGIN
            || y < center.y + COURSE_MIN_Y
            || y > center.y + COURSE_MAX_Y
            || this.voidWarning.remainingMeters <= 0;
    }

    tick(dt = 0) {
        if (this._disposed || this._finalized) return this._summary;
        const safeDt = Math.max(0, Number(dt) || 0);
        const human = this.entityManager?.humanPlayers?.[0] || null;
        this.survivalSeconds += safeDt;
        if (this.combatStarted) this._trackHumanEvents(human);
        this._updateProgress(human);
        this._syncModules(this.currentModuleIndex, resolveEndlessDifficultyTier(this.elapsedCombatSeconds));
        if (this._pendingFinalReason) return this.finalize(this._pendingFinalReason);
        if (!human?.alive) return this.finalize(ENDLESS_PARCOURS_END_REASONS.PLAYER_DEATH);
        this._updateWarnings(human, safeDt);
        if (this._isOutsideCourse(human)) {
            this.entityManager?._killPlayer?.(human, ENDLESS_PARCOURS_END_REASONS.VOID);
            if (!this._pendingFinalReason && human.alive !== true) {
                return this.finalize(ENDLESS_PARCOURS_END_REASONS.VOID);
            }
        }
        if (this.combatStarted) {
            this.elapsedCombatSeconds += safeDt;
            const module = this.activeModules.get(this.currentModuleIndex)?.module;
            if (module) syncEndlessFlightObjective(this, module.moduleIndex, module.area);
            updateEndlessSideRoute(this, human);
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
        this._sideRouteStates.clear();
        this._rewardedSideRoutes.clear();
        this.arena?.exitStaticStreamingMode?.();
        this._sharedGeometry?.dispose?.();
        for (const material of Object.values(this._materials)) material?.dispose?.();
        if (this.entityManager?.endlessParcoursRuntime === this) this.entityManager.endlessParcoursRuntime = null;
        this._disposed = true;
    }
}
