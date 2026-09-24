/* global localStorage, window */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { _electron as electron } from '@playwright/test';

function option(name) {
    const inline = process.argv.find((argument) => argument.startsWith(`--${name}=`));
    return inline ? inline.slice(name.length + 3) : '';
}

const executablePath = path.resolve(option('exe'));
const profilePath = path.resolve(option('profile'));
assert.equal(existsSync(executablePath), true, `Installed executable is missing: ${executablePath}`);
await mkdir(profilePath, { recursive: true });
const appDataPath = path.join(profilePath, 'AppData', 'Roaming');
const localAppDataPath = path.join(profilePath, 'AppData', 'Local');
await Promise.all([
    mkdir(appDataPath, { recursive: true }),
    mkdir(localAppDataPath, { recursive: true }),
]);
const environment = {
    ...process.env,
    APPDATA: appDataPath,
    LOCALAPPDATA: localAppDataPath,
    USERPROFILE: profilePath,
    CURVIOS_ELECTRON_SHOW_WINDOW: '1',
    PW_RUN_TAG: `installed-game-test-${process.pid}`,
};
delete environment.ELECTRON_RUN_AS_NODE;

async function closeApplication(application) {
    if (!application) return;
    const closed = await Promise.race([
        application.close().then(() => true, () => false),
        new Promise((resolve) => setTimeout(() => resolve(false), 15_000)),
    ]);
    if (!closed && application.process()?.exitCode == null) {
        application.process().kill();
    }
}

let gameApp = null;
let settingsApp = null;
try {
    gameApp = await electron.launch({ executablePath, env: environment, timeout: 60_000 });
    assert.equal(await gameApp.evaluate(({ app }) => app.commandLine.hasSwitch('mute-audio')), true,
        'Installed game test must start with muted audio.');
    const gameWindow = await gameApp.firstWindow({ timeout: 60_000 });
    await gameWindow.waitForLoadState('domcontentloaded');
    await gameWindow.waitForFunction(() => Boolean(window.GAME_INSTANCE?.settings), null, { timeout: 60_000 });

    const modeResults = [];
    for (const scenario of [
        { label: 'classic', gameMode: 'CLASSIC', modePath: 'normal', mapKey: 'standard' },
        { label: 'hunt', gameMode: 'HUNT', modePath: 'fight', mapKey: 'standard' },
        { label: 'arcade', gameMode: 'ARCADE', modePath: 'arcade', mapKey: 'parcours_rift' },
    ]) {
        if (modeResults.length > 0) {
            await gameWindow.reload();
            await gameWindow.waitForFunction(() => Boolean(window.GAME_INSTANCE?.settings), null, { timeout: 60_000 });
        }
        const result = await gameWindow.evaluate(async (entry) => {
            const game = window.GAME_INSTANCE;
            game.settings.gameMode = entry.gameMode;
            game.settings.mapKey = entry.mapKey;
            game.settings.numBots = 1;
            game.settings.localSettings = game.settings.localSettings || {};
            game.settings.localSettings.modePath = entry.modePath;
            game._onSettingsChanged();
            await game.matchFlowUiController.startMatch();
            const deadline = Date.now() + 5_000;
            while ((game.entityManager?.players?.length || 0) < 1 && Date.now() < deadline) {
                await new Promise((resolve) => setTimeout(resolve, 50));
            }
            const snapshot = {
                label: entry.label,
                state: String(game.state || ''),
                players: game.entityManager?.players?.length || 0,
                activeMode: String(game.runtimeConfig?.session?.activeGameMode || ''),
                modePath: String(game.settings.localSettings.modePath || ''),
            };
            await game._returnToMenu();
            await new Promise((resolve) => setTimeout(resolve, 50));
            return snapshot;
        }, scenario);
        assert.ok(
            result.players >= 1 || result.state.toLowerCase() === 'playing',
            `${scenario.label} did not start a running match.`
        );
        assert.equal(result.modePath, scenario.modePath, `${scenario.label} mode path changed.`);
        modeResults.push(result);
    }

    const lanStatus = await gameWindow.evaluate(async () => {
        const started = await window.curviosApp.host.start();
        const stopped = await window.curviosApp.host.stop();
        return { started, stopped };
    });
    assert.equal(lanStatus.started.state, 'running', 'Installed LAN server did not start.');
    assert.equal(lanStatus.stopped.state, 'stopped', 'Installed LAN server did not stop.');

    const previousWindows = gameApp.windows().length;
    await gameWindow.evaluate(() => window.curviosApp.hangar.openWindow({ mode: 'arcade' }));
    await gameWindow.waitForTimeout(500);
    const hangarWindow = gameApp.windows().find((candidate) => candidate !== gameWindow);
    assert.ok(hangarWindow, `Hangar window did not open (previous windows: ${previousWindows}).`);
    await hangarWindow.waitForLoadState('domcontentloaded');
    assert.match(await hangarWindow.title(), /Hangar/i);
    await hangarWindow.close();

    await gameWindow.evaluate(() => {
        localStorage.setItem('curviosclash.installer-smoke', 'persisted');
    });
    await gameWindow.reload();
    assert.equal(
        await gameWindow.evaluate(() => localStorage.getItem('curviosclash.installer-smoke')),
        'persisted',
        'Installed profile persistence failed.'
    );

    const ffmpegPath = path.join(path.dirname(executablePath), 'resources', 'app.asar.unpacked', 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
    assert.equal(existsSync(ffmpegPath), true, 'Embedded FFmpeg is missing.');
    const videoPath = path.join(profilePath, 'installer-smoke.mp4');
    const encode = spawnSync(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=1',
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', videoPath,
    ], { windowsHide: true, encoding: 'utf8' });
    assert.equal(encode.status, 0, `Embedded FFmpeg export failed: ${encode.stderr}`);
    const probe = spawnSync(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', videoPath, '-f', 'null', '-'], {
        windowsHide: true,
        encoding: 'utf8',
    });
    assert.equal(probe.status, 0, `Exported video is unreadable: ${probe.stderr}`);

    await closeApplication(gameApp);
    gameApp = null;
    settingsApp = await electron.launch({ executablePath, args: ['--settings-studio'], env: environment, timeout: 60_000 });
    const settingsWindow = await settingsApp.firstWindow({ timeout: 60_000 });
    await settingsWindow.waitForLoadState('domcontentloaded');
    await settingsWindow.waitForFunction(() => Boolean(window.settingsStudioApi), null, { timeout: 60_000 });
    const settingsResult = await settingsWindow.evaluate(async () => {
        return Promise.race([
            (async () => {
                const loaded = await window.settingsStudioApi.load();
                const saved = await window.settingsStudioApi.save(loaded.draft, loaded.browserDemoPolicy?.draft);
                return { loaded: loaded.ok, saved: saved.ok };
            })(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Settings Studio IPC timed out.')), 30_000)),
        ]);
    });
    assert.deepEqual(settingsResult, { loaded: true, saved: true }, 'Settings Studio persistence failed.');

    await writeFile(path.join(profilePath, 'keep-after-uninstall.txt'), 'profile must survive uninstall\n', 'utf8');
    console.log(JSON.stringify({ modeResults, lan: 'ok', hangar: 'ok', settingsStudio: 'ok', videoPath, profilePath }));
} finally {
    await closeApplication(settingsApp);
    await closeApplication(gameApp);
}
