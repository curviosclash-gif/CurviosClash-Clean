/* global window, document */
// A real LAN match between two app processes on this machine, each with its own profile:
// the host opens a lobby through the menu, the guest joins with code and the manual
// address localhost:<port> (UDP discovery between two local processes is not relied on),
// both get ready, the host starts. Input proof: the guest's pilot steers through the
// guest's regular input path and the host must see the guest ship turn.
import { configurePilot, installControl, stopPilot } from './playtest-control.mjs';
import { launchSession } from './playtest-session.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitInPage(page, predicate, arg, timeoutMs, label) {
    try {
        await page.waitForFunction(predicate, arg, { timeout: timeoutMs, polling: 250 });
    } catch (error) {
        throw new Error(`${label} (waited ${timeoutMs} ms): ${error?.message?.split('\n')[0] || error}`);
    }
}

const lobbyState = (page) => page.evaluate(() => {
    const state = window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.() || null;
    return state && {
        joined: state.joined, role: state.role, memberCount: state.memberCount, readyCount: state.readyCount,
        allReady: state.allReady, canStart: state.canStart, connectionPhase: state.connectionPhase,
        lobbyCode: state.lobbyCode, shareAddress: state.shareAddress, signalingUrl: state.signalingUrl,
    };
});

async function openMultiplayerMenu(page) {
    await page.locator('#menu-nav [data-session-type="multiplayer"]').click({ timeout: 15_000 });
    await page.locator('#submenu-multiplayer').waitFor({ state: 'visible', timeout: 15_000 });
    await page.locator('#btn-multiplayer-transport-lan').click({ timeout: 5000 }).catch(() => {});
}

/** Launches host and guest into `run.runDir` and brings them into one running LAN match. */
export async function openLanMatch(run, { visible = false, mapKey = null } = {}) {
    const steps = [];
    const host = await launchSession({ runDir: run.runDir, role: 'host', visible });
    run.sessions.set('host', host);
    const guest = await launchSession({ runDir: run.runDir, role: 'guest', visible });
    run.sessions.set('guest', guest);
    steps.push('both apps ready');

    await openMultiplayerMenu(host.page);
    await host.page.locator('[data-connection-intent-target="host"]').click({ timeout: 10_000 });
    await host.page.locator('#btn-multiplayer-host').click({ timeout: 10_000 });
    await host.page.locator('#multiplayer-session-controls').waitFor({ state: 'visible', timeout: 30_000 });
    const code = (await host.page.locator('#multiplayer-share-code').textContent())?.trim();
    const server = await host.page.evaluate(() => window.curviosApp?.getLanServerStatus?.());
    const port = server?.port;
    if (!code || !port) throw new Error(`host lobby incomplete: code ${code}, port ${port}`);
    steps.push(`host lobby ${code} on port ${port}`);

    await openMultiplayerMenu(guest.page);
    await guest.page.locator('[data-connection-intent-target="join"]').click({ timeout: 10_000 }).catch(() => {});
    await guest.page.locator('#multiplayer-lobby-code').fill(code, { timeout: 10_000 });
    await guest.page.locator('#multiplayer-manual-address summary').click({ timeout: 5000 });
    await guest.page.locator('#multiplayer-host-address').fill(`localhost:${port}`, { timeout: 5000 });
    await guest.page.locator('#btn-multiplayer-join').click({ timeout: 10_000 });
    await waitInPage(host.page, () => window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.()?.memberCount === 2, null, 30_000, 'guest did not appear in the host lobby');
    steps.push('guest joined');

    if (mapKey) {
        await host.page.evaluate(async (key) => {
            const game = window.GAME_INSTANCE;
            game.settings.mapKey = key;
            await Promise.resolve(game._onSettingsChanged?.());
        }, mapKey);
        run.interventions.push({ at: new Date().toISOString(), role: 'host', helper: 'set_setting', args: { path: 'mapKey', value: mapKey } });
    }
    // Blur the code field first: key events are ignored while a text input has focus.
    await guest.page.evaluate(() => document.activeElement?.blur?.());
    await guest.page.locator('#multiplayer-ready-toggle').check({ timeout: 10_000 });
    await waitInPage(host.page, () => window.GAME_INSTANCE?.menuMultiplayerBridge?.getSessionState?.()?.canStart === true, null, 30_000, 'host can not start (guest not ready or not connected)');
    steps.push('guest ready, host can start');

    await host.page.locator('#btn-multiplayer-start').click({ timeout: 10_000 });
    for (const [role, session] of [['host', host], ['guest', guest]]) {
        await waitInPage(session.page, () => window.GAME_INSTANCE?.state === 'PLAYING' && (window.GAME_INSTANCE.entityManager?.players?.length || 0) >= 2,
            null, 60_000, `${role} did not reach PLAYING with two players`);
    }
    steps.push('match running on both');
    await installControl(host);
    await installControl(guest);
    const localIndexes = {
        host: await host.page.evaluate(() => window.GAME_INSTANCE.runtimeConfig?.session?.localPlayerIndex ?? 0),
        guest: await guest.page.evaluate(() => window.GAME_INSTANCE.runtimeConfig?.session?.localPlayerIndex ?? 1),
    };
    return { code, port, steps, localIndexes, lobby: { host: await lobbyState(host.page), guest: await lobbyState(guest.page) } };
}

const headingOf = (page, index) => page.evaluate((playerIndex) => {
    const ship = window.GAME_INSTANCE.entityManager?.players?.find((entry) => entry.index === playerIndex);
    if (!ship) return null;
    const forward = new ship.position.constructor(0, 0, -1).applyQuaternion(ship.quaternion);
    return { yaw: Math.atan2(-forward.x, -forward.z), pos: [ship.position.x, ship.position.y, ship.position.z] };
}, index);

/**
 * Proves guest input reaches the host: the guest pilot holds a hard turn for 1.5 s and
 * the host's copy of the guest ship must turn by a clear angle in the same direction.
 */
const aliveOn = (page, index) => page.evaluate((playerIndex) => {
    const ship = window.GAME_INSTANCE?.entityManager?.players?.find((entry) => entry.index === playerIndex);
    return window.GAME_INSTANCE?.state === 'PLAYING' && ship?.alive !== false && Boolean(ship);
}, index);

/**
 * One side's pilot turns its own ship; the other side must see that ship turn the same
 * way. A ship that already crashed (CLASSIC: one life per round) cannot turn, so each
 * attempt first waits until the ship is alive on both sides; up to four attempts.
 */
// 600 ms at about 137 degrees per second is ~80 degrees: well clear of noise and far from
// the 180 degree wrap that would flip the measured direction.
export async function proveRemoteTurn(run, { from, to, playerIndex, turn = 1, ms = 600 }) {
    const sender = run.sessions.get(from);
    const receiver = run.sessions.get(to);
    const attempts = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline && !(await aliveOn(sender.page, playerIndex) && await aliveOn(receiver.page, playerIndex))) await sleep(250);
        const before = await headingOf(receiver.page, playerIndex);
        await configurePilot(sender, { mode: 'maneuver', input: { turn, climb: 0, roll: 0 }, frames: Math.round(ms / 1000 * 60), player: playerIndex });
        await sleep(ms + 600);
        await stopPilot(sender, 'input proof done');
        const after = await headingOf(receiver.page, playerIndex);
        const stillAlive = await aliveOn(receiver.page, playerIndex);
        if (!before || !after) { attempts.push({ reason: 'ship not found on the receiving side' }); continue; }
        let delta = after.yaw - before.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        // turn > 0 is a right turn, which lowers this yaw angle.
        const degrees = Math.round(delta * 180 / Math.PI);
        const proven = Math.sign(delta) === (turn > 0 ? -1 : 1) && Math.abs(degrees) >= 30;
        attempts.push({ turnedDegrees: degrees, aliveAfter: stillAlive });
        if (proven) return { proven: true, turnedDegrees: degrees, attempts };
    }
    return { proven: false, attempts };
}

export async function proveGuestInput(run, { guestIndex = 1, turn = 1, ms = 600 } = {}) {
    const result = await proveRemoteTurn(run, { from: 'guest', to: 'host', playerIndex: guestIndex, turn, ms });
    return { ...result, turnedDegreesOnHost: result.turnedDegrees ?? null };
}

/** The guest leaves through the pause menu ("Verbindung trennen"); the host must see it. */
export async function leaveAsGuest(run) {
    const host = run.sessions.get('host');
    const guest = run.sessions.get('guest');
    await guest.page.keyboard.press('Escape');
    await guest.page.locator('#pause-overlay').waitFor({ state: 'visible', timeout: 10_000 });
    await guest.page.locator('#btn-pause-menu').click({ timeout: 10_000 });
    await waitInPage(guest.page, () => window.GAME_INSTANCE?.state === 'MENU', null, 30_000, 'guest did not return to the menu');
    await guest.page.locator('#btn-multiplayer-leave').click({ timeout: 10_000 }).catch(() => {});
    await sleep(2500);
    return { guestState: await guest.page.evaluate(() => window.GAME_INSTANCE.state), hostState: await host.page.evaluate(() => window.GAME_INSTANCE.state), hostLobby: await lobbyState(host.page) };
}
