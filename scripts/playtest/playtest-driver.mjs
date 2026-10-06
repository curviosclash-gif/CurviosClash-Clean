/* global window, requestAnimationFrame */
// Building blocks for letting an agent play the real desktop app on its own: launch an
// isolated app session, start matches, fly with the test pilot, read numbers and take
// screenshots. Callbacks passed to page.evaluate run in the renderer, hence the browser
// globals above.
import fs from 'node:fs/promises';
import path from 'node:path';
import {
    acquirePlaywrightRunLock,
    releasePlaywrightRunLockOnExit,
} from '../playwright-run-lock.mjs';
import {
    distanceTravelled,
    countDeaths,
    describeMatchStartProblems,
    resolvePlaytestOutDir,
    sanitizeShotName,
} from './playtest-support.mjs';
import { installControl, resetControl, setPaused } from './playtest-control.mjs';
import {
    closeSession,
    collectErrors,
    createRunDir,
    findWindowPage,
    launchSession,
    REPO_ROOT,
} from './playtest-session.mjs';

export { distanceTravelled, countDeaths, REPO_ROOT };
export {
    configurePilot,
    disableAutopilot,
    enableAutopilot,
    installControl,
    maneuver,
    observe,
    pilotStatus,
    readEvents,
    setPaused,
    step,
    stopPilot,
    updatePilot,
} from './playtest-control.mjs';
export {
    collectErrors,
    createRunDir,
    findWindowPage,
    launchSession,
    listWindows,
    queueOpenDialog,
    readMainProcessRecords,
    setMessageBoxResponse,
    setWindowsOnScreen,
    triggerFocusShortcut,
} from './playtest-session.mjs';

export const OUT_DIR = resolvePlaytestOutDir();

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Holds the machine-wide Playwright lock for the whole session; released on exit. */
export async function acquireLock(label = 'playtest', options = {}) {
    const lock = await acquirePlaywrightRunLock({ label, kind: 'long', ...options });
    releasePlaywrightRunLockOnExit(lock.release);
    return lock;
}

/**
 * Launches the desktop app from dist-app-test (the build with the test bridge) in its own
 * run folder, off screen at full frame rate. Rounds are tagged as automation in
 * telemetry, so they never count as human play.
 */
export async function launchApp({ visible = false, tag = 'claude', runDir = null, role = 'main' } = {}) {
    const run = runDir ? { runDir } : await createRunDir(role);
    return launchSession({ runDir: run.runDir, role, visible, tag });
}

/** Closes the session and starts a fresh app in the same run folder. */
export async function relaunchApp(session) {
    await closeApp(session);
    return launchSession({
        runDir: session.runDir, role: `${session.role}-relaunch-${Date.now()}`,
        visible: session?.visible === true, tag: session?.tag || 'claude',
    });
}

export async function closeApp(session) {
    await closeSession(session);
}

/** Screenshot of a window (default the main game window) into the session's shot folder. */
export async function shot(session, name, kind = 'main') {
    const file = path.join(session.paths?.shots || path.join(OUT_DIR, 'shots'), `${sanitizeShotName(name)}.png`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const page = await findWindowPage(session, kind);
    if (!page) throw new Error(`no ${kind} window is open`);
    await page.screenshot({ path: file, timeout: 20_000 }).catch(async () => {
        const url = page.url();
        const png = await session.app.evaluate(async ({ BrowserWindow }, wanted) => {
            const window = BrowserWindow.getAllWindows().find((entry) => entry.webContents.getURL() === wanted)
                || BrowserWindow.getAllWindows()[0];
            const image = await window.webContents.capturePage();
            return image.toPNG().toString('base64');
        }, url);
        await fs.writeFile(file, Buffer.from(png, 'base64'));
    });
    return file;
}

/** Errors of every window and the main process since sinceMs. */
export async function errorsSince(session, sinceMs) {
    return collectErrors(session, sinceMs);
}

/**
 * Starts a match through the runtime facade, skipping the menu. Vehicle, arcade and hunt
 * settings go back to the profile's first state before each start, because settings
 * persist between matches of one session and would leak from one step into the next.
 * `seed` fixes the arcade seed and replaces Math.random in the renderer with a seeded
 * generator: fewer random differences between runs, not a determinism guarantee (frame
 * timing still varies unless the run is paused and advanced with step/act).
 * `problems` lists every difference from the request (map fallback, wrong mode, ...).
 * @param {{ map: string, mode?: 'CLASSIC'|'HUNT'|'ARCADE'|'ESCORT', bots?: number, humans?: number,
 *   vehicle?: string, hunt?: object, arcade?: object, session?: 'single'|'splitscreen', modePath?: string,
 *   difficulty?: string, winsNeeded?: number, seed?: number, paused?: boolean, timeoutMs?: number }} options
 */
export async function startMatch(session, options) {
    const result = await session.page.evaluate(async (opts) => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const game = window.GAME_INSTANCE;
        if (window.__playtest) Object.assign(window.__playtest, { paused: false, budget: 0, action: null, actionFrames: 0 });
        if (game.state !== 'MENU') {
            await Promise.resolve(game._returnToMenu?.());
            for (let index = 0; index < 100 && game.state !== 'MENU'; index += 1) await wait(50);
        }
        if (game.state !== 'MENU') return { ok: false, menuReached: false, state: game.state };
        const settings = game.settings;
        const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
        const base = window.__playtestBaseSettings || (window.__playtestBaseSettings = {
            vehicles: clone(settings.vehicles), arcade: clone(settings.arcade), hunt: clone(settings.hunt),
        });
        settings.vehicles = clone(base.vehicles);
        settings.arcade = clone(base.arcade);
        settings.hunt = clone(base.hunt);
        Object.assign(settings, {
            mode: opts.session === 'splitscreen' ? '2p' : '1p',
            numHumans: opts.humans || 1,
            numBots: opts.bots ?? 2,
            winsNeeded: opts.winsNeeded ?? 15,
            botDifficulty: opts.difficulty || 'NORMAL',
            gameMode: opts.mode || 'CLASSIC',
            mapKey: opts.map,
        });
        if (opts.vehicle) settings.vehicles = { ...(settings.vehicles || {}), PLAYER_1: opts.vehicle };
        settings.hunt = { ...(settings.hunt || {}), teamMode: false, teamObjective: 'HUNT', ...(opts.hunt || {}) };
        if (opts.arcade || Number.isInteger(opts.seed)) {
            settings.arcade = { ...(settings.arcade || {}), ...(opts.arcade || {}) };
            if (Number.isInteger(opts.seed)) settings.arcade.seed = opts.seed;
        }
        window.__playtestNativeRandom = window.__playtestNativeRandom || Math.random;
        if (Number.isInteger(opts.seed)) {
            let state = opts.seed >>> 0;
            Math.random = () => {
                state = (state + 0x6D2B79F5) | 0;
                let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
                mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
                return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
            };
        } else {
            Math.random = window.__playtestNativeRandom;
        }
        settings.localSettings = settings.localSettings || {};
        settings.localSettings.sessionType = opts.session || 'single';
        settings.localSettings.modePath = opts.modePath
            || (opts.mode === 'HUNT' ? 'fight' : opts.mode === 'ARCADE' ? 'arcade' : 'normal');
        await Promise.resolve(game._onSettingsChanged?.());
        const startedAt = performance.now();
        await Promise.resolve(game.runtimeFacade?.startMatch?.());
        let ok = false;
        while (performance.now() - startedAt < (opts.timeoutMs || 60_000)) {
            if (game.state === 'PLAYING' && game.entityManager?.humanPlayers?.[0]) { ok = true; break; }
            await wait(100);
        }
        const loadError = game.arena?._glbLoadError;
        return {
            ok,
            menuReached: true,
            state: game.state,
            loadMs: Math.round(performance.now() - startedAt),
            mapKey: game.arena?.currentMapKey || null,
            gameMode: game.settings.gameMode,
            glbError: loadError ? String(loadError?.message || loadError) : null,
            players: game.entityManager?.players?.length || 0,
            humanVehicle: game.entityManager?.humanPlayers?.[0]?.vehicleId || null,
            seed: Number.isInteger(opts.seed) ? opts.seed : null,
            // What the runtime actually uses; it clamps bots and wins without telling.
            bots: game.runtimeConfig?.session?.numBots ?? game.entityManager?.bots?.length ?? null,
            winsNeeded: game.runtimeConfig?.session?.winsNeeded ?? game.winsNeeded ?? null,
            seedActual: game.runtimeConfig?.session?.seed ?? game.runtimeConfig?.seed ?? game.settings?.arcade?.seed ?? null,
        };
    }, options);
    result.problems = describeMatchStartProblems(options, result);
    if (!result.ok) return result;
    // New match, new entity manager: hooks go on again, the autopilot choice carries over.
    await resetControl(session);
    result.control = await installControl(session);
    result.pilot = await session.page.evaluate(() => window.__playtestPilotRuntime?.describe?.() ?? null);
    if (options?.paused) result.paused = (await setPaused(session, true)).paused;
    return result;
}

// Runs in the renderer; passed as source so sample() can call it in a loop there.
function readSnapshotInPage() {
    const game = window.GAME_INSTANCE;
    const manager = game.entityManager;
    const human = manager?.humanPlayers?.[0];
    const position = human?.position;
    return {
        t: Math.round(performance.now()),
        frame: window.__playtest?.simFrame ?? null,
        state: game.state,
        hp: human ? Math.round(human.hp * 10) / 10 : null,
        maxHp: human?.maxHp ?? null,
        shield: human?.shieldHP ?? null,
        alive: human?.alive ?? null,
        pos: position ? [Math.round(position.x), Math.round(position.y), Math.round(position.z)] : null,
        speed: human?.speed != null ? Math.round(human.speed * 10) / 10 : null,
        inventory: human?.inventory ? [...human.inventory] : null,
        score: human?.score ?? null,
        aliveBots: manager?.bots?.filter((entry) => entry.player.alive).length ?? null,
    };
}

/** The numbers most checks need, read once. */
export async function snapshot(session) {
    return session.page.evaluate(`(${readSnapshotInPage})()`);
}

/**
 * Snapshots every intervalMs for durationMs. Sampling runs inside the renderer, so the
 * interval is not stretched by a round trip per sample. `extra` is an optional page
 * function per sample; with it, sampling falls back to one round trip per sample.
 */
export async function sample(session, durationMs, intervalMs = 1000, extra = null) {
    const duration = Math.max(0, Number(durationMs) || 0);
    const interval = Math.max(16, Number(intervalMs) || 1000);
    if (!extra) {
        return session.page.evaluate(`(async () => {
            const read = ${readSnapshotInPage};
            const samples = [];
            const end = performance.now() + ${duration};
            do {
                samples.push(read());
                await new Promise((resolve) => setTimeout(resolve, ${interval}));
            } while (performance.now() < end);
            return samples;
        })()`);
    }
    const samples = [];
    const end = Date.now() + duration;
    while (Date.now() < end) {
        const entry = await snapshot(session);
        entry.extra = await session.page.evaluate(extra).catch((error) => `ERR ${error.message}`);
        samples.push(entry);
        await sleep(interval);
    }
    return samples;
}

/** Average frame rate and 95th-percentile frame time over ms, measured with requestAnimationFrame. */
export async function measureFps(session, ms = 4000) {
    return session.page.evaluate(async (duration) => {
        const times = [];
        const startedAt = performance.now();
        await new Promise((resolve) => {
            const tick = (time) => {
                times.push(time);
                if (time - startedAt < duration) requestAnimationFrame(tick);
                else resolve();
            };
            requestAnimationFrame(tick);
        });
        const deltas = [];
        for (let index = 1; index < times.length; index += 1) deltas.push(times[index] - times[index - 1]);
        deltas.sort((left, right) => left - right);
        const average = deltas.reduce((sum, value) => sum + value, 0) / Math.max(1, deltas.length);
        return { fps: Math.round(1000 / average), p95ms: Math.round(deltas[Math.floor(deltas.length * 0.95)] || 0), frames: deltas.length };
    }, ms);
}

/** Puts an item straight into the human inventory (e.g. 'BOMBER_STRIKE'). */
export async function giveItem(session, type) {
    return session.page.evaluate((itemType) => {
        const human = window.GAME_INSTANCE.entityManager.humanPlayers[0];
        const added = human.addToInventory(itemType);
        return { added, inventory: [...human.inventory] };
    }, type);
}

export async function returnToMenu(session) {
    return session.page.evaluate(async () => {
        const game = window.GAME_INSTANCE;
        if (window.__playtest) Object.assign(window.__playtest, { paused: false, budget: 0, action: null, actionFrames: 0 });
        await Promise.resolve(game._returnToMenu?.());
        for (let index = 0; index < 100 && game.state !== 'MENU'; index += 1) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return game.state;
    });
}

export async function press(session, key, holdMs = 80) {
    await session.page.keyboard.down(key);
    try {
        await sleep(holdMs);
    } finally {
        await session.page.keyboard.up(key);
    }
}

/**
 * Pins the human at `pos` facing `target` for `ms` while real keys are held or tapped,
 * e.g. to fire the MG (KeyX) at a structure. `sweep` circles the aim around the target
 * so shots do not all pass through the first hole. `god` keeps health full and clears
 * the own trail, which a ship standing still would otherwise fly into.
 */
export async function holdAim(session, { pos, target, ms = 4000, keys = ['KeyX'], tapKeys = [], sweep = 0, god = true }) {
    await session.page.evaluate((args) => {
        const human = window.GAME_INSTANCE.entityManager.humanPlayers[0];
        // A newer holdAim or the cleanup below bumps the token and ends this loop.
        window.__playtestHoldToken = (window.__playtestHoldToken || 0) + 1;
        const token = window.__playtestHoldToken;
        const Vector = human.position.constructor;
        const startedAt = performance.now();
        const forward = new Vector(0, 0, -1);
        const direction = new Vector();
        const tick = () => {
            if (window.__playtestHoldToken !== token) return;
            const seconds = (performance.now() - startedAt) / 1000;
            const radius = args.sweep * (0.15 + 0.85 * ((seconds * 0.37) % 1));
            const offsetX = args.sweep > 0 ? Math.cos(seconds * 5.1) * radius : 0;
            const offsetY = args.sweep > 0 ? Math.sin(seconds * 5.1) * radius : 0;
            direction.set(
                args.target[0] + offsetX - args.pos[0],
                args.target[1] + offsetY - args.pos[1],
                args.target[2] - args.pos[2],
            ).normalize();
            human.position.set(args.pos[0], args.pos[1], args.pos[2]);
            human.quaternion.setFromUnitVectors(forward, direction);
            if (args.god) { human.hp = human.maxHp; human.trail?.clear?.(); }
            human.markRenderDiscontinuity?.('playtest');
            if (performance.now() - startedAt < args.ms) requestAnimationFrame(tick);
        };
        tick();
    }, { pos, target, ms, sweep, god });
    try {
        for (const key of keys) await session.page.keyboard.down(key);
        const end = Date.now() + ms;
        while (Date.now() < end) {
            for (const key of tapKeys) await press(session, key, 60);
            await sleep(tapKeys.length ? 350 : 200);
        }
    } finally {
        // Keys stuck down or a ship still pinned would spoil every later step.
        for (const key of keys) await session.page.keyboard.up(key).catch(() => {});
        await session.page.evaluate(() => { window.__playtestHoldToken = (window.__playtestHoldToken || 0) + 1; }).catch(() => {});
    }
}

/** Moves the human once, optionally facing `target`; physics takes over again right after. */
export async function teleport(session, pos, target = null) {
    return session.page.evaluate((args) => {
        const human = window.GAME_INSTANCE.entityManager.humanPlayers[0];
        human.position.set(args.pos[0], args.pos[1], args.pos[2]);
        if (args.target) {
            const Vector = human.position.constructor;
            human.quaternion.setFromUnitVectors(
                new Vector(0, 0, -1),
                new Vector(args.target[0] - args.pos[0], args.target[1] - args.pos[1], args.target[2] - args.pos[2]).normalize(),
            );
        }
        human.trail?.clear?.();
        human.markRenderDiscontinuity?.('playtest');
        return [human.position.x, human.position.y, human.position.z].map(Math.round);
    }, { pos, target });
}

/** Menu path helper: presses Escape until `selector` is visible (max `tries`). */
export async function escapeUntilVisible(session, selector, tries = 5) {
    for (let index = 0; index < tries && !(await session.page.isVisible(selector)); index += 1) {
        await session.page.keyboard.press('Escape');
        await sleep(300);
    }
    return session.page.isVisible(selector);
}

export async function saveJson(name, data) {
    await fs.mkdir(OUT_DIR, { recursive: true });
    const file = path.join(OUT_DIR, `${sanitizeShotName(name)}.json`);
    await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    return file;
}
