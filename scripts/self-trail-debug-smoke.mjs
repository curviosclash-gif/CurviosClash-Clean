import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

const HOST = '127.0.0.1';
const PORT = 4173;
const BASE_URL = `http://${HOST}:${PORT}`;
const PLAYTEST_URL = `${BASE_URL}/?playtest=1&traildebug=1&traildebugmax=600`;
const DEFAULT_VEHICLE_IDS = ['drone', 'manta', 'aircraft'];
const VEHICLE_IDS = String(process.env.SMOKE_VEHICLES || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
if (VEHICLE_IDS.length === 0) {
    VEHICLE_IDS.push(...DEFAULT_VEHICLE_IDS);
}

function spawnDevServer(cwd) {
    const viteEntrypoint = 'node_modules/vite/bin/vite.js';
    const child = spawn(
        process.execPath,
        [viteEntrypoint, '--host', HOST, '--port', String(PORT), '--strictPort'],
        {
            cwd,
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        }
    );

    let stdoutTail = '';
    let stderrTail = '';
    const appendTail = (prev, chunk) => {
        const next = (prev + chunk).slice(-4000);
        return next;
    };

    child.stdout?.on('data', (chunk) => {
        stdoutTail = appendTail(stdoutTail, String(chunk));
    });
    child.stderr?.on('data', (chunk) => {
        stderrTail = appendTail(stderrTail, String(chunk));
    });

    let exited = false;
    let exitCode = null;
    child.on('exit', (code) => {
        exited = true;
        exitCode = code;
    });

    return {
        child,
        isExited() {
            return exited;
        },
        getExitCode() {
            return exitCode;
        },
        getTails() {
            return { stdoutTail, stderrTail };
        },
    };
}

async function probeExistingServer(url) {
    try {
        const response = await fetch(url, {
            redirect: 'follow',
            signal: AbortSignal.timeout(1500),
        });
        if (!response.ok) return { reachable: false, reason: `HTTP ${response.status}` };
        const text = await response.text();
        const looksLikeProject = /CuviosClash/i.test(text) || /btn-start/i.test(text);
        return {
            reachable: true,
            looksLikeProject,
            reason: looksLikeProject ? 'matched project html' : 'reachable but unknown content',
        };
    } catch (error) {
        return { reachable: false, reason: error?.message || String(error) };
    }
}

async function waitForServer(url, devServer, timeoutMs = 30000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    while (Date.now() < deadline) {
        if (devServer?.isExited?.()) {
            const { stdoutTail, stderrTail } = devServer.getTails?.() || {};
            throw new Error(
                `Dev server exited early (code=${devServer.getExitCode?.()})\n` +
                `${stdoutTail ? `stdout:\n${stdoutTail}\n` : ''}` +
                `${stderrTail ? `stderr:\n${stderrTail}` : ''}`
            );
        }
        try {
            const response = await fetch(url, {
                redirect: 'follow',
                signal: AbortSignal.timeout(1500),
            });
            if (response.ok) return;
            lastError = new Error(`HTTP ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await delay(300);
    }
    throw new Error(`Dev server not reachable at ${url}: ${lastError?.message || 'timeout'}`);
}

async function loadPlaywright() {
    try {
        return await import('playwright');
    } catch (error) {
        const help = 'Playwright not available. Install locally (e.g. `npm i -D playwright`) and retry.';
        throw new Error(`${help}\nOriginal: ${error?.message || error}`);
    }
}

function acquireRunLock(cwd) {
    const lockPath = path.join(cwd, '.self-trail-smoke.lock');
    try {
        fs.writeFileSync(lockPath, JSON.stringify({
            pid: process.pid,
            startedAt: new Date().toISOString(),
        }), { flag: 'wx' });
    } catch (error) {
        if (error?.code === 'EEXIST') {
            let lockInfo = null;
            try {
                lockInfo = fs.readFileSync(lockPath, 'utf8');
            } catch {
                lockInfo = null;
            }
            throw new Error(
                `Another self-trail smoke run appears to be active (lock file exists: ${lockPath}).` +
                (lockInfo ? `\nLock contents: ${lockInfo}` : '')
            );
        }
        throw error;
    }
    return {
        lockPath,
        release() {
            try {
                fs.unlinkSync(lockPath);
            } catch {
                // no-op
            }
        },
    };
}

async function waitForRuntimeReady(page, options = {}) {
    const gameInstanceTimeoutMs = options.gameInstanceTimeoutMs || 30000;
    const playingTimeoutMs = options.playingTimeoutMs || 30000;
    try {
        await page.waitForFunction(() => window.GAME_INSTANCE, null, { timeout: gameInstanceTimeoutMs });
        await page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: playingTimeoutMs });
    } catch (error) {
        let diagnostics = null;
        try {
            diagnostics = await page.evaluate(() => ({
                hasGameInstance: !!window.GAME_INSTANCE,
                gameState: window.GAME_INSTANCE?.state ?? null,
                bodyTextHead: document.body?.innerText?.slice(0, 240) || '',
                mainMenuHidden: !!document.getElementById('main-menu')?.classList.contains('hidden'),
            }));
        } catch {
            diagnostics = null;
        }
        const details = diagnostics ? `\nRuntime diagnostics: ${JSON.stringify(diagnostics)}` : '';
        throw new Error(`${error?.message || error}${details}`);
    }
}

async function main() {
    const cwd = process.cwd();
    const runLock = acquireRunLock(cwd);
    let devServer = null;
    let usingExistingServer = false;
    let browser = null;
    let context = null;
    const cleanup = async () => {
        if (browser) {
            try {
                await browser.close();
            } catch {
                // no-op
            }
            browser = null;
            context = null;
        }
        if (devServer?.child && !devServer.child.killed) {
            devServer.child.kill();
            await delay(300);
        }
        runLock.release();
    };

    try {
        const existing = await probeExistingServer(BASE_URL);
        if (existing.reachable && existing.looksLikeProject) {
            usingExistingServer = true;
            console.error(`[smoke] Reusing existing dev server at ${BASE_URL} (${existing.reason})`);
        } else {
            console.error(`[smoke] Starting dev server on ${BASE_URL} ...`);
            devServer = spawnDevServer(cwd);
            await waitForServer(BASE_URL, devServer);
            console.error('[smoke] Dev server reachable');
        }
        const { chromium } = await loadPlaywright();
        console.error('[smoke] Launching Playwright Chromium ...');
        browser = await chromium.launch({ headless: true });
        context = await browser.newContext();

        await context.addInitScript(() => {
            window.__trailDebugCapture = [];
            window.__trailPageErrors = [];

            const wrapConsole = (method) => {
                const original = console[method];
                if (typeof original !== 'function') return;
                console[method] = function wrappedConsole(...args) {
                    try {
                        const first = String(args[0] ?? '');
                        if (first.startsWith('[TrailCollisionDebug:')) {
                            const closeIdx = first.indexOf(']');
                            const tag = closeIdx > 0
                                ? first.slice('[TrailCollisionDebug:'.length, closeIdx)
                                : 'unknown';
                            window.__trailDebugCapture.push({
                                level: method,
                                tag,
                                message: first,
                                payload: args[1] ?? null,
                                ts: performance.now(),
                            });
                        } else if (first.startsWith('[TrailCollisionDebug]')) {
                            window.__trailDebugCapture.push({
                                level: method,
                                tag: 'meta',
                                message: first,
                                payload: args[1] ?? null,
                                ts: performance.now(),
                            });
                        }
                    } catch {
                        // no-op
                    }
                    return original.apply(this, args);
                };
            };

            wrapConsole('debug');
            wrapConsole('info');
            wrapConsole('warn');

            window.addEventListener('error', (event) => {
                window.__trailPageErrors.push({
                    message: event?.message || 'unknown',
                    source: event?.filename || null,
                    line: event?.lineno || null,
                    column: event?.colno || null,
                });
            });
        });

        const page = await context.newPage();
        const externalPageErrors = [];
        page.on('pageerror', (error) => {
            externalPageErrors.push(String(error?.message || error));
        });

        console.error(`[smoke] Opening ${PLAYTEST_URL}`);
        await page.goto(PLAYTEST_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await waitForRuntimeReady(page);
        console.error('[smoke] Runtime initialized (PLAYING)');

        const results = [];
        for (const vehicleId of VEHICLE_IDS) {
            console.error(`[smoke] Running probe for vehicle=${vehicleId}`);
            const result = await page.evaluate(async (selectedVehicleId) => {
                const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
                const waitForValue = async (getter, timeoutMs = 5000, stepMs = 50) => {
                    const deadline = performance.now() + timeoutMs;
                    while (performance.now() < deadline) {
                        let value = null;
                        try {
                            value = getter();
                        } catch {
                            value = null;
                        }
                        if (value) return value;
                        await sleep(stepMs);
                    }
                    return null;
                };

                const game = window.GAME_INSTANCE;
                if (!game) throw new Error('GAME_INSTANCE missing');

                if (game.state !== 'MENU' && typeof game._returnToMenu === 'function') {
                    game._returnToMenu();
                    await waitForValue(() => game.state === 'MENU' ? true : null, 3000);
                }

                game.settings.mode = '1p';
                game.settings.numBots = 0;
                game.settings.vehicles.PLAYER_1 = selectedVehicleId;
                game.settings.vehicles.PLAYER_2 = selectedVehicleId;
                game.settings.gameplay = game.settings.gameplay || {};
                game.settings.gameplay.planarMode = !!game.settings.gameplay.planarMode;

                window.__trailDebugCapture.length = 0;
                if (typeof game.startMatch !== 'function') throw new Error('startMatch missing');
                game.startMatch();
                await waitForValue(
                    () => (game.state === 'PLAYING' && game.entityManager?.players?.[0]) ? true : null,
                    10000,
                    50
                );

                const em = game.entityManager;
                const player = em?.players?.[0];
                if (!em || !player) throw new Error(`Match start failed for vehicle ${selectedVehicleId}`);

                let derivedSkipRecent = null;
                try {
                    if (typeof em?.constructor?.deriveSelfTrailSkipRecentSegments === 'function') {
                        const value = em.constructor.deriveSelfTrailSkipRecentSegments(player);
                        derivedSkipRecent = Number.isFinite(value) ? value : null;
                    }
                } catch {
                    derivedSkipRecent = null;
                }

                const trailSpatialIndex = typeof em?.getTrailSpatialIndex === 'function'
                    ? em.getTrailSpatialIndex()
                    : em?._trailSpatialIndex;
                if (trailSpatialIndex) {
                    trailSpatialIndex._trailCollisionDebugEnabled = true;
                    trailSpatialIndex._trailCollisionDebugMaxLogs = Math.max(600, trailSpatialIndex._trailCollisionDebugMaxLogs || 0);
                    trailSpatialIndex._trailCollisionDebugLogCount = 0;
                    trailSpatialIndex._trailCollisionDebugSkipRecentSeen = 0;
                }
                window.__trailDebugCapture.length = 0;

                const naturalSkipLog = await waitForValue(
                    () => window.__trailDebugCapture.find((entry) => entry.tag === 'skip-recent' && entry?.payload?.skipRecent),
                    3500,
                    50
                );

                if (game.gameLoop?.setTimeScale) {
                    game.gameLoop.setTimeScale(0);
                }
                await sleep(30);

                if (trailSpatialIndex) {
                    trailSpatialIndex._trailCollisionDebugLogCount = 0;
                    trailSpatialIndex._trailCollisionDebugSkipRecentSeen = 0;
                }
                window.__trailDebugCapture.length = 0;
                trailSpatialIndex?.spatialGrid?.clear?.();

                const trail = player.trail;
                const maxSegments = Math.max(64, Number(trail?.maxSegments) || 64);
                const writeIndex = 40;
                if (trail) {
                    trail.writeIndex = writeIndex;
                    trail.maxSegments = maxSegments;
                }

                const hitboxRadius = Number(player.hitboxRadius) || 1;
                const segRadius = Math.max(0.2, hitboxRadius * 0.35);
                const baseY = Number(player.position?.y) || 0;
                const baseZ = Number(player.position?.z) || 0;
                const skipRecentProbe = Math.max(
                    6,
                    Number(derivedSkipRecent) || 0,
                    Number(naturalSkipLog?.payload?.skipRecent) || 0
                );
                const longLengths = [40, 120, 180];
                const registrations = [];

                for (let i = 0; i < longLengths.length; i++) {
                    const len = longLengths[i];
                    const z = baseZ + 60 + i * 8;
                    registrations.push(em.registerTrailSegment(0, 100 + i, {
                        fromX: 0,
                        fromY: baseY,
                        fromZ: z,
                        toX: len,
                        toY: baseY,
                        toZ: z,
                        midX: len * 0.5,
                        midZ: z,
                        radius: segRadius,
                    }));
                }

                const recentSegmentIdx = (writeIndex - 1 + maxSegments) % maxSegments;
                const olderSegmentIdx = (writeIndex - 1 - (skipRecentProbe + 3) + maxSegments * 8) % maxSegments;
                const recentZ = baseZ + 20;
                const olderZ = baseZ + 28;

                const recentRegistration = em.registerTrailSegment(0, recentSegmentIdx, {
                    fromX: -5,
                    fromY: baseY,
                    fromZ: recentZ,
                    toX: 5,
                    toY: baseY,
                    toZ: recentZ,
                    midX: 0,
                    midZ: recentZ,
                    radius: segRadius,
                });
                const olderRegistration = em.registerTrailSegment(0, olderSegmentIdx, {
                    fromX: -5,
                    fromY: baseY,
                    fromZ: olderZ,
                    toX: 5,
                    toY: baseY,
                    toZ: olderZ,
                    midX: 0,
                    midZ: olderZ,
                    radius: segRadius,
                });

                const preHit = em.checkGlobalCollision(
                    { x: 0, y: baseY, z: recentZ },
                    hitboxRadius,
                    0,
                    skipRecentProbe,
                    null
                );
                const hit = em.checkGlobalCollision(
                    { x: 0, y: baseY, z: olderZ },
                    hitboxRadius,
                    0,
                    skipRecentProbe,
                    null
                );

                const logs = window.__trailDebugCapture.slice();
                const byTag = (tag) => logs.filter((entry) => entry.tag === tag);
                const registerLogs = byTag('register-segment');
                const skipLogs = byTag('skip-recent');
                const selfHitLogs = byTag('self-hit');

                em.unregisterTrailSegment(recentRegistration.key, recentRegistration.entry);
                em.unregisterTrailSegment(olderRegistration.key, olderRegistration.entry);
                for (const reg of registrations) {
                    em.unregisterTrailSegment(reg.key, reg.entry);
                }

                if (game.gameLoop?.setTimeScale) {
                    game.gameLoop.setTimeScale(1);
                }

                return {
                    vehicleId: selectedVehicleId,
                    playerIndex: player.index,
                    hitboxRadius: Number(hitboxRadius.toFixed(3)),
                    derivedSkipRecent,
                    naturalSkipRecent: naturalSkipLog?.payload?.skipRecent ?? null,
                    skipRecentProbe,
                    preHit,
                    hit,
                    registerLogCount: registerLogs.length,
                    skipRecentLogCount: skipLogs.length,
                    selfHitLogCount: selfHitLogs.length,
                    maxRegisterKeyCount: registerLogs.reduce((max, entry) => Math.max(max, Number(entry?.payload?.keyCount) || 0), 0),
                    maxRegisterSegmentLength: registerLogs.reduce((max, entry) => Math.max(max, Number(entry?.payload?.segmentLength) || 0), 0),
                    sampleRegister: registerLogs[0]?.payload || null,
                    sampleSkipRecent: skipLogs[0]?.payload || null,
                    sampleSelfHit: selfHitLogs[0]?.payload || null,
                    pageErrors: Array.isArray(window.__trailPageErrors) ? window.__trailPageErrors.slice() : [],
                };
            }, vehicleId);

            results.push(result);
        }

        const pageErrorPayload = await page.evaluate(() => ({
            capturedErrors: Array.isArray(window.__trailPageErrors) ? window.__trailPageErrors.slice() : [],
        }));

        await browser.close();
        browser = null;
        context = null;
        console.error('[smoke] Browser closed, evaluating results');

        const failures = [];
        for (const result of results) {
            if (result.pageErrors?.length) failures.push(`${result.vehicleId}: page error(s) in capture`);
            if (result.preHit !== null) failures.push(`${result.vehicleId}: expected preHit=null (skip-recent), got ${JSON.stringify(result.preHit)}`);
            if (!result.hit?.hit) failures.push(`${result.vehicleId}: expected self-hit collision result`);
            if (result.registerLogCount < 1) failures.push(`${result.vehicleId}: missing register-segment debug log`);
            if (result.skipRecentLogCount < 1) failures.push(`${result.vehicleId}: missing skip-recent debug log`);
            if (result.selfHitLogCount < 1) failures.push(`${result.vehicleId}: missing self-hit debug log`);
            if (result.maxRegisterKeyCount < 2) failures.push(`${result.vehicleId}: expected multi-cell register keyCount>=2`);
            if (!Number.isFinite(result.derivedSkipRecent) || result.derivedSkipRecent < 1) {
                failures.push(`${result.vehicleId}: derivedSkipRecent helper value not available`);
            }
        }
        if (externalPageErrors.length) {
            failures.push(`Playwright pageerror events: ${externalPageErrors.join(' | ')}`);
        }
        if (pageErrorPayload.capturedErrors?.length) {
            failures.push(`window error events: ${JSON.stringify(pageErrorPayload.capturedErrors)}`);
        }

        const summary = {
            url: PLAYTEST_URL,
            serverMode: usingExistingServer ? 'reused-existing' : 'spawned-local',
            vehicles: results.map((r) => ({
                vehicleId: r.vehicleId,
                hitboxRadius: r.hitboxRadius,
                derivedSkipRecent: r.derivedSkipRecent,
                naturalSkipRecent: r.naturalSkipRecent,
                skipRecentProbe: r.skipRecentProbe,
                maxRegisterKeyCount: r.maxRegisterKeyCount,
                maxRegisterSegmentLength: r.maxRegisterSegmentLength,
                registerLogCount: r.registerLogCount,
                skipRecentLogCount: r.skipRecentLogCount,
                selfHitLogCount: r.selfHitLogCount,
            })),
            failures,
        };

        console.log(JSON.stringify(summary, null, 2));
        if (failures.length > 0) {
            process.exitCode = 1;
        }
    } finally {
        const { stdoutTail, stderrTail } = devServer?.getTails?.() || { stdoutTail: '', stderrTail: '' };
        await cleanup();
        if (process.exitCode && process.exitCode !== 0 && devServer) {
            if (stdoutTail.trim()) {
                console.error('\n[vite stdout tail]\n' + stdoutTail);
            }
            if (stderrTail.trim()) {
                console.error('\n[vite stderr tail]\n' + stderrTail);
            }
        }
    }
}

main().catch((error) => {
    console.error(error?.stack || String(error));
    process.exitCode = 1;
});
