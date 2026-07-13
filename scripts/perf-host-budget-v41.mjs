import { execSync, spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const HOST = 'localhost';
const PORT = parseIntEnv('V41_HOST_BUDGET_PORT', 4294, 1024, 65535);
const BASE_URL = `http://${HOST}:${PORT}`;

const APP_READY_TIMEOUT_MS = parseIntEnv('V41_HOST_BUDGET_APP_READY_TIMEOUT_MS', 600_000, 5_000, 900_000);
const SAMPLE_FRAME_COUNT = parseIntEnv('V41_HOST_BUDGET_SAMPLE_FRAMES', 540, 60, 10_000);
const WARMUP_FRAME_COUNT = parseIntEnv('V41_HOST_BUDGET_WARMUP_FRAMES', 180, 0, 10_000);
const YIELD_EVERY_FRAMES = parseIntEnv('V41_HOST_BUDGET_YIELD_EVERY_FRAMES', 6, 1, 240);
const TARGET_PLAYERS = parseIntEnv('V41_HOST_BUDGET_TARGET_PLAYERS', 10, 2, 32);
const BOT_COUNT = parseIntEnv('V41_HOST_BUDGET_BOT_COUNT', Math.max(0, TARGET_PLAYERS - 1), 0, 64);
const MAP_KEY = String(process.env.V41_HOST_BUDGET_MAP_KEY || 'showcase_nexus').trim() || 'showcase_nexus';
const FRAME_P95_MAX_MS = parseFloatEnv('V41_HOST_BUDGET_FRAME_P95_MAX_MS', 30, 5, 120);
const FRAME_AVG_MAX_MS = parseFloatEnv('V41_HOST_BUDGET_FRAME_AVG_MAX_MS', 24, 5, 120);
const SPIKE_THRESHOLD_MS = parseFloatEnv('V41_HOST_BUDGET_SPIKE_THRESHOLD_MS', 120, 20, 500);
const SPIKE_RATE_MAX = parseFloatEnv('V41_HOST_BUDGET_SPIKE_RATE_MAX', 0.02, 0, 1);
const OUTPUT_PATH = String(process.env.V41_HOST_BUDGET_OUTPUT || 'tmp/perf-host-budget-report-v41.json');
const HEADED = String(process.env.V41_HOST_BUDGET_HEADED || '').trim() === '1';

function parseIntEnv(name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const numeric = Number.parseInt(String(process.env[name] || ''), 10);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function parseFloatEnv(name, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
    const numeric = Number.parseFloat(String(process.env[name] || ''));
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function toShortError(error) {
    if (!error) return 'unknown';
    if (typeof error === 'string') return error;
    return error.message || String(error);
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

function startViteServer() {
    const viteBin = fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url));
    return spawn(process.execPath, [viteBin, 'dev', '--host', HOST, '--port', String(PORT), '--strictPort'], {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
        windowsHide: true,
    });
}

async function waitForServer(url, timeoutMs = 45_000) {
    const start = Date.now();
    let lastError = null;
    while ((Date.now() - start) < timeoutMs) {
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

function percentileFromSorted(values, ratio) {
    if (!Array.isArray(values) || values.length === 0) return 0;
    const clampedRatio = Math.max(0, Math.min(1, Number(ratio) || 0));
    const rawIndex = Math.ceil(values.length * clampedRatio) - 1;
    const index = Math.max(0, Math.min(values.length - 1, rawIndex));
    return Number(values[index]) || 0;
}

function summarizeDurations(values = []) {
    const filtered = values
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry) && entry >= 0)
        .sort((left, right) => left - right);
    if (filtered.length === 0) {
        return {
            count: 0,
            min: 0,
            max: 0,
            avg: 0,
            p50: 0,
            p95: 0,
            p99: 0,
        };
    }
    const sum = filtered.reduce((acc, value) => acc + value, 0);
    return {
        count: filtered.length,
        min: filtered[0],
        max: filtered[filtered.length - 1],
        avg: sum / filtered.length,
        p50: percentileFromSorted(filtered, 0.5),
        p95: percentileFromSorted(filtered, 0.95),
        p99: percentileFromSorted(filtered, 0.99),
    };
}

function computeSpikeStats(values = [], thresholdMs = 120) {
    const filtered = values
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry) && entry >= 0);
    if (filtered.length === 0) {
        return {
            thresholdMs,
            count: 0,
            rate: 0,
        };
    }
    const spikeCount = filtered.reduce((acc, value) => acc + (value > thresholdMs ? 1 : 0), 0);
    return {
        thresholdMs,
        count: spikeCount,
        rate: spikeCount / filtered.length,
    };
}

async function prepareRun(page) {
    await page.goto(BASE_URL, { waitUntil: 'commit', timeout: APP_READY_TIMEOUT_MS });
    await page.waitForFunction(() => !!window.GAME_INSTANCE, null, { timeout: APP_READY_TIMEOUT_MS });
    await page.waitForSelector('#main-menu', { state: 'visible', timeout: APP_READY_TIMEOUT_MS });

    await page.click('#menu-nav [data-session-type="splitscreen"]', { force: true });
    await page.waitForSelector('#submenu-custom:not(.hidden)', { timeout: APP_READY_TIMEOUT_MS });
    const modePathButton = page.locator('#submenu-custom:not(.hidden) [data-mode-path="normal"]').first();
    if (await modePathButton.count()) {
        await modePathButton.click({ force: true });
    } else {
        await page.click('#submenu-custom:not(.hidden) [data-menu-step-target="submenu-game"]', { force: true });
    }
    await page.waitForSelector('#submenu-game:not(.hidden)', { timeout: APP_READY_TIMEOUT_MS });

    await page.evaluate(({ mapKey, botCount }) => {
        const game = window.GAME_INSTANCE;
        if (!game) {
            throw new Error('GAME_INSTANCE missing');
        }

        if (game.state !== 'MENU' && typeof game._returnToMenu === 'function') {
            game._returnToMenu();
        }

        const mapSelect = document.getElementById('map-select');
        const requestedMapKey = String(mapKey || '').trim();
        if (requestedMapKey && mapSelect instanceof HTMLSelectElement) {
            mapSelect.value = requestedMapKey;
            mapSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }

        const botSlider = document.getElementById('bot-count');
        if (botSlider instanceof HTMLInputElement) {
            const maxValue = Number.parseInt(botSlider.max || '', 10);
            const sliderValue = Number.isFinite(maxValue)
                ? Math.min(Math.max(0, Number(botCount) || 0), maxValue)
                : Math.max(0, Number(botCount) || 0);
            botSlider.value = String(sliderValue);
            botSlider.dispatchEvent(new Event('input', { bubbles: true }));
        }

        if (game.settings && typeof game.settings === 'object') {
            if (!game.settings.localSettings || typeof game.settings.localSettings !== 'object') {
                game.settings.localSettings = {};
            }
            game.settings.localSettings.sessionType = 'splitscreen';
            game.settings.localSettings.modePath = 'normal';
            game.settings.mode = '2p';
            game.settings.gameMode = 'CLASSIC';
            game.settings.numBots = Math.max(0, Number(botCount) || 0);
            game.settings.mapKey = requestedMapKey || game.settings.mapKey;
            game.settings.vehicles = {
                ...(game.settings.vehicles || {}),
                PLAYER_1: game.settings?.vehicles?.PLAYER_1 || 'ship5',
                PLAYER_2: game.settings?.vehicles?.PLAYER_2 || 'ship5',
            };
            game.settings.matchSettings = {
                ...(game.settings.matchSettings || {}),
                winsNeeded: 3,
            };
        }

        game._applySettingsToRuntime?.({ schedulePrewarm: false });
    }, { mapKey: MAP_KEY, botCount: BOT_COUNT });

    const didStart = await page.evaluate(() => {
        const startButton = document.querySelector('#submenu-game:not(.hidden) #btn-start');
        if (!(startButton instanceof HTMLButtonElement)) return false;
        startButton.click();
        return true;
    });
    if (!didStart) {
        throw new Error('start button unavailable');
    }

    await page.waitForFunction(
        () => {
            const game = window.GAME_INSTANCE;
            const hud = document.getElementById('hud');
            const playerCount = Array.isArray(game?.entityManager?.players)
                ? game.entityManager.players.length
                : 0;
            return game?.state === 'PLAYING'
                && !!hud
                && !hud.classList.contains('hidden')
                && playerCount > 0;
        },
        null,
        { timeout: APP_READY_TIMEOUT_MS }
    );
}

async function collectMeasurement(page) {
    return page.evaluate(async ({
        sampleFrames,
        warmupFrames,
        yieldEveryFrames,
        targetPlayers,
    }) => {
        const game = window.GAME_INSTANCE;
        if (!game || game.state !== 'PLAYING') {
            throw new Error('game is not in PLAYING state');
        }
        const dt = 1 / 60;
        const dtMs = dt * 1000;
        const loop = game.gameLoop || null;
        const frameDurationsMs = [];
        const updateDurationsMs = [];
        const renderDurationsMs = [];
        let logicalTimestampMs = 0;

        const runFrame = (measureFrame) => {
            logicalTimestampMs += dtMs;
            if (loop) {
                loop.renderAlpha = 1;
                loop.renderDelta = dt;
                loop.renderFrameId = (Number(loop.renderFrameId) || 0) + 1;
                loop._updateRenderTiming?.(
                    logicalTimestampMs,
                    dt,
                    dt,
                    false,
                    measureFrame ? 'v41-host-budget' : 'v41-host-warmup'
                );
            }

            const frameStartMs = performance.now();
            game.update?.(dt);
            const updateEndMs = performance.now();
            game.render?.(1, dt);
            const renderEndMs = performance.now();

            if (!measureFrame) return;

            frameDurationsMs.push(Math.max(0, renderEndMs - frameStartMs));
            updateDurationsMs.push(Math.max(0, updateEndMs - frameStartMs));
            renderDurationsMs.push(Math.max(0, renderEndMs - updateEndMs));
        };

        loop?.stop?.();
        game.runtimePerfProfiler?.reset?.();

        for (let frame = 0; frame < warmupFrames; frame += 1) {
            runFrame(false);
            if (((frame + 1) % yieldEveryFrames) === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }
        for (let frame = 0; frame < sampleFrames; frame += 1) {
            runFrame(true);
            if (((frame + 1) % yieldEveryFrames) === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }
        }

        const players = Array.isArray(game.entityManager?.players) ? game.entityManager.players : [];
        const botPlayers = players.filter((player) => !!player?.isBot).length;
        const alivePlayers = players.filter((player) => player?.alive !== false).length;
        const snapshot = game.debugApi?.getRuntimePerformanceSnapshot?.({
            windowSize: sampleFrames,
            spikeEventsLimit: 32,
        }) || null;

        return {
            targetPlayers,
            playerCount: players.length,
            botPlayers,
            humanPlayers: players.length - botPlayers,
            alivePlayers,
            frameDurationsMs,
            updateDurationsMs,
            renderDurationsMs,
            runtimeSnapshot: snapshot,
        };
    }, {
        sampleFrames: SAMPLE_FRAME_COUNT,
        warmupFrames: WARMUP_FRAME_COUNT,
        yieldEveryFrames: YIELD_EVERY_FRAMES,
        targetPlayers: TARGET_PLAYERS,
    });
}

function buildAcceptance(metrics = {}, observed = {}) {
    const playerCount = Number(observed.playerCount) || 0;
    const frameP95 = Number(metrics.frame?.p95) || 0;
    const frameAvg = Number(metrics.frame?.avg) || 0;
    const spikeRate = Number(metrics.frameSpikes?.rate) || 0;

    const checks = [
        {
            id: 'player_count',
            target: `>= ${TARGET_PLAYERS}`,
            actual: playerCount,
            pass: playerCount >= TARGET_PLAYERS,
        },
        {
            id: 'frame_p95_ms',
            target: `<= ${FRAME_P95_MAX_MS}`,
            actual: frameP95,
            pass: frameP95 <= FRAME_P95_MAX_MS,
        },
        {
            id: 'frame_avg_ms',
            target: `<= ${FRAME_AVG_MAX_MS}`,
            actual: frameAvg,
            pass: frameAvg <= FRAME_AVG_MAX_MS,
        },
        {
            id: 'frame_spike_rate',
            target: `<= ${SPIKE_RATE_MAX} @>${SPIKE_THRESHOLD_MS}ms`,
            actual: spikeRate,
            pass: spikeRate <= SPIKE_RATE_MAX,
        },
    ];

    return {
        pass: checks.every((entry) => !!entry.pass),
        checks,
    };
}

async function run() {
    forceKillPort(PORT);
    let server = null;
    let browser = null;
    let context = null;

    try {
        server = startViteServer();
        await waitForServer(BASE_URL, APP_READY_TIMEOUT_MS);

        browser = await chromium.launch({
            headless: !HEADED,
            args: [
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
            ],
        });
        context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
        const page = await context.newPage();

        await prepareRun(page);
        const measurement = await collectMeasurement(page);

        const metrics = {
            frame: summarizeDurations(measurement.frameDurationsMs),
            update: summarizeDurations(measurement.updateDurationsMs),
            render: summarizeDurations(measurement.renderDurationsMs),
            frameSpikes: computeSpikeStats(measurement.frameDurationsMs, SPIKE_THRESHOLD_MS),
        };
        const acceptance = buildAcceptance(metrics, measurement);

        const report = {
            generatedAt: new Date().toISOString(),
            appUrl: BASE_URL,
            scenario: {
                mapKey: MAP_KEY,
                targetPlayers: TARGET_PLAYERS,
                botCount: BOT_COUNT,
                sampleFrames: SAMPLE_FRAME_COUNT,
                warmupFrames: WARMUP_FRAME_COUNT,
                yieldEveryFrames: YIELD_EVERY_FRAMES,
                measurementMode: 'manual-step-60hz',
            },
            observed: {
                playerCount: measurement.playerCount,
                botPlayers: measurement.botPlayers,
                humanPlayers: measurement.humanPlayers,
                alivePlayers: measurement.alivePlayers,
            },
            metrics,
            runtimeSnapshot: measurement.runtimeSnapshot,
            thresholds: {
                frameP95MaxMs: FRAME_P95_MAX_MS,
                frameAvgMaxMs: FRAME_AVG_MAX_MS,
                spikeThresholdMs: SPIKE_THRESHOLD_MS,
                spikeRateMax: SPIKE_RATE_MAX,
            },
            acceptance,
        };

        await mkdir(dirname(OUTPUT_PATH), { recursive: true });
        await writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2), 'utf8');

        console.log('[v41-host-budget] report:', OUTPUT_PATH);
        console.log(JSON.stringify({
            pass: acceptance.pass,
            playerCount: report.observed.playerCount,
            frameAvgMs: Number(report.metrics.frame.avg.toFixed(3)),
            frameP95Ms: Number(report.metrics.frame.p95.toFixed(3)),
            frameP99Ms: Number(report.metrics.frame.p99.toFixed(3)),
            spikeRate: Number(report.metrics.frameSpikes.rate.toFixed(4)),
        }, null, 2));

        if (!acceptance.pass) {
            process.exitCode = 1;
        }
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
    console.error('[v41-host-budget] failed:', error?.stack || toShortError(error));
    process.exit(1);
});
