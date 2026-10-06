/* global window, document, getComputedStyle, innerWidth, innerHeight */
// Desktop scenarios through the real UI: menu -> match -> pause -> back; hangar change ->
// test flight; editor save -> reload -> play; recording -> replay -> video export with a
// frame check; splitscreen and LAN with input proof for each player; every map loaded
// and flown; failure handling; keyboard and mouse input paths. Menu navigation reuses the
// helpers of the Playwright suite (tests/helpers.js). Each scenario returns steps with
// their outcome; the first failed step ends it with status failed and a screenshot.
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { openCustomSubmenu, openGameSubmenu, openLevel4Drawer, openStartSetupSection, selectSessionType, startGameFromMenu } from '../../tests/helpers.js';
import * as D from './playtest-driver.mjs';
import { cancellableSleep, throwIfCancelled } from './playtest-jobs.mjs';
import { leaveAsGuest, openLanMatch, proveGuestInput, proveRemoteTurn } from './playtest-lan.mjs';
import { closeSession, findWindowPage, launchSession, REPO_ROOT } from './playtest-session.mjs';
import { leaveMatchFromPauseMenu } from './playtest-ui.mjs';

const requireElectron = createRequire(path.join(REPO_ROOT, 'electron', 'package.json'));

function createSteps(session, context) {
    const steps = [];
    const gameBugs = [];
    return {
        steps,
        gameBugs,
        async run(label, body) {
            throwIfCancelled(context.signal);
            const startedAt = Date.now();
            try {
                const detail = await body();
                steps.push({ step: label, ok: true, ms: Date.now() - startedAt, ...(detail && typeof detail === 'object' ? { detail } : {}) });
                context.log(`${label}: ok`);
                return detail;
            } catch (error) {
                const screenshot = session ? await D.shot(session, `failed-${label}`).catch(() => null) : null;
                steps.push({ step: label, ok: false, ms: Date.now() - startedAt, error: String(error?.message || error).split('\n')[0], screenshot });
                // A step can name the failure a game bug (with its evidence) instead of a tool problem.
                if (error?.gameBug) gameBugs.push({ step: label, ...error.gameBug });
                context.log(`${label}: FAILED ${error?.message || error}`);
                throw Object.assign(new Error(`step "${label}" failed`), { scenarioStepFailed: true });
            }
        },
    };
}

async function runSteps(session, context, body) {
    const tracker = createSteps(session, context);
    try {
        const extra = await body(tracker);
        return { status: 'passed', steps: tracker.steps, ...(extra || {}) };
    } catch (error) {
        if (!error?.scenarioStepFailed) throw error;
        return { status: 'failed', steps: tracker.steps, gameBugs: tracker.gameBugs };
    }
}

/**
 * Every UI scenario starts on the main menu level: a match is ended, open panels are
 * closed with their back buttons or Escape, as a person would.
 */
async function toMainMenu(session) {
    const { page } = session;
    if (await page.evaluate(() => window.GAME_INSTANCE?.state) !== 'MENU') await D.returnToMenu(session);
    for (let attempt = 0; attempt < 8; attempt += 1) {
        if (await page.locator('#menu-nav [data-session-type="single"]').isVisible().catch(() => false)) return true;
        const back = page.locator('[data-back]:visible').first();
        if (await back.count()) await back.click({ timeout: 2000 }).catch(() => {});
        else await page.keyboard.press('Escape');
        await new Promise((resolve) => setTimeout(resolve, 300));
    }
    return page.locator('#menu-nav [data-session-type="single"]').isVisible().catch(() => false);
}

const waitState = (page, state, timeout = 30_000) => page.waitForFunction((wanted) => window.GAME_INSTANCE?.state === wanted, state, { timeout });

const headingOf = (session, index) => session.page.evaluate((playerIndex) => {
    const ship = window.GAME_INSTANCE.entityManager?.players?.find((entry) => entry.index === playerIndex);
    if (!ship) return null;
    const forward = new ship.position.constructor(0, 0, -1).applyQuaternion(ship.quaternion);
    return Math.atan2(-forward.x, -forward.z) * 180 / Math.PI;
}, index);
const turnedDeg = (before, after) => {
    let delta = after - before;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return Math.round(delta);
};

/** Menu -> match -> pause -> back to the menu, only with clicks and keys. */
export function scenarioMenuPauseReturn(run, session, context) {
    return runSteps(session, context, async (steps) => {
        await steps.run('start match from the menu', async () => {
            await toMainMenu(session);
            await startGameFromMenu(session.page);
            await waitState(session.page, 'PLAYING', 60_000);
            return { map: await session.page.evaluate(() => window.GAME_INSTANCE.arena?.currentMapKey) };
        });
        await steps.run('pause with Escape', async () => {
            await cancellableSleep(1500, context.signal);
            await session.page.keyboard.press('Escape');
            await waitState(session.page, 'PAUSED', 10_000);
            await session.page.locator('#pause-overlay').waitFor({ state: 'visible', timeout: 5000 });
        });
        await steps.run('back to the menu from the pause menu', async () => {
            await leaveMatchFromPauseMenu(session.page, { timeoutMs: 5000 });
            await waitState(session.page, 'MENU', 30_000);
            await session.page.locator('#main-menu').waitFor({ state: 'visible', timeout: 10_000 });
        });
    });
}

/** Hangar: change the trail style of the active build, activate it, test-fly it, find the style on the ship. */
export function scenarioHangarTestFlight(run, session, context) {
    return runSteps(session, context, async (steps) => {
        let hangar = null;
        let chosen = null;
        await steps.run('open the arcade setup', async () => {
            await toMainMenu(session);
            // A fresh profile has a single trail style; unlock two colours like the hangar spec
            // does (recorded as intervention), so there is something to change.
            const unlocked = await session.page.evaluate(() => {
                const store = window.GAME_INSTANCE.settingsManager.getPlayerRecordStorePort();
                const colors = store.loadJsonRecord('cuviosclash.arcade-colors.v1', null);
                const ids = colors?.unlockedColorIds || ['standard'];
                if (ids.length > 1) return null;
                store.saveJsonRecord('cuviosclash.arcade-colors.v1', { schemaVersion: 'arcade-colors.v1', unlockedColorIds: ['standard', 'frost', 'ion'] });
                return ['frost', 'ion'];
            });
            if (unlocked) run.interventions.push({ at: new Date().toISOString(), role: session.role, helper: 'seed_unlocks', args: { arcadeColors: unlocked } });
            await openCustomSubmenu(session.page);
            await session.page.locator('#submenu-custom:not(.hidden) [data-mode-path="arcade"]').click({ timeout: 10_000 });
            await openStartSetupSection(session.page, 'arcade');
            await session.page.locator('.arcade-advanced-options-summary').first().click({ timeout: 10_000 });
        });
        await steps.run('open the hangar window', async () => {
            const opened = session.app.waitForEvent('window', { timeout: 30_000 });
            await session.page.locator('.hangar-window-open').first().click({ timeout: 10_000 });
            hangar = await opened;
            await hangar.waitForLoadState('domcontentloaded');
            await hangar.locator('#hangar-test-flight').waitFor({ state: 'attached', timeout: 30_000 });
            return { url: hangar.url() };
        });
        await steps.run('change the trail style', async () => {
            const select = hangar.getByLabel('Spurstil');
            await select.waitFor({ state: 'visible', timeout: 15_000 });
            const options = await select.evaluate((element) => ({
                current: element.value,
                values: [...element.options].filter((option) => !option.disabled).map((option) => option.value),
            }));
            chosen = options.values.find((value) => value !== options.current);
            if (!chosen) throw new Error(`no other unlocked trail style (only ${options.values.join(', ')})`);
            await select.selectOption(chosen);
            return { from: options.current, to: chosen };
        });
        await steps.run('activate the build and start the test flight', async () => {
            const activate = hangar.locator('.hangar-activate-build').first();
            if (await activate.isVisible().catch(() => false)) await activate.click({ timeout: 5000 });
            await hangar.locator('#hangar-test-flight').click({ timeout: 10_000 });
            await session.page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING'
                && window.GAME_INSTANCE.settings?.arcade?.runType === 'hangar_test', null, { timeout: 60_000 });
        });
        await steps.run('the changed style flies', async () => {
            const loadout = await session.page.evaluate(() => {
                const ship = window.GAME_INSTANCE.entityManager.humanPlayers[0];
                return { trailStyleId: ship?.arcadeCosmeticLoadout?.trailStyleId ?? null, vehicle: ship?.vehicleId ?? null };
            });
            if (loadout.trailStyleId !== chosen) throw new Error(`ship flies trail ${loadout.trailStyleId}, expected ${chosen}`);
            return loadout;
        });
        await steps.run('end the test flight', async () => {
            await session.page.keyboard.press('Escape');
            await session.page.waitForFunction(() => window.GAME_INSTANCE?.state !== 'PLAYING', null, { timeout: 30_000 });
        });
    });
}

/** Editor: build a small map, save it into the game, find and play it, and start the editor playtest. */
export function scenarioEditorRoundTrip(run, session, context) {
    const mapName = `Playtest ${Date.now().toString(36)}`;
    const mapKey = `editor_${mapName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    return runSteps(session, context, async (steps) => {
        let editor = null;
        await steps.run('open the map editor from the utilities drawer', async () => {
            await toMainMenu(session);
            await openLevel4Drawer(session.page, { section: 'utilities' });
            const popup = session.page.waitForEvent('popup', { timeout: 30_000 });
            await session.page.locator('#btn-open-editor').click({ timeout: 10_000 });
            editor = await popup;
            await editor.waitForFunction(() => typeof window.__CURVIOS_EDITOR_DISK__?.saveMap === 'function', null, { timeout: 60_000 });
            await editor.locator('#threeCanvas').waitFor({ state: 'visible', timeout: 30_000 });
        });
        await steps.run('place a wall, a player spawn and a bot spawn', async () => {
            // A narrow or remembered layout may start with the dock folded; unfold it first.
            if (await editor.locator('#buildDock.is-collapsed').count()) await editor.locator('#btnDockCollapse').click({ timeout: 5000 });
            const ready = await editor.locator('#dockCategoryTabs [data-category-id="build"]').waitFor({ state: 'visible', timeout: 15_000 }).then(() => true, () => false);
            if (!ready) {
                const diagnosis = await editor.evaluate(() => {
                    const dock = document.getElementById('buildDock');
                    const tabs = document.getElementById('dockCategoryTabs');
                    return {
                        dockClass: dock?.className, dockDisplay: dock && getComputedStyle(dock).display, dockRect: dock?.getBoundingClientRect?.().toJSON?.(),
                        tabCount: tabs?.children?.length ?? null, tabsDisplay: tabs && getComputedStyle(tabs).display,
                        categories: [...(tabs?.children || [])].map((tab) => tab.dataset.categoryId), viewport: [innerWidth, innerHeight],
                    };
                });
                const shotFile = path.join(session.paths.shots, `editor-dock-${Date.now()}.png`);
                await editor.screenshot({ path: shotFile }).catch(() => {});
                throw Object.assign(new Error(`build tab not visible: ${JSON.stringify(diagnosis)} (screenshot ${shotFile})`), {
                    gameBug: {
                        kind: 'editor-not-initialised',
                        summary: 'The 3D map editor window opens but stays a shell: no build cards in the dock, assets not loaded, empty scene.',
                        reproduce: 'Main menu -> utilities drawer -> 3D editor (fresh profile, dist-app-test).',
                        evidence: { diagnosis, screenshot: shotFile },
                    },
                });
            }
            const place = async (category, entry, xFactor) => {
                await editor.locator(`#dockCategoryTabs [data-category-id="${category}"]`).click({ timeout: 10_000 });
                await editor.locator(`#dockCards [data-entry-id="${entry}"]`).click({ timeout: 10_000 });
                const box = await editor.locator('#threeCanvas').boundingBox();
                const dock = await editor.locator('#buildDock').boundingBox();
                const width = dock && dock.x > box.x ? dock.x - box.x : box.width;
                await editor.mouse.click(box.x + width * xFactor, box.y + box.height * 0.32);
            };
            await place('build', 'build-hard', 0.34);
            await place('flow', 'flow-spawn-player', 0.52);
            await place('flow', 'flow-spawn-bot', 0.72);
        });
        await steps.run('save the map into the game', async () => {
            await editor.locator('#btnSaveToGame').click({ timeout: 10_000 });
            await editor.locator('#exportMapName').fill(mapName);
            await editor.locator('#exportTarget').selectOption('install').catch(() => {});
            const acknowledge = editor.locator('#exportWarningAcknowledge');
            if (await acknowledge.isVisible().catch(() => false)) await acknowledge.check();
            await editor.locator('#btnExportConfirm').click({ timeout: 10_000 });
            await editor.locator('#exportResultView').waitFor({ state: 'visible', timeout: 30_000 });
            const file = path.join(session.profile, 'curviosclash-app', 'maps', `${mapKey}.runtime.json`);
            await fs.access(file);
            return { mapKey, file };
        });
        await steps.run('the game lists the map after reopening the map selection', async () => {
            await openGameSubmenu(session.page).catch(() => {});
            await session.page.locator('#submenu-game:not(.hidden) [data-back]').click({ timeout: 10_000 }).catch(() => {});
            await openCustomSubmenu(session.page);
            await session.page.locator('#submenu-custom:not(.hidden) [data-mode-path="normal"]').click({ timeout: 10_000 });
            await session.page.locator(`#map-select option[value="${mapKey}"]`).waitFor({ state: 'attached', timeout: 15_000 });
        });
        await steps.run('play the saved map', async () => {
            await session.page.selectOption('#map-select', mapKey);
            await session.page.locator('#btn-start').click({ timeout: 10_000 });
            await session.page.waitForFunction((key) => window.GAME_INSTANCE?.arena?.currentMapKey === key && window.GAME_INSTANCE.state === 'PLAYING', mapKey, { timeout: 60_000 });
            await D.configurePilot(session, { mode: 'bot' });
            await cancellableSleep(4000, context.signal);
            await D.stopPilot(session, 'editor map flown');
            return { mapKey, alive: (await D.observe(session, { vector: false })).self?.alive };
        });
        await steps.run('start the editor playtest', async () => {
            const popup = editor.waitForEvent('popup', { timeout: 30_000 });
            await editor.locator('#btnPlaytest').click({ timeout: 10_000 });
            const playtest = await popup;
            await playtest.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING', null, { timeout: 60_000 });
            const key = await playtest.evaluate(() => window.GAME_INSTANCE.arena?.currentMapKey);
            await playtest.close();
            await editor.evaluate(() => window.CURVIOS_EDITOR?.ui?.markSaved?.()).catch(() => {});
            await editor.close();
            return { playtestMapKey: key };
        });
        await D.returnToMenu(session).catch(() => {});
    });
}

function probeVideo(file) {
    const ffmpeg = process.env.CURVIOS_RECORDING_FFMPEG_PATH || requireElectron('ffmpeg-static');
    return new Promise((resolve) => {
        execFile(ffmpeg, ['-hide_banner', '-i', file, '-map', '0:v:0', '-f', 'null', '-'], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (error, _stdout, stderr) => {
            const text = String(stderr || '');
            const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(text);
            const frames = [...text.matchAll(/frame=\s*(\d+)/g)].map((match) => Number(match[1])).at(-1) ?? 0;
            resolve({
                ok: !error, frames,
                durationSeconds: duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : null,
                tool: path.basename(ffmpeg),
            });
        });
    });
}

/** Records two seconds cinematic, renders it from the menu and checks the exported video. */
export function scenarioRecordingExport(run, session, context) {
    return runSteps(session, context, async (steps) => {
        let exported = null;
        await steps.run('start a match', async () => {
            await toMainMenu(session);
            await startGameFromMenu(session.page);
            await waitState(session.page, 'PLAYING', 60_000);
        });
        await steps.run('record with F8, stop with F9', async () => {
            await session.page.keyboard.press('F8');
            const started = await session.page.waitForFunction(() => window.GAME_INSTANCE?.mediaRecorderSystem?.isCinematicReplayRecording?.() === true, null, { timeout: 3000 })
                .then(() => true, () => false);
            if (!started) throw new Error('F8 did not start a cinematic recording');
            await cancellableSleep(2000, context.signal);
            await session.page.keyboard.press('F9');
            await session.page.waitForFunction(() => {
                const recorder = window.GAME_INSTANCE?.mediaRecorderSystem;
                return recorder?.isCinematicReplayRecording?.() === false && recorder?.listCinematicReplayRecordings?.().length >= 1;
            }, null, { timeout: 15_000 });
        });
        await steps.run('render the replay from the recording drawer', async () => {
            await D.returnToMenu(session);
            await openLevel4Drawer(session.page, { section: 'recording' });
            await session.page.locator('#cinematic-replay-render-button').click({ timeout: 10_000 });
            const savesDir = session.paths.saves;
            const deadline = Date.now() + 240_000;
            while (Date.now() < deadline) {
                throwIfCancelled(context.signal);
                const files = (await fs.readdir(savesDir).catch(() => [])).filter((name) => name.endsWith('.mp4'));
                if (files.length) {
                    const file = path.join(savesDir, files[0]);
                    const size = (await fs.stat(file)).size;
                    await cancellableSleep(1500, context.signal);
                    if ((await fs.stat(file)).size === size && size > 0) { exported = file; break; }
                }
                await cancellableSleep(1000, context.signal);
            }
            if (!exported) throw new Error('no video file arrived in the run folder');
            return { file: exported, note: 'save dialog answered by the playtest (intervention)' };
        });
        await steps.run('the video has frames and a duration', async () => {
            const probe = await probeVideo(exported);
            if (!probe.ok || probe.frames < 30 || !(probe.durationSeconds > 0.5)) throw new Error(`video not readable: ${JSON.stringify(probe)}`);
            return probe;
        });
    });
}

/** Local splitscreen: both players steer through their own device and turn the other way round. */
export function scenarioSplitscreen(run, session, context) {
    return runSteps(session, context, async (steps) => {
        await steps.run('start a splitscreen match from the menu', async () => {
            await toMainMenu(session);
            await selectSessionType(session.page, 'splitscreen');
            await session.page.locator('#submenu-custom:not(.hidden) [data-mode-path="normal"]').click({ timeout: 10_000 });
            await session.page.locator('#submenu-game:not(.hidden) #btn-start').click({ timeout: 10_000 });
            await session.page.waitForFunction(() => window.GAME_INSTANCE?.state === 'PLAYING' && (window.GAME_INSTANCE.entityManager?.humanPlayers?.length || 0) >= 2, null, { timeout: 60_000 });
        });
        await steps.run('player 1 turns right, player 2 turns left', async () => {
            const before = [await headingOf(session, 0), await headingOf(session, 1)];
            await D.configurePilot(session, { mode: 'maneuver', input: { turn: 1 }, frames: 60, player: 0 });
            await cancellableSleep(1300, context.signal);
            await D.configurePilot(session, { mode: 'maneuver', input: { turn: -1 }, frames: 60, player: 1 });
            await cancellableSleep(1300, context.signal);
            await D.stopPilot(session, 'splitscreen proof done');
            const after = [await headingOf(session, 0), await headingOf(session, 1)];
            const turned = [turnedDeg(before[0], after[0]), turnedDeg(before[1], after[1])];
            if (!(turned[0] <= -30 && turned[1] >= 30)) throw new Error(`turned ${turned.join(' / ')} degrees`);
            return { turnedDeg: turned, control: 'pilot as device 0 and device 1' };
        });
        await steps.run('back to the menu', async () => {
            await session.page.keyboard.press('Escape');
            await waitState(session.page, 'PAUSED', 10_000);
            await leaveMatchFromPauseMenu(session.page, { timeoutMs: 5000 });
            await waitState(session.page, 'MENU', 30_000);
        });
    });
}

/** Real LAN between two apps: host, join, ready, start, input both ways, leave. */
export function scenarioLan(run, _session, context, { visible = false } = {}) {
    return runSteps(null, context, async (steps) => {
        let lan = null;
        await steps.run('host, join, ready and start', async () => {
            // The session was opened with layout lan: that match is the one to test.
            lan = run.lan || await openLanMatch(run, { visible });
            return { code: lan.code, port: lan.port, localIndexes: lan.localIndexes };
        });
        await steps.run('guest input reaches the host', async () => {
            const proof = await proveGuestInput(run, { guestIndex: lan.localIndexes.guest, turn: 1 });
            if (!proof.proven) throw new Error(`host did not see the guest turn: ${JSON.stringify(proof.attempts)}`);
            return proof;
        });
        await steps.run('host input reaches the guest', async () => {
            const proof = await proveRemoteTurn(run, { from: 'host', to: 'guest', playerIndex: lan.localIndexes.host, turn: -1 });
            if (!proof.proven) throw new Error(`guest did not see the host turn: ${JSON.stringify(proof.attempts)}`);
            return { turnedDegreesOnGuest: proof.turnedDegrees, attempts: proof.attempts.length };
        });
        await steps.run('guest leaves', async () => leaveAsGuest(run));
    });
}

function modeForMap(map) {
    if (map.parcours) return { mode: 'ARCADE', pilot: { mode: 'parcours' } };
    if (map.excludedModes.includes('CLASSIC')) return { mode: 'HUNT', modePath: 'fight', pilot: { mode: 'combat', tactic: 'balanced' } };
    return { mode: 'CLASSIC', pilot: { mode: 'bot' } };
}

/** Every map: start it in a fitting mode, compare requested and loaded map, fly 15 s with the pilot. */
export async function scenarioAllMaps(run, session, context, { maps = null, seconds = 15 } = {}) {
    // The maps the menu offers (#map-select), not internal keys such as the editor test map.
    const catalog = await session.page.evaluate(() => {
        const maps = window.GAME_INSTANCE?.config?.MAPS || {};
        const offered = [...(document.querySelector('#map-select')?.options || [])].map((option) => option.value).filter(Boolean);
        const keys = offered.length ? offered : Object.keys(maps).filter((key) => key !== 'custom');
        return [...new Set(keys)].map((key) => ({
            key, parcours: maps[key]?.parcours?.enabled === true,
            excludedModes: Array.isArray(maps[key]?.excludedModes) ? maps[key].excludedModes : [],
        }));
    });
    const selected = maps ? catalog.filter((map) => maps.includes(map.key)) : catalog;
    const results = [];
    for (const [index, map] of selected.entries()) {
        throwIfCancelled(context.signal);
        context.progress({ map: map.key, index: index + 1, of: selected.length });
        if (map.key === 'custom') {
            // Offered as "Custom (Editor gespeichert)": needs a map saved in the editor first
            // (covered by editor_roundtrip). A fresh profile has none.
            results.push({ map: map.key, status: 'blocked', reason: 'needs a map saved in the editor; a fresh profile has none' });
            continue;
        }
        const plan = modeForMap(map);
        const startedAt = Date.now();
        const start = await D.startMatch(session, { map: map.key, mode: plan.mode, modePath: plan.modePath, bots: plan.mode === 'ARCADE' ? 0 : 1, vehicle: 'ship1', seed: 101 });
        run.interventions.push({ at: new Date().toISOString(), role: session.role, helper: 'start_match', args: { map: map.key, mode: plan.mode }, note: 'menu bypassed' });
        if (!start.ok) {
            results.push({ map: map.key, mode: plan.mode, status: 'failed', loaded: start.mapKey, problems: start.problems });
            continue;
        }
        await D.configurePilot(session, plan.pilot);
        await cancellableSleep(seconds * 1000, context.signal);
        const pilot = await D.pilotStatus(session);
        await D.stopPilot(session, 'map sweep step over');
        const fps = await D.measureFps(session, 1500).catch(() => null);
        const errors = await D.errorsSince(session, startedAt);
        const status = start.mapKey !== map.key ? 'failed' : (pilot.counters.frames < seconds * 30 ? 'unclear' : (errors.length ? 'failed' : 'passed'));
        results.push({
            map: map.key, mode: plan.mode, status, loaded: start.mapKey, loadMs: start.loadMs, problems: start.problems,
            pilotMode: plan.pilot.mode, pilotFrames: pilot.counters.frames, fps, errors: errors.slice(0, 5),
        });
        context.log(`${map.key}: ${status}`);
    }
    const failed = results.filter((entry) => entry.status === 'failed');
    const unclear = results.filter((entry) => entry.status === 'unclear');
    const blocked = results.filter((entry) => entry.status === 'blocked');
    return {
        status: failed.length ? 'failed' : (unclear.length ? 'unclear' : 'passed'),
        blocked: blocked.map((entry) => `${entry.map}: ${entry.reason}`),
        maps: results.length, passed: results.filter((entry) => entry.status === 'passed').length, failed: failed.map((entry) => entry.map),
        observations: blocked.length ? ['"Custom (Editor gespeichert)" is offered in the map list without a saved editor map and then starts standard without a notice'] : [],
        unclear: unclear.map((entry) => entry.map), results,
        gameBugs: results.flatMap((entry) => (entry.errors || []).map((error) => ({ map: entry.map, mode: entry.mode, seed: 101, ...error }))),
    };
}

/** Keyboard (WASD-style bindings) and mouse (menu clicks by coordinates) without the pilot. */
export function scenarioInputPaths(run, session, context) {
    return runSteps(session, context, async (steps) => {
        await steps.run('mouse: open the single player menu by coordinates', async () => {
            if (!await toMainMenu(session)) throw new Error('main menu level not reachable');
            const box = await session.page.locator('#menu-nav [data-session-type="single"]').boundingBox();
            if (!box) throw new Error('single player button not visible');
            await session.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await session.page.locator('#submenu-custom:not(.hidden)').waitFor({ state: 'visible', timeout: 10_000 });
            return { clickedAt: [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)] };
        });
        await steps.run('start a match from the menu', async () => {
            await startGameFromMenu(session.page);
            await waitState(session.page, 'PLAYING', 60_000);
        });
        await steps.run('keyboard: the yaw-right key turns the ship right', async () => {
            const key = await session.page.evaluate(() => window.GAME_INSTANCE.settings?.controls?.PLAYER_1?.RIGHT || 'KeyD');
            const before = await headingOf(session, 0);
            await session.page.keyboard.down(key);
            session.heldKeys.add(key);
            await cancellableSleep(800, context.signal);
            await session.page.keyboard.up(key);
            session.heldKeys.delete(key);
            const turned = turnedDeg(before, await headingOf(session, 0));
            if (turned > -20) throw new Error(`key ${key} turned the ship ${turned} degrees`);
            return { key, turnedDeg: turned, control: 'real key events (CDP), no pilot' };
        });
        await D.returnToMenu(session).catch(() => {});
    });
}

/**
 * Failure handling: closed window, renderer crash, busy lock, cancelled job. Afterwards
 * no key may be held and the crashed session's processes must be gone.
 */
export function scenarioFailureCases(run, session, context, { tryLock }) {
    return runSteps(null, context, async (steps) => {
        await steps.run('missing build is refused before launch', async () => {
            const error = await launchSession({ runDir: run.runDir, role: 'missing-build', entry: 'game', buildDir: path.join(run.runDir, 'no-build') })
                .then(() => null, (caught) => caught);
            if (error?.code !== 'PLAYTEST_BUILD_MISSING') throw new Error(`expected PLAYTEST_BUILD_MISSING, got ${error?.code || 'a running app'}`);
            return { code: error.code };
        });
        await steps.run('a renderer crash is recorded', async () => {
            const victim = await launchSession({ runDir: run.runDir, role: 'crash-probe' });
            await victim.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer());
            await cancellableSleep(3000, context.signal);
            const errors = await D.errorsSince(victim, 0);
            const pid = victim.pid;
            await closeSession(victim);
            const alive = await new Promise((resolve) => execFile('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { windowsHide: true }, (_e, out) => resolve(String(out).includes(String(pid)))));
            if (!errors.some((entry) => /crash|render-process-gone/.test(`${entry.kind} ${entry.text}`))) throw new Error('crash not recorded');
            if (alive) throw new Error(`process ${pid} still running after close`);
            return { recorded: errors.map((entry) => entry.kind), processGone: true };
        });
        await steps.run('a closed main window is noticed', async () => {
            const victim = await launchSession({ runDir: run.runDir, role: 'close-probe' });
            await victim.app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); });
            await cancellableSleep(3000, context.signal);
            const noticed = victim.closed === true || victim.page.isClosed();
            await closeSession(victim);
            if (!noticed) throw new Error('closing the window went unnoticed');
            return { noticed };
        });
        await steps.run('a busy lock is reported, not waited for', async () => tryLock());
        await steps.run('held keys are released on close', async () => {
            const probe = await launchSession({ runDir: run.runDir, role: 'keys-probe' });
            await probe.page.keyboard.down('KeyW');
            probe.heldKeys.add('KeyW');
            await closeSession(probe);
            if (probe.heldKeys.size) throw new Error('keys still marked as held');
            return { released: true };
        });
        if (session) await D.returnToMenu(session).catch(() => {});
        return { note: 'the job timeout and cancel paths are covered by the job registry contract test' };
    });
}

export async function screenshotOf(session, kind) {
    const page = await findWindowPage(session, kind, 3000);
    return page ? D.shot(session, `${kind}-${Date.now()}`, kind) : null;
}
