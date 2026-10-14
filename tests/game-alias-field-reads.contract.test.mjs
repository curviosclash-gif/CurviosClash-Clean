import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// game.arena and game.renderer are backward-compatibility fields the runtime coordinator still
// sets on Game; new code reaches the arena and the renderer through ports and runtime handles.
// This ratchet holds the remaining reads per file: a new read fails, and so does a file that
// dropped reads without lowering its budget here, so the list can only shrink.
// game.entityManager is left for the later split of game logic and rendering.

const SRC_ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const ALIAS_READ = /\bgame\??\.(arena|renderer)\b/g;

const READ_BUDGET = Object.freeze({
    'core/GameBootstrap.js|arena': 1,
    'core/InteractiveMatchRuntimeGuard.js|arena': 2,
    'core/PlayingStateSystem.js|arena': 1,
    'core/PlayingStateSystem.js|renderer': 1,
    'core/recording/CinematicReplayRenderRuntime.js|arena': 1,
    'core/recording/MarketingReplayRender.js|renderer': 1,
    'core/recording/MarketingSession.js|renderer': 1,
    'core/runtime/RuntimeSettingsChangeOrchestrator.js|renderer': 7,
    'core/RuntimeDiagnosticsSystem.js|renderer': 1,
    'ui/CrosshairSystem.js|renderer': 2,
    'ui/MatchFlowTelemetryController.js|arena': 2,
    'ui/MatchFlowTelemetryController.js|renderer': 5,
    'ui/MatchFlowTransitionHotspots.js|arena': 3,
    'ui/MatchFlowUiController.js|renderer': 4,
});

function listSourceFiles(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return listSourceFiles(full);
        return entry.isFile() && entry.name.endsWith('.js') ? [full] : [];
    });
}

function countAliasReads(sources) {
    const counts = {};
    for (const [file, source] of sources) {
        for (const match of source.matchAll(ALIAS_READ)) {
            const key = `${file}|${match[1]}`;
            counts[key] = (counts[key] || 0) + 1;
        }
    }
    return counts;
}

function compareWithBudget(counts, budget) {
    const problems = [];
    for (const key of new Set([...Object.keys(counts), ...Object.keys(budget)])) {
        const actual = counts[key] || 0;
        const allowed = budget[key] || 0;
        if (actual > allowed) problems.push(`${key}: ${actual} reads, budget ${allowed} - use a port or runtime handle`);
        if (actual < allowed) problems.push(`${key}: ${actual} reads, budget ${allowed} - lower the budget`);
    }
    return problems.sort();
}

test('game.arena and game.renderer reads in src stay within their shrinking budget', () => {
    const sources = listSourceFiles(SRC_ROOT).map((file) => [
        path.relative(SRC_ROOT, file).replaceAll('\\', '/'),
        readFileSync(file, 'utf8'),
    ]);
    assert.deepEqual(compareWithBudget(countAliasReads(sources), READ_BUDGET), []);
});

test('a new read and a stale budget are both reported', () => {
    const counts = countAliasReads([
        ['ui/NewPanel.js', 'const camera = this.game?.renderer?.cameras?.[0];'],
        ['ui/CrosshairSystem.js', 'const camera = game?.renderer?.cameras?.[index];'],
    ]);
    assert.deepEqual(compareWithBudget(counts, { 'ui/CrosshairSystem.js|renderer': 2 }), [
        'ui/CrosshairSystem.js|renderer: 1 reads, budget 2 - lower the budget',
        'ui/NewPanel.js|renderer: 1 reads, budget 0 - use a port or runtime handle',
    ]);
});
