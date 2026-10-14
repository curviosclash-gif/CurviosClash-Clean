import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { installMarketingSessionIpc } = require('../electron/marketing-session-ipc.cjs');
import { createElectronAppModeLaunchAdapter } from '../src/platform/electron/ElectronPlatformBridge.js';
import { refreshLocalMapCatalog } from '../src/core/runtime/LocalMapCatalogRefresh.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = (file) => readFile(path.join(root, file), 'utf8');

test('normal game runtime does not import or tick marketing code', async () => {
    const main = await source('src/core/main.js');
    assert.doesNotMatch(main, /import\s*\{\s*MarketingSession\s*\}/);
    assert.match(main, /if \(window\.curviosMarketing\)[\s\S]*?import\('\.\/recording\/MarketingSession\.js'\)[\s\S]*?import\('\.\/recording\/MarketingSessionRuntimePort\.js'\)/);
    assert.match(await source('dev/vite/rendererShellConfig.js'), /normalizedId\.includes\('\/core\/recording\/Marketing'\)[\s\S]*?return 'marketing-session'/);
    const update = main.match(/    update\(dt\) \{([\s\S]*?)\n    \}/)?.[1] || '';
    assert.doesNotMatch(update, /marketing/i);
    assert.doesNotMatch(await source('src/core/InputManager.js'), /recordingInputObserver/);
    assert.doesNotMatch(await source('src/state/RoundRecorder.js'), /marketingObserver/);
});

test('Electron loads marketing IPC and ffmpeg only for the dedicated launch', async () => {
    const main = await source('electron/main.cjs');
    execFileSync(process.execPath, ['--check', path.join(root, 'electron/main.cjs')]);
    assert.match(main, /if \(marketingMode\) \{\s*const \{ installMarketingSessionIpc \} = require\('\.\/marketing-session-ipc\.cjs'\)/);
    assert.match(main, /if \(marketingMode\) \{\s*const \{ installMarketingSessionIpc \}[\s\S]*?require\('ffmpeg-static'\)/);
    assert.doesNotMatch(main, /ipcMain\.handle\(['"]marketing:/);
    assert.match(main, /sha256:\s*await hashDirectory\(rendererDir\)/);
    assert.match(main, /CURVIOS_USER_DATA_ROOT = path\.join\(app\.getPath\('appData'\), 'curviosclash-marketing-profile'\)/);
    assert.match(main, /function resolveMarketingConfigDirectory[\s\S]*?path\.basename\(resolvedConfig\) !== 'config\.json'/);
    assert.match(main, /const configInfo = await lstat\(actualConfig\)[\s\S]*?configInfo\.isSymbolicLink\(\)/);
    assert.doesNotMatch(await source('src/core/recording/MarketingSession.js'), /document\.(?:body|createElement)/);
    assert.doesNotMatch(await source('src/core/recording/MarketingSession.js'), /constructor\(game\)|this\.game\s*=/);
    assert.match(await source('src/bootstrap.js'), /if \(window\.curviosMarketing\)[\s\S]*?MarketingCaptureView\.js/);
    const preload = await source('electron/preload.cjs');
    assert.match(preload, /if \(process\.argv\.includes\('--curvios-marketing'\)\)\s*\{\s*const requestMarketingSession = createInvokeBridge\('marketing:request'\);[\s\S]*?contextBridge\.exposeInMainWorld\('curviosMarketing'/);
    assert.match(preload, /createInvokeBridge\('app-mode:launch'\)/);
});

test('menu keeps Cinematic Replay separate from the dedicated marketing launcher', async () => {
    const html = await source('index.html');
    assert.match(html, /data-menu-step-target="submenu-media">Aufnahme &amp; Content/);
    assert.match(html, /data-level4-section="recording"[^>]*>Cinematic Replay öffnen/);
    assert.match(html, /id="btn-marketing-capture"[^>]*>Marketing-Modus starten/);
    assert.match(await source('src/ui/menu/MenuSchema.js'), /id: 'submenu-media'/);
    const bindings = await source('src/ui/menu/MenuToolsBindings.js');
    assert.doesNotMatch(bindings, /curviosApp/);
    assert.match(bindings, /createElectronAppModeLaunchAdapter/);
});

test('app mode adapter forwards the current settings snapshot to Electron', async () => {
    const calls = [];
    const adapter = createElectronAppModeLaunchAdapter({ curviosApp: { contracts: { launchMode: {
        contractVersion: 'app-mode-launch.v1', launch: (...args) => calls.push(args),
    } } } });
    const settings = { mapKey: 'editor_test-map', botDifficulty: 'NORMAL', controls: {},
        localMap: { name: 'Test map', size: [100, 100, 100], obstacles: [] } };
    adapter.launch('marketing-capture', settings);
    assert.deepEqual(calls, [['marketing-capture', settings]]);
});

test('marketing local-map snapshot is merged into the isolated runtime catalog before launch', async () => {
    const catalog = {};
    const knownKeys = new Set();
    const localMap = { name: 'Test map', size: [100, 100, 100], obstacles: [] };
    const refreshed = await refreshLocalMapCatalog({
        gameState: 'MENU', getGameState: () => 'MENU',
        readLocalMaps: async () => ({ 'editor_test-map': localMap }),
        catalog, refreshRuntimeConfig: () => {}, knownKeys, fallbackMaps: {},
    });
    assert.equal(refreshed, true);
    assert.deepEqual(catalog['editor_test-map'], localMap);
    assert.equal(knownKeys.has('editor_test-map'), true);
});

test('marketing IPC rejects untrusted senders and capture paths inside the repository', async () => {
    const folder = await mkdtemp(path.join(os.tmpdir(), 'curvios-marketing-ipc-'));
    const handlers = new Map();
    const ipcMain = { handle: (name, handler) => handlers.set(name, handler) };
    const configPath = path.join(folder, 'config.json');
    await writeFile(configPath, JSON.stringify({ action: 'capture', humans: 1, bots: 3,
        directory: path.join(folder, 'capture') }));
    installMarketingSessionIpc({ ipcMain, getWindow: () => null, isTrusted: () => false,
        configPath, ffmpeg: 'ffmpeg', repositoryRoot: root });
    await assert.rejects(handlers.get('marketing:request')({}, 'config'), /untrusted_marketing_sender/);

    const invalidConfigPath = path.join(folder, 'inside-repository.json');
    await writeFile(invalidConfigPath, JSON.stringify({ action: 'capture', humans: 1, bots: 3,
        directory: path.join(root, 'capture-output') }));
    const invalidHandlers = new Map();
    installMarketingSessionIpc({ ipcMain: { handle: (name, handler) => invalidHandlers.set(name, handler) },
        getWindow: () => null, isTrusted: () => true, configPath: invalidConfigPath,
        ffmpeg: 'ffmpeg', repositoryRoot: root });
    await assert.rejects(invalidHandlers.get('marketing:request')({}, 'config'), /marketing_path_inside_repository/);

    const settingsPath = path.join(folder, 'settings.json');
    const settings = { mapKey: 'editor_test-map', botDifficulty: 'NORMAL', controls: { PLAYER_1: { fire: 'Space' } },
        localMap: { name: 'Test map', size: [100, 100, 100], obstacles: [] } };
    await writeFile(settingsPath, JSON.stringify({ action: 'capture', humans: 1, bots: 3,
        directory: path.join(folder, 'settings-capture'), settings }));
    const settingsHandlers = new Map();
    installMarketingSessionIpc({ ipcMain: { handle: (name, handler) => settingsHandlers.set(name, handler) },
        getWindow: () => null, isTrusted: () => true, configPath: settingsPath, ffmpeg: 'ffmpeg', repositoryRoot: root });
    assert.deepEqual((await settingsHandlers.get('marketing:request')({}, 'config')).settings, settings);

    const invalidMapPath = path.join(folder, 'invalid-local-map.json');
    await writeFile(invalidMapPath, JSON.stringify({ action: 'capture', humans: 1, bots: 3,
        directory: path.join(folder, 'invalid-local-map-capture'), settings: { ...settings, localMap: { size: [0, 1, 2] } } }));
    const invalidMapHandlers = new Map();
    installMarketingSessionIpc({ ipcMain: { handle: (name, handler) => invalidMapHandlers.set(name, handler) },
        getWindow: () => null, isTrusted: () => true, configPath: invalidMapPath, ffmpeg: 'ffmpeg', repositoryRoot: root });
    await assert.rejects(invalidMapHandlers.get('marketing:request')({}, 'config'), /invalid_marketing_local_map/);

    const invalidSettingsPath = path.join(folder, 'invalid-settings.json');
    await writeFile(invalidSettingsPath, JSON.stringify({ action: 'capture', humans: 1, bots: 3,
        directory: path.join(folder, 'invalid-settings-capture'), settings: { ...settings, botDifficulty: 'IMPOSSIBLE' } }));
    const invalidSettingsHandlers = new Map();
    installMarketingSessionIpc({ ipcMain: { handle: (name, handler) => invalidSettingsHandlers.set(name, handler) },
        getWindow: () => null, isTrusted: () => true, configPath: invalidSettingsPath, ffmpeg: 'ffmpeg', repositoryRoot: root });
    await assert.rejects(invalidSettingsHandlers.get('marketing:request')({}, 'config'), /invalid_marketing_settings/);
});
