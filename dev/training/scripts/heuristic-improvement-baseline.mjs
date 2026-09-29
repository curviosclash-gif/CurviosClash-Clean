import { HEADLESS_PRODUCT_BASE_CONFIG, verifyHeadlessProductArena } from '../src/state/HeadlessProductMapConfig.js';

// Fixed pre-optimization profiles: benchmark opponents must not move when product defaults change.
const NEUTRAL_TACTICS = Object.freeze({
    escapeLateralBias: 0.5,
    attackCutoffBias: 0.5,
    finisherBias: 0.5,
    openingFanoutBias: 0.5,
    opportunistBias: 0.5,
    openingHookBias: 0.5,
    trafficAvoidanceBias: 0.5,
    predictiveSafetyBias: 0.5,
});

export const HEURISTIC_IMPROVEMENT_BASELINE = Object.freeze({
    defensive: Object.freeze({
        retreatVitality: 0.54, retreatPressure: 0.56, boostBias: 0.72,
        defensiveItemThresholdScale: 0.78, offensiveItemThresholdScale: 1.18,
        attackWindow: 0.58, safetyDistance: 0.44, preferredRange: 0.46,
        strafeDistance: 0.60, ...NEUTRAL_TACTICS,
    }),
    balanced: Object.freeze({
        retreatVitality: 0.38, retreatPressure: 0.74, boostBias: 1,
        defensiveItemThresholdScale: 1, offensiveItemThresholdScale: 1,
        attackWindow: 0.72, safetyDistance: 0.30, preferredRange: 0.34,
        strafeDistance: 0.50, ...NEUTRAL_TACTICS,
    }),
    aggressive: Object.freeze({
        retreatVitality: 0.20, retreatPressure: 0.90, boostBias: 1.32,
        defensiveItemThresholdScale: 1.14, offensiveItemThresholdScale: 0.82,
        attackWindow: 0.86, safetyDistance: 0.18, preferredRange: 0.20,
        strafeDistance: 0.38, ...NEUTRAL_TACTICS,
    }),
});

// Players pick the difficulty in the menu and fight on many maps. Each seed plays one
// difficulty on one map; 3 x 4 is 12, so any twelve consecutive seeds cover every pair.
// The maps have preset obstacles and no GLB world, so they build without a renderer.
export const HEURISTIC_BENCHMARK_DIFFICULTIES = Object.freeze(['EASY', 'NORMAL', 'HARD']);
export const HEURISTIC_BENCHMARK_MAPS = Object.freeze(['standard', 'pillar_hall', 'mega_maze', 'crossfire']);

export function resolveHeuristicBenchmarkSetup(seedIndex) {
    const index = Math.max(0, Math.trunc(Number(seedIndex) || 0));
    return {
        difficulty: HEURISTIC_BENCHMARK_DIFFICULTIES[index % HEURISTIC_BENCHMARK_DIFFICULTIES.length],
        mapKey: HEURISTIC_BENCHMARK_MAPS[index % HEURISTIC_BENCHMARK_MAPS.length],
    };
}

// Product map presets without their GLB worlds, shared with every headless training run.
export const HEURISTIC_BENCHMARK_BASE_CONFIG = HEADLESS_PRODUCT_BASE_CONFIG;

export function verifyHeuristicBenchmarkArena(arena, mapKey) {
    verifyHeadlessProductArena(arena, mapKey, HEURISTIC_BENCHMARK_BASE_CONFIG);
}
