import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDITOR_VIEW_PATHS } from '../src/shared/contracts/EditorPathContract.js';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_HTML_PATH = path.join(ROOT_DIR, 'index.html');
const DIST_APP_DIR = path.join(ROOT_DIR, 'dist-app');
const DIST_HTML_PATH = path.join(DIST_APP_DIR, 'index.html');
const ELECTRON_PACKAGE_PATH = path.join(ROOT_DIR, 'electron', 'package.json');
const RUNTIME_RESOURCES_PACKAGE_PATH = path.join(ROOT_DIR, 'electron', 'runtime-resources', 'package.json');
const require = createRequire(import.meta.url);
const { startStaticServer } = require('../electron/static-server.cjs');

const CRITICAL_RENDERER_MARKERS = Object.freeze([
    'bot-policy-strategy',
    'bots.policyStrategy',
    'arcade-ghost-duel-mode-select',
    'startSetup.arcadeGhostDuelMode',
    'normal-camera-perspective-select',
    'cameraPerspective.normal',
    'recording-profile-select',
    'recording.profile',
    'recording-orientation-select',
    'recording.orientation',
    'shadow-quality-slider',
    'local.shadowQuality',
    'bloom-quality-slider',
    'local.bloomQuality',
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

function readJson(filePath) {
    return JSON.parse(readUtf8(filePath));
}

function extractIds(html) {
    return new Set([...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]));
}

function sortedDifference(left, right) {
    return [...left].filter((value) => !right.has(value)).sort();
}

function inlineScriptHashes(html) {
    const normalizedHtml = html.replace(/\r\n?/g, '\n');
    return [...normalizedHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
        .filter((match) => !/(?:^|\s)src(?:\s|=|$)/i.test(match[1]))
        .map((match) => `'sha256-${createHash('sha256').update(match[2], 'utf8').digest('base64')}'`)
        .sort();
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

test('Electron CSP hashes exactly the inline scripts served by each built desktop HTML page', async () => {
    assert.ok(existsSync(DIST_HTML_PATH), 'dist-app/index.html is missing. Run npm run build:app first.');
    const pages = [
        '/',
        '/hangar.html',
        EDITOR_VIEW_PATHS.MAP_EDITOR,
        EDITOR_VIEW_PATHS.VEHICLE_LAB,
    ];
    let server = null;
    try {
        server = await startStaticServer({ rootDir: DIST_APP_DIR, port: 0 });
        for (const page of pages) {
            const response = await fetch(new URL(page, server.url));
            assert.equal(response.status, 200, `${page} must be served from dist-app.`);
            const html = await response.text();
            const csp = response.headers.get('content-security-policy') || '';
            const scriptSrc = csp.split(';').map((part) => part.trim()).find((part) => part.startsWith('script-src')) || '';
            const actualHashes = scriptSrc.split(/\s+/).filter((token) => token.startsWith("'sha256-")).sort();

            assert.doesNotMatch(scriptSrc, /'unsafe-inline'/, `${page}: ${scriptSrc}`);
            assert.deepEqual(actualHashes, inlineScriptHashes(html), `${page} script-src hashes must match the served HTML exactly.`);
            assert.match(csp, /style-src 'self' 'unsafe-inline'/, `${page}: ${csp}`);
            assert.match(csp, /connect-src[^;]*http:\/\/\*:\*/, `${page}: ${csp}`);
        }
    } finally {
        await server?.close?.();
    }
});

test('Electron package copies runtime trees that live outside the Electron app directory', () => {
    const electronPackage = readJson(ELECTRON_PACKAGE_PATH);
    const runtimeResourcesPackage = readJson(RUNTIME_RESOURCES_PACKAGE_PATH);
    const files = electronPackage.build?.files || [];
    const resourcesByTarget = new Map(
        (electronPackage.build?.extraResources || []).map((entry) => [entry.to, entry.from])
    );

    assert.deepEqual(files.filter((entry) => entry.startsWith('../')), []);
    assert.equal(resourcesByTarget.get('dist-app'), '../dist-app');
    assert.equal(resourcesByTarget.get('server'), '../server');
    assert.equal(resourcesByTarget.get('src'), '../src');
    assert.equal(resourcesByTarget.get('package.json'), 'runtime-resources/package.json');
    assert.equal(runtimeResourcesPackage.type, 'module');
});
