// Rules and bot spawns shared by every map of the v1.3.0 parcours pack.
const BASE_PARCOURS_RULES = Object.freeze({
    ordered: true,
    resetOnDeath: true,
    resetToLastValid: false,
    maxSegmentTimeMs: 14000,
    cooldownMs: 430,
    wrongOrderCooldownMs: 650,
    wrongOrderPenaltyMs: 2000,
    errorIndicatorMs: 1400,
    allowLaneAliases: true,
    winnerByParcoursComplete: true,
    animateCheckpoints: true,
    showGhost: true,
});

export function parcoursRules(overrides = {}) {
    return { ...BASE_PARCOURS_RULES, ...overrides };
}

export const V130_BOT_SPAWNS = Object.freeze({
    micro_maw: Object.freeze([
        { x: -54, y: 12, z: -56 },
        { x: -54, y: 12, z: -44 },
        { x: -46, y: 12, z: -50 },
    ]),
    mirror_docks: Object.freeze([
        { x: -92, y: 16, z: -10 },
        { x: -92, y: 16, z: 10 },
        { x: -80, y: 16, z: 0 },
    ]),
    glass_serpent: Object.freeze([
        { x: -128, y: 20, z: -44 },
        { x: -126, y: 20, z: -28 },
        { x: -112, y: 20, z: -36 },
    ]),
    storm_switchyard: Object.freeze([
        { x: -116, y: 14, z: -10 },
        { x: -116, y: 14, z: 10 },
        { x: -100, y: 14, z: 0 },
    ]),
    wind_cathedral: Object.freeze([
        { x: -76, y: 16, z: -10 },
        { x: -76, y: 16, z: 10 },
        { x: -62, y: 16, z: 0 },
    ]),
    chrono_spillway: Object.freeze([
        { x: -138, y: 72, z: -38 },
        { x: -138, y: 72, z: -18 },
        { x: -124, y: 72, z: -28 },
    ]),
});
