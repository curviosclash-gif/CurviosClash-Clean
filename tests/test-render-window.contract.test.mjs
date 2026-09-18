import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { resolveTestRenderMode as resolveHarnessRenderMode } from './desktop-process-teardown.mjs';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(import.meta.dirname, '..');
const {
    OFFSCREEN_WINDOW_POSITION,
    TEST_RENDER_MODE_INACTIVE,
    TEST_RENDER_MODE_OFF,
    createMainWindowOptions,
    createTestRenderWindowOptions,
    listTestRenderCommandLineSwitches,
    resolveTestRenderMode,
    shouldShowInactive,
} = require(path.join(repoRoot, 'electron', 'test-render-window.cjs'));

test('electron keeps its product behaviour without the test render switch', () => {
    assert.equal(resolveTestRenderMode({}), TEST_RENDER_MODE_OFF);
    assert.equal(resolveTestRenderMode({ CURVIOS_ELECTRON_TEST_RENDER: '' }), TEST_RENDER_MODE_OFF);
    assert.equal(resolveTestRenderMode({ CURVIOS_ELECTRON_TEST_RENDER: 'off' }), TEST_RENDER_MODE_OFF);
    assert.deepEqual(createTestRenderWindowOptions(TEST_RENDER_MODE_OFF), {});
    assert.deepEqual(listTestRenderCommandLineSwitches(TEST_RENDER_MODE_OFF), []);
    assert.equal(shouldShowInactive(TEST_RENDER_MODE_OFF), false);
});

test('the test render switch shows the window off screen without focus', () => {
    assert.equal(resolveTestRenderMode({ CURVIOS_ELECTRON_TEST_RENDER: 'inactive' }), TEST_RENDER_MODE_INACTIVE);
    assert.equal(resolveTestRenderMode({ CURVIOS_ELECTRON_TEST_RENDER: '1' }), TEST_RENDER_MODE_INACTIVE);
    const options = createTestRenderWindowOptions(TEST_RENDER_MODE_INACTIVE);
    assert.equal(options.show, false, 'the constructor must not activate the window');
    assert.equal(options.skipTaskbar, true, 'no taskbar entry may appear');
    assert.equal(options.focusable, false, 'the window must never take the keyboard focus');
    assert.ok(options.x <= -10000 && options.y <= -10000, 'the window sits outside every real desktop');
    assert.deepEqual(
        { x: options.x, y: options.y },
        { x: OFFSCREEN_WINDOW_POSITION.x, y: OFFSCREEN_WINDOW_POSITION.y }
    );
    assert.equal(shouldShowInactive(TEST_RENDER_MODE_INACTIVE), true);
    const switchNames = listTestRenderCommandLineSwitches(TEST_RENDER_MODE_INACTIVE).map((entry) => entry.name);
    assert.deepEqual(switchNames, [
        'disable-features',
        'disable-backgrounding-occluded-windows',
        'disable-renderer-backgrounding',
    ]);
    const occlusion = listTestRenderCommandLineSwitches(TEST_RENDER_MODE_INACTIVE)
        .find((entry) => entry.name === 'disable-features');
    assert.equal(occlusion.value, 'CalculateNativeWinOcclusion');
});

test('the harness only uses the render mode when nobody asked for a visible window', () => {
    assert.equal(resolveHarnessRenderMode({}), 'inactive');
    assert.equal(resolveHarnessRenderMode({ PW_SHOW_WINDOW: '1' }), 'off');
    assert.equal(resolveHarnessRenderMode({ PW_SHOW_WINDOW: '0' }), 'inactive');
    assert.equal(resolveHarnessRenderMode({ CURVIOS_ELECTRON_SHOW_WINDOW: '1' }), 'off');
    assert.equal(resolveHarnessRenderMode({ CURVIOS_ELECTRON_SHOW_WINDOW: '0' }), 'inactive');
    assert.equal(resolveHarnessRenderMode({ PW_TEST_RENDER: '0' }), 'off', 'emergency switch back to the old window');
});

test('a packaged app ignores the test render switch', () => {
    const env = { CURVIOS_ELECTRON_TEST_RENDER: 'inactive' };
    assert.equal(resolveTestRenderMode(env, { isPackaged: true }), TEST_RENDER_MODE_OFF);
    assert.equal(resolveTestRenderMode(env, { isPackaged: false }), TEST_RENDER_MODE_INACTIVE);
});

test('the main window options stay untouched without the mode and beat a visible show with it', () => {
    const baseOptions = {
        width: 1280,
        height: 720,
        title: 'CurviosClash',
        backgroundColor: '#050510',
        show: true,
        webPreferences: { sandbox: true },
    };

    assert.deepEqual(createMainWindowOptions({ baseOptions, mode: TEST_RENDER_MODE_OFF }), baseOptions);
    assert.deepEqual(createMainWindowOptions({ baseOptions }), baseOptions, 'no mode means product behaviour');

    // @render tests ask for a visible window (show: true). The test options must still win,
    // otherwise the constructor itself would raise the window and take the user's focus.
    const inactive = createMainWindowOptions({ baseOptions, mode: TEST_RENDER_MODE_INACTIVE });
    assert.equal(inactive.show, false);
    assert.equal(inactive.focusable, false);
    assert.equal(inactive.skipTaskbar, true);
    assert.equal(inactive.x, OFFSCREEN_WINDOW_POSITION.x);
    assert.deepEqual(inactive.webPreferences, baseOptions.webPreferences, 'web preferences are never touched');
    assert.equal(inactive.width, 1280);
});

test('main process and harness are wired to the pure helpers', () => {
    const mainSource = readFileSync(path.join(repoRoot, 'electron', 'main.cjs'), 'utf8');
    assert.ok(mainSource.includes("require('./test-render-window.cjs')"), 'main.cjs loads the pure module');
    assert.match(
        mainSource,
        /new BrowserWindow\(createMainWindowOptions\(\{\s*mode: testRenderMode,/,
        'the main window is built from the pure options function, nothing is spread beside it'
    );
    assert.match(
        mainSource,
        /resolveTestRenderMode\(process\.env, \{ isPackaged: app\.isPackaged \}\)/,
        'the packaged app cannot be switched into the test mode'
    );
    assert.ok(mainSource.includes('appendSwitch'), 'chromium switches are appended');
    assert.ok(
        mainSource.indexOf('appendSwitch') < mainSource.indexOf('app.whenReady'),
        'switches must be set before the app is ready'
    );
    assert.match(
        mainSource,
        /if \(shouldShowInactive\(testRenderMode\)\) \{\s*(?:\/\/[^\n]*\n\s*)*mainWindow\.showInactive\(\);\s*\}/,
        'showInactive() only runs inside the mode check'
    );
    assert.equal(
        mainSource.match(/\.showInactive\(\)/g)?.length,
        1,
        'there is exactly one showInactive() call, the guarded one'
    );

    const harnessSource = readFileSync(path.join(repoRoot, 'tests', 'helpers.desktop.js'), 'utf8');
    assert.ok(
        harnessSource.includes('CURVIOS_ELECTRON_TEST_RENDER: resolveTestRenderMode(process.env)'),
        'the desktop harness passes the render mode to electron'
    );
});

// The Windows package is built from an allow list (build.files). A module that main.cjs
// requires but the list does not name passes every renderer build and every contract test,
// and the shipped app then dies at start with "Cannot find module". This guard walks the
// local requires of every packaged electron file.
test('every local module a packaged electron file requires is packaged as well', () => {
    const electronDir = path.join(repoRoot, 'electron');
    const packageJson = JSON.parse(readFileSync(path.join(electronDir, 'package.json'), 'utf8'));
    const files = packageJson.build.files.filter((entry) => typeof entry === 'string');
    const globPrefixes = files.filter((entry) => entry.endsWith('/**/*')).map((entry) => entry.slice(0, -'**/*'.length));
    const isPackaged = (relativePath) => files.includes(relativePath)
        || globPrefixes.some((prefix) => relativePath.startsWith(prefix));

    const missing = [];
    for (const entry of files.filter((name) => name.endsWith('.cjs'))) {
        const source = readFileSync(path.join(electronDir, entry), 'utf8');
        for (const match of source.matchAll(/require\('\.\/([^']+\.cjs)'\)/g)) {
            const required = path.posix.join(path.posix.dirname(entry), match[1]);
            if (!isPackaged(required)) missing.push(`${entry} -> ${required}`);
        }
    }

    assert.deepEqual(missing, [], 'required by a packaged file but missing from build.files');
    assert.ok(isPackaged('test-render-window.cjs'));
});

test('the game export carries the module that its main process requires', async () => {
    const { GAME_EXPORT_ELECTRON_FILES } = await import('../scripts/game-export-contract.mjs');
    assert.ok(GAME_EXPORT_ELECTRON_FILES.has('electron/test-render-window.cjs'));

    const builderConfig = readFileSync(path.join(repoRoot, 'game-export', 'electron-builder.yml'), 'utf8');
    assert.match(builderConfig, /^\s+- test-render-window\.cjs$/m);
});