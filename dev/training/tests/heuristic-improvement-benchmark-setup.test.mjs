import assert from 'node:assert/strict';
import test from 'node:test';

import { CONFIG_BASE } from '../../../src/core/Config.js';
import {
    HEURISTIC_BENCHMARK_DIFFICULTIES,
    HEURISTIC_BENCHMARK_MAPS,
    resolveHeuristicBenchmarkSetup,
} from '../scripts/heuristic-improvement-baseline.mjs';

test('benchmark covers every menu difficulty', () => {
    assert.deepEqual([...HEURISTIC_BENCHMARK_DIFFICULTIES], ['EASY', 'NORMAL', 'HARD']);
});

test('benchmark maps exist and need no GLB world, so they build headless', () => {
    assert.ok(HEURISTIC_BENCHMARK_MAPS.length >= 3);
    for (const mapKey of HEURISTIC_BENCHMARK_MAPS) {
        const preset = CONFIG_BASE.MAPS[mapKey];
        assert.ok(preset, `${mapKey} is not a map preset`);
        assert.ok((preset.obstacles || []).length > 0, `${mapKey} has no obstacles to fly around`);
    }
});

test('twelve consecutive seeds play every difficulty on every map exactly once', () => {
    const seen = new Set();
    for (let index = 0; index < 12; index += 1) {
        const { difficulty, mapKey } = resolveHeuristicBenchmarkSetup(index);
        seen.add(`${difficulty}@${mapKey}`);
    }
    assert.equal(seen.size, HEURISTIC_BENCHMARK_DIFFICULTIES.length * HEURISTIC_BENCHMARK_MAPS.length);
});

test('every benchmark map builds as the product arena, never the silent fallback', async () => {
    const { createRuntimeConfigSnapshot } = await import('../../../src/core/RuntimeConfig.js');
    const { createHeadlessMatchKernelRuntime } = await import('../src/state/HeadlessMatchKernelRuntime.js');
    const { HEURISTIC_BENCHMARK_BASE_CONFIG, verifyHeuristicBenchmarkArena } = await import('../scripts/heuristic-improvement-baseline.mjs');
    const build = async (mapKey, baseConfig) => {
        const settings = {
            localSettings: { modePath: 'fight', sessionType: 'single' }, mode: '1p', mapKey, gameMode: 'HUNT',
            numBots: 2, botPolicyStrategy: 'heuristic', hunt: { respawnEnabled: true }, portalsEnabled: false,
        };
        const runtimeConfig = createRuntimeConfigSnapshot(settings, baseConfig ? { baseConfig } : undefined);
        return createHeadlessMatchKernelRuntime({
            settings, runtimeConfig, baseConfig, requestedMapKey: runtimeConfig.session.mapKey,
            profile: { sessionId: `benchmark-arena-${mapKey}`, fixedStepSeconds: 1 / 60, deterministic: true },
        });
    };
    for (const mapKey of HEURISTIC_BENCHMARK_MAPS) {
        const runtime = await build(mapKey, HEURISTIC_BENCHMARK_BASE_CONFIG);
        try {
            verifyHeuristicBenchmarkArena(runtime.session.entityManager.arena, mapKey);
        } finally {
            runtime.dispose?.();
        }
    }
    const fallback = await build('pillar_hall', null);
    try {
        assert.throws(() => verifyHeuristicBenchmarkArena(fallback.session.entityManager.arena, 'pillar_hall'), /arena/);
    } finally {
        fallback.dispose?.();
    }
});
