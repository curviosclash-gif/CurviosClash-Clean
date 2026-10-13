import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    GAME_EXPORT_FORBIDDEN_PATH_PATTERNS,
    GAME_EXPORT_TEMPLATE_MAPPINGS,
    isGameExportSourcePath,
} from '../scripts/game-export-contract.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/**
 * `npm run game:export` first selects files by the allowlist and only at the very end
 * rejects the copied tree against the forbidden patterns. When both rules disagree the
 * export aborts after copying about a gigabyte of assets, and nothing else runs it. This
 * guard applies the same two rules to the tracked files without copying anything.
 */
function isForbidden(relativePath) {
    return GAME_EXPORT_FORBIDDEN_PATH_PATTERNS.some((pattern) => pattern.test(relativePath));
}

function listTrackedFiles() {
    return execFileSync('git', ['ls-files', '-z'], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024 * 64,
    }).split('\0').filter(Boolean);
}

test('no file the game export allowlist selects trips its forbidden path patterns', () => {
    const selected = listTrackedFiles().filter(isGameExportSourcePath);
    assert.ok(selected.length > 1000, 'game export allowlist selected suspiciously few files');
    const forbidden = selected.filter(isForbidden);
    assert.deepEqual(forbidden, [], `allowlisted but forbidden in the game export:\n${forbidden.join('\n')}`);
});

const IMPORT_SPECIFIER_PATTERN = /(?:\bfrom|\bimport|\brequire)\s*\(?\s*['"](\.{1,2}\/[^'"\n]+)['"]/g;

/**
 * Imports the export rewrites to product adapters, either in `transformGameFile`
 * (scripts/export-game-repo.mjs) or as an alias in the exported Vite config.
 */
const EXPORT_TRANSFORM = 'scripts/export-game-repo.mjs';
const EXPORT_VITE_CONFIG = 'game-export/vite.config.js';
const REWRITTEN_EXPORT_EDGES = Object.freeze([
    ['src/core/main.js', 'src/core/PlaytestLaunchParams.js', EXPORT_TRANSFORM],
    ['src/core/main.js', 'src/core/PlaytestReturnControl.js', EXPORT_TRANSFORM],
    ['src/core/main.js', 'src/dev/tuning/TuningRuntimeIpcBridge.js', EXPORT_TRANSFORM],
    ['src/core/main.js', 'src/mobile-classic/MobileClassicApp.js', EXPORT_VITE_CONFIG],
    ['src/ui/UIManager.js', 'src/ui/menu/MenuDeveloperStateSync.js', EXPORT_TRANSFORM],
    ['src/core/SettingsManager.js', 'src/state/AuthoringTelemetryStore.js', EXPORT_TRANSFORM],
    ['src/shared/storage/StorageKeys.js', 'src/shared/contracts/AuthoringTelemetryContract.js', EXPORT_TRANSFORM],
    ['src/entities/runtime-modular-vehicle-mesh.js', 'src/shared/vehicle-lab/ModularVehicleMeshBridge.js', EXPORT_TRANSFORM],
]);

test('exported src files import only files the game export ships', () => {
    for (const [importer, target, rewrittenIn] of REWRITTEN_EXPORT_EDGES) {
        assert.ok(
            readFileSync(path.join(repoRoot, rewrittenIn), 'utf8').includes(path.posix.basename(target)),
            `${rewrittenIn} no longer rewrites ${importer} -> ${target}, so the skipped edge is stale`
        );
    }
    const tracked = new Set(listTrackedFiles());
    const selected = [...tracked].filter((file) => isGameExportSourcePath(file) && /^src\/.*\.(?:c|m)?js$/.test(file));
    const missing = [];
    for (const importer of selected) {
        const source = readFileSync(path.join(repoRoot, importer), 'utf8');
        for (const [, specifier] of source.matchAll(IMPORT_SPECIFIER_PATTERN)) {
            const target = path.posix.normalize(path.posix.join(path.posix.dirname(importer), specifier));
            if (!tracked.has(target) || isGameExportSourcePath(target)) continue;
            if (REWRITTEN_EXPORT_EDGES.some(([from, to]) => from === importer && to === target)) continue;
            missing.push(`${importer} -> ${target}`);
        }
    }
    assert.deepEqual(missing, [], `exported files import what the game export drops:\n${missing.join('\n')}`);
});

test('files the export writes itself pass its forbidden path patterns', () => {
    const generated = ['src/entities/ModularVehicleMesh.js', ...Object.values(GAME_EXPORT_TEMPLATE_MAPPINGS)];
    assert.deepEqual(generated.filter(isForbidden), []);
});

test('the forbidden patterns still reject authoring tools', () => {
    for (const authoringPath of [
        'prototypes/vehicle-lab/main.js',
        'src/shared/vehicle-lab/ModularVehicleMeshBridge.js',
        'vehicle-lab/index.html',
        'electron/tuning-console/tuning-app.js',
        'editor/js/main.js',
        'src/dev/tuning/TuningRuntimeIpcBridge.js',
        'dev/training/run.mjs',
    ]) {
        assert.equal(isForbidden(authoringPath), true, `${authoringPath} must stay out of the game export`);
    }
});
