import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from '@playwright/test';

const DEFAULT_EXECUTABLE_PATH = path.resolve(
    process.cwd(),
    'release',
    'win-unpacked',
    'CurviosClash.exe'
);
const executablePath = path.resolve(process.argv[2] || DEFAULT_EXECUTABLE_PATH);

async function listFiles(directoryPath) {
    if (!existsSync(directoryPath)) return [];
    const files = [];
    for (const entry of await readdir(directoryPath)) {
        const entryPath = path.join(directoryPath, entry);
        if ((await stat(entryPath)).isDirectory()) files.push(...await listFiles(entryPath));
        else files.push(entryPath);
    }
    return files;
}

async function assertNoPackagedDeveloperTraining() {
    const resourcesDirectory = path.join(path.dirname(executablePath), 'resources');
    const rendererIndexPath = path.join(resourcesDirectory, 'dist-app', 'index.html');
    assert.equal(existsSync(rendererIndexPath), true, `Packaged renderer is missing: ${rendererIndexPath}`);
    const rendererHtml = await readFile(rendererIndexPath, 'utf8');
    assert.doesNotMatch(rendererHtml, /developer-training-|Training-Interface|Training Reset|Run Batch|Run Eval|Run Gate/i);

    const resourceFiles = await listFiles(resourcesDirectory);
    const relativePaths = resourceFiles.map((filePath) => path.relative(resourcesDirectory, filePath).replace(/\\/g, '/'));
    const forbiddenPath = relativePaths.find((relativePath) => (
        /dist-app\/assets\/(?:training|trainer|validation)-[^/]+\.js$/i.test(relativePath)
        || /^(?:src\/(?:entities\/ai\/training|state\/(?:training|validation))|dev\/training)(?:\/|$)/i.test(relativePath)
        || /(?:DeveloperTraining|GameDebugTraining|MenuDeveloperTraining|MenuRuntimeDeveloperTraining)/i.test(relativePath)
        || /(?:HeadlessMatchKernelRuntime|MatchKernelTrainingPayload)/i.test(relativePath)
    ));
    assert.equal(forbiddenPath, undefined, `Developer training resource reached package: ${forbiddenPath}`);
}

function isPathInside(parentPath, candidatePath) {
    const relativePath = path.relative(parentPath, candidatePath);
    return relativePath === ''
        || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath));
}

async function closeElectronApp(electronApp) {
    if (!electronApp) return;
    await electronApp.close().catch(() => {});
}

assert.equal(process.platform, 'win32', 'Packaged Electron verification requires Windows.');
assert.equal(existsSync(executablePath), true, `Packaged executable is missing: ${executablePath}`);
await assertNoPackagedDeveloperTraining();

const isolatedProfilePath = await mkdtemp(path.join(os.tmpdir(), 'curvios-package-runtime-'));
const appDataPath = path.join(isolatedProfilePath, 'AppData', 'Roaming');
const localAppDataPath = path.join(isolatedProfilePath, 'AppData', 'Local');
const sharedSettingsPath = path.join(appDataPath, 'curviosclash-app');
await Promise.all([
    mkdir(appDataPath, { recursive: true }),
    mkdir(localAppDataPath, { recursive: true }),
]);

const isolatedEnvironment = {
    ...process.env,
    APPDATA: appDataPath,
    LOCALAPPDATA: localAppDataPath,
    USERPROFILE: isolatedProfilePath,
    CURVIOS_ELECTRON_SHOW_WINDOW: '1',
};
delete isolatedEnvironment.ELECTRON_RUN_AS_NODE;

let gameApp = null;
let settingsStudioApp = null;

try {
    gameApp = await electron.launch({
        executablePath,
        env: isolatedEnvironment,
        timeout: 45_000,
    });
    const gameWindow = await gameApp.firstWindow({ timeout: 45_000 });
    await gameWindow.waitForLoadState('domcontentloaded');
    const gameProbe = await gameWindow.evaluate(async () => {
        const hostStatus = await window.curviosApp?.host?.getStatus?.();
        return {
            marker: window.__CURVIOS_APP__ === true,
            contractName: window.curviosApp?.host?.contractName || '',
            hostState: hostStatus?.state || '',
            configuredPorts: hostStatus?.configuredPorts || [],
        };
    });
    assert.equal(gameProbe.marker, true, 'Packaged game preload marker is missing.');
    assert.equal(gameProbe.contractName, 'host', 'Packaged game host contract is missing.');
    assert.equal(gameProbe.hostState, 'stopped', 'Packaged main-frame IPC returned an invalid host state.');
    assert.ok(gameProbe.configuredPorts.length > 0, 'Packaged main-frame IPC returned no LAN ports.');

    settingsStudioApp = await electron.launch({
        executablePath,
        args: ['--settings-studio'],
        env: isolatedEnvironment,
        timeout: 45_000,
    });
    const settingsStudioWindow = await settingsStudioApp.firstWindow({ timeout: 45_000 });
    await settingsStudioWindow.waitForLoadState('domcontentloaded');
    const settingsStudioProbe = await settingsStudioWindow.evaluate(async () => {
        const loaded = await window.settingsStudioApi?.load?.();
        const saved = await window.settingsStudioApi?.save?.(
            loaded?.draft,
            loaded?.browserDemoPolicy?.draft
        );
        await window.settingsStudioApi?.setLanguage?.('de');
        return {
            marker: window.__CURVIOS_SETTINGS_STUDIO__ === true,
            title: document.title,
            loaded: loaded?.ok === true,
            saved: saved?.ok === true,
            paths: loaded?.paths || {},
        };
    });
    assert.equal(settingsStudioProbe.marker, true, 'Packaged Settings Studio preload marker is missing.');
    assert.equal(settingsStudioProbe.title, 'CurviosClash Settings Studio');
    assert.equal(settingsStudioProbe.loaded, true, 'Packaged Settings Studio load IPC failed.');
    assert.equal(settingsStudioProbe.saved, true, 'Packaged Settings Studio save IPC failed.');
    assert.equal(gameWindow.isClosed(), false, 'Settings Studio displaced the running game instance.');

    for (const [pathName, candidatePath] of Object.entries(settingsStudioProbe.paths)) {
        assert.equal(
            isPathInside(sharedSettingsPath, path.resolve(candidatePath)),
            true,
            `${pathName} escaped the writable shared settings directory: ${candidatePath}`
        );
    }
    for (const requiredFilePath of [
        settingsStudioProbe.paths.overrideFilePath,
        settingsStudioProbe.paths.browserDemoPolicyOverrideFilePath,
        settingsStudioProbe.paths.browserDemoPolicyExportFilePath,
    ]) {
        assert.equal(existsSync(requiredFilePath), true, `Packaged Settings Studio did not write ${requiredFilePath}`);
    }

    console.log(JSON.stringify({
        executablePath,
        gameMainFrameIpc: 'ok',
        settingsStudioMainFrameIpc: 'ok',
        developerTrainingBoundary: 'ok',
        concurrentWindows: 'ok',
        writableSettingsRoot: sharedSettingsPath,
    }));
} finally {
    await closeElectronApp(settingsStudioApp);
    await closeElectronApp(gameApp);
    await rm(isolatedProfilePath, { recursive: true, force: true });
}
