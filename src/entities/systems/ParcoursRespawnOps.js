import {
    resetParcoursProgressState,
    rewindParcoursProgressState,
} from './ParcoursProgressStateOps.js';

const modeRulesByRoute = new WeakMap();

// A mode may supply respawn rules for routes that author none, so a death there cannot freeze
// the round. A map that authors its own respawn keeps it untouched. Callers read this at use
// time rather than when the route is built, because Arcade sets the sector type apart from the
// round start. The merged route is cached so per-frame reads allocate nothing.
export function resolveModeParcoursRoute(entityManager, route) {
    const overrides = entityManager?.gameModeStrategy?.getParcoursRespawnFallback?.() || null;
    if (!route || !overrides || typeof overrides !== 'object') return route;
    if (route.rules?.respawnOnDeath === true) return route;
    const cached = modeRulesByRoute.get(route);
    if (cached?.overrides === overrides) return cached.route;
    const merged = { ...route, rules: { ...route.rules, ...overrides } };
    modeRulesByRoute.set(route, { overrides, route: merged });
    return merged;
}

function resolveRespawnCheckpoint(route, state, restartAtFirstCheckpoint) {
    if (!route || !state) return null;
    if (restartAtFirstCheckpoint || state.nextCheckpointIndex <= 0) {
        return route.entriesByCheckpointIndex?.[0]?.[0] || route.checkpoints?.[0] || null;
    }

    const routeIndex = Math.max(0, Math.min(route.totalCheckpoints - 1, state.nextCheckpointIndex - 1));
    const checkpointId = state.stageCheckpointIds?.[routeIndex] || '';
    if (checkpointId) {
        const exactEntry = route.checkpoints.find((entry) => entry.id === checkpointId);
        if (exactEntry) return exactEntry;
    }
    return route.entriesByCheckpointIndex?.[routeIndex]?.[0] || null;
}

function createRespawnPlan(route, entry, player, options) {
    if (!entry || !Array.isArray(entry.pos)) return null;
    const forward = Array.isArray(entry.forward) ? entry.forward : [0, 0, -1];
    const clearance = Math.max(1, Number(entry.radius) || 0)
        + Math.max(0.05, Number(player?.hitboxRadius) || 0.8)
        + 1;
    return {
        kind: 'parcours',
        checkpointId: entry.id || '',
        restartAtFirstCheckpoint: options.restartAtFirstCheckpoint,
        checkpointRespawnsUsed: options.checkpointRespawnsUsed,
        delaySeconds: Math.max(0.1, Number(route.rules.respawnDelaySeconds) || 3),
        position: [
            entry.pos[0] - (forward[0] * clearance),
            entry.pos[1] - (forward[1] * clearance),
            entry.pos[2] - (forward[2] * clearance),
        ],
        forward: [...forward],
    };
}

export function applyParcoursDeathRespawn(route, state, player, options = {}) {
    const limit = Math.max(0, Math.trunc(Number(route?.rules?.lastCheckpointRespawns) || 0));
    const used = Math.max(0, Math.trunc(Number(state?.checkpointRespawnsUsed) || 0)) + 1;
    const restartAtFirstCheckpoint = used > limit;
    if (restartAtFirstCheckpoint && route?.rules?.endRunWhenRespawnsExhausted === true) {
        // No plan means no respawn; progress stays untouched so the run's result still counts.
        return {
            feedback: 'Respawns verbraucht: Run beendet',
            logDetails: `cause=${options.reason || 'death'} respawn=none used=${limit}/${limit}`,
            plan: null,
        };
    }
    const respawnEntry = resolveRespawnCheckpoint(route, state, restartAtFirstCheckpoint);

    if (restartAtFirstCheckpoint) {
        resetParcoursProgressState(state, {
            countReset: true,
            preserveCounters: true,
            errorMessage: 'Zurueck zu Checkpoint 1',
            now: options.now,
            setErrorState: options.setErrorState,
        });
        state.checkpointRespawnsUsed = 0;
    } else {
        rewindParcoursProgressState(state, route, {
            now: options.now,
            errorMessage: 'Rueckfall auf letzten Checkpoint',
            setErrorState: options.setErrorState,
        });
        state.checkpointRespawnsUsed = used;
    }

    return {
        feedback: restartAtFirstCheckpoint
            ? 'Respawns verbraucht: Neustart bei Checkpoint 1'
            : `Respawn am letzten Checkpoint (${used}/${limit})`,
        logDetails: `cause=${options.reason || 'death'} respawn=${restartAtFirstCheckpoint ? 'first' : 'last'} used=${state.checkpointRespawnsUsed}/${limit}`,
        plan: createRespawnPlan(route, respawnEntry, player, {
            restartAtFirstCheckpoint,
            checkpointRespawnsUsed: state.checkpointRespawnsUsed,
        }),
    };
}
