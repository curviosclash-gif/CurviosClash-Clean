import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_HTML_PATH = path.join(ROOT_DIR, 'index.html');
const DIST_APP_DIR = path.join(ROOT_DIR, 'dist-app');
const DIST_HTML_PATH = path.join(DIST_APP_DIR, 'index.html');

const CRITICAL_RENDERER_MARKERS = Object.freeze([
    'bot-policy-strategy',
    'bots.policyStrategy',
    'arcade-ghost-duel-mode-select',
    'startSetup.arcadeGhostDuelMode',
    'normal-camera-perspective-select',
    'cameraPerspective.normal',
    'recording-profile-select',
    'recording.profile',
    'shadow-quality-slider',
    'local.shadowQuality',
    'next-checkpoint-glow-slider',
    'gameplay.nextCheckpointGlowIntensity',
    'mg-trail-aim-slider',
    'gameplay.mgTrailAimRadius',
    'fight-player-hp-slider',
    'gameplay.fightPlayerHp',
    'multiplayer.transport',
]);

function readUtf8(filePath) {
    return readFileSync(filePath, 'utf8');
}

function extractIds(html) {
    return new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
}

function sortedDifference(left, right) {
    return [...left].filter((value) => !right.has(value)).sort();
}

function resolveDistAppBundlePath(distHtml) {
    const match = distHtml.match(/<script[^>]+type=["']module["'][^>]+src=["']([^"']*\/assets\/app-[^"']+\.js)["']/);
    assert.ok(match, 'dist-app/index.html must reference the bundled app asset. Run npm run build:app first.');
    return path.join(DIST_APP_DIR, match[1].replace(/^\//, ''));
}

test('Electron renderer dist-app keeps source HTML element IDs', () => {
    assert.ok(existsSync(DIST_HTML_PATH), 'dist-app/index.html is missing. Run npm run build:app first.');

    const sourceIds = extractIds(readUtf8(SOURCE_HTML_PATH));
    const distIds = extractIds(readUtf8(DIST_HTML_PATH));

    assert.deepEqual(
        sortedDifference(sourceIds, distIds),
        [],
        'dist-app/index.html is missing source UI element IDs.'
    );
    assert.deepEqual(
        sortedDifference(distIds, sourceIds),
        [],
        'dist-app/index.html contains element IDs that are no longer in source index.html.'
    );
});

test('Electron renderer dist-app contains critical UI and settings runtime markers', () => {
    assert.ok(existsSync(DIST_HTML_PATH), 'dist-app/index.html is missing. Run npm run build:app first.');
    assert.ok(existsSync(path.join(DIST_APP_DIR, 'assets')), 'dist-app/assets is missing. Run npm run build:app first.');

    const sourceHtml = readUtf8(SOURCE_HTML_PATH);
    const distHtml = readUtf8(DIST_HTML_PATH);
    const appBundlePath = resolveDistAppBundlePath(distHtml);
    assert.ok(existsSync(appBundlePath), `dist app bundle is missing: ${appBundlePath}`);
    const appBundle = readUtf8(appBundlePath);
    const assetFiles = readdirSync(path.join(DIST_APP_DIR, 'assets')).join('\n');

    for (const marker of CRITICAL_RENDERER_MARKERS) {
        const presentInSourceHtml = sourceHtml.includes(marker);
        const presentInDistHtml = distHtml.includes(marker);
        const presentInDistRuntime = appBundle.includes(marker) || assetFiles.includes(marker);
        assert.equal(
            presentInDistHtml || presentInDistRuntime,
            true,
            `dist-app is missing critical renderer marker "${marker}".`
        );
        if (presentInSourceHtml) {
            assert.equal(presentInDistHtml, true, `dist-app/index.html is missing source marker "${marker}".`);
        }
    }
});
