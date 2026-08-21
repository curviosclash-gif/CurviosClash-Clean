import {
    emitHuntEliminationFeed,
    rememberFightDeath,
} from '../hunt/HuntEliminationFeed.js';
import { resolveWorldAudioOptions } from './audio/WorldAudioOptions.js';
import { emitArcadeEliminationEvents } from './runtime/EntityArcadeGameplayEvents.js';

export function killPlayer(entityManager, player, cause = 'UNKNOWN', options = {}) {
    if (!player || !player.alive) return;
    rememberFightDeath(player);
    entityManager._parcoursProgressSystem?.onPlayerDeath?.(player, { cause });
    entityManager.recorder?.captureSnapshotNow?.(entityManager);
    player.kill();
    entityManager.recorder?.captureSnapshotNow?.(entityManager);
    entityManager._projectileSystem?.clearRocketTrailsForOwner?.(player);
    if (entityManager.gameModeStrategy?.hasScoring() && entityManager.isFightOutcomeAuthority !== false) {
        const scoringResult = entityManager._huntScoring.registerElimination(player, {
            killer: options?.killer || null,
            spawnAgeSeconds: (Math.max(0, Number(entityManager._simulationClockMs) || 0) * 0.001)
                - (Number(player.fightSpawnedAtSeconds) || 0),
        });
        emitHuntEliminationFeed(
            entityManager._eventBus,
            entityManager.players,
            player,
            options?.killer,
            scoringResult?.assistIndices,
            entityManager.audio
        );
    }
    entityManager._respawnSystem.onPlayerDied(player);
    const killcamStarted = entityManager._killcamSystem?.onPlayerDied?.(
        player,
        {
            killer: options?.killer || null,
            cause,
            impactPoint: options?.impactPoint || player.position,
            projectileType: options?.projectileType || null,
        }
    ) === true;
    const suppressLiveDeathEffects = killcamStarted
        && entityManager._killcamSystem?.shouldSuppressLiveDeathEffects?.() !== false;
    if (!suppressLiveDeathEffects) {
        entityManager.particles?.spawnExplosion?.(player.position, player.color, {
            cause,
            projectileType: options?.projectileType || null,
        });
    }
    const killer = options?.killer || null;
    if (!suppressLiveDeathEffects) {
        entityManager.audio?.play?.(
            'EXPLOSION',
            resolveWorldAudioOptions(entityManager.players, player.position)
        );
    }
    if (entityManager.recorder) {
        const killerIndex = Number.isInteger(killer?.index) ? killer.index : -1;
        entityManager.recorder.markPlayerDeath(player, cause);
        entityManager.recorder.logEvent(
            'KILL',
            player.index,
            `cause=${cause} killer=${killerIndex}`,
            player.position
        );
    }
    emitArcadeEliminationEvents(entityManager, player, cause, options);
    entityManager._eventBus.emitPlayerDied(player, cause);
    entityManager.endlessParcoursRuntime?.handlePlayerDeath?.(player, cause, options);
}
