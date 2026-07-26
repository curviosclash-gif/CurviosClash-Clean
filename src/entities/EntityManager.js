// ============================================
// EntityManager.js - manages players, collisions and item projectiles
// ============================================

import { BotPolicyRegistry } from './ai/BotPolicyRegistry.js';
import { DEFAULT_BOT_POLICY_TYPE } from './ai/BotPolicyTypes.js';
import { createBotRuntimeContext } from './ai/BotRuntimeContextFactory.js';
import { assembleEntityRuntime } from './runtime/EntityRuntimeAssembler.js';
import { emitHuntDamageFeedback } from '../hunt/HuntDamageFeedback.js';
import { rememberFightAttacker } from '../hunt/HuntEliminationFeed.js';
import { createGameModeStrategy } from '../modes/GameModeRegistry.js';
import { LastRoundGhostSystem } from './LastRoundGhostSystem.js';
import { KillcamSystem } from '../hunt/KillcamSystem.js';
import { killPlayer } from './EntityPlayerDeathOps.js';
import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import { applyLiveRuntimeConfig as _applyLiveRuntimeConfig } from './EntityManagerLiveConfigOps.js';
import { createRuntimeRng } from '../shared/contracts/RuntimeRngContract.js';
import {
    emitArcadeDamageEvent,
    emitArcadeGameplayEvent,
} from './runtime/EntityArcadeGameplayEvents.js';
import { updateEntityCameraContext } from './runtime/EntityCameraContext.js';

function clampInt(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function bindRuntimePorts(owner, runtime) {
    owner.runtimePorts = runtime?.ports || null;
    owner._projectileSystem = runtime?.systems?.projectileSystem || null;
    owner._huntScoring = runtime?.support?.huntScoring || null;
    owner._eventBus = runtime?.support?.eventBus || null;
    owner._tmpVec = runtime?.support?.tempVectors?.primary || null;
    owner._tmpVec2 = runtime?.support?.tempVectors?.secondary || null;
    owner._tmpDir = runtime?.support?.tempVectors?.direction || null;
    owner._tmpDir2 = runtime?.support?.tempVectors?.alternateDirection || null;
    owner._tmpCamAnchor = runtime?.support?.tempVectors?.cameraAnchor || null;
    owner._tmpCamRenderPos = runtime?.support?.tempVectors?.cameraRenderPosition || null;
    owner._tmpCamRenderQuat = runtime?.support?.tempQuaternion || null;
    owner._tmpCollisionNormal = runtime?.support?.tempVectors?.collisionNormal || null;
    owner._tmpPrevPlayerPosition = runtime?.support?.tempVectors?.previousPlayerPosition || null;
    owner._fallbackArenaCollision = runtime?.support?.fallbackArenaCollision || null;
    owner._lockOnCache = runtime?.support?.lockOnCache || new Map();
    owner._trailSpatialIndex = runtime?.support?.trailSpatialIndex || null;
    owner._spawnPlacementSystem = runtime?.support?.spawnPlacementSystem || null;
    owner._collisionResponseSystem = runtime?.support?.collisionResponseSystem || null;
    owner._runtimeContext = runtime?.context || null;
    owner._playerInputSystem = runtime?.systems?.playerInputSystem || null;
    owner._playerLifecycleSystem = runtime?.systems?.playerLifecycleSystem || null;
    owner._parcoursProgressSystem = runtime?.systems?.parcoursProgressSystem || null;
    owner._overheatGunSystem = runtime?.systems?.overheatGunSystem || null;
    owner._respawnSystem = runtime?.systems?.respawnSystem || null;
    owner._huntCombatSystem = runtime?.systems?.huntCombatSystem || null;
    owner._staticTurretSystem = runtime?.systems?.staticTurretSystem || null;
    owner._roundOutcomeSystem = runtime?.systems?.roundOutcomeSystem || null;
    owner._setupOps = runtime?.systems?.setupOps || null;
    owner._spawnOps = runtime?.systems?.spawnOps || null;
    owner._tickPipeline = runtime?.systems?.tickPipeline || null;
}

export class EntityManager {
    static deriveSelfTrailSkipRecentSegments(player) {
        const entityRuntimeConfig = resolveEntityRuntimeConfig(player?.entityManager || player);
        const updateInterval = Math.max(0.01, Number(entityRuntimeConfig.TRAIL?.UPDATE_INTERVAL) || 0.07);
        const speed = Math.max(1, Number(player?.speed) || Number(player?.baseSpeed) || Number(entityRuntimeConfig.PLAYER?.SPEED) || 18);
        const hitboxRadius = Math.max(0.4, Number(player?.hitboxRadius) || Number(entityRuntimeConfig.PLAYER?.HITBOX_RADIUS) || 0.8);
        const trailRadius = Math.max(0.05, (Number(player?.trail?.width) || Number(entityRuntimeConfig.TRAIL?.WIDTH) || 0.6) * 0.5);

        let bodyLengthEstimate = hitboxRadius * 2.5;
        const box = player?.hitboxBox;
        if (box && box.min && box.max) {
            const lenX = Math.abs(Number(box.max.x) - Number(box.min.x)) || 0;
            const lenZ = Math.abs(Number(box.max.z) - Number(box.min.z)) || 0;
            bodyLengthEstimate = Math.max(bodyLengthEstimate, lenX, lenZ);
        }

        const graceDistance = Math.max(
            hitboxRadius * 3.5,
            bodyLengthEstimate + hitboxRadius * 0.5 + trailRadius
        );
        const estimatedSegmentSpacing = Math.max(0.2, speed * updateInterval);

        return clampInt(Math.ceil(graceDistance / estimatedSegmentSpacing) + 1, 5, 12);
    }

    constructor(renderer, arena, powerupManager, particles, audio, recorder, runtimeProfiler = null, options = {}) {
        this.renderer = renderer;
        this.arena = arena;
        this.powerupManager = powerupManager;
        this.particles = particles;
        this.audio = audio;
        this.recorder = recorder;
        this.runtimeProfiler = runtimeProfiler || null;
        this.players = [];
        this.humanPlayers = [];
        this.bots = [];
        this.botByPlayer = new Map();
        // ponytail: camera updates are synchronous, so one mutable context avoids per-frame garbage.
        this._cameraContext = {
            playerState: { hp: 0, maxHp: 1, score: 0, speed: 0, isBoosting: false },
            otherPlayerPosition: null,
        };
        this.onPlayerDied = null;
        this.onRoundEnd = null;
        this.onPlayerFeedback = null;
        this.onHuntFeedEvent = null;
        this.onHuntDamageEvent = null;
        this.onArcadeGameplayEvent = null;
        this.entityRuntimeConfig = resolveEntityRuntimeConfig(options?.entityRuntimeConfig || arena || null);
        this.botDifficulty = this.entityRuntimeConfig.BOT?.ACTIVE_DIFFICULTY
            || this.entityRuntimeConfig.BOT?.DEFAULT_DIFFICULTY
            || 'NORMAL';
        this.runtime = assembleEntityRuntime(this);
        bindRuntimePorts(this, this.runtime);
        this._lastRoundGhostSystem = new LastRoundGhostSystem(renderer, {
            entityManager: this,
            ghostTrailCollisionEnabled: this.entityRuntimeConfig?.TRAIL?.GHOST_COLLISION_ENABLED === true,
        });
        this._killcamSystem = new KillcamSystem({
            renderer, entityManager: this, recorder, respawnSystem: this._respawnSystem,
            ghostSystem: this._lastRoundGhostSystem,
        });
        this.projectiles = this.runtime.systems.projectileSystem.projectiles;
        this.botPolicyRegistry = new BotPolicyRegistry();
        this.botPolicyType = DEFAULT_BOT_POLICY_TYPE;
        this.botBridgeEnabled = false;
        this.activeGameMode = String(this.entityRuntimeConfig.HUNT?.ACTIVE_MODE || 'CLASSIC').trim().toUpperCase();
        this.huntEnabled = this.entityRuntimeConfig.HUNT?.ENABLED !== false && this.activeGameMode === 'HUNT';
        this.runtimeRng = createRuntimeRng();
        this.gameModeStrategy = createGameModeStrategy(this.activeGameMode, {
            entityRuntimeConfig: this.entityRuntimeConfig,
            runtimeRng: this.runtimeRng,
        });
        if (this.powerupManager) {
            this.powerupManager.getStrategy = () => this.gameModeStrategy;
        }
        this.runtimeConfig = null;
    }

    setup(numHumans, numBots, options = {}) {
        this.clear();
        this._setupOps.runSetup(numHumans, numBots, options);
    }

    _applySetupRuntimeOptions(options = {}) {
        this._setupOps.applySetupRuntimeOptions(options);
    }

    _resolveSetupPlayerContext(options = {}) {
        return this._setupOps.resolveSetupPlayerContext(options);
    }

    _resetSetupCollections() {
        this._setupOps.resetSetupCollections();
    }

    _setupHumanPlayers(numHumans, setupContext) {
        this._setupOps.setupHumanPlayers(numHumans, setupContext);
    }

    _setupBotPlayers(numHumans, numBots, setupContext) {
        this._setupOps.setupBotPlayers(numHumans, numBots, setupContext);
    }

    setBotDifficulty(profileName) {
        this.botDifficulty = profileName || this.botDifficulty;
        for (let i = 0; i < this.bots.length; i++) {
            const bot = this.bots[i];
            if (bot?.ai?.setDifficulty) {
                bot.ai.setDifficulty(this.botDifficulty);
            }
        }
    }

    applyLiveRuntimeConfig(entityRuntimeConfig = null, runtimeConfig = null) {
        _applyLiveRuntimeConfig(this, entityRuntimeConfig, runtimeConfig);
    }

    createBotRuntimeContext(player, dt, options = {}) {
        return createBotRuntimeContext(this, player, dt, options);
    }

    spawnAll() {
        this._spawnOps.spawnAll();
    }

    _createSpawnContext() {
        return this._spawnOps.createSpawnContext();
    }

    _spawnPlayer(player, spawnContext) {
        this._spawnOps.spawnPlayer(player, spawnContext);
    }

    _getPlanarSpawnLevel() {
        const bounds = this.arena?.bounds || null;
        const fallback = bounds
            ? (bounds.minY + bounds.maxY) * 0.5
            : (this.entityRuntimeConfig.PLAYER?.START_Y || 5);

        const hasPortals = Array.isArray(this.arena?.portals) && this.arena.portals.length > 0;
        if (!hasPortals) {
            return fallback;
        }

        if (!this.arena?.getPortalLevels) {
            return fallback;
        }

        const levels = this.arena.getPortalLevels();
        if (!Array.isArray(levels) || levels.length === 0) {
            return fallback;
        }

        let best = fallback;
        let bestDist = Infinity;
        for (let i = 0; i < levels.length; i++) {
            const value = levels[i];
            if (!Number.isFinite(value)) continue;
            const dist = Math.abs(value - fallback);
            if (dist < bestDist) {
                bestDist = dist;
                best = value;
            }
        }
        return best;
    }

    _findSpawnPosition(minDistance = 12, margin = 12, planarLevel = null) {
        return this._spawnPlacementSystem.findSpawnPosition(minDistance, margin, planarLevel);
    }

    _findSafeSpawnDirection(position, radius = 0.8) {
        return this._spawnPlacementSystem.findSafeSpawnDirection(position, radius);
    }

    _traceFreeDistance(origin, direction, maxDistance, stepDistance, radius = 0.8) {
        return this._spawnPlacementSystem.traceFreeDistance(origin, direction, maxDistance, stepDistance, radius);
    }

    update(dt, inputManager, renderFrameId = 0) {
        this._tickPipeline.update(dt, inputManager, renderFrameId);
    }

    setNetworkReplica(enabled) { this._projectileSystem?.setNetworkReplica?.(enabled); this.powerupManager?.setNetworkReplica?.(enabled); } applyNetworkSnapshot(snapshot) { this._projectileSystem?.applyNetworkSnapshot?.(snapshot?.projectiles, this.players); this.powerupManager?.applyNetworkSnapshot?.(snapshot?.powerups); }

    _getPendingHumanRespawns(players = this.humanPlayers) {
        if (!this.gameModeStrategy?.isRespawnEnabled()) return 0;
        return this._respawnSystem.getPendingCountForPlayers(players);
    }

    _takeInventoryItem(player, preferredIndex = -1, action = 'use') {
        return this._huntCombatSystem.takeInventoryItem(player, preferredIndex, action);
    }

    _peekInventoryItem(player, preferredIndex = -1, action = 'use') {
        return this._huntCombatSystem.peekInventoryItem(player, preferredIndex, action);
    }

    _useInventoryItem(player, preferredIndex = -1) {
        return this._huntCombatSystem.useInventoryItem(player, preferredIndex);
    }

    _shootItemProjectile(player, preferredIndex = -1) {
        return this._huntCombatSystem.shootItemProjectile(player, preferredIndex);
    }

    _shootHuntGun(player) {
        return this._huntCombatSystem.shootHuntGun(player);
    }

    getHuntOverheatSnapshot() {
        return this._overheatGunSystem.getOverheatSnapshot();
    }

    getHuntScoreboard() {
        return this._huntScoring.getScoreboard(this.players);
    }

    getHuntScoreboardSummary(maxEntries = 3, rows = null) {
        return this._huntScoring.formatSummary(this.players, { maxEntries, rows });
    }

    getHuntRespawnRemainingByPlayer() { return this._respawnSystem.getRemainingByPlayer(); }

    getParcoursHudState(playerIndex, now = undefined) {
        if (!this._parcoursProgressSystem) return null;
        return this._parcoursProgressSystem.getPlayerHudState(playerIndex, now);
    }

    getParcoursRouteSnapshot() {
        return this._parcoursProgressSystem?.getRouteSnapshot?.() || null;
    }

    _checkLockOn(player) {
        return this._huntCombatSystem.checkLockOn(player);
    }

    getLockOnTarget(playerIndex) {
        if (this._lockOnCache.has(playerIndex)) return this._lockOnCache.get(playerIndex);
        const player = this.players[playerIndex];
        if (!player || !player.alive) return null;
        return this._checkLockOn(player);
    }

    _notifyPlayerFeedback(player, message) { this._eventBus.emitPlayerFeedback(player, message); }

    _emitArcadeGameplayEvent(event) { emitArcadeGameplayEvent(this, event); }

    _emitHuntDamageEvent(event) {
        rememberFightAttacker(event?.target, event?.sourcePlayer);
        this.recorder?.recordDamageEvent?.(event || null);
        if (this.gameModeStrategy?.hasDamageEvents() && this.isFightOutcomeAuthority !== false) {
            this._huntScoring.registerDamage(event?.sourcePlayer, event?.target, event?.damageResult);
        }
        emitHuntDamageFeedback(event, {
            particles: this.particles,
            audio: this.audio,
        });
        this._eventBus.emitHuntDamageEvent(event || null);
        emitArcadeDamageEvent(this, event);
    }

    _killPlayer(player, cause = 'UNKNOWN', options = {}) {
        killPlayer(this, player, cause, options);
    }

    _isBotPositionSafe(player, position) {
        return this._collisionResponseSystem.isBotPositionSafe(player, position);
    }

    _clampBotPosition(vec) {
        this._collisionResponseSystem.clampBotPosition(vec);
    }

    _findSafeBouncePosition(player, baseDirection, normal = null, options = {}) {
        this._spawnPlacementSystem.findSafeBouncePosition(player, baseDirection, normal, options);
    }

    _bounceBot(player, normalOverride = null, source = 'WALL', options = {}) {
        this._collisionResponseSystem.bounceBot(player, normalOverride, source, options);
        player?.markRenderDiscontinuity?.('bounce');
    }

    _bouncePlayerOnFoam(player, normalOverride = null) {
        this._collisionResponseSystem.bouncePlayerOnFoam(player, normalOverride);
        player?.markRenderDiscontinuity?.('bounce-foam');
    }

    renderInterpolatedTransforms(renderAlpha = 1, visualDelta = 0) {
        const visualDt = Math.max(0, Math.min(0.05, Number(visualDelta) || 0));
        for (const player of this.players) {
            player?.view?.applyRenderTransform?.(renderAlpha);
            player?.view?.updateVisuals?.(player?.alive ? visualDt : 0);
        }
    }

    updateCameras(dt, renderAlpha = 1, useRenderedTransforms = false, renderProjection = null) {
        const projectedPlayers = Array.isArray(renderProjection?.players) ? renderProjection.players : null;
        let projectedHumanCount = 0;
        if (projectedPlayers) {
            for (const player of projectedPlayers) {
                if (player && player.isBot !== true) projectedHumanCount += 1;
            }
        }
        if (projectedHumanCount > 0) {
            const hasMultipleHumans = projectedHumanCount > 1;
            for (const projectedPlayer of projectedPlayers) {
                if (!projectedPlayer || projectedPlayer.isBot === true) continue;
                const playerIndex = Number.isInteger(projectedPlayer?.playerIndex)
                    ? projectedPlayer.playerIndex
                    : -1;
                if (playerIndex < 0 || playerIndex >= this.renderer.cameras.length) continue;

                const mode = this.renderer.getCameraMode(playerIndex);
                this._tmpCamRenderPos.set(
                    Number(projectedPlayer?.position?.x) || 0,
                    Number(projectedPlayer?.position?.y) || 0,
                    Number(projectedPlayer?.position?.z) || 0
                );
                this._tmpCamRenderQuat.set(
                    Number(projectedPlayer?.quaternion?.x) || 0,
                    Number(projectedPlayer?.quaternion?.y) || 0,
                    Number(projectedPlayer?.quaternion?.z) || 0,
                    Number.isFinite(Number(projectedPlayer?.quaternion?.w))
                        ? Number(projectedPlayer?.quaternion?.w)
                        : 1
                );

                const dir = projectedPlayer?.alive !== false
                    ? this._tmpDir2.set(
                        Number(projectedPlayer?.direction?.x) || 0,
                        Number(projectedPlayer?.direction?.y) || 0,
                        Number(projectedPlayer?.direction?.z) || 0
                    )
                    : this._tmpDir2.set(0, 0, -1);
                if (dir.lengthSq() <= 0.000001) {
                    dir.set(0, 0, -1);
                } else {
                    dir.normalize();
                }

                const firstPersonAnchor = mode === 'FIRST_PERSON'
                    ? this._tmpCamAnchor.set(
                        Number(projectedPlayer?.firstPersonAnchor?.x) || 0,
                        Number(projectedPlayer?.firstPersonAnchor?.y) || 0,
                        Number(projectedPlayer?.firstPersonAnchor?.z) || 0
                    )
                    : null;
                let otherPlayerPosition = null;
                if (hasMultipleHumans) {
                    let otherPlayer = null;
                    for (const entry of projectedPlayers) {
                        if (entry && entry.isBot !== true && entry.playerIndex !== playerIndex) {
                            otherPlayer = entry;
                            break;
                        }
                    }
                    if (otherPlayer?.position) {
                        otherPlayerPosition = this._tmpVec2.set(
                            Number(otherPlayer.position.x) || 0,
                            Number(otherPlayer.position.y) || 0,
                            Number(otherPlayer.position.z) || 0
                        );
                    }
                }

                this.renderer.updateCamera(
                    playerIndex,
                    this._tmpCamRenderPos,
                    dir,
                    dt,
                    this._tmpCamRenderQuat,
                    projectedPlayer?.cockpitCamera === true,
                    projectedPlayer?.isBoosting === true,
                    this.arena,
                    firstPersonAnchor,
                    updateEntityCameraContext(this._cameraContext, projectedPlayer, otherPlayerPosition)
                );
            }
            this._killcamSystem?.applyCinematicCamera?.(dt);
            return;
        }

        const hasMultipleHumans = Array.isArray(this.humanPlayers) && this.humanPlayers.length > 1;
        for (const player of this.players) {
            if (!player.isBot && player.index < this.renderer.cameras.length) {
                const mode = this.renderer.getCameraMode(player.index);
                const reusedRenderedTransform = useRenderedTransforms
                    && player.view?.copyRenderTransform?.(this._tmpCamRenderPos, this._tmpCamRenderQuat);
                if (!reusedRenderedTransform) {
                    player.resolveRenderTransform(renderAlpha, this._tmpCamRenderPos, this._tmpCamRenderQuat);
                }
                const dir = player.alive
                    ? this._tmpDir2.set(0, 0, -1).applyQuaternion(this._tmpCamRenderQuat)
                    : this._tmpDir2.set(0, 0, -1);
                const firstPersonAnchor = mode === 'FIRST_PERSON'
                    ? player.getFirstPersonCameraAnchor(this._tmpCamAnchor)
                    : null;
                let otherPlayerPosition = null;
                if (hasMultipleHumans) {
                    const otherPlayer = this.humanPlayers.find((entry) => entry && entry !== player) || null;
                    if (otherPlayer && typeof otherPlayer.resolveRenderPosition === 'function') {
                        otherPlayerPosition = otherPlayer.resolveRenderPosition(renderAlpha);
                    }
                }
                this.renderer.updateCamera(
                    player.index,
                    this._tmpCamRenderPos,
                    dir,
                    dt,
                    this._tmpCamRenderQuat,
                    player.cockpitCamera,
                    player.isBoosting,
                    this.arena,
                    firstPersonAnchor,
                    updateEntityCameraContext(this._cameraContext, player, otherPlayerPosition)
                );
            }
        }
        this._killcamSystem?.applyCinematicCamera?.(dt);
    }

    playLastRoundGhost(clip, options = undefined) {
        return this._lastRoundGhostSystem?.playClip?.(clip, options) || false;
    }

    clearLastRoundGhost() {
        this._lastRoundGhostSystem?.clear?.();
    }

    updateLastRoundGhostPlayback(dt) {
        const killcam = this._killcamSystem;
        if (killcam?.isActive?.()) {
            const scaledDt = Math.max(0, Number(dt) || 0) * killcam.getTimeScale();
            killcam.advanceGhostPlayback(scaledDt);
            killcam.update(dt);
            return;
        }
        this._lastRoundGhostSystem?.update?.(dt);
    }

    getLastRoundGhostState() {
        return this._lastRoundGhostSystem?.getState?.() || {
            active: false,
            frameCount: 0,
            entryCount: 0,
            ghosts: [],
        };
    }

    getHumanPlayers() { return this.humanPlayers; }
    getRuntimeContext() { return this.runtime?.context || this._runtimeContext; }
    getTrailSpatialIndex() { return this._trailSpatialIndex; }

    registerTrailSegment(playerIndex, segmentIdx, data, reusableRef = null) {
        return this._trailSpatialIndex.registerTrailSegment(playerIndex, segmentIdx, data, reusableRef);
    }

    unregisterTrailSegment(key, entry) {
        this._trailSpatialIndex.unregisterTrailSegment(key, entry);
    }

    checkGlobalCollision(position, radius, excludePlayerIndex = -1, skipRecent = 0, playerRef = null) {
        return this._trailSpatialIndex.checkGlobalCollision(position, radius, excludePlayerIndex, skipRecent, playerRef);
    }

    clear() {
        this._teardownRuntime({ disposeProjectileSystem: false });
    }

    dispose() {
        this._teardownRuntime({ disposeProjectileSystem: true });
    }

    _teardownRuntime({ disposeProjectileSystem = false } = {}) {
        for (const player of this.players) {
            if (player) player.dispose();
        }
        this.players.length = 0;
        this.humanPlayers.length = 0;
        this.bots.length = 0;
        this.botByPlayer.clear();
        if (disposeProjectileSystem) {
            this._projectileSystem.dispose();
        } else {
            this._projectileSystem.clear();
        }
        this._lastRoundGhostSystem?.clear?.();
        this._killcamSystem?.clear?.();
        this._overheatGunSystem.reset();
        this._respawnSystem.reset();
        this._parcoursProgressSystem?.reset?.();
        if (disposeProjectileSystem) {
            this._staticTurretSystem?.dispose?.();
        } else {
            this._staticTurretSystem?.clear?.();
        }
        this._huntScoring.reset();
        this._simulationClockMs = 0;

        if (this.powerupManager) {
            this.powerupManager.clear();
        }

        this._trailSpatialIndex.clear();
        this._lockOnCache.clear();
        this.onHuntDamageEvent = null;
        this.onHuntFeedEvent = null;
        this.onArcadeGameplayEvent = null;
        if (disposeProjectileSystem) {
            this._lastRoundGhostSystem?.dispose?.();
            this._killcamSystem?.dispose?.();
        }
    }
}
