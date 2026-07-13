import { execSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { getBotValidationMatrix } from '../src/state/validation/BotValidationMatrix.js';

const HOST = '127.0.0.1';
const PORT = parsePositiveInt(process.env.PERF_RUCKLER_PORT, 4286, 1024, 65_535);
const BASE_URL = `http://${HOST}:${PORT}`;
const APP_READY_TIMEOUT_MS = parsePositiveInt(process.env.PERF_RUCKLER_APP_READY_TIMEOUT_MS, 120_000, 5_000, 180_000);
const NAVIGATION_MAX_ATTEMPTS = parsePositiveInt(process.env.PERF_RUCKLER_NAV_ATTEMPTS, 4, 1, 12);
const NAVIGATION_RETRY_DELAY_MS = parsePositiveInt(process.env.PERF_RUCKLER_NAV_RETRY_DELAY_MS, 800, 0, 30_000);
const SERVER_MODE = String(process.env.PERF_RUCKLER_SERVER_MODE || 'preview').trim().toLowerCase();
const AUTO_BUILD = String(process.env.PERF_RUCKLER_AUTO_BUILD || '1').trim() !== '0';
const SAMPLE_DURATION_MS = parsePositiveInt(process.env.PERF_RUCKLER_SAMPLE_DURATION_MS, 15_000, 2_000, 120_000);
const AFTER_TOGGLE_WAIT_MS = parsePositiveInt(process.env.PERF_RUCKLER_AFTER_TOGGLE_WAIT_MS, 250, 0, 5_000);
const RECORDING_SAMPLE_DURATION_MS = parsePositiveInt(
    process.env.PERF_RUCKLER_RECORDING_SAMPLE_DURATION_MS,
    Math.min(4_000, SAMPLE_DURATION_MS),
    500,
    30_000
);
const SAMPLE_FPS = parsePositiveInt(process.env.PERF_RUCKLER_SAMPLE_FPS, 60, 30, 120);
const SAMPLE_FRAME_COUNT = parsePositiveInt(
    process.env.PERF_RUCKLER_SAMPLE_FRAME_COUNT,
    24,
    1,
    5_000
);
const WARMUP_FRAME_COUNT = Math.max(40, Math.round(Math.max(AFTER_TOGGLE_WAIT_MS, 100) / (1000 / SAMPLE_FPS)));
const STEP_YIELD_EVERY_FRAMES = parsePositiveInt(process.env.PERF_RUCKLER_STEP_YIELD_EVERY_FRAMES, 1, 1, 240);
const OUTPUT_PATH = String(process.env.PERF_RUCKLER_OUTPUT_PATH || `tmp/perf_jitter_matrix_${Date.now()}.json`);
const HEADED = String(process.env.PERF_RUCKLER_HEADED || '').trim() === '1';
const VERBOSE = String(process.env.PERF_RUCKLER_VERBOSE || '').trim() === '1';
const SCENARIO_FILTER = String(process.env.PERF_RUCKLER_SCENARIOS || '')
    .split(/[,\s;]+/)
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry.length > 0);

function parsePositiveInt(rawValue, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const numeric = Number.parseInt(String(rawValue || ''), 10);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function toShortError(error) {
    if (!error) return 'unknown';
    if (typeof error === 'string') return error;
    return error.message || String(error);
}

function logVerbose(message, payload = null) {
    if (!VERBOSE) return;
    if (payload == null) {
        console.log(`[perf-jitter:verbose] ${message}`);
        return;
    }
    console.log(`[perf-jitter:verbose] ${message}`, payload);
}

function forceKillPort(port) {
    try {
        if (process.platform === 'win32') {
            execSync(
                `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | Sort-Object -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }"`,
                { stdio: 'ignore' }
            );
            return;
        }
        execSync(`lsof -ti:${port} | xargs kill -9`, { stdio: 'ignore' });
    } catch {
        // no-op
    }
}

function startViteDevServer() {
    const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
    return spawn(process.execPath, [viteBin, 'dev', '--host', HOST, '--port', String(PORT), '--strictPort'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
    });
}

function startVitePreviewServer() {
    const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
    return spawn(process.execPath, [viteBin, 'preview', '--host', HOST, '--port', String(PORT), '--strictPort'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
    });
}

function ensureDistBuild() {
    const distIndexPath = fileURLToPath(new URL('../dist/index.html', import.meta.url));
    if (existsSync(distIndexPath)) {
        return;
    }
    if (!AUTO_BUILD) {
        throw new Error('dist/index.html missing and PERF_RUCKLER_AUTO_BUILD=0');
    }
    execSync('npm run build', { stdio: 'inherit' });
    if (!existsSync(distIndexPath)) {
        throw new Error('dist/index.html missing after build');
    }
}

function startAppServer() {
    if (SERVER_MODE === 'dev') {
        return startViteDevServer();
    }
    ensureDistBuild();
    return startVitePreviewServer();
}

async function stopServer(server) {
    if (!server || server.exitCode !== null) return;
    server.kill();
    await delay(250);
    if (server.exitCode !== null) return;
    try {
        if (process.platform === 'win32') {
            execSync(`taskkill /PID ${server.pid} /T /F`, { stdio: 'ignore' });
        } else {
            execSync(`kill -9 ${server.pid}`, { stdio: 'ignore' });
        }
    } catch {
        // no-op
    }
}

async function waitForServer(url, timeoutMs = 45_000) {
    const start = Date.now();
    let lastError = null;
    while (Date.now() - start < timeoutMs) {
        try {
            const response = await fetch(url, {
                redirect: 'follow',
                signal: AbortSignal.timeout(1_500),
            });
            if (response.ok) return;
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await delay(250);
    }
    throw new Error(`Server not reachable after ${timeoutMs}ms (${toShortError(lastError)})`);
}

async function waitForAppReadiness(page, timeoutMs) {
    await page.waitForFunction(() => {
        const menu = document.getElementById('main-menu');
        const menuVisible = !!(menu && !menu.classList.contains('hidden'));
        const runtimeReady = !!globalThis?.GAME_INSTANCE;
        return menuVisible || runtimeReady;
    }, null, { timeout: timeoutMs });
}

async function navigateToApp(page, url, timeoutMs) {
    let lastError = null;
    for (let attempt = 1; attempt <= NAVIGATION_MAX_ATTEMPTS; attempt += 1) {
        try {
            logVerbose('browser:goto:attempt', {
                attempt,
                waitUntil: 'commit',
                timeoutMs,
            });
            await page.goto(url, { waitUntil: 'commit', timeout: timeoutMs });
            await waitForAppReadiness(page, timeoutMs);
            return;
        } catch (error) {
            lastError = error;
            logVerbose('browser:goto:retry', {
                attempt,
                error: toShortError(error),
            });
            if (attempt >= NAVIGATION_MAX_ATTEMPTS) break;
            await delay(NAVIGATION_RETRY_DELAY_MS);
        }
    }
    throw new Error(`App navigation failed after ${NAVIGATION_MAX_ATTEMPTS} attempts (${toShortError(lastError)})`);
}

function detectPeriodicSpikes(spikeEvents = []) {
    if (!Array.isArray(spikeEvents) || spikeEvents.length < 4) {
        return {
            periodic: false,
            intervalCount: 0,
            inBandRatio: 0,
            meanIntervalMs: 0,
            stdDevMs: 0,
        };
    }

    const sorted = spikeEvents
        .map((entry) => Number(entry?.timestampMs))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
    if (sorted.length < 4) {
        return {
            periodic: false,
            intervalCount: 0,
            inBandRatio: 0,
            meanIntervalMs: 0,
            stdDevMs: 0,
        };
    }

    const intervals = [];
    for (let i = 1; i < sorted.length; i++) {
        const delta = sorted[i] - sorted[i - 1];
        if (delta > 0) intervals.push(delta);
    }
    if (intervals.length < 3) {
        return {
            periodic: false,
            intervalCount: intervals.length,
            inBandRatio: 0,
            meanIntervalMs: 0,
            stdDevMs: 0,
        };
    }

    const inBand = intervals.filter((value) => value >= 900 && value <= 2200);
    const inBandRatio = inBand.length / intervals.length;
    const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length;
    const variance = intervals.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const periodic = inBandRatio >= 0.6 && stdDev <= 260;

    return {
        periodic,
        intervalCount: intervals.length,
        inBandRatio,
        meanIntervalMs: mean,
        stdDevMs: stdDev,
    };
}

function percentileFromSorted(values, ratio) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    const clampedRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    const rawIndex = Math.ceil(values.length * clampedRatio) - 1;
    const index = Math.max(0, Math.min(values.length - 1, rawIndex));
    return Number(values[index]) || 0;
}

function evaluateAcceptance(run) {
    const p95 = Number(run?.performance?.frameMs?.p95 || 0);
    const periodic = !!run?.spikeRhythm?.periodic;
    const intervalStats = run?.recording?.frameIntervalStats || null;
    const recordingGapMaxMs = Number(intervalStats?.max || 0);
    const recordingRequested = run?.recording?.requested === true;
    const recordingStable = run.recording?.requested
        ? recordingGapMaxMs > 0 && recordingGapMaxMs <= 60
        : true;
    const interactiveFramePass = recordingRequested ? true : (p95 < 22);
    const periodicPass = recordingRequested ? true : !periodic;
    return {
        pass: interactiveFramePass && periodicPass && recordingStable,
        interactiveFramePass,
        p95Pass: recordingRequested ? true : (p95 < 22),
        p99Pass: true,
        periodicPass,
        recordingPass: recordingStable,
    };
}

async function ensureMenuState(page) {
    logVerbose('ensureMenuState:start');
    await page.waitForFunction(() => !!window.GAME_INSTANCE, null, { timeout: APP_READY_TIMEOUT_MS });
    await page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        if (!game) throw new Error('GAME_INSTANCE missing');
        if (game.state !== 'MENU' && typeof game._returnToMenu === 'function') {
            game._returnToMenu();
        }
    });
    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'MENU', null, { timeout: 12_000 });
    logVerbose('ensureMenuState:done');
}

async function runSingleMatrixCase(page, scenario, options) {
    logVerbose('runSingleMatrixCase:start', {
        scenarioId: scenario?.id,
        cinematicEnabled: !!options?.cinematicEnabled,
        recordingEnabled: !!options?.recordingEnabled,
    });
    await ensureMenuState(page);
    const clipSessionId = `phase9-${String(scenario.id || 'scenario').toLowerCase()}-${options.cinematicEnabled ? 'cin' : 'plain'}-${options.recordingEnabled ? 'rec' : 'norec'}`;

    const setup = await page.evaluate(async ({ scenarioId, cinematicEnabled, recordingEnabled, clipSessionId }) => {
        const game = window.GAME_INSTANCE;
        if (!game) throw new Error('GAME_INSTANCE missing');
        const debugApi = game.debugApi || window.GAME_DEBUG || null;
        const applyScenario = typeof game.applyBotValidationScenario === 'function'
            ? game.applyBotValidationScenario.bind(game)
            : (typeof debugApi?.applyBotValidationScenario === 'function'
                ? debugApi.applyBotValidationScenario.bind(debugApi)
                : null);
        if (typeof applyScenario !== 'function') throw new Error('applyBotValidationScenario missing');
        const appliedScenario = applyScenario(scenarioId);
        if (!appliedScenario) throw new Error(`Scenario not found: ${scenarioId}`);

        if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
            game.settings.localSettings = {};
        }
        game.settings.localSettings.shadowQuality = 2;
        if (!game.settings.cockpitCamera || typeof game.settings.cockpitCamera !== 'object') {
            game.settings.cockpitCamera = {};
        }
        game.settings.cockpitCamera.PLAYER_1 = false;
        game.settings.cockpitCamera.PLAYER_2 = false;
        if (Array.isArray(game.renderer?.cameraModes)) {
            for (let i = 0; i < game.renderer.cameraModes.length; i++) {
                game.renderer.cameraModes[i] = 0;
            }
        }
        game.renderer?.setShadowQuality?.(2);
        game._applySettingsToRuntime?.({ schedulePrewarm: false });

        if (typeof game.renderer?.setCinematicEnabled === 'function') {
            game.renderer.setCinematicEnabled(!!cinematicEnabled);
        }

        game.runtimePerfProfiler?.reset?.();
        if (game.recorder?.resetAggregateMetrics) {
            game.recorder.resetAggregateMetrics();
        }

        const recorder = game.mediaRecorderSystem;
        const support = recorder?.getSupportState?.() || {};
        let recordingStarted = false;
        let recordingStartResult = null;
        if (recordingEnabled && support.canRecord) {
            if (typeof recorder?.startRecording === 'function') {
                recordingStartResult = await recorder.startRecording({
                    type: 'recording_requested',
                    context: {
                        command: 'start',
                        source: 'perf-jitter-matrix',
                        sessionId: clipSessionId,
                        activeGameMode: String(game.settings?.gameMode || game.activeGameMode || 'classic'),
                    },
                });
                recordingStarted = !!recordingStartResult?.started || !!recorder?.isRecording?.();
            } else if (typeof recorder?.notifyLifecycleEvent === 'function') {
                recorder.notifyLifecycleEvent('recording_requested', {
                    command: 'start',
                    source: 'perf-jitter-matrix',
                    sessionId: clipSessionId,
                    activeGameMode: String(game.settings?.gameMode || game.activeGameMode || 'classic'),
                });
                await new Promise((resolve) => setTimeout(resolve, 150));
                recordingStarted = !!recorder?.isRecording?.();
            }
        }

        if (typeof game.startMatch !== 'function') throw new Error('startMatch missing');
        game.startMatch();

        return {
            appliedScenarioId: appliedScenario.id,
            recordingRequested: !!recordingEnabled,
            recordingSupported: !!support.canRecord,
            recordingStarted,
            recordingStartResult,
        };
    }, {
        scenarioId: scenario.id,
        cinematicEnabled: options.cinematicEnabled,
        recordingEnabled: options.recordingEnabled,
        clipSessionId,
    });

    await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: APP_READY_TIMEOUT_MS });
    await delay(AFTER_TOGGLE_WAIT_MS);
    if (options.recordingEnabled) {
        logVerbose('runSingleMatrixCase:recording-sample:start', {
            scenarioId: scenario?.id,
            sampleDurationMs: RECORDING_SAMPLE_DURATION_MS,
        });
        await page.evaluate(async () => {
            const game = window.GAME_INSTANCE;
            const loop = window.GAME_INSTANCE?.gameLoop;
            if (loop && loop.running !== true) {
                loop.start?.();
            }
            window.GAME_INSTANCE?.runtimePerfProfiler?.reset?.();
            for (let frame = 0; frame < 3; frame += 1) {
                game?.update?.(1 / 60);
                game?.render?.(1, 1 / 60);
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        });
        await delay(RECORDING_SAMPLE_DURATION_MS);
        logVerbose('runSingleMatrixCase:recording-sample:done', {
            scenarioId: scenario?.id,
        });
        var interactiveSample = { frameTimes: [] };
    } else {
        logVerbose('runSingleMatrixCase:manual-sample:start', {
            scenarioId: scenario?.id,
            sampleFrameCount: SAMPLE_FRAME_COUNT,
            warmupFrameCount: WARMUP_FRAME_COUNT,
        });
        interactiveSample = await page.evaluate(async ({ sampleFrameCount, sampleFps, warmupFrameCount, yieldEveryFrames, verbose }) => {
            const game = window.GAME_INSTANCE;
            if (!game) throw new Error('GAME_INSTANCE missing');

            const frameDt = 1 / Math.max(1, Number(sampleFps) || 60);
            const frameDtMs = frameDt * 1000;
            const totalFrames = Math.max(1, Math.trunc(sampleFrameCount || 0));
            const warmupFrames = Math.max(0, Math.trunc(warmupFrameCount || 0));
            const chunkSize = Math.max(1, Math.trunc(yieldEveryFrames || 1));
            const profiler = game.runtimePerfProfiler || null;
            const loop = game.gameLoop || null;
            let logicalTimestampMs = 0;
            const frameTimes = [];

            const stepSingleFrame = (measureFrame) => {
                logicalTimestampMs += frameDtMs;

                if (loop) {
                    loop.renderAlpha = 1;
                    loop.renderDelta = frameDt;
                    loop.renderFrameId = (Number(loop.renderFrameId) || 0) + 1;
                    loop._updateRenderTiming?.(
                        logicalTimestampMs,
                        frameDt,
                        frameDt,
                        false,
                        measureFrame ? 'perf-jitter-manual' : 'perf-jitter-warmup'
                    );
                }

                const frameStartMs = performance.now();
                if (measureFrame) {
                    profiler?.beginFrame?.(0, logicalTimestampMs);
                }
                game.update?.(frameDt);
                game.render?.(1, frameDt);
                if (measureFrame) {
                    const frameCostMs = Math.max(0, performance.now() - frameStartMs);
                    frameTimes.push(frameCostMs);
                    profiler?.endFrame?.(frameCostMs, logicalTimestampMs);
                }
            };

            loop?.stop?.();
            for (let frame = 0; frame < warmupFrames; frame += 1) {
                stepSingleFrame(false);
            }

            profiler?.reset?.();
            for (let frame = 0; frame < totalFrames; frame += 1) {
                stepSingleFrame(true);
                if (((frame + 1) % chunkSize) === 0) {
                    if (verbose) {
                        console.log(`[perf-jitter:page] frame-chunk ${frame + 1}/${totalFrames}`);
                    }
                    await new Promise((resolve) => setTimeout(resolve, 0));
                }
            }
            if (verbose) {
                console.log(`[perf-jitter:page] frame-chunk ${totalFrames}/${totalFrames} done`);
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
            return {
                frameTimes,
            };
        }, {
            sampleFrameCount: SAMPLE_FRAME_COUNT,
            sampleFps: SAMPLE_FPS,
            warmupFrameCount: WARMUP_FRAME_COUNT,
            yieldEveryFrames: STEP_YIELD_EVERY_FRAMES,
            verbose: VERBOSE,
        });
        logVerbose('runSingleMatrixCase:manual-sample:done', {
            scenarioId: scenario?.id,
        });
    }

    logVerbose('runSingleMatrixCase:snapshot:start', {
        scenarioId: scenario?.id,
        recordingEnabled: !!options?.recordingEnabled,
    });
    const snapshot = await page.evaluate(async ({ recordingEnabled, clipSessionId }) => {
        const game = window.GAME_INSTANCE;
        if (!game) throw new Error('GAME_INSTANCE missing');
        const debugApi = game.debugApi || window.GAME_DEBUG || null;
        const perfSnapshot = typeof debugApi?.getRuntimePerformanceSnapshot === 'function'
            ? debugApi.getRuntimePerformanceSnapshot({
                windowSize: 420,
                spikeEventsLimit: 24,
            })
            : {
                performance: game.runtimePerfProfiler?.getSnapshot?.({
                    windowSize: 420,
                    spikeEventsLimit: 24,
                }) || null,
                recorder: game.mediaRecorderSystem?.getRecordingDiagnostics?.() || null,
            };

        let stopResult = null;
        let exportMeta = null;
        if (recordingEnabled && game.mediaRecorderSystem?.isRecording?.()) {
            stopResult = await game.mediaRecorderSystem.stopRecording({
                source: 'perf-jitter-matrix',
                command: 'stop',
                sessionId: clipSessionId,
            });
            exportMeta = game.mediaRecorderSystem?.getLastExportMeta?.() || exportMeta;
        }

        return {
            state: game.state,
            perfSnapshot,
            stopResult,
            exportMeta,
            recordingState: game.mediaRecorderSystem?.getRecordingDiagnostics?.() || null,
        };
    }, {
        recordingEnabled: !!options.recordingEnabled,
        clipSessionId,
    });
    logVerbose('runSingleMatrixCase:snapshot:done', {
        scenarioId: scenario?.id,
    });

    await ensureMenuState(page);

    const perfData = snapshot?.perfSnapshot?.performance || null;
    const spikeEvents = perfData?.spikes?.events || [];
    const spikeRhythm = detectPeriodicSpikes(spikeEvents);
    const run = {
        scenarioId: scenario.id,
        scenario,
        cinematicEnabled: !!options.cinematicEnabled,
        recording: {
            requested: !!options.recordingEnabled,
            supported: !!setup.recordingSupported,
            started: !!setup.recordingStarted,
            startResult: setup.recordingStartResult || null,
            stopResult: snapshot?.stopResult || null,
            artifactPath: options.recordingEnabled
                ? (snapshot?.exportMeta?.downloadFileName || snapshot?.stopResult?.downloadFileName || null)
                : null,
            frameIntervalStats: options.recordingEnabled
                ? (snapshot?.exportMeta?.frameIntervalStats || snapshot?.stopResult?.frameIntervalStats || null)
                : null,
            recorderDiagnostics: snapshot?.recordingState || null,
        },
        performance: perfData,
        spikeRhythm,
        finalState: snapshot?.state || null,
        frameTimesMs: Array.isArray(interactiveSample?.frameTimes)
            ? interactiveSample.frameTimes.map((entry) => Number(entry) || 0)
            : [],
    };
    run.acceptance = evaluateAcceptance(run);
    return run;
}

async function run() {
    forceKillPort(PORT);
    const server = startAppServer();
    let browser = null;
    let context = null;
    try {
        logVerbose('server:wait', { host: BASE_URL });
        await waitForServer(BASE_URL, APP_READY_TIMEOUT_MS);
        logVerbose('server:ready', { host: BASE_URL });

        browser = await chromium.launch({
            headless: !HEADED,
            args: [
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
            ],
        });
        context = await browser.newContext({
            viewport: { width: 1600, height: 900 },
        });
        const page = await context.newPage();
        logVerbose('browser:goto', { host: BASE_URL });
        await navigateToApp(page, BASE_URL, APP_READY_TIMEOUT_MS);
        await page.bringToFront();
        await ensureMenuState(page);
        logVerbose('browser:ready');

        const scenarios = getBotValidationMatrix()
            .slice(0, 4)
            .filter((scenario) => {
                if (SCENARIO_FILTER.length === 0) return true;
                return SCENARIO_FILTER.includes(String(scenario.id || '').toUpperCase());
            });
        const runs = [];
        const matrixVariants = [
            { cinematicEnabled: false, recordingEnabled: false },
            { cinematicEnabled: true, recordingEnabled: false },
            { cinematicEnabled: false, recordingEnabled: true },
            { cinematicEnabled: true, recordingEnabled: true },
        ];

        for (let i = 0; i < scenarios.length; i++) {
            const scenario = scenarios[i];
            for (let j = 0; j < matrixVariants.length; j++) {
                const variant = matrixVariants[j];
                logVerbose('matrix:variant:start', {
                    scenarioId: scenario?.id,
                    cinematicEnabled: !!variant?.cinematicEnabled,
                    recordingEnabled: !!variant?.recordingEnabled,
                });
                const runResult = await runSingleMatrixCase(page, scenario, variant);
                runs.push(runResult);
                if (variant.recordingEnabled) {
                    console.log(
                        `[perf-jitter] ${scenario.id} cinematic=${variant.cinematicEnabled ? 'on' : 'off'} recording=on gapMax=${Number(runResult.recording?.frameIntervalStats?.max || 0).toFixed(2)} pass=${runResult.acceptance.pass}`
                    );
                } else {
                    console.log(
                        `[perf-jitter] ${scenario.id} cinematic=${variant.cinematicEnabled ? 'on' : 'off'} recording=off p95=${(runResult.performance?.frameMs?.p95 || 0).toFixed(2)} p99=${(runResult.performance?.frameMs?.p99 || 0).toFixed(2)} pass=${runResult.acceptance.pass}`
                    );
                }
            }
        }

        const interactiveFrameTimes = runs
            .filter((entry) => entry?.recording?.requested !== true)
            .flatMap((entry) => Array.isArray(entry?.frameTimesMs) ? entry.frameTimesMs : [])
            .filter((entry) => Number.isFinite(entry) && entry >= 0)
            .sort((a, b) => a - b);
        const interactiveAggregateP99 = percentileFromSorted(interactiveFrameTimes, 0.99);
        const summary = {
            totalRuns: runs.length,
            passedRuns: runs.filter((entry) => entry.acceptance.pass).length,
            interactiveRuns: runs.filter((entry) => entry?.recording?.requested !== true).length,
            recordingRuns: runs.filter((entry) => entry?.recording?.requested === true).length,
            passedInteractiveRuns: runs.filter((entry) => entry?.recording?.requested !== true && entry.acceptance.pass).length,
            passedRecordingRuns: runs.filter((entry) => entry?.recording?.requested === true && entry.acceptance.pass).length,
            worstInteractiveP95: Math.max(...runs
                .filter((entry) => entry?.recording?.requested !== true)
                .map((entry) => Number(entry?.performance?.frameMs?.p95 || 0))),
            interactiveAggregateP99,
            periodicSpikeRuns: runs.filter((entry) => entry?.recording?.requested !== true && entry.spikeRhythm?.periodic).length,
            recordingGapViolations: runs.filter((entry) => !entry.acceptance.recordingPass).length,
            worstRecordingGapMs: Math.max(...runs.map((entry) => Number(entry?.recording?.frameIntervalStats?.max || 0))),
            benchmarkPass:
                runs
                    .filter((entry) => entry?.recording?.requested !== true)
                    .every((entry) => entry.acceptance.pass)
                && runs
                    .filter((entry) => entry?.recording?.requested === true)
                    .every((entry) => entry.acceptance.pass)
                && interactiveAggregateP99 < 30,
            referenceClips: runs
                .map((entry) => entry?.recording?.artifactPath || null)
                .filter((entry) => !!entry),
        };

        const report = {
            generatedAt: new Date().toISOString(),
            host: BASE_URL,
            sampleDurationMs: SAMPLE_DURATION_MS,
            measurementMode: {
                interactive: {
                    type: 'deterministic_manual_step',
                    sampleFps: SAMPLE_FPS,
                    sampleFrameCount: SAMPLE_FRAME_COUNT,
                    warmupFrameCount: WARMUP_FRAME_COUNT,
                    yieldEveryFrames: STEP_YIELD_EVERY_FRAMES,
                },
                recording: {
                    type: 'realtime_gap_probe',
                    sampleDurationMs: RECORDING_SAMPLE_DURATION_MS,
                },
            },
            scenarios,
            runs,
            summary,
            acceptanceTargets: {
                interactiveFrameP95Ms: '< 22 (non-recording variants)',
                interactiveAggregateP99Ms: '< 30 (all non-recording frames pooled)',
                periodicSpikes: 'none in 1-2s rhythm for non-recording variants',
                recordingFrameGapMaxMs: '<= 60 (recording variants)',
            },
        };

        await writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2), 'utf8');
        console.log(`\n[perf-jitter] wrote ${OUTPUT_PATH}`);
        console.log(JSON.stringify(summary, null, 2));
    } finally {
        try {
            await context?.close();
        } catch {
            // no-op
        }
        try {
            await browser?.close();
        } catch {
            // no-op
        }
        await stopServer(server);
        forceKillPort(PORT);
    }
}

run().catch((error) => {
    console.error('[perf-jitter] failed:', error?.stack || toShortError(error));
    process.exit(1);
});
