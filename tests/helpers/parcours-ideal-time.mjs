import { CONFIG } from '../../src/core/Config.js';
import { buildRouteFromParcours } from '../../src/entities/systems/ParcoursProgressUtils.js';

// Ideal time of a pure parcours map in seconds: the longest way through the route (branches are
// followed over nextCheckpointIds and the longer option counts) from the player spawn over every
// ring to the finish, flown at the base speed. Everything is in world units, i.e. authored
// anchors times MAP_SCALE exactly like Arena._cacheAuthoredMapAnchors scales the spawn.
const MAP_SCALE = CONFIG.ARENA.MAP_SCALE;
const BASE_SPEED = CONFIG.PLAYER.SPEED;

// Time goal = ideal time x factor of the difficulty step (Lehre 1-2, Handwerk 3, 4, 5).
export const TIME_GOAL_FACTOR_BY_DIFFICULTY = Object.freeze({ 1: 3.0, 2: 3.0, 3: 2.4, 4: 2.0, 5: 1.8 });

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

export function longestRouteLength(map) {
    const route = buildRouteFromParcours(map.parcours, { positionScale: MAP_SCALE });
    const anchorScale = map.scaleAuthoredAnchors === true ? MAP_SCALE : 1;
    const spawn = map.playerSpawn
        ? [map.playerSpawn.x * anchorScale, map.playerSpawn.y * anchorScale, map.playerSpawn.z * anchorScale]
        : route.checkpoints[0].pos;
    const byId = new Map(route.checkpoints.filter((cp) => !cp.aliasOf).map((cp) => [cp.id, cp]));
    const memo = new Map();
    // Longest remaining way from a ring (the route is a DAG: successors have a higher stage).
    const remaining = (cp) => {
        if (memo.has(cp.id)) return memo.get(cp.id);
        const next = cp.nextCheckpointIds.map((id) => byId.get(id)).filter(Boolean);
        const best = next.length > 0
            ? Math.max(...next.map((n) => dist(cp.pos, n.pos) + remaining(n)))
            : (route.finish ? dist(cp.pos, route.finish.pos) : 0);
        memo.set(cp.id, best);
        return best;
    };
    const firsts = [...byId.values()].filter((cp) => cp.routeIndex === 0);
    return Math.max(...firsts.map((cp) => dist(spawn, cp.pos) + remaining(cp)));
}

export function idealTimeSeconds(map) {
    return longestRouteLength(map) / BASE_SPEED;
}

export function parcoursTimeGoals(map) {
    return (map.missions || []).filter((m) => m.type === 'TIME_TRIAL').map((m) => Number(m.params?.target));
}
