/* global window, requestAnimationFrame */
// Building blocks for letting an agent play the real desktop app on its own: launch
// Electron with a throwaway profile, start matches, fly with the game's bot pilot or
// by hand, read numbers and take screenshots. Callbacks passed to page.evaluate run
// in the renderer, hence the browser globals above.
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    acquirePlaywrightRunLock,
    releasePlaywrightRunLockOnExit,
} from '../playwright-run-lock.mjs';
import {
    distanceTravelled,
    countDeaths,
    filterPlaytestErrors,
    resolvePlaytestOutDir,
    sanitizeShotName,
} from './playtest-support.mjs';

export { distanceTravelled, countDeaths };

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUT_DIR = resolvePlaytestOutDir();
export const SHOTS_DIR = path.join(OUT_DIR, 'shots');

const requireRepo = createRequire(path.join(REPO_ROOT, 'package.json'));
const requireElectron = createRequire(path.join(REPO_ROOT, 'electron', 'package.json'));
const { _electron } = requireRepo('@playwright/test');

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Holds the machine-wide Playwright lock for the whole session; released on exit. */
export async function acquireLock(label = 'playtest') {
    const lock = await acquirePlaywrightRunLock({ label, kind: 'long' });
    releasePlaywrightRunLockOnExit(lock.release);
    return lock;
}

/**
 * Launches the desktop app from dist-app-test (the build with the test bridge) in an
 * off-screen window that renders at full frame rate. Rounds are tagged as automation
 * in telemetry, so they never count as human play.
 */
export async function launchApp({ visible = false, tag = 'claude' } = {}) {
    if (!existsSync(path.join(REPO_ROOT, 'dist-app-test', 'index.html'))) {
        throw new Error('dist-app-test is missing: run "npm run build:app:test" first.');
    }
    await fs.mkdir(SHOTS_DIR, { recursive: true });
    const profile = await fs.mkdtemp(path.join(OUT_DIR, 'profile-'));
    const boot = path.join(profile, 'boot.cjs');
    const main = path.join(REPO_ROOT, 'electron', 'main.cjs');
    await fs.writeFile(boot, `const {app}=require('electron');app.setPath('appData',${JSON.stringify(profile)});require(${JSON.stringify(main)});\n`);
    const env = {
        ...process.env,
        PW_RUN_TAG: `playtest-${Date.now()}`,
        CURVIOS_E2E_RENDERER: '1',
        CURVIOS_AUTOMATION: tag,
        CURVIOS_ELECTRON_SHOW_WINDOW: '1',
        CURVIOS_DESKTOP_STATIC_PORT: process.env.CURVIOS_DESKTOP_STATIC_PORT || String(39600 + (process.pid % 300)),
    };
    if (!visible) env.CURVIOS_ELECTRON_TEST_RENDER = 'inactive';
    delete env.ELECTRON_RUN_AS_NODE;
    const app = await _electron.launch({
        executablePath: requireElectron('electron'),
        cwd: path.join(REPO_ROOT, 'electron'),
        args: [boot],
        env,
        timeout: 90_000,
    });
    const page = await app.firstWindow({ timeout: 90_000 });
    const errors = [];
    page.on('pageerror', (error) => errors.push({ kind: 'pageerror', text: String(error?.message || error), at: Date.now() }));
    page.on('console', (message) => {
        if (message.type() === 'error') errors.push({ kind: 'console', text: message.text().slice(0, 500), at: Date.now() });
    });
    await page.waitForFunction(() => Boolean(window.GAME_INSTANCE?.settings), null, { timeout: 90_000 });
    await page.waitForSelector('#main-menu[data-shell-ready="true"]', { timeout: 60_000 }).catch(() => {});
    return { app, page, profile, errors };
}

export async function closeApp(session) {
    if (!session?.app) return;
    const closed = await Promise.race([
        session.app.close().then(() => true, () => false),
        sleep(15_000).then(() => false),
    ]);
    if (!closed && session.app.process()?.exitCode == null) session.app.process().kill();
}

/** Screenshot of the main window; falls back to capturePage when Playwright times out. */
export async function shot(session, name) {
    const file = path.join(SHOTS_DIR, `${sanitizeShotName(name)}.png`);
    await session.page.screenshot({ path: file, timeout: 20_000 }).catch(async () => {
        const png = await session.app.evaluate(async ({ BrowserWindow }) => {
            const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage();
            return image.toPNG().toString('base64');
        });
        await fs.writeFile(file, Buffer.from(png, 'base64'));
    });
    return file;
}

export function errorsSince(session, sinceMs) {
    return filterPlaytestErrors(session.errors, sinceMs);
}

/**
 * Starts a match through the runtime facade, skipping the menu. Team mode is reset on
 * every start because settings persist between matches of one session.
 * @param {{ map: string, mode?: 'CLASSIC'|'HUNT'|'ARCADE'|'ESCORT', bots?: number, vehicle?: string,
 *   hunt?: object, arcade?: object, session?: 'single'|'splitscreen', modePath?: string,
 *   difficulty?: string, winsNeeded?: number, timeoutMs?: number }} options
 */
export async function startMatch(session, options) {
    return session.page.evaluate(async (opts) => {
        const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const game = window.GAME_INSTANCE;
        if (game.state !== 'MENU') {
            await Promise.resolve(game._returnToMenu?.());
            for (let index = 0; index < 100 && game.state !== 'MENU'; index += 1) await wait(50);
        }
        const settings = game.settings;
        Object.assign(settings, {
            mode: opts.session === 'splitscreen' ? '2p' : '1p',
            numHumans: opts.humans || 1,
            numBots: opts.bots ?? 2,
            winsNeeded: opts.winsNeeded ?? 99,
            botDifficulty: opts.difficulty || 'NORMAL',
            gameMode: opts.mode || 'CLASSIC',
            mapKey: opts.map,
        });
        if (opts.vehicle) settings.vehicles = { ...(settings.vehicles || {}), PLAYER_1: opts.vehicle };
        settings.hunt = { ...(settings.hunt || {}), teamMode: false, teamObjective: 'HUNT', ...(opts.hunt || {}) };
        if (opts.arcade) settings.arcade = { ...(settings.arcade || {}), ...opts.arcade };
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
            state: game.state,
            loadMs: Math.round(performance.now() - startedAt),
            // A map that a mode excludes falls back silently; compare this with the request.
            mapKey: game.arena?.currentMapKey || null,
            gameMode: game.settings.gameMode,
            glbError: loadError ? String(loadError?.message || loadError) : null,
            players: game.entityManager?.players?.length || 0,
            humanVehicle: game.entityManager?.humanPlayers?.[0]?.vehicleId || null,
        };
    }, options);
}

/**
 * Lets the game's own bot policy fly the human ship. Setting autopilotActive is not
 * enough: the guided-rocket input routing clears it every frame when no rocket flies.
 * So the human counts as a bot only while its input is resolved.
 */
export async function enableAutopilot(session, policyType = null) {
    return session.page.evaluate((requestedType) => {
        const manager = window.GAME_INSTANCE.entityManager;
        const human = manager.humanPlayers[0];
        if (!human) return false;
        const pilot = manager.botPolicyRegistry.create(requestedType || manager.botPolicyType, {
            difficulty: manager.botDifficulty, recorder: manager.recorder, runtimeConfig: manager.runtimeConfig,
            runtimeProfiler: manager.runtimeProfiler, entityRuntimeConfig: manager.entityRuntimeConfig,
            bridgeEnabled: manager.botBridgeEnabled, activeGameMode: manager.combatModeType,
            isDesktopRuntime: manager.botIsDesktopRuntime, runtimeRng: manager.runtimeRng,
        });
        manager.botByPlayer.set(human, pilot);
        const inputSystem = manager._playerInputSystem;
        if (!inputSystem.__playtestWrapped) {
            const resolve = inputSystem.resolvePlayerInput.bind(inputSystem);
            inputSystem.resolvePlayerInput = (player, dt, inputManager) => {
                if (!player.__playtestPilot) return resolve(player, dt, inputManager);
                const wasBot = player.isBot;
                player.isBot = true;
                try { return resolve(player, dt, inputManager); } finally { player.isBot = wasBot; }
            };
            inputSystem.__playtestWrapped = true;
        }
        human.__playtestPilot = true;
        return true;
    }, policyType);
}

export async function disableAutopilot(session) {
    return session.page.evaluate(() => {
        const manager = window.GAME_INSTANCE.entityManager;
        const human = manager?.humanPlayers?.[0];
        if (!human) return;
        human.__playtestPilot = false;
        manager.botByPlayer.delete(human);
    });
}

/** The numbers most checks need, read once. */
export async function snapshot(session) {
    return session.page.evaluate(() => {
        const game = window.GAME_INSTANCE;
        const manager = game.entityManager;
        const human = manager?.humanPlayers?.[0];
        const position = human?.position;
        return {
            t: Math.round(performance.now()),
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
    });
}

/** Snapshots every intervalMs for durationMs; `extra` is an optional page function per sample. */
export async function sample(session, durationMs, intervalMs = 1000, extra = null) {
    const samples = [];
    const end = Date.now() + durationMs;
    while (Date.now() < end) {
        const entry = await snapshot(session);
        if (extra) entry.extra = await session.page.evaluate(extra).catch((error) => `ERR ${error.message}`);
        samples.push(entry);
        await sleep(intervalMs);
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
        await Promise.resolve(game._returnToMenu?.());
        for (let index = 0; index < 100 && game.state !== 'MENU'; index += 1) {
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return game.state;
    });
}

export async function press(session, key, holdMs = 80) {
    await session.page.keyboard.down(key);
    await sleep(holdMs);
    await session.page.keyboard.up(key);
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
        const Vector = human.position.constructor;
        const startedAt = performance.now();
        const forward = new Vector(0, 0, -1);
        const direction = new Vector();
        const tick = () => {
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
    for (const key of keys) await session.page.keyboard.down(key);
    const end = Date.now() + ms;
    while (Date.now() < end) {
        for (const key of tapKeys) await press(session, key, 60);
        await sleep(tapKeys.length ? 350 : 200);
    }
    for (const key of keys) await session.page.keyboard.up(key);
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
