/* global window, performance */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { _electron as electron } from '@playwright/test';
import { acquirePlaywrightRunLock, releasePlaywrightRunLockOnExit } from '../playwright-run-lock.mjs';
import { waitForLoadedGame } from '../../tests/helpers.js';
import { ROCKET_DUEL } from './rocket-duel-scene.mjs';

const root = process.cwd();
const liveSize = { width: 1280, height: 720 };
const output = path.resolve(process.argv[2] || path.join(root, 'output', 'marketing',
    `rocket-duel-${new Date().toISOString().replace(/[:.]/g, '-')}`));
const probe = process.argv.includes('--probe');
console.warn('[rocket-duel] Technikprobe: Beide Spielerslots werden per Skript gesteuert; kein Gameplay menschlicher Spieler.');
const requireElectron = createRequire(path.join(root, 'electron', 'package.json'));
const lock = await acquirePlaywrightRunLock({ label: 'marketing rocket duel' });
releasePlaywrightRunLockOnExit(lock.release);
let app;

try {
    await mkdir(output);
    const bundle = await build({
        entryPoints: [path.join(root, 'scripts/marketing/rocket-duel-scene.mjs')],
        bundle: true, write: false, format: 'iife', globalName: '__rocketDuel', platform: 'browser',
    });
    app = await electron.launch({
        executablePath: requireElectron('electron'),
        args: ['--force-device-scale-factor=1', '.'],
        cwd: path.join(root, 'electron'),
        env: {
            ...process.env,
            CURVIOS_ELECTRON_SHOW_WINDOW: '0',
            CURVIOS_ELECTRON_TEST_RENDER: '1',
            CURVIOS_E2E_RENDERER: '1',
            CURVIOS_USER_DATA_ROOT: path.join(output, 'user-data'),
        },
    });
    const page = await app.firstWindow();
    page.on('pageerror', (error) => console.error(`[rocket-duel] ${error.message}`));
    page.on('console', (message) => {
        if (message.text().startsWith('[rocket-duel]')) console.log(message.text());
    });
    await waitForLoadedGame(page);
    await page.setViewportSize(liveSize);
    const contentSize = await app.evaluate(async ({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.setMaximumSize(8192, 8192);
        win.setContentSize(size.width, size.height);
        for (let attempt = 0; attempt < 4; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 100));
            const [width, height] = win.getContentSize();
            if (width === size.width && height === size.height) break;
            const [outerWidth, outerHeight] = win.getSize();
            win.setSize(outerWidth + size.width - width, outerHeight + size.height - height);
        }
        return win.getContentSize();
    }, liveSize);
    if (contentSize[0] !== liveSize.width || contentSize[1] !== liveSize.height) {
        throw new Error(`Desktop size mismatch: ${contentSize.join('x')}`);
    }
    await page.waitForFunction((size) => window.innerWidth === size.width && window.innerHeight === size.height,
        liveSize);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    if (!probe) {
        await app.evaluate(({ BrowserWindow, dialog }, filename) => {
            const win = BrowserWindow.getAllWindows()[0];
            win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
                if (request.frame !== win.webContents.mainFrame) { callback({}); return; }
                callback({ video: win.webContents.mainFrame, audio: win.webContents.mainFrame,
                    enableLocalEcho: true });
            });
            dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
        }, path.join(output, 'curviosclash-rocket-duel.mp4'));
    }
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        Object.assign(game.settings, {
            mode: '2p', gameMode: 'HUNT', mapKey: 'rift_bazaar', numBots: 3,
            botDifficulty: 'EASY',
            winsNeeded: 15, portalsEnabled: false, autoRoll: false,
        });
        Object.assign(game.settings.localSettings, { sessionType: 'splitscreen', modePath: 'fight' });
        Object.assign(game.settings.gameplay, { speed: 30, turnSensitivity: 3, itemAmount: 20,
            trailLength: 5000 });
        game.settings.hunt = { ...game.settings.hunt, respawnEnabled: true,
            deathmatchKillLimit: 100, timeLimitEnabled: false, winCondition: 'kills_time' };
        game.settings.cockpitCamera = { PLAYER_1: false, PLAYER_2: false };
        game.settings.cameraPerspective = { normal: 'classic', reduceMotion: true,
            speedFovEnabled: false };
        game.settings.recording = { profile: 'cinematic', hudMode: 'clean',
            exportPreset: 'youtube-mp4', orientation: 'landscape' };
        game.settings.audio = { ...game.settings.audio, enabled: true };
        game._applySettingsToRuntime({ schedulePrewarm: false });
        game.audio?.applySettings?.(game.settings.audio);
        game.startMatch();
    });
    await page.waitForFunction(() => window.GAME_INSTANCE?.entityManager?.players?.length === 5,
        null, { timeout: 60000 });
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING',
        null, { timeout: 30000 });
    await page.evaluate(() => window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().pauseMatch());
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PAUSED');
    await page.evaluate(() => {
        window.__rocketDuelRun = window.__rocketDuel.installRocketDuelFlight(window.GAME_INSTANCE);
    });
    await page.evaluate(() => window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().resumeMatch());
    for (const checkpoint of [30, 60, 90, ROCKET_DUEL.prerollSeconds]) {
        await page.waitForFunction((target) => window.__rocketDuelRun.state.time >= target
            || window.GAME_INSTANCE.state !== 'PLAYING', checkpoint, { timeout: 120000 });
        const state = await page.evaluate(() => ({
            gameState: window.GAME_INSTANCE.state,
            time: window.__rocketDuelRun.state.time,
            shots: window.__rocketDuelRun.state.shots.length,
            alive: window.GAME_INSTANCE.entityManager.players.slice(0, 2).map((player) => player.alive),
        }));
        console.log(`[rocket-duel] preroll ${JSON.stringify(state)}`);
        if (state.gameState !== 'PLAYING') throw new Error('Match ended during preroll');
    }
    await page.waitForFunction(() => window.GAME_INSTANCE.entityManager.players.slice(0, 2)
        .every((player) => player.alive), null, { timeout: 20000 });
    await page.evaluate(() => window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().pauseMatch());
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PAUSED');
    const preroll = await page.evaluate(() => ({
        seconds: window.__rocketDuelRun.state.time,
        shots: window.__rocketDuelRun.state.shots.filter((shot) => shot.at < 120),
        pickups: window.__rocketDuelRun.state.pickups.filter((pickup) => pickup.at < 120),
        rocketFires: window.__rocketDuelRun.state.events.filter((event) => event.at < 120
            && event.type === 'ITEM_USE' && event.player < 2
            && event.data.includes('mode=shoot type=ROCKET') && event.data.includes('ok=1')),
    }));
    if (preroll.seconds < ROCKET_DUEL.prerollSeconds || preroll.rocketFires.length < 4) {
        throw new Error(`Preroll did not establish rocket play: ${JSON.stringify(preroll)}`);
    }
    if (!probe) {
        const start = await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const recorder = game.mediaRecorderSystem;
            recorder.setRecordingCaptureSettings(game.settings.recording);
            return recorder.startRecording({ type: 'recording_requested',
                context: { source: 'marketing-rocket-duel' } });
        });
        if (!start.started) throw new Error(`Cinematic replay did not start: ${JSON.stringify(start)}`);
    }
    const clipStartTime = await page.evaluate(() => {
        window.__rocketDuelRecordingStart = performance.now();
        window.__rocketDuelClipStartTime = window.__rocketDuelRun.state.time;
        window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().resumeMatch();
        return window.__rocketDuelClipStartTime;
    });
    console.log(`[rocket-duel] clip starts after ${clipStartTime.toFixed(2)}s of gameplay`);
    for (const checkpoint of [10, 20, 30, ROCKET_DUEL.durationSeconds]) {
        await page.waitForFunction((target) => window.__rocketDuelRun.state.time
            - window.__rocketDuelClipStartTime >= target
            || window.GAME_INSTANCE.state !== 'PLAYING', checkpoint, { timeout: 90000 });
        const state = await page.evaluate(() => ({ gameState: window.GAME_INSTANCE.state,
            time: window.__rocketDuelRun.state.time,
            shots: window.__rocketDuelRun.state.shots.length }));
        console.log(`[rocket-duel] clip ${JSON.stringify(state)}`);
        if (state.gameState !== 'PLAYING') throw new Error('Match ended during clip');
        if (probe) await page.screenshot({ path: path.join(output, `probe-${checkpoint}.png`) });
    }
    const evidence = await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        return {
            ...window.__rocketDuelRun.state,
            players: game.entityManager.players.map((player) => ({ index: player.index,
                bot: player.isBot, alive: player.alive, hp: player.hp, score: player.score })),
            clipStartTime: window.__rocketDuelClipStartTime,
            clipWallSeconds: (performance.now() - window.__rocketDuelRecordingStart) / 1000,
        };
    });
    await writeFile(path.join(output, 'evidence.json'), `${JSON.stringify({
        buildCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
        map: 'rift_bazaar', mode: 'HUNT', players: 2, bots: 3,
        playerControl: 'scripted-input', itemPlacement: 'scripted-spawn',
        prerollSeconds: preroll.seconds, ...evidence,
    }, null, 2)}\n`);
    if (probe) {
        console.log(`[rocket-duel] Probe: ${output}`);
    } else {
        const stop = await page.evaluate(() => window.GAME_INSTANCE.mediaRecorderSystem.stopRecording());
        if (!stop.recordingId) throw new Error(`Replay not queued: ${JSON.stringify(stop)}`);
        const clipFires = evidence.events.filter((event) => event.at >= evidence.clipStartTime
            && event.type === 'ITEM_USE' && event.player < 2
            && event.data.includes('mode=shoot type=ROCKET') && event.data.includes('ok=1'));
        if (![0, 1].every((player) => clipFires.some((event) => event.player === player))) {
            throw new Error(`Both pilots need a real rocket shot in the clip: ${JSON.stringify(clipFires)}`);
        }
        await page.evaluate(() => window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().pauseMatch());
        await page.evaluate((cameraScale) => {
            const game = window.GAME_INSTANCE;
            const exporter = game.mediaRecorderSystem._cinematicReplayExporter;
            const original = exporter.renderFrame;
            const director = window.__rocketDuel.createRocketDuelCamera(game.renderer.cameras[0]);
            const recorded = [null, null];
            const onStatus = exporter.onStatus;
            let lastProgress = -1;
            exporter.onStatus = (status) => {
                onStatus?.(status);
                const progress = Math.floor(Number(status.progress || 0) * 10);
                if (status.phase === 'rendering' && progress !== lastProgress) {
                    lastProgress = progress;
                    console.info(`[rocket-duel] export ${progress * 10}%`);
                }
            };
            exporter.renderFrame = async (frame) => {
                if (frame.projection) {
                    for (const playerIndex of [0, 1]) {
                        recorded[playerIndex] = window.__rocketDuel.sampleRocketDuelRecordedCamera(
                            frame.leftSnapshot, frame.rightSnapshot, frame.alpha, playerIndex,
                            recorded[playerIndex]);
                    }
                    frame.projection.recordedCamera = director.sample(frame.projection, recorded,
                        frame.timeMs / 1000 * cameraScale);
                }
                return original(frame);
            };
        }, ROCKET_DUEL.durationSeconds / evidence.clipWallSeconds);
        console.log('[rocket-duel] Rendering cinematic replay');
        const rendered = await page.evaluate((id) => window.GAME_INSTANCE.mediaRecorderSystem
            .renderCinematicReplayRecording(id), stop.recordingId);
        if (!rendered.saved) throw new Error(`Replay export failed: ${JSON.stringify(rendered)}`);
        console.log(`[rocket-duel] Saved ${rendered.filePath}`);
    }
} finally {
    await app?.close();
    lock.release();
}
