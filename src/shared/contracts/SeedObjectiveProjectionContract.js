// HUD projection of a shootable plant whose released parts open a secret room.

const SEED_OBJECTIVE_SOURCES = Object.freeze(['dandelionSeeds', 'sunflowerKernels']);

/**
 * @param {unknown} value
 * @param {number} [fallback]
 * @returns {number}
 */
function number(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function count(value) {
    return Math.max(0, Math.trunc(number(value, 0)));
}

/**
 * Additive v1 fields: `source` names the plant (a producer that predates it means the dandelion),
 * `portalOpen` and `portalPosition` let the HUD point at the room once it has opened.
 * @param {any} [value]
 */
export function createSeedObjectiveProjection(value = null) {
    const source = value && typeof value === 'object' ? value : {};
    const total = count(source.total);
    const released = Math.min(total, count(source.released));
    const active = total > 0;
    const allReleased = active && released === total && source.allReleased === true;
    const portalOpen = active && source.portalOpen === true;
    const position = source.portalPosition && typeof source.portalPosition === 'object'
        ? source.portalPosition : null;
    return {
        active,
        source: SEED_OBJECTIVE_SOURCES.includes(source.source) ? source.source : 'dandelionSeeds',
        total,
        released,
        remaining: active ? total - released : 0,
        allReleased,
        completedAtSeconds: allReleased ? Math.max(0, number(source.completedAtSeconds, 0)) : 0,
        portalOpen,
        portalPosition: portalOpen && position
            ? { x: number(position.x, 0), y: number(position.y, 0), z: number(position.z, 0) }
            : null,
    };
}
