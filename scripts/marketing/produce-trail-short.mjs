/* global document, window, navigator, performance, MediaRecorder, FileReader, Blob */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { _electron as electron } from '@playwright/test';
import { acquirePlaywrightRunLock, releasePlaywrightRunLockOnExit } from '../playwright-run-lock.mjs';
import { waitForLoadedGame } from '../../tests/helpers.js';
import { TRAIL_SHORT } from './trail-short-scene.mjs';

const root = process.cwd();
const outputRoot = path.resolve(process.argv[2] || path.join(root, 'output', 'marketing'));
const probe = process.argv.includes('--probe');
const variant = process.argv.includes('--ghost') ? 'ghost' : 'thick';
const formats = process.argv.includes('--landscape') ? ['landscape']
    : process.argv.includes('--portrait') ? ['portrait'] : ['landscape', 'portrait'];
const output = path.join(outputRoot, `${variant === 'ghost' ? 'ghost-short' : 'trail-short'}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const requireElectron = createRequire(path.join(root, 'electron', 'package.json'));
const lock = await acquirePlaywrightRunLock({ label: 'trail short production' });
releasePlaywrightRunLockOnExit(lock.release);
let app;

async function beginWindowRecording(page, format) {
    const size = format === 'portrait' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
    await app.evaluate(({ BrowserWindow, dialog }, filename) => {
        const win = BrowserWindow.getAllWindows()[0];
        win.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
            if (request.frame !== win.webContents.mainFrame) { callback({}); return; }
            callback({ video: win.webContents.mainFrame, audio: win.webContents.mainFrame, enableLocalEcho: true });
        });
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
    }, path.join(output, `${format}-cinematic.mp4`));
    // The only capture source granted above is this isolated game's renderer, including its DOM HUD.
    await page.locator('#game-canvas').click({ force: true });
    return page.evaluate(async (dimensions) => {
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: { ...dimensions, frameRate: 60 }, audio: true,
        });
        const videoTrack = stream.getVideoTracks()[0];
        await videoTrack.applyConstraints({ width: { exact: dimensions.width }, height: { exact: dimensions.height },
            frameRate: { ideal: 60, max: 60 } });
        const preview = document.createElement('video');
        preview.muted = true;
        preview.srcObject = stream;
        await preview.play();
        await new Promise((resolve) => preview.requestVideoFrameCallback(resolve));
        if (preview.videoWidth !== dimensions.width || preview.videoHeight !== dimensions.height) {
            for (const track of stream.getTracks()) track.stop();
            throw new Error(`Capture size mismatch: ${preview.videoWidth}x${preview.videoHeight}`);
        }
        preview.pause();
        preview.srcObject = null;
        if (stream.getAudioTracks().length === 0) throw new Error('Window recording has no game audio');
        const mimeType = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus']
            .find((type) => MediaRecorder.isTypeSupported(type));
        if (!mimeType) throw new Error('No supported gameplay recording codec');
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 18_000_000 });
        const capture = { recorder, stream, chunks: [], startedAt: 0, error: null };
        recorder.addEventListener('dataavailable', ({ data }) => { if (data.size) capture.chunks.push(data); });
        recorder.addEventListener('error', (event) => { capture.error = String(event.error || 'recording_error'); });
        await new Promise((resolve, reject) => {
            recorder.addEventListener('start', () => { capture.startedAt = performance.now(); resolve(); }, { once: true });
            recorder.addEventListener('error', reject, { once: true });
            recorder.start(1000);
        });
        window.__trailShortCapture = capture;
        return stream.getVideoTracks()[0].getSettings();
    }, size);
}

async function finishWindowRecording(page, filename) {
    const base64 = await page.evaluate(async () => {
        const capture = window.__trailShortCapture;
        if (!capture) throw new Error('No window recording');
        try {
            await new Promise((resolve, reject) => {
                capture.recorder.addEventListener('stop', resolve, { once: true });
                capture.recorder.addEventListener('error', reject, { once: true });
                capture.recorder.stop();
            });
            if (capture.error) throw new Error(capture.error);
            const blob = new Blob(capture.chunks, { type: capture.recorder.mimeType });
            if (!blob.size) throw new Error('Empty gameplay recording');
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(';base64,')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } finally {
            for (const track of capture.stream.getTracks()) track.stop();
        }
    });
    await writeFile(filename, Buffer.from(base64, 'base64'), { flag: 'wx' });
}

try {
    await mkdir(output, { recursive: true });
    const bundle = await build({ entryPoints: [path.join(root, 'scripts/marketing/trail-short-scene.mjs')],
        bundle: true, write: false, format: 'iife', globalName: '__trailShort', platform: 'browser' });
    const manifest = { orientations: {} };
    for (const format of formats) {
      app = await electron.launch({
        executablePath: requireElectron('electron'), args: ['--force-device-scale-factor=1', '.'], cwd: path.join(root, 'electron'),
        env: { ...process.env, CURVIOS_ELECTRON_SHOW_WINDOW: '0', CURVIOS_ELECTRON_TEST_RENDER: '1',
            CURVIOS_USER_DATA_ROOT: path.join(output, `${format}-user-data`),
            CURVIOS_E2E_RENDERER: '1' },
    });
    const page = await app.firstWindow();
    console.log(`[trail-short] ${format} window ready`);
    await page.setViewportSize(format === 'portrait' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });
    page.on('pageerror', (error) => console.error(`[trail-short] ${error.message}`));
    page.on('console', (message) => {
        if (message.text().startsWith('[trail-short]')) console.log(message.text());
    });
    await waitForLoadedGame(page);
    console.log(`[trail-short] ${format} game loaded`);
    const dimensions = format === 'portrait' ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
    // Apply after startup has restored the window; otherwise a late restore can resize the take.
    await page.setViewportSize(dimensions);
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
    }, dimensions);
    if (contentSize[0] !== dimensions.width || contentSize[1] !== dimensions.height) {
        throw new Error(`Desktop content size mismatch: ${contentSize.join('x')}`);
    }
    await page.waitForFunction((size) => window.innerWidth === size.width && window.innerHeight === size.height, dimensions);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    console.log(`[trail-short] ${format} flight controller loaded`);
    await page.addStyleTag({ content: `
        #hud, #crosshair-container { opacity: var(--trail-short-hud-opacity, 1) !important; }
        body[data-trail-short-player="0"] [id^="p2-"],
        body[data-trail-short-player="0"] #crosshair-p2,
        body[data-trail-short-player="1"] [id^="p1-"],
        body[data-trail-short-player="1"] #crosshair-p1 { display: none !important; }
    ` });
    await page.evaluate((orientation) => {
        const game = window.GAME_INSTANCE;
        Object.assign(game.settings, { mode: '2p', gameMode: 'CLASSIC', mapKey: 'standard', numBots: 0,
            winsNeeded: 9, portalsEnabled: false, autoRoll: false });
        Object.assign(game.settings.localSettings, { sessionType: 'splitscreen', modePath: 'normal' });
        Object.assign(game.settings.gameplay, { itemAmount: 0, speed: 30, turnSensitivity: 3, trailLength: 5000 });
        game.settings.cockpitCamera = { PLAYER_1: false, PLAYER_2: false };
        game.settings.cameraPerspective = { normal: 'classic', reduceMotion: true, speedFovEnabled: false };
        game.settings.recording = { profile: 'cinematic', hudMode: 'clean', exportPreset: 'youtube-mp4', orientation };
        // The licensed Classic track is mixed once during the final render.
        game.settings.audio = { ...game.settings.audio, enabled: true, musicVolume: 0 };
        game._applySettingsToRuntime({ schedulePrewarm: false });
        game.audio?.applySettings?.(game.settings.audio);
        game.startMatch();
    }, format);
    console.log(`[trail-short] ${format} match started`);
    await page.waitForFunction(() => window.GAME_INSTANCE?.entityManager?.players?.length === 2, null, { timeout: 60000 });
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING', null, { timeout: 30000 });
    await page.evaluate(() => window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().pauseMatch());
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PAUSED', null, { timeout: 5000 });
    await page.evaluate((selectedVariant) => {
        window.__trailShortRun = window.__trailShort.installTrailShortFlight(window.GAME_INSTANCE,
            { variant: selectedVariant });
        document.getElementById('p2-hud')?.classList.add('hidden');
        // The real HUD projects into the selected full-window viewport during this two-slot take.
        const viewport = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
        window.GAME_INSTANCE.crosshairSystem._resolveViewportRect = () => viewport;
    }, variant);
    console.log(`[trail-short] ${format} ${variant} flight installed`);
    if (!probe) {
        console.log(`[trail-short] ${format} window capture: ${JSON.stringify(await beginWindowRecording(page, format))}`);
        const start = await page.evaluate(async () => {
            const recorder = window.GAME_INSTANCE.mediaRecorderSystem;
            recorder.setRecordingCaptureSettings(window.GAME_INSTANCE.settings.recording);
            const result = await recorder.startRecording({ type: 'recording_requested', context: { source: 'trail-short' } });
            const replayRecorder = recorder._cinematicReplayRecorder;
            window.__trailShortRun.nativeStartedAt = performance.now() - (replayRecorder.now() - replayRecorder._startedAt);
            return result;
        });
        if (!start.started) throw new Error(`Replay did not start: ${JSON.stringify(start)}`);
    }
    await page.evaluate(() => window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().resumeMatch());
    await page.waitForFunction(() => window.GAME_INSTANCE.state === 'PLAYING');
    const sampleTimes = probe ? [4, 6, 9, 12, 14, 16, 17, 18, 19, 20, 21, 22.3] : [4, 8, 12, 16, 20, 22.3];
    for (let sample = 0; sample < sampleTimes.length; sample += 1) {
        await page.waitForFunction((target) => window.__trailShortRun.state.time >= target
            || window.GAME_INSTANCE.state !== 'PLAYING', sampleTimes[sample], { timeout: 60000 });
        const state = await page.evaluate(() => ({ state: window.GAME_INSTANCE.state, ...window.__trailShortRun.state }));
        console.log(JSON.stringify({ state: state.state, time: state.time, last: state.history.at(-1) }));
        if (probe) await page.screenshot({ path: path.join(output, `${format}-probe-${sample}.png`) });
        if (state.state !== 'PLAYING' || state.time >= TRAIL_SHORT.warmup + TRAIL_SHORT.duration + 0.3) break;
    }
    const state = await page.evaluate((selectedVariant) => ({ ...window.__trailShortRun.state,
        alive: window.GAME_INSTANCE.entityManager.players.every((player) => player.alive),
        itemActive: window.GAME_INSTANCE.entityManager.players[selectedVariant === 'ghost' ? 1 : 0].activeEffects
            .some((effect) => effect.type === (selectedVariant === 'ghost' ? 'GHOST' : 'THICK')),
        nativeStartedAt: window.__trailShortRun.nativeStartedAt,
        windowStartedAt: window.__trailShortCapture?.startedAt,
        events: window.GAME_INSTANCE.recorder.events.filter((entry) => entry.type).slice(-25) }), variant);
    await writeFile(path.join(output, `${format}-take.json`), `${JSON.stringify(state, null, 2)}\n`, { flag: 'wx' });
    if (!probe) {
        const stop = await page.evaluate(() => window.GAME_INSTANCE.mediaRecorderSystem.stopRecording());
        await finishWindowRecording(page, path.join(output, `${format}-gameplay.webm`));
        if (!state.alive || !state.finishedAt) throw new Error('Rehearsal failed: both pilots must survive the complete take');
        if (!state.itemCollected || !state.itemRequested || !state.itemActive) {
            throw new Error(`Take has no verified ${variant.toUpperCase()} pickup and use`);
        }
        if (variant === 'ghost' && (state.closestPass.distance > 1.2 || !state.ghostActiveAtCrossing)) {
            throw new Error(`Take has no verified GHOST trail crossing: ${JSON.stringify(state.closestPass)}`);
        }
        const elapsed = (state.finishedAt - state.clipStartedAt) / 1000;
        if (Math.abs(elapsed - TRAIL_SHORT.duration) > 0.08) {
            throw new Error(`Capture fell behind simulation: ${elapsed.toFixed(3)}s for the 16s clip`);
        }
        if (!stop.recordingId) throw new Error(`Replay not queued: ${JSON.stringify(stop)}`);
        await page.evaluate(() => window.GAME_INSTANCE.runtimeCoordinator.getRuntimeFacade().pauseMatch());
        const cinematicStart = (state.clipStartedAt - state.nativeStartedAt) / 1000;
        const gameplayStart = (state.clipStartedAt - state.windowStartedAt) / 1000;
        await page.evaluate(({ offset, portrait, selectedVariant }) => {
            const game = window.GAME_INSTANCE;
            const camera = window.__trailShort.createTrailShortCamera(game.renderer.cameras[0],
                { handoff: true, variant: selectedVariant });
            const exporter = game.mediaRecorderSystem._cinematicReplayExporter;
            const original = exporter.renderFrame;
            const onStatus = exporter.onStatus;
            let progress = -1;
            let lensVerified = false;
            exporter.onStatus = (status) => {
                onStatus?.(status);
                const next = Math.floor(Number(status.progress || 0) * 10);
                if (status.phase === 'rendering' && next !== progress) {
                    progress = next;
                    console.info(`[trail-short] Cinematic export ${next * 10}%`);
                }
            };
            exporter.renderFrame = async (frame) => {
                const clipTime = frame.timeMs / 1000 - offset;
                if (frame.projection) frame.projection.recordedCamera = camera.sample(frame.projection, clipTime, portrait);
                const canvas = await original(frame);
                if (!lensVerified && clipTime >= 3 && clipTime < 3.1) {
                    const renderedCamera = game.renderer.recordingCapturePipeline._cinematicCameraRig.cameras[0];
                    if (renderedCamera?.fov !== 75) throw new Error('Cinematic camera did not reach the 75-degree follow lens');
                    lensVerified = true;
                    console.info('[trail-short] Cinematic handoff camera verified: 75 degrees');
                }
                return canvas;
            };
        }, { offset: cinematicStart, portrait: format === 'portrait', selectedVariant: variant });
        console.log(`[trail-short] Rendering ${format} cinematic replay`);
        const rendered = await page.evaluate((id) => window.GAME_INSTANCE.mediaRecorderSystem.renderCinematicReplayRecording(id), stop.recordingId);
        if (!rendered.saved) throw new Error(`Replay export failed: ${JSON.stringify(rendered)}`);
        manifest.variant = variant;
        manifest.orientations[format] = { gameplay: `${format}-gameplay.webm`, cinematic: `${format}-cinematic.mp4`, gameplayStart, cinematicStart };
        await writeFile(path.join(output, 'take.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    await app.close();
    app = null;
    }
    console.log(`[trail-short] ${probe ? 'Probe' : 'Take'}: ${output}`);
} finally {
    await app?.close();
    lock.release();
}
