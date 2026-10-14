/* global document, window, HTMLCanvasElement, MediaRecorder, FileReader, KeyboardEvent */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { _electron as electron } from '@playwright/test';
import { acquirePlaywrightRunLock, releasePlaywrightRunLockOnExit } from '../playwright-run-lock.mjs';
import {
    openGameSubmenu,
    openCustomSubmenu,
    returnToMenu,
    waitForLoadedGame,
} from '../../tests/helpers.js';

const root = process.cwd();
const outputRoot = path.resolve(process.argv[2] || path.join(root, 'output', 'marketing'));
const captureDir = path.join(outputRoot, `capture-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const requireElectron = createRequire(path.join(root, 'electron', 'package.json'));
const electronExecutable = requireElectron('electron');
const sceneDurationMs = Math.max(3000, Math.min(20000, Number(process.env.CURVIOS_MARKETING_SCENE_MS) || 5000));
const selectedScene = String(process.argv[3] || 'all');
if (!['all', 'classic', 'fight', 'arcade'].includes(selectedScene)) {
    throw new Error('Scene must be all, classic, fight, or arcade');
}

async function beginCanvasRecording(page) {
    return page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        if (!(canvas instanceof HTMLCanvasElement) || typeof canvas.captureStream !== 'function') {
            throw new Error('Game canvas recording is unavailable');
        }
        const mimeType = [
            'video/webm;codecs=vp8',
            'video/webm;codecs=vp9',
            'video/webm',
        ].find((candidate) => MediaRecorder.isTypeSupported(candidate));
        if (!mimeType) throw new Error('No WebM MediaRecorder codec is available');
        const stream = canvas.captureStream(30);
        const chunks = [];
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 5_000_000 });
        recorder.addEventListener('dataavailable', (event) => {
            if (event.data?.size > 0) chunks.push(event.data);
        });
        recorder.start(1000);
        globalThis.__marketingCanvasCapture = { recorder, stream, chunks, mimeType };
        return { mimeType, width: canvas.width, height: canvas.height };
    });
}

async function finishCanvasRecording(page) {
    return page.evaluate(async () => {
        const capture = globalThis.__marketingCanvasCapture;
        if (!capture) throw new Error('No marketing capture is running');
        const { recorder, stream, chunks, mimeType } = capture;
        try {
            await new Promise((resolve, reject) => {
                recorder.addEventListener('stop', resolve, { once: true });
                recorder.addEventListener('error', reject, { once: true });
                recorder.stop();
            });
            const blob = new Blob(chunks, { type: mimeType });
            if (blob.size === 0) throw new Error('Marketing capture is empty');
            return await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result).split(',')[1]);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });
        } finally {
            for (const track of stream.getTracks()) track.stop();
            delete globalThis.__marketingCanvasCapture;
        }
    });
}

async function recordScene(page, id) {
    // The trail is the visual hook: lay down curves before the recorded take.
    await selectKeyboardInput(page);
    await showTrailsFromAbove(page);
    await weave(page, 2200);
    const details = await beginCanvasRecording(page);
    await weave(page, sceneDurationMs);
    const encoded = await finishCanvasRecording(page);
    await writeFile(path.join(captureDir, `${id}.webm`), Buffer.from(encoded, 'base64'));
    console.log(`[marketing:capture] ${id}: ${details.width}x${details.height}, ${details.mimeType}`);
}

async function selectKeyboardInput(page) {
    await page.evaluate(() => {
        const input = globalThis.GAME_INSTANCE?.input;
        if (!input?.setPlayerSource) throw new Error('Keyboard input is unavailable');
        input.setPlayerSource(0, {
            type: 'keyboard',
            playerIndex: -1,
            active: false,
            bind(index) { this.playerIndex = index; this.active = true; },
            unbind() { this.playerIndex = -1; this.active = false; },
            dispose() { this.unbind(); },
            poll() { return input.getKeyboardInput(0, { includeSecondaryBindings: true }); },
        });
    });
}

async function showTrailsFromAbove(page) {
    await page.locator('#game-canvas').focus();
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const cameraIndex = await page.evaluate(() => globalThis.GAME_INSTANCE?.entityManager?.renderer?.cameraModes?.[0]);
        if (cameraIndex === 2) return;
        await page.evaluate(() => globalThis.GAME_INSTANCE?.entityManager?.renderer?.cycleCamera?.(0));
        await page.waitForTimeout(120);
    }
    throw new Error('Could not select the top-down trail camera');
}

async function weave(page, durationMs) {
    const end = Date.now() + durationMs;
    for (let turn = 0; Date.now() < end; turn += 1) {
        const code = turn % 2 === 0 ? 'KeyA' : 'KeyD';
        await page.evaluate((keyCode) => {
            window.dispatchEvent(new KeyboardEvent('keydown', { code: keyCode, bubbles: true }));
        }, code);
        try {
            await page.waitForTimeout(Math.min(700, Math.max(0, end - Date.now())));
        } finally {
            await page.evaluate((keyCode) => {
                window.dispatchEvent(new KeyboardEvent('keyup', { code: keyCode, bubbles: true }));
            }, code);
        }
        if (Date.now() < end) await page.waitForTimeout(Math.min(180, end - Date.now()));
    }
}

async function selectMapAndBots(page, mapKey, bots) {
    await page.locator('#map-select').selectOption(mapKey, { force: true });
    await page.evaluate((count) => {
        const slider = document.getElementById('bot-count');
        slider.value = String(count);
        slider.dispatchEvent(new Event('input', { bubbles: true }));
    }, bots);
}

async function startClassic(page) {
    await waitForLoadedGame(page);
    await openGameSubmenu(page);
    await selectMapAndBots(page, 'standard', 3);
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction(() => globalThis.GAME_INSTANCE?.entityManager?.players?.length > 0,
        null, { timeout: 60000 });
}

async function startFight(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="fight"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await selectMapAndBots(page, 'rift_bazaar', 3);
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction(() => globalThis.GAME_INSTANCE?.entityManager?.gameModeStrategy?.modeType === 'HUNT',
        null, { timeout: 60000 });
}

async function startArcade(page) {
    await waitForLoadedGame(page);
    await openCustomSubmenu(page);
    await page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click({ force: true });
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: 5000 });
    await page.locator('#submenu-game:not(.hidden) #btn-start').click({ force: true });
    await page.waitForFunction(() => (
        globalThis.GAME_INSTANCE?.entityManager?.gameModeStrategy?.modeType === 'ARCADE'
    ), null, { timeout: 20000 }).catch(async (error) => {
        const state = await page.evaluate(() => ({
            gameState: globalThis.GAME_INSTANCE?.state,
            modeType: globalThis.GAME_INSTANCE?.entityManager?.gameModeStrategy?.modeType,
            runType: globalThis.GAME_INSTANCE?.runtimeConfig?.arcade?.runType,
            menuPanel: document.querySelector('.submenu-panel:not(.hidden)')?.id,
            status: document.getElementById('status-toast')?.textContent,
        }));
        throw new Error(`Arcade did not start: ${JSON.stringify(state)}; ${error.message}`);
    });
}

const lock = await acquirePlaywrightRunLock({ label: 'marketing capture' });
releasePlaywrightRunLockOnExit(lock.release);
let app;
try {
    await mkdir(outputRoot, { recursive: true });
    await mkdir(captureDir);
    app = await electron.launch({
        executablePath: electronExecutable,
        args: ['.'],
        cwd: path.join(root, 'electron'),
        env: {
            ...process.env,
            CURVIOS_ELECTRON_SHOW_WINDOW: '0',
            CURVIOS_ELECTRON_TEST_RENDER: '1',
            CURVIOS_USER_DATA_ROOT: path.join(captureDir, 'user-data'),
        },
    });
    const page = await app.firstWindow();
    app.process()?.stderr?.on('data', (chunk) => process.stderr.write(chunk));
    page.on('pageerror', (error) => console.error(`[marketing:capture] page error: ${error.message}`));
    await page.setViewportSize({ width: 1280, height: 720 });
    if (selectedScene === 'all' || selectedScene === 'classic') {
        await startClassic(page);
        await recordScene(page, 'classic');
        if (selectedScene === 'all') await returnToMenu(page);
    }
    if (selectedScene === 'all' || selectedScene === 'fight') {
        await startFight(page);
        await recordScene(page, 'fight');
        if (selectedScene === 'all') await returnToMenu(page);
    }
    if (selectedScene === 'all' || selectedScene === 'arcade') {
        await startArcade(page);
        await recordScene(page, 'arcade');
    }
    await writeFile(path.join(captureDir, 'capture.json'), `${JSON.stringify({
        source: 'real desktop gameplay',
        capturedAt: new Date().toISOString(),
        scenes: selectedScene === 'all' ? ['classic', 'fight', 'arcade'] : [selectedScene],
        durationMsPerScene: sceneDurationMs,
        note: 'Gameplay video only; use the in-game Cinematic Replay export for final 60 fps footage with audio.',
    }, null, 2)}\n`);
    console.log(`[marketing:capture] Saved to ${captureDir}`);
} finally {
    await app?.close();
    lock.release();
}
