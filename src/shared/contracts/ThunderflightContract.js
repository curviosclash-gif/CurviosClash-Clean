import { isHuntParcoursConfig } from './HuntParcoursContract.js';

export const THUNDERFLIGHT_STRIKE_INTERVAL_SECONDS = 12;

/** Height is measured against the real scaled arena, not the authored map units. */
export function resolveThunderflightMultiplier(y, bounds) {
    const low = Number(bounds?.minY), high = Number(bounds?.maxY), height = Number(y);
    if (![low, high, height].every(Number.isFinite) || high <= low) return 1;
    const fraction = (height - low) / (high - low);
    return fraction >= 2 / 3 ? 4 : fraction >= 1 / 3 ? 2 : 1;
}

const SPIRAL_POINTS = [[0, 8, 30], [30, 16, 25], [30, 25, 0], [25, 34, -30],
    [0, 43, -30], [-30, 51, -25], [-30, 60, 0], [-25, 65, 25], [0, 65, 30]];
const spiralRoute = {
    enabled: true, routeId: 'thunderflight_spiral_tower_v1',
    rules: { ordered: true, winnerByParcoursComplete: true, animateCheckpoints: true, cooldownMs: 450 },
    checkpoints: SPIRAL_POINTS.slice(0, -1).map((pos, index) => ({
        id: `CP${String(index + 1).padStart(2, '0')}`, type: index === 0 ? 'entry' : 'gate', pos,
        radius: 4.5, forward: pos.map((value, axis) => SPIRAL_POINTS[index + 1][axis] - value),
    })),
    finish: { id: 'FINISH', type: 'finish', pos: SPIRAL_POINTS.at(-1), radius: 4.5, forward: [1, 0, 0] },
};

/** A dedicated run may add its course without changing free combat on the same map. */
export function resolveThunderflightMap(map, mapKey, config) {
    if (!isHuntParcoursConfig(config) || config.arcade.huntParcoursVariantId !== 'thunderflight') return map;
    if (!['sky_islands', 'spiral_tower', 'abyssal_descent'].includes(mapKey)) return map;
    const parcours = mapKey === 'spiral_tower' ? spiralRoute : map.parcours;
    return { ...map, parcours: { ...parcours, gameModes: ['CLASSIC', 'ARCADE', 'HUNT'] } };
}
