import * as THREE from 'three';
import {
    calculateEndlessScore,
    ENDLESS_PARCOURS_ACTIVE_WINDOW,
    ENDLESS_PARCOURS_BOT_CAPACITY,
    ENDLESS_PARCOURS_END_REASONS,
    ENDLESS_PARCOURS_MODULE_LENGTH,
    resolveEndlessDesiredBotCount,
    resolveEndlessDifficultyTier,
    resolveEndlessReinforcementDelay,
    resolveEndlessThreatLevel,
} from '../../shared/contracts/EndlessParcoursContract.js';
import {
    loadEndlessParcoursRecords,
    normalizeEndlessParcoursRecords,
    saveEndlessParcoursRecords,
    updateEndlessParcoursRecords,
} from '../../state/arcade/EndlessParcoursRecords.js';
import { generateEndlessParcoursModule } from './EndlessParcoursGenerator.js';
import {
    countActiveEndlessBotSlots,
    countPendingEndlessBotSlots,
} from './EndlessParcoursRuntimeCounters.js';
import {
    findSafeEndlessSpawnAnchor,
    resolveEndlessBotRole,
} from './EndlessParcoursBotDirectorOps.js';

const COURSE_HALF_WIDTH = 27;
const COURSE_VOID_HALF_WIDTH = 42;
const COURSE_MIN_Y = -24;
const COURSE_MAX_Y = 64;
const BOT_SPAWN_MIN_DISTANCE_SQ = 18 * 18;
const BOT_SPAWN_DEFER_SECONDS = 0.5;
const WALL_THICKNESS = 3;
const WALL_HEIGHT = 34;
function safeDateIso() {
    try { return new Date().toISOString(); } catch { return ''; }
}

function createBoxCollider({ x, y, z, sx, sy, sz }, originZ, ownerId, index, kind = 'hard') {
    const centerX = Number(x) || 0;
    const centerY = Number(y) || 0;
    const centerZ = originZ + (Number(z) || 0);
    const halfX = Math.max(0.01, Number(sx) || 1) * 0.5;
    const halfY = Math.max(0.01, Number(sy) || 1) * 0.5;
    const halfZ = Math.max(0.01, Number(sz) || 1) * 0.5;
    return {
        id: `${ownerId}:collider:${index}`,
        ownerId,
        kind,
        isWall: kind === 'wall',
        box: new THREE.Box3(
            new THREE.Vector3(centerX - halfX, centerY - halfY, centerZ - halfZ),
            new THREE.Vector3(centerX + halfX, centerY + halfY, centerZ + halfZ)
        ),
    };
}

function setSharedResourceFlag(resource) {
    if (!resource) return resource;
    resource.userData = resource.userData || {};
    resource.userData.__sharedNoDispose = true;
    return resource;
}

export class EndlessParcoursRuntime {
    constructor({
        baseSeed = 1,
        renderer = null,
        arena = null,
        powerupManager = null,
        entityManager = null,
        audio = null,
        wallClockIso = safeDateIso,
    } = {}) {
        this.baseSeed = Math.max(1, Number(baseSeed) >>> 0);
        this.renderer = renderer;
        this.arena = arena;
        this.powerupManager = powerupManager;
        this.entityManager = entityManager;
        this.audio = audio;
        this.wallClockIso = typeof wallClockIso === 'function' ? wallClockIso : safeDateIso;
        this.activeModules = new Map();
        this.maxProgressMeters = 0;
        this.completedModules = 0;
        this.survivalSeconds = 0;
        this.elapsedCombatSeconds = 0;
        this.combatStarted = false;
        this.botKills = 0;
        this.score = 0;
        this.currentModuleIndex = 0;
        this._nextEscalationBoundary = 45;
        this._lastThreatLevel = 'INTRO';
        this._lastAnnouncedBotTarget = 0;
        this._pendingFinalReason = '';
        this._finalized = false;
        this._disposed = false;
        this._summary = null;
        this._recordStore = null;
        this._records = normalizeEndlessParcoursRecords();
        this._isNewRecord = false;
        this._lastPersistenceResult = { ok: true, reason: 'not_attempted' };
        this._startSpeed = Math.max(0.001, Number(entityManager?.humanPlayers?.[0]?.baseSpeed) || 1);
        this._tmpDirection = new THREE.Vector3();
        this._tmpDelta = new THREE.Vector3();
        this._tmpSpawnPosition = new THREE.Vector3();
        this._tmpSpawnDirection = new THREE.Vector3(0, 0, 1);
        this._candidateSpawnAnchor = { id: '', x: 0, y: 0, z: 0 };
        this._selectedSpawnAnchor = { id: '', x: 0, y: 0, z: 0 };
        this._sharedGeometry = setSharedResourceFlag(new THREE.BoxGeometry(1, 1, 1));
        this._materials = {
            floor: setSharedResourceFlag(new THREE.MeshStandardMaterial({ color: 0x183047, emissive: 0x07131f, roughness: 0.8 })),
            wall: setSharedResourceFlag(new THREE.MeshStandardMaterial({ color: 0x245a82, emissive: 0x0a2d4a, emissiveIntensity: 0.45 })),
            obstacle: setSharedResourceFlag(new THREE.MeshStandardMaterial({ color: 0xb13a56, emissive: 0x4a0b18, emissiveIntensity: 0.5 })),
            gate: setSharedResourceFlag(new THREE.MeshStandardMaterial({ color: 0x5de2ff, emissive: 0x16738d, emissiveIntensity: 0.9 })),
        };
        this._botSlots = [];
        const bots = Array.isArray(entityManager?.bots) ? entityManager.bots : [];
        for (let slot = 0; slot < Math.min(ENDLESS_PARCOURS_BOT_CAPACITY, bots.length); slot += 1) {
            this._botSlots.push({ slot, player: bots[slot]?.player || null, state: 'idle', life: 0, eligibleAt: 0 });
        }
        this.entityManager.endlessParcoursRuntime = this;
        this.arena?.enterStaticStreamingMode?.({
            minX: -1000,
            maxX: 1000,
            minY: -1000,
            maxY: 1000,
            minZ: -1000,
            maxZ: 1_000_000,
        });
        this._syncModules(0, 1);
    }

    setRecordStore(store) {
        this._recordStore = store || null;
        this._records = loadEndlessParcoursRecords(this._recordStore);
        return this.getRecordsSnapshot();
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

    handlePlayerDeath(player, cause = 'UNKNOWN', options = {}) {
        if (this._disposed || this._finalized || !player) return;
        if (!player.isBot) {
            this._pendingFinalReason = String(cause || '').toUpperCase() === ENDLESS_PARCOURS_END_REASONS.VOID
                ? ENDLESS_PARCOURS_END_REASONS.VOID
                : ENDLESS_PARCOURS_END_REASONS.PLAYER_DEATH;
            return;
        }
        const slotState = this._botSlots.find((entry) => entry.player === player);
        if (!slotState || slotState.state !== 'active') return;
        this.entityManager?.deactivateBotSlot?.(slotState.slot, 'bot_eliminated');
        slotState.state = 'pending';
        slotState.eligibleAt = this.elapsedCombatSeconds + resolveEndlessReinforcementDelay(this.elapsedCombatSeconds);
        if (options?.killer && options.killer.isBot !== true) this.botKills += 1;
    }

    _createScaledMesh(material, x, y, z, sx, sy, sz) {
        const mesh = new THREE.Mesh(this._sharedGeometry, material);
        mesh.position.set(x, y, z);
        mesh.scale.set(sx, sy, sz);
        mesh.castShadow = false;
        mesh.receiveShadow = true;
        return mesh;
    }

    _instantiateModule(module) {
        const ownerId = `endless-module:${module.moduleIndex}`;
        const group = new THREE.Group();
        group.name = ownerId;
        group.userData.endlessModuleIndex = module.moduleIndex;
        group.add(this._createScaledMesh(
            this._materials.floor,
            0, -3, module.originZ + module.length * 0.5,
            COURSE_HALF_WIDTH * 2, 1.2, module.length
        ));
        group.add(this._createScaledMesh(
            this._materials.wall,
            -COURSE_HALF_WIDTH, WALL_HEIGHT * 0.5 - 2, module.originZ + module.length * 0.5,
            WALL_THICKNESS, WALL_HEIGHT, module.length
        ));
        group.add(this._createScaledMesh(
            this._materials.wall,
            COURSE_HALF_WIDTH, WALL_HEIGHT * 0.5 - 2, module.originZ + module.length * 0.5,
            WALL_THICKNESS, WALL_HEIGHT, module.length
        ));
        const colliders = [
            createBoxCollider({ x: -COURSE_HALF_WIDTH, y: WALL_HEIGHT * 0.5 - 2, z: module.length * 0.5, sx: WALL_THICKNESS, sy: WALL_HEIGHT, sz: module.length }, module.originZ, ownerId, 0, 'wall'),
            createBoxCollider({ x: COURSE_HALF_WIDTH, y: WALL_HEIGHT * 0.5 - 2, z: module.length * 0.5, sx: WALL_THICKNESS, sy: WALL_HEIGHT, sz: module.length }, module.originZ, ownerId, 1, 'wall'),
        ];
        for (let index = 0; index < module.colliders.length; index += 1) {
            const definition = module.colliders[index];
            const worldZ = module.originZ + definition.z;
            group.add(this._createScaledMesh(
                this._materials.obstacle,
                definition.x, definition.y, worldZ,
                definition.sx, definition.sy, definition.sz
            ));
            colliders.push(createBoxCollider(definition, module.originZ, ownerId, index + 2));
        }
        const checkpoint = this._createScaledMesh(
            this._materials.gate,
            0, 9, module.checkpointZ,
            COURSE_HALF_WIDTH * 1.7, 0.5, 0.6
        );
        checkpoint.name = `${ownerId}:checkpoint`;
        group.add(checkpoint);
        this.renderer?.addToScene?.(group);
        this.arena?.registerStaticColliderBatch?.(ownerId, colliders);
        for (let index = 0; index < module.pickups.length; index += 1) {
            const pickup = module.pickups[index];
            this.powerupManager?.spawnAtAnchor?.({
                ownerId,
                id: pickup.id,
                type: pickup.type,
                x: pickup.x,
                y: pickup.y,
                z: module.originZ + pickup.z,
            });
        }
        return { ownerId, module, group, colliders };
    }

    _removeModule(instance) {
        if (!instance) return;
        const { ownerId, module, group } = instance;
        this._deactivateBotsInModule(module);
        this.powerupManager?.removeByOwnerId?.(ownerId);
        this.entityManager?._projectileSystem?.clearInBounds?.(
            -COURSE_VOID_HALF_WIDTH,
            COURSE_VOID_HALF_WIDTH,
            module.originZ,
            module.originZ + module.length
        );
        this.entityManager?._lockOnCache?.clear?.();
        this.arena?.unregisterStaticColliderBatch?.(ownerId);
        this.renderer?.removeFromScene?.(group);
    }

    _deactivateBotsInModule(module) {
        for (let index = 0; index < this._botSlots.length; index += 1) {
            const state = this._botSlots[index];
            const z = Number(state.player?.position?.z);
            if (state.state !== 'active' || !Number.isFinite(z)) continue;
            if (z < module.originZ || z > module.originZ + module.length) continue;
            this.entityManager?.deactivateBotSlot?.(state.slot, 'module_unloaded');
            state.state = 'idle';
            state.eligibleAt = this.elapsedCombatSeconds;
        }
    }

    _syncModules(currentModuleIndex, difficultyTier) {
        const minIndex = Math.max(0, currentModuleIndex - ENDLESS_PARCOURS_ACTIVE_WINDOW.behind);
        const maxIndex = currentModuleIndex + ENDLESS_PARCOURS_ACTIVE_WINDOW.ahead;
        for (let index = minIndex; index <= maxIndex; index += 1) {
            if (this.activeModules.has(index)) continue;
            const previous = index > 0
                ? generateEndlessParcoursModule({ baseSeed: this.baseSeed, moduleIndex: index - 1, difficultyTier })
                : null;
            const module = generateEndlessParcoursModule({
                baseSeed: this.baseSeed,
                moduleIndex: index,
                previousConnector: previous?.exitConnector || 'straight',
                difficultyTier,
            });
            this.activeModules.set(index, this._instantiateModule(module));
        }
        for (const [index, instance] of this.activeModules) {
            if (index >= minIndex && index <= maxIndex) continue;
            this._removeModule(instance);
            this.activeModules.delete(index);
        }
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
        if (human?.alive) {
            human.getDirection(this._tmpDirection).normalize();
            this._tmpDelta.subVectors(this._tmpSpawnPosition, human.position);
            if (this._tmpDelta.lengthSq() > 0.001 && this._tmpDirection.dot(this._tmpDelta.normalize()) > 0.05) return false;
        }
        return true;
    }

    _findSafeSpawnAnchor(slotState) {
        return findSafeEndlessSpawnAnchor(this, slotState);
    }

    _resolveBotRole(slotState) {
        return resolveEndlessBotRole(this, slotState);
    }

    _tryActivateSlot(slotState) {
        const anchor = this._findSafeSpawnAnchor(slotState);
        if (!anchor) return false;
        const tier = resolveEndlessDifficultyTier(this.elapsedCombatSeconds);
        const difficulty = tier <= 1 ? 'EASY' : (tier === 2 ? 'NORMAL' : 'HARD');
        slotState.life += 1;
        const activated = this.entityManager?.activateBotSlot?.({
            slot: slotState.slot,
            position: anchor,
            direction: this._tmpSpawnDirection,
            role: this._resolveBotRole(slotState),
            difficulty,
            life: slotState.life,
        }) === true;
        if (!activated) return false;
        slotState.state = 'active';
        slotState.eligibleAt = 0;
        return true;
    }

    _reconcileBots() {
        if (!this.combatStarted) return;
        const desired = resolveEndlessDesiredBotCount(this.elapsedCombatSeconds);
        for (let index = 0; index < this._botSlots.length; index += 1) {
            const state = this._botSlots[index];
            if (state.state !== 'pending' || state.eligibleAt > this.elapsedCombatSeconds) continue;
            if (!this._tryActivateSlot(state)) state.eligibleAt = this.elapsedCombatSeconds + BOT_SPAWN_DEFER_SECONDS;
        }
        let reserved = countActiveEndlessBotSlots(this._botSlots) + countPendingEndlessBotSlots(this._botSlots);
        for (let index = 0; reserved < desired && index < this._botSlots.length; index += 1) {
            const state = this._botSlots[index];
            if (state.state !== 'idle' || state.eligibleAt > this.elapsedCombatSeconds) continue;
            if (this._tryActivateSlot(state)) reserved += 1;
            else state.eligibleAt = this.elapsedCombatSeconds + BOT_SPAWN_DEFER_SECONDS;
        }
    }

    _announceEscalation() {
        const threat = resolveEndlessThreatLevel(this.elapsedCombatSeconds);
        const botTarget = resolveEndlessDesiredBotCount(this.elapsedCombatSeconds);
        if (threat === this._lastThreatLevel && botTarget === this._lastAnnouncedBotTarget) return;
        this._lastThreatLevel = threat;
        this._lastAnnouncedBotTarget = botTarget;
        const human = this.entityManager?.humanPlayers?.[0] || null;
        this.entityManager?._notifyPlayerFeedback?.(human, `Bedrohungsstufe: ${threat} | Jaeger: ${botTarget}`);
        this.audio?.play?.('POWERUP');
    }

    _updateProgress(player) {
        const progress = Math.max(0, Number(player?.position?.z) || 0);
        if (progress <= this.maxProgressMeters) return;
        this.maxProgressMeters = progress;
        const completed = Math.max(0, Math.floor(progress / ENDLESS_PARCOURS_MODULE_LENGTH));
        if (completed > this.completedModules) {
            this.completedModules = completed;
            const speedMultiplier = 1 + Math.min(0.35, Math.floor(completed / 4) * 0.05);
            player?.setControlOptions?.({ speed: this._startSpeed * speedMultiplier });
        }
        if (!this.combatStarted && progress >= ENDLESS_PARCOURS_MODULE_LENGTH) {
            this.combatStarted = true;
            this.elapsedCombatSeconds = 0;
            this._lastThreatLevel = 'EASY';
        }
        this.currentModuleIndex = Math.max(0, Math.floor(progress / ENDLESS_PARCOURS_MODULE_LENGTH));
    }

    _isOutsideCourse(player) {
        const x = Number(player?.position?.x) || 0;
        const y = Number(player?.position?.y) || 0;
        const z = Number(player?.position?.z) || 0;
        return Math.abs(x) > COURSE_VOID_HALF_WIDTH
            || y < COURSE_MIN_Y
            || y > COURSE_MAX_Y
            || z < this.maxProgressMeters - (ENDLESS_PARCOURS_MODULE_LENGTH * 2 + 30);
    }

    tick(dt = 0) {
        if (this._disposed || this._finalized) return this._summary;
        const safeDt = Math.max(0, Number(dt) || 0);
        const human = this.entityManager?.humanPlayers?.[0] || null;
        this.survivalSeconds += safeDt;
        this._updateProgress(human);
        const tier = resolveEndlessDifficultyTier(this.elapsedCombatSeconds);
        this._syncModules(this.currentModuleIndex, tier);
        if (this._pendingFinalReason) return this.finalize(this._pendingFinalReason);
        if (!human?.alive) return this.finalize(ENDLESS_PARCOURS_END_REASONS.PLAYER_DEATH);
        if (this._isOutsideCourse(human)) {
            this.entityManager?._killPlayer?.(human, ENDLESS_PARCOURS_END_REASONS.VOID);
            return this.finalize(ENDLESS_PARCOURS_END_REASONS.VOID);
        }
        if (this.combatStarted) {
            this.elapsedCombatSeconds += safeDt;
            while (this.elapsedCombatSeconds >= this._nextEscalationBoundary) {
                this._nextEscalationBoundary += 45;
            }
            this._announceEscalation();
            this._reconcileBots();
        }
        this.score = calculateEndlessScore(this);
        return null;
    }

    update(dt = 0) {
        return this.tick(dt);
    }

    _buildSummary(reason) {
        const summary = {
            runType: 'endless_parcours',
            reason: String(reason || ''),
            score: calculateEndlessScore(this),
            distanceMeters: this.maxProgressMeters,
            survivalSeconds: this.survivalSeconds,
            completedModules: this.completedModules,
            botKills: this.botKills,
            seed: this.baseSeed,
            isNewRecord: false,
        };
        return summary;
    }

    finalize(reason = ENDLESS_PARCOURS_END_REASONS.PLAYER_DEATH, options = {}) {
        if (this._finalized) return this._summary;
        this._finalized = true;
        this._pendingFinalReason = '';
        this._summary = this._buildSummary(reason);
        const shouldPersist = options.persist !== false && reason !== ENDLESS_PARCOURS_END_REASONS.ABORT;
        if (shouldPersist) {
            const update = updateEndlessParcoursRecords(this._records, this._summary, this.wallClockIso());
            this._records = update.records;
            this._isNewRecord = update.isNewRecord;
            this._summary.isNewRecord = update.isNewRecord;
            this._lastPersistenceResult = saveEndlessParcoursRecords(this._recordStore, this._records);
        }
        if (options.requestRoundEnd !== false) {
            this.entityManager?.requestRoundEnd?.({
                winner: null,
                allowNoWinner: true,
                reason,
                parcours: { endless: true, endlessSummary: { ...this._summary } },
            });
        }
        return this._summary;
    }

    getHudState() {
        if (this._disposed) return null;
        const activeBots = countActiveEndlessBotSlots(this._botSlots);
        return {
            runType: 'endless_parcours',
            phase: this._finalized ? 'finished' : 'running',
            seed: this.baseSeed,
            score: { total: calculateEndlessScore(this) },
            maxProgressMeters: this.maxProgressMeters,
            survivalSeconds: this.survivalSeconds,
            completedModules: this.completedModules,
            botKills: this.botKills,
            activeBots,
            botCapacity: ENDLESS_PARCOURS_BOT_CAPACITY,
            threatLevel: this.combatStarted ? resolveEndlessThreatLevel(this.elapsedCombatSeconds) : 'INTRO',
            recordScore: this._records.best.score,
            recordDistanceMeters: this._records.best.distanceMeters,
            isNewRecord: this._isNewRecord,
            postRunSummary: this._summary,
            persistence: this._lastPersistenceResult,
        };
    }

    getDebugSnapshot() {
        return {
            activeModules: this.activeModules.size,
            colliderBatches: this.arena?.getStaticColliderBatchCount?.() || 0,
            pickups: Array.isArray(this.powerupManager?.items) ? this.powerupManager.items.length : 0,
            spawnAnchors: Array.from(this.activeModules.values()).reduce((total, entry) => total + entry.module.botAnchors.length, 0),
            activeBots: countActiveEndlessBotSlots(this._botSlots),
            botSlots: this._botSlots.map((entry) => ({ slot: entry.slot, playerIndex: entry.player?.index, state: entry.state, life: entry.life })),
        };
    }

    dispose() {
        if (this._disposed) return;
        if (!this._finalized) this.finalize(ENDLESS_PARCOURS_END_REASONS.ABORT, { persist: false, requestRoundEnd: false });
        for (let index = 0; index < this._botSlots.length; index += 1) {
            this.entityManager?.deactivateBotSlot?.(this._botSlots[index].slot, 'runtime_dispose');
            this._botSlots[index].state = 'idle';
        }
        for (const instance of this.activeModules.values()) this._removeModule(instance);
        this.activeModules.clear();
        this.arena?.exitStaticStreamingMode?.();
        this._sharedGeometry?.dispose?.();
        for (const material of Object.values(this._materials)) material?.dispose?.();
        if (this.entityManager?.endlessParcoursRuntime === this) this.entityManager.endlessParcoursRuntime = null;
        this._disposed = true;
    }
}
