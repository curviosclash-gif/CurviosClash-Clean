import { createRuntimeRng } from './RuntimeRngContract.js';
import { isHuntParcoursConfig } from './HuntParcoursContract.js';

export const FOX_HUNT_DURATION_MS = 300000;
export const FOX_HUNT_RESPAWN_RULES = Object.freeze({
    respawnOnDeath: true, respawnDelaySeconds: 3, lastCheckpointRespawns: Number.MAX_SAFE_INTEGER,
    preserveProgressOnDeath: true, endRunWhenRespawnsExhausted: false, resetAttemptOnExhaustion: false,
});

export function isFoxHuntConfig(config) {
    return isHuntParcoursConfig(config) && config.arcade.huntParcoursVariantId === 'fox_hunt';
}

/** Stable input ordering and one seeded shuffle treat human and bot slots equally. */
export function createFoxHuntStartOrder(indices, seed) {
    const order = [...new Set(indices)].sort((a, b) => a - b);
    const rng = createRuntimeRng({ seed });
    for (let index = order.length - 1; index > 0; index--) {
        const target = rng.int(index + 1);
        [order[index], order[target]] = [order[target], order[index]];
    }
    return order;
}

/** Points, scored fox rings, fox kills; exact ties share first place. */
export function resolveFoxHuntLeaders(rows) {
    let best = null;
    const leaders = [];
    for (const [index, row] of rows) {
        const tuple = [row.points, row.rings, row.kills];
        const difference = best ? tuple[0] - best[0] || tuple[1] - best[1] || tuple[2] - best[2] : 1;
        if (difference > 0) { best = tuple; leaders.length = 0; }
        if (difference >= 0) leaders.push(index);
    }
    return leaders;
}

/** Run-only route rules never change ordinary free play on these maps. */
export function resolveFoxHuntMap(map, mapKey, config) {
    if (!isFoxHuntConfig(config) || !['neon_carnival', 'kinetic_tide', 'orbital_shipyard'].includes(mapKey)) return map;
    return { ...map, parcours: { ...map.parcours, gameModes: ['CLASSIC', 'ARCADE', 'HUNT'],
        rules: { ...map.parcours?.rules, ...FOX_HUNT_RESPAWN_RULES } } };
}
