import { isParcoursActiveForGameMode } from '../../shared/contracts/MapModeContract.js';
import { resolveEntityRuntimeConfig } from '../../shared/contracts/EntityRuntimeConfig.js';
import { buildRouteFromParcours } from './ParcoursProgressUtils.js';

/**
 * The route is authored on the map, but only the modes built around it run it: the tutorial
 * in Classic, the time trials in Arcade, and Hunt only where a map declares its course as a
 * combat route. Without this gate an adventure map carries lit checkpoints into a deathmatch.
 */
export function resolveActiveParcoursRoute(entityManager) {
    const mapDefinition = entityManager?.arena?.currentMapDefinition || null;
    if (!isParcoursActiveForGameMode(mapDefinition, entityManager?.activeGameMode)) return null;

    const mapScale = Number(resolveEntityRuntimeConfig(entityManager)?.ARENA?.MAP_SCALE);
    return buildRouteFromParcours(mapDefinition.parcours, {
        positionScale: Number.isFinite(mapScale) && mapScale > 0 ? mapScale : 1,
    });
}

export function resolveProgressPlayerIndex(
    entityManager,
    route,
    progressPlayerIndexResolver,
    players = null
) {
    const playerList = Array.isArray(players) ? players : (entityManager?.players || []);
    if (typeof progressPlayerIndexResolver === 'function') {
        try {
            const resolved = progressPlayerIndexResolver({
                players: playerList,
                entityManager,
                routeId: route?.routeId || '',
            });
            if (Number.isInteger(resolved) && resolved >= 0) return resolved;
        } catch {
            // no-op
        }
    }

    const viewportLocalPlayerIndex = Number(entityManager?.renderer?.viewportSystem?.localPlayerIndex);
    if (Number.isInteger(viewportLocalPlayerIndex) && viewportLocalPlayerIndex >= 0) {
        return viewportLocalPlayerIndex;
    }

    for (const player of playerList) {
        if (player && Number.isInteger(player.index) && player.isBot !== true) {
            return player.index;
        }
    }
    return 0;
}

export function playerOwnsGhostRecording(ghostRecorder, player) {
    if (!ghostRecorder?.isRecording || !player || !Number.isInteger(player.index)) return false;
    return typeof ghostRecorder.isOwnedBy === 'function'
        ? ghostRecorder.isOwnedBy(player.index)
        : player?.isBot !== true;
}

export function clearGhostRecording(ghostRecorder, reason = 'reset') {
    if (!ghostRecorder) return;
    if (typeof ghostRecorder.cancelRecording === 'function' && ghostRecorder.isRecording === true) {
        ghostRecorder.cancelRecording(reason);
        return;
    }
    ghostRecorder.reset?.();
}

export function cancelGhostRecordingForPlayer(ghostRecorder, player, reason = 'cancelled') {
    if (!ghostRecorder || player?.isBot === true || !Number.isInteger(player?.index)) return false;
    if (!playerOwnsGhostRecording(ghostRecorder, player)) return false;
    if (typeof ghostRecorder.cancelRecording === 'function') {
        return ghostRecorder.cancelRecording(reason, player.index) === true;
    }
    ghostRecorder.reset?.();
    return true;
}

export function buildRouteSnapshot(route) {
    if (!route) return null;
    return {
        enabled: true,
        routeId: route.routeId,
        totalCheckpoints: route.totalCheckpoints,
        sequence: [...route.sequence],
        checkpoints: route.checkpoints.map((entry) => ({
            id: entry.id,
            type: entry.type,
            aliasOf: entry.aliasOf,
            routeIndex: entry.routeIndex,
            nextCheckpointIds: [...(entry.nextCheckpointIds || [])],
            isBranchOption: entry.isBranchOption === true,
            branchParentId: entry.branchParentId || null,
            mergeCheckpointId: entry.mergeCheckpointId || null,
            pos: [...entry.pos],
            radius: entry.radius,
            forward: entry.forward ? [...entry.forward] : null,
        })),
        branches: Array.isArray(route.branches)
            ? route.branches.map((entry) => ({
                checkpointId: entry.checkpointId,
                routeIndex: entry.routeIndex,
                nextCheckpointIds: [...(entry.nextCheckpointIds || [])],
                mergeCheckpointId: entry.mergeCheckpointId || null,
                validMerge: entry.validMerge === true,
            }))
            : [],
        finish: route.finish ? {
            id: route.finish.id,
            type: route.finish.type,
            pos: [...route.finish.pos],
            radius: route.finish.radius,
            forward: route.finish.forward ? [...route.finish.forward] : null,
        } : null,
        rules: { ...route.rules },
    };
}
