import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';
import { resolveParcoursSpawnDirection } from '../systems/ParcoursRespawnOps.js';

export class EntitySpawnOps {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
    }

    spawnAll() {
        const owner = this.entityManager;
        if (!owner) return;
        owner._roundEnded = false;
        owner._simulationClockMs = 0;
        owner.arena?.setGlbAnimationElapsedSeconds?.(0);
        owner._respawnSystem.reset();
        owner._huntScoring.reset();
        owner._roundOutcomeSystem.reset();
        owner._globalFogEffectSystem?.reset?.();
        owner._lastRoundOutcome = null;
        owner._authoritativeHuntState = null;
        owner._lastAppliedAuthoritativeOutcomeKey = '';
        owner._parcoursProgressSystem?.startRound?.(owner.players);
        owner._mapHazardSystem?.startRound?.();
        owner._mapDestructibleSystem?.startRound?.();
        owner._mapDestructibleBlastSystem?.startRound?.();
        owner._secretRoomSystem?.startRound?.();
        owner._exclusionZoneSystem?.startRound?.();
        owner._spawnPlacementSystem?.resetAssignments?.();
        const spawnContext = this.createSpawnContext();
        for (const player of owner.players) {
            if (player?.entitySlotActive === false) continue;
            if (!player?.isBot && owner.gameModeStrategy?.isEndlessParcours?.()) {
                const initialSpawn = owner.endlessParcoursRuntime?.getInitialHumanSpawn?.();
                if (initialSpawn?.position) {
                    this.spawnPlayerAt(player, initialSpawn.position, initialSpawn.direction);
                    continue;
                }
            }
            this.spawnPlayer(player, spawnContext);
        }
        owner._staticTurretSystem?.startRound?.();
        owner._mapUnitSystem?.startRound?.();
        owner._lightningStrikeSystem?.reset?.();
    }

    createSpawnContext() {
        const owner = this.entityManager;
        const isPlanar = !!resolveGameplayConfig(owner).GAMEPLAY.PLANAR_MODE;
        return {
            planarSpawnLevel: isPlanar && owner ? owner._getPlanarSpawnLevel() : null,
        };
    }

    spawnPlayer(player, spawnContext = null) {
        const owner = this.entityManager;
        if (!owner || !player) return;
        const context = spawnContext || this.createSpawnContext();
        const pos = owner._findSpawnPosition(12, 12, {
            planarLevel: context.planarSpawnLevel,
            player,
        });
        const dir = this._resolveRouteSpawnDirection(player, pos)
            || owner._findSafeSpawnDirection(pos, player.hitboxRadius, player);
        this.spawnPlayerAt(player, pos, dir);
    }

    // Humans on a parcours route start facing the route. Bots keep the safe free lane, so
    // their spread across the spawn points stays as it was.
    _resolveRouteSpawnDirection(player, position) {
        if (!position || player?.isBot === true) return null;
        const route = this.entityManager?._parcoursProgressSystem?.getRouteSnapshot?.() || null;
        const facing = resolveParcoursSpawnDirection(route, position);
        return facing ? position.clone().set(facing[0], facing[1], facing[2]) : null;
    }

    spawnPlayerAt(player, pos, dir = null) {
        const owner = this.entityManager;
        if (!owner || !player || !pos) return;
        player.spawn(pos, dir);
        player.fightLastAttackerIndex = -1;
        player.fightLastThreatSourceIndex = -1;
        player.fightLastThreatAtSeconds = -Infinity;
        player.fightTargetPlayerIndex = -1;
        player.fightTargetLockRemaining = 0;
        player.fightSpawnedAtSeconds = Math.max(0, Number(owner._simulationClockMs) || 0) * 0.001;
        if (player.isBot && player.scenarioRole) {
            player.scenarioAnchor = { x: pos.x, y: pos.y, z: pos.z };
        }
        // 82.8.1: Apply strategy stat bonuses (HP bonus, speed upgrade) after base spawn
        const strategy = owner.gameModeStrategy;
        if (strategy) {
            if (typeof strategy.resetPlayerHealth === 'function') {
                strategy.resetPlayerHealth(player);
            }
            if (typeof strategy.applySpawnStatBonuses === 'function') {
                strategy.applySpawnStatBonuses(player);
            }
        }
        player.shootCooldown = 0;
        owner._parcoursProgressSystem?.onPlayerSpawn?.(player, { reason: 'spawn_all' });
        owner._exclusionZoneSystem?.resetPlayer?.(player);
        if (owner.recorder) {
            owner.recorder.markPlayerSpawn(player);
            owner.recorder.logEvent('SPAWN', player.index, player.isBot ? 'bot=1' : 'bot=0');
        }
    }
}

