import {
    emitHuntEliminationFeed,
    rememberFightDeath,
} from '../hunt/HuntEliminationFeed.js';
import {
    isEnvironmentKillCause,
    resolveEnvironmentKillCredit,
} from '../hunt/EnvironmentKillCreditOps.js';
import { resolveWorldAudioOptions } from './audio/WorldAudioOptions.js';
import { emitArcadeEliminationEvents } from './runtime/EntityArcadeGameplayEvents.js';

function resolveEnvironmentCredit(entityManager, player, cause, deathOptions, nowSeconds) {
    if (deathOptions?.killer || !isEnvironmentKillCause(cause)) return null;
    const scoring = entityManager?._huntScoring || null;
    const credit = resolveEnvironmentKillCredit({
        cause,
        victim: player,
        players: entityManager?.players || [],
        // No clock argument: hit ages stay on the clock that stamped them.
        damageHistory: scoring?.getDamageHistoryAges?.(player.index) || [],
        nowSeconds,
    });
    return credit.killer ? credit : null;
}

export function killPlayer(entityManager, player, cause = 'UNKNOWN', options = {}) {
    if (!player || !player.alive) return;
    const nowSeconds = Math.max(0, Number(entityManager._simulationClockMs) || 0) * 0.001;
    const deathOptions = player.isBot === true && player.endlessRunId
        ? {
            ...options,
            runId: String(player.endlessRunId),
            botSlot: Number(player.endlessBotSlot),
            activationGeneration: Number(player.endlessActivationGeneration),
        }
        : { ...options };
    const environmentCredit = resolveEnvironmentCredit(entityManager, player, cause, deathOptions, nowSeconds);
    if (environmentCredit) deathOptions.killer = environmentCredit.killer;
    rememberFightDeath(player);
    entityManager._parcoursProgressSystem?.onPlayerDeath?.(player, { cause });
    entityManager.recorder?.captureSnapshotNow?.(entityManager);
    player.kill();
    entityManager.recorder?.captureSnapshotNow?.(entityManager);
    entityManager._projectileSystem?.clearRocketTrailsForOwner?.(player);
    if (entityManager.gameModeStrategy?.hasScoring() && entityManager.isFightOutcomeAuthority !== false) {
        const scoringResult = entityManager._huntScoring.registerElimination(player, {
            killer: deathOptions?.killer || null,
            // No nowSeconds here: the assist window compares against hits stamped on the
            // scoring clock, so registerElimination must keep reading that same clock.
            spawnAgeSeconds: nowSeconds - (Number(player.fightSpawnedAtSeconds) || 0),
        });
        emitHuntEliminationFeed(
            entityManager._eventBus,
            entityManager.players,
            player,
            deathOptions?.killer,
            scoringResult?.assistIndices,
            entityManager.audio,
            environmentCredit ? { credit: environmentCredit.credit, cause } : null
        );
    }
    entityManager._respawnSystem.onPlayerDied(player);
    const killcamStarted = entityManager._killcamSystem?.onPlayerDied?.(
        player,
        {
            killer: deathOptions?.killer || null,
            cause,
            impactPoint: deathOptions?.impactPoint || player.position,
            projectileType: deathOptions?.projectileType || null,
        }
    ) === true;
    const suppressLiveDeathEffects = killcamStarted
        && entityManager._killcamSystem?.shouldSuppressLiveDeathEffects?.() !== false;
    if (!suppressLiveDeathEffects) {
        entityManager.particles?.spawnExplosion?.(player.position, player.color, {
            cause,
            projectileType: deathOptions?.projectileType || null,
        });
    }
    const killer = deathOptions?.killer || null;
    if (!suppressLiveDeathEffects) {
        entityManager.audio?.play?.(
            'EXPLOSION',
            resolveWorldAudioOptions(entityManager, player.position)
        );
    }
    if (entityManager.recorder) {
        const killerIndex = Number.isInteger(killer?.index) ? killer.index : -1;
        const creditSuffix = environmentCredit ? ` credit=${environmentCredit.credit}` : '';
        entityManager.recorder.markPlayerDeath(player, cause);
        entityManager.recorder.logEvent(
            'KILL',
            player.index,
            `cause=${cause} killer=${killerIndex}${creditSuffix}`,
            player.position
        );
    }
    emitArcadeEliminationEvents(entityManager, player, cause, deathOptions);
    entityManager._eventBus.emitPlayerDied(player, cause);
    entityManager.endlessParcoursRuntime?.handlePlayerDeath?.(player, cause, deathOptions);
}
