import { GROUND, NAVE_VAULT } from '../notre_dame/NotreDameStructure.js';

// Telegraphs are deliberately longer than the active bursts. The risky roof route crosses the
// first and third volumes; the low aisle route remains clear, making the branch choice meaningful.
export const NOTRE_DAME_FIRE_HAZARDS = Object.freeze([
    Object.freeze({
        id: 'attic_ember_burst',
        position: Object.freeze([-28, NAVE_VAULT + 12, 3]),
        radius: 6.5,
        cycleSeconds: 14,
        telegraphSeconds: 3.2,
        activeSeconds: 0.8,
        phaseOffsetSeconds: 0,
        damage: 28,
    }),
    Object.freeze({
        id: 'crossing_collapse_dust',
        position: Object.freeze([17, GROUND + 44, -7]),
        radius: 7.5,
        cycleSeconds: 17,
        telegraphSeconds: 3.5,
        activeSeconds: 0.9,
        phaseOffsetSeconds: 5,
        damage: 24,
    }),
    Object.freeze({
        id: 'choir_breach_burst',
        position: Object.freeze([50, GROUND + 44, -3]),
        radius: 6.5,
        cycleSeconds: 13,
        telegraphSeconds: 3,
        activeSeconds: 0.75,
        phaseOffsetSeconds: 8,
        damage: 28,
    }),
    Object.freeze({
        id: 'south_transept_fall',
        position: Object.freeze([17, GROUND + 30, -43]),
        radius: 7,
        cycleSeconds: 19,
        telegraphSeconds: 3.8,
        activeSeconds: 0.85,
        phaseOffsetSeconds: 2,
        damage: 24,
    }),
]);
