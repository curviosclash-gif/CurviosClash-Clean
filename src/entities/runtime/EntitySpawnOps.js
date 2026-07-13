import { resolveGameplayConfig } from '../../shared/contracts/GameplayConfigContract.js';

export class EntitySpawnOps {
    constructor(entityManager) {
        this.entityManager = entityManager || null;
    }

    spawnAll() {
        const owner = this.entityManager;
        if (!owner) return;
        owner._roundEnded = false;
        owner._simulationClockMs = 0;
        owner._respawnSystem.reset();
        owner._parcoursProgressSystem?.startRound?.(owner.players);
        owner._spawnPlacementSystem?.resetAssignments?.();
        const spawnContext = this.createSpawnContext();
        for (const player of owner.players) {
            this.spawnPlayer(player, spawnContext);
        }
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
        const dir = owner._findSafeSpawnDirection(pos, player.hitboxRadius);
        player.spawn(pos, dir);
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
        if (owner.recorder) {
            owner.recorder.markPlayerSpawn(player);
            owner.recorder.logEvent('SPAWN', player.index, player.isBot ? 'bot=1' : 'bot=0');
        }
    }
}

