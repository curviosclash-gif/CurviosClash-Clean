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
    createSecondaryWindowOptions,
    createTestRenderWindowOptions,
    listTestRenderCommandLineSwitches,
    resolveTestRenderMode,
    shouldShowInactive,
    showWindowForMode,
    withTestRenderWindowOpenHandler,
} = require(path.join(repoRoot, 'electron', 'test-render-window.cjs'));
const { createHangarWindowController } = require(path.join(repoRoot, 'electron', 'hangar-window.cjs'));
const { createTuningWindowController } = require(path.join(repoRoot, 'electron', 'tuning-window.cjs'));

class FakeWindow {
    constructor(options = {}) {
        this.options = options;
        this.calls = [];
        this.events = new Map();
        this.destroyed = false;
    }
    isDestroyed() { return this.destroyed; }
    isMinimized() { return false; }
    isVisible() { return this.calls.includes('show') || this.calls.includes('showInactive'); }
    on(name, handler) { this.events.set(name, handler); }
    once(name, handler) { this.events.set(name, handler); }
    get webContents() {
        return { on() {}, setWindowOpenHandler() {} };
    }
    async loadURL(url) { this.url = url; this.events.get('ready-to-show')?.(); }
    async loadFile(file) { this.url = file; this.events.get('ready-to-show')?.(); }
    maximize() { this.calls.push('maximize'); }
    show() { this.calls.push('show'); }
    showInactive() { this.calls.push('showInactive'); }
    focus() { this.calls.push('focus'); }
    setAlwaysOnTop() { this.calls.push('setAlwaysOnTop'); }
    close() { this.destroyed = true; this.events.get('closed')?.(); }
}

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

test('secondary window options stay untouched without the mode', () => {
    const baseOptions = {
        width: 1600,
        height: 1000,
        title: 'CurviosClash Hangar',
        show: true,
        alwaysOnTop: true,
        webPreferences: { sandbox: true },
    };
    assert.deepEqual(createSecondaryWindowOptions({ baseOptions, mode: TEST_RENDER_MODE_OFF }), baseOptions);
    assert.deepEqual(createSecondaryWindowOptions({ baseOptions }), baseOptions, 'no mode means product behaviour');
});

test('secondary windows hide themselves the same way the main window does', () => {
    const baseOptions = {
        width: 1600,
        height: 1000,
        title: 'CurviosClash Hangar',
        show: true,
        alwaysOnTop: true,
        parent: { fake: 'parent' },
        webPreferences: { sandbox: true },
    };
    const options = createSecondaryWindowOptions({ baseOptions, mode: TEST_RENDER_MODE_INACTIVE });
    assert.equal(options.show, false);
    assert.equal(options.skipTaskbar, true);
    assert.equal(options.focusable, false);
    assert.equal(options.x, OFFSCREEN_WINDOW_POSITION.x);
    assert.equal(options.y, OFFSCREEN_WINDOW_POSITION.y);
    // Ein immer-obenauf-Fenster waehrend eines Laufs waere genau das, was der Nutzer
    // nicht will, falls Windows die Position doch einmal zurueckholt.
    assert.equal(options.alwaysOnTop, false, 'no test window may sit on top of the user');
    assert.deepEqual(options.webPreferences, baseOptions.webPreferences, 'web preferences are never touched');
    assert.equal(options.parent, baseOptions.parent, 'the parent relation survives');
    assert.equal(options.width, 1600);
});

test('showWindowForMode only paints the window in the test mode, and never activates it', () => {
    const product = new FakeWindow();
    assert.equal(showWindowForMode(product, TEST_RENDER_MODE_OFF), false);
    assert.deepEqual(product.calls, [], 'without the mode the caller keeps its own show path');

    const test1 = new FakeWindow();
    assert.equal(showWindowForMode(test1, TEST_RENDER_MODE_INACTIVE), true);
    assert.deepEqual(test1.calls, ['showInactive'], 'painting must never use show() or focus()');
    assert.equal(showWindowForMode(null, TEST_RENDER_MODE_INACTIVE), true, 'a closed window is not an error');
});

test('a wrapped window-open handler is the untouched handler without the mode', () => {
    const handler = () => ({ action: 'allow', overrideBrowserWindowOptions: { width: 1440 } });
    assert.equal(withTestRenderWindowOpenHandler(handler, TEST_RENDER_MODE_OFF), handler);
    assert.equal(withTestRenderWindowOpenHandler(handler), handler);
});

test('a wrapped window-open handler hides the popup it allows', () => {
    const webPreferences = { sandbox: true, preload: 'editor-preload.cjs' };
    const denied = { action: 'deny' };
    const handler = ({ url } = {}) => (url === 'allowed'
        ? { action: 'allow', overrideBrowserWindowOptions: { width: 1440, height: 900, webPreferences } }
        : denied);
    const wrapped = withTestRenderWindowOpenHandler(handler, TEST_RENDER_MODE_INACTIVE);

    // Same object, not a copy: the wrapper does not even touch a refusal.
    assert.equal(wrapped({ url: 'blocked' }), denied, 'the security answer is never widened');

    const allowed = wrapped({ url: 'allowed' });
    assert.equal(allowed.action, 'allow');
    assert.equal(allowed.overrideBrowserWindowOptions.show, false);
    assert.equal(allowed.overrideBrowserWindowOptions.alwaysOnTop, false);
    assert.equal(allowed.overrideBrowserWindowOptions.skipTaskbar, true);
    assert.equal(allowed.overrideBrowserWindowOptions.focusable, false);
    assert.equal(allowed.overrideBrowserWindowOptions.x, OFFSCREEN_WINDOW_POSITION.x);
    assert.equal(allowed.overrideBrowserWindowOptions.width, 1440, 'the editor size survives');
    assert.deepEqual(
        allowed.overrideBrowserWindowOptions.webPreferences,
        webPreferences,
        'the secure web preferences survive untouched'
    );
});

test('the hangar window keeps maximizing and focusing without the mode', async () => {
    const controller = createHangarWindowController({
        BrowserWindow: FakeWindow,
        resolveWindowUrl: () => 'http://127.0.0.1/hangar.html?mode=arcade',
        shouldShowWindow: () => true,
    });
    const opened = await controller.openHangarWindow({ focus: true });
    assert.deepEqual(opened.window.calls, ['maximize', 'show', 'focus']);
    assert.equal(opened.window.options.show, false, 'the product still waits for ready-to-show');
    assert.equal(opened.window.options.skipTaskbar, undefined);
});

test('the hangar window stays off screen and unfocused in the test mode', async () => {
    const controller = createHangarWindowController({
        BrowserWindow: FakeWindow,
        resolveWindowUrl: () => 'http://127.0.0.1/hangar.html?mode=arcade',
        shouldShowWindow: () => true,
        testRenderMode: TEST_RENDER_MODE_INACTIVE,
    });
    const opened = await controller.openHangarWindow({ focus: true });
    // maximize() alone pulls a hidden window onto the screen - that is how the hangar
    // window became visible and took the focus during test runs.
    assert.deepEqual(opened.window.calls, ['showInactive']);
    assert.equal(opened.window.options.focusable, false);
    assert.equal(opened.window.options.skipTaskbar, true);
    assert.equal(opened.window.options.x, OFFSCREEN_WINDOW_POSITION.x);
    assert.equal(opened.window.options.minWidth, 1100, 'the product options survive');
});

test('the tuning window keeps focusing without the mode and hides with it', async () => {
    const product = createTuningWindowController({
        BrowserWindow: FakeWindow,
        htmlPath: path.join(repoRoot, 'electron', 'tuning-console', 'tuning.html'),
        shouldShowWindow: () => true,
    });
    const openedProduct = await product.createTuningWindow({ focus: true });
    assert.deepEqual(openedProduct.window.calls, ['focus']);
    assert.equal(openedProduct.window.options.show, true);

    const underTest = createTuningWindowController({
        BrowserWindow: FakeWindow,
        htmlPath: path.join(repoRoot, 'electron', 'tuning-console', 'tuning.html'),
        shouldShowWindow: () => true,
        testRenderMode: TEST_RENDER_MODE_INACTIVE,
    });
    const openedTest = await underTest.createTuningWindow({ focus: true, alwaysOnTop: true });
    assert.deepEqual(openedTest.window.calls, ['showInactive']);
    assert.equal(openedTest.window.options.show, false);
    assert.equal(openedTest.window.options.alwaysOnTop, false);
    assert.equal(openedTest.window.options.focusable, false);
    assert.equal(openedTest.window.options.x, OFFSCREEN_WINDOW_POSITION.x);
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

// Jedes Fenster, das im Testmodus entstehen kann, muss denselben Weg nehmen. Ein
// vergessener Aufrufer faellt sonst nur auf, weil ein Fenster auf dem Schirm auftaucht.
test('every window main.cjs can open goes through the test render helpers', () => {
    const mainSource = readFileSync(path.join(repoRoot, 'electron', 'main.cjs'), 'utf8');

    const openHandlerCalls = mainSource.match(/setWindowOpenHandler\(/g)?.length ?? 0;
    const wrappedCalls = mainSource.match(/withTestRenderWindowOpenHandler\(/g)?.length ?? 0;
    assert.equal(wrappedCalls, openHandlerCalls, 'every window-open handler is wrapped');
    assert.ok(openHandlerCalls >= 3, 'editor, playtest and the denying handler are all covered');

    assert.match(
        mainSource,
        /did-create-window', \(editorWindow[\s\S]{0,900}showWindowForMode\(editorWindow, testRenderMode\)/,
        'the editor window is painted off screen instead of staying at one frame per second'
    );
    assert.match(
        mainSource,
        /did-create-window', \(playtestWindow[\s\S]{0,300}showWindowForMode\(playtestWindow, testRenderMode\)/,
        'the playtest window is painted off screen as well'
    );
    assert.match(
        mainSource,
        /createHangarWindowController\(\{[\s\S]{0,600}testRenderMode,/,
        'the hangar controller learns the mode'
    );
    assert.match(
        mainSource,
        /createTuningWindowController\(\{[\s\S]{0,400}testRenderMode,/,
        'the tuning controller learns the mode'
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