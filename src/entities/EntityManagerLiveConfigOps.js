import { resolveEntityRuntimeConfig } from '../shared/contracts/EntityRuntimeConfig.js';
import { resolveGameplayConfig } from '../shared/contracts/GameplayConfigContract.js';

export function applyLiveRuntimeConfig(em, entityRuntimeConfig, runtimeConfig) {
    const nextErc = resolveEntityRuntimeConfig(entityRuntimeConfig || em.entityRuntimeConfig || null);
    if (!nextErc) return;
    em.entityRuntimeConfig = nextErc;

    const runtimeContext = em.runtime?.context || em._runtimeContext || null;
    if (runtimeContext?.services && typeof runtimeContext.services === 'object') {
        runtimeContext.services.entityRuntimeConfig = nextErc;
    }
    const supportRuntimeContext = em.runtime?.support?.runtimeContext || null;
    if (
        supportRuntimeContext
        && supportRuntimeContext !== runtimeContext
        && supportRuntimeContext?.services
        && typeof supportRuntimeContext.services === 'object'
    ) {
        supportRuntimeContext.services.entityRuntimeConfig = nextErc;
    }

    const projectileSystem = em.runtime?.systems?.projectileSystem || em._projectileSystem || null;
    if (projectileSystem && typeof projectileSystem === 'object') {
        projectileSystem.entityRuntimeConfig = nextErc;
    }

    if (em.powerupManager && typeof em.powerupManager === 'object') {
        em.powerupManager.entityRuntimeConfig = nextErc;
        if (runtimeConfig !== undefined) {
            em.powerupManager.runtimeConfig = runtimeConfig;
        }
        if (nextErc.POWERUP?.TYPES && typeof nextErc.POWERUP.TYPES === 'object') {
            em.powerupManager.typeKeys = Object.keys(nextErc.POWERUP.TYPES);
        }
    }

    if (em.gameModeStrategy && typeof em.gameModeStrategy === 'object') {
        em.gameModeStrategy.entityRuntimeConfig = nextErc;
    }

    if (em.arena) {
        em.arena.entityRuntimeConfig = nextErc;
        if (runtimeConfig !== undefined) {
            em.arena.runtimeConfig = runtimeConfig;
        }
    }
    if (em._lastRoundGhostSystem && typeof em._lastRoundGhostSystem.configure === 'function') {
        const hasRuntimeGhostCollisionSetting = runtimeConfig?.arcade
            && Object.prototype.hasOwnProperty.call(runtimeConfig.arcade, 'ghostTrailCollisionEnabled');
        em._lastRoundGhostSystem.configure({
            entityManager: em,
            ghostTrailCollisionEnabled: hasRuntimeGhostCollisionSetting
                ? runtimeConfig.arcade.ghostTrailCollisionEnabled === true
                : nextErc.TRAIL?.GHOST_COLLISION_ENABLED === true,
        });
    }
    if (runtimeConfig !== undefined) {
        em.runtimeConfig = runtimeConfig;
    }
    const playerSection = nextErc.PLAYER || {};
    const nextMaxHp = Number(nextErc?.HUNT?.PLAYER_MAX_HP);
    for (const player of em.players) {
        if (!player) continue;
        player.entityRuntimeConfig = nextErc;
        if (typeof player.setControlOptions === 'function') {
            player.setControlOptions({
                speed: Number(playerSection.SPEED),
                turnSpeed: Number(playerSection.TURN_SPEED),
                rollSpeed: Number(playerSection.ROLL_SPEED),
                modelScale: Number(playerSection.MODEL_SCALE),
            });
        }
        player.gameplayConfig = resolveGameplayConfig(player);
        if (Number.isFinite(nextMaxHp) && nextMaxHp > 0 && Number.isFinite(Number(player.maxHp))) {
            player.maxHp = nextMaxHp;
            const hp = Number(player.hp);
            if (Number.isFinite(hp)) {
                player.hp = Math.max(0, Math.min(hp, nextMaxHp));
            }
        }
    }
}
