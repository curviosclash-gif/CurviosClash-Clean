// Pure helpers of the autonomous playtest driver. No Playwright, no Electron, so a
// contract test can load them in plain Node.
import { timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

export const PLAYTEST_TOKEN_HEADER = 'x-playtest-token';

// Console noise that says nothing about the game: Chromium autofill and DevTools chatter,
// the missing favicon, and the meta-CSP note about frame-ancestors.
const NOISE_PATTERN = /Autofill|DevTools|favicon|frame-ancestors/i;

/** Output folder for profiles, shots and results; one per day unless CURVIOS_PLAYTEST_OUT is set. */
export function resolvePlaytestOutDir(env = process.env, now = new Date(), tmpDir = os.tmpdir()) {
    const explicit = String(env?.CURVIOS_PLAYTEST_OUT || '').trim();
    if (explicit) return path.resolve(explicit);
    const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
        .map((part) => String(part).padStart(2, '0'))
        .join('');
    return path.join(tmpDir, `curvios-playtest-${day}`);
}

/**
 * Where the daemon leaves its port and token. Deliberately not in the per-day output
 * folder: a client started after midnight would look in the next day's folder.
 */
export function resolveDaemonStateFile(env = process.env, tmpDir = os.tmpdir()) {
    const explicit = String(env?.CURVIOS_PLAYTEST_OUT || '').trim();
    if (explicit) return path.join(path.resolve(explicit), 'daemon.json');
    return path.join(tmpDir, 'curvios-playtest-daemon.json');
}

/** A file name that is safe on Windows and still readable in a report. */
export function sanitizeShotName(name) {
    const cleaned = String(name || '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
    return cleaned || 'shot';
}

/** Path length flown across samples of the form { pos: [x, y, z] | null }. */
export function distanceTravelled(samples) {
    let distance = 0;
    for (let index = 1; index < (samples?.length || 0); index += 1) {
        const from = samples[index - 1]?.pos;
        const to = samples[index]?.pos;
        if (!from || !to) continue;
        distance += Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
    }
    return Math.round(distance);
}

/** Deaths seen as an alive -> dead step between consecutive samples. */
export function countDeaths(samples) {
    let deaths = 0;
    for (let index = 1; index < (samples?.length || 0); index += 1) {
        if (samples[index - 1]?.alive === true && samples[index]?.alive === false) deaths += 1;
    }
    return deaths;
}

/** Errors recorded at or after sinceMs, without known console noise. */
export function filterPlaytestErrors(errors, sinceMs = 0) {
    return (errors || []).filter((entry) => entry.at >= sinceMs && !NOISE_PATTERN.test(entry.text));
}

export const SIM_STEP_SECONDS = 1 / 60;

/** Fixed simulation steps (1/60 s each) that cover ms of game time; at least one. */
export function framesForMs(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value <= 0) return 1;
    return Math.max(1, Math.round(value / 1000 / SIM_STEP_SECONDS));
}

const ACTION_AXES = ['pitchAxis', 'yawAxis', 'rollAxis'];
const ACTION_FLAGS = [
    'pitchUp', 'pitchDown', 'yawLeft', 'yawRight', 'rollLeft', 'rollRight',
    'boost', 'shootMG', 'shootRocket', 'shootItem', 'nextItem', 'dropItem',
];

/**
 * The control input an agent may hold for a while, in the field names of the bot action
 * contract (src/entities/ai/actions/BotActionContract.js). Axes are clamped to -1..1,
 * unknown fields are dropped, so a typo cannot reach the game as a silent no-op.
 */
export function sanitizePlaytestAction(action = {}) {
    const source = action && typeof action === 'object' ? action : {};
    const unknown = Object.keys(source).filter((key) => (
        !ACTION_AXES.includes(key) && !ACTION_FLAGS.includes(key) && key !== 'useItem' && key !== 'shootItemIndex'
    ));
    if (unknown.length) throw new Error(`unknown action field(s): ${unknown.join(', ')}`);
    const sanitized = {};
    for (const key of ACTION_AXES) {
        const value = Number(source[key]);
        if (source[key] != null && Number.isFinite(value)) sanitized[key] = Math.max(-1, Math.min(1, value));
    }
    for (const key of ACTION_FLAGS) sanitized[key] = source[key] === true;
    for (const key of ['useItem', 'shootItemIndex']) {
        sanitized[key] = Number.isInteger(source[key]) && source[key] >= 0 ? source[key] : -1;
    }
    return sanitized;
}

/** Turns the raw observation vector into { KEY: value } using the bot observation semantics. */
export function nameObservation(vector, semantics) {
    if (!Array.isArray(vector) || vector.length === 0) return null;
    const named = {};
    for (const entry of semantics || []) {
        const value = vector[entry.index];
        if (Number.isFinite(value)) named[entry.key] = Math.round(value * 1000) / 1000;
    }
    return named;
}

/** What went wrong with a match start compared with what was asked for; empty when fine. */
export function describeMatchStartProblems(request = {}, result = {}) {
    const problems = [];
    if (result.menuReached === false) problems.push(`menu not reached before start (state ${result.state})`);
    if (!result.ok) problems.push(`match did not reach PLAYING (state ${result.state})`);
    if (request.map && result.mapKey && result.mapKey !== request.map) {
        problems.push(`map fell back from ${request.map} to ${result.mapKey}`);
    }
    if (request.mode && result.gameMode && result.gameMode !== request.mode) {
        problems.push(`mode is ${result.gameMode}, not ${request.mode}`);
    }
    if (result.glbError) problems.push(`map model failed to load: ${result.glbError}`);
    return problems;
}

/** Rejects with a timeout error if the promise is not settled within ms. */
export function withTimeout(promise, ms, label = 'step') {
    let timer = null;
    const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out after ${ms} ms`), { code: 'PLAYTEST_TIMEOUT' })), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Internal game names the driver reaches into. They are not a public API, so a contract
 * test checks each one still exists in src/ and a rename breaks the test instead of the
 * next playtest.
 */
export const PLAYTEST_RUNTIME_HOOKS = Object.freeze([
    { file: 'src/core/main.js', needle: '_returnToMenu(' },
    { file: 'src/core/main.js', needle: '_onSettingsChanged(' },
    { file: 'src/core/main.js', needle: 'runtimeFacade' },
    { file: 'src/core/main.js', needle: 'this.gameLoop' },
    { file: 'src/core/GameLoop.js', needle: 'this.updateFn(this.fixedStep)' },
    { file: 'src/entities/Arena.js', needle: 'this.currentMapKey' },
    { file: 'src/entities/Arena.js', needle: '_glbLoadError' },
    { file: 'src/entities/EntityManager.js', needle: 'this.botByPlayer = new Map()' },
    { file: 'src/entities/EntityManager.js', needle: 'botPolicyRegistry' },
    { file: 'src/entities/EntityManager.js', needle: '_playerInputSystem' },
    { file: 'src/entities/EntityManager.js', needle: '_eventBus' },
    { file: 'src/entities/runtime/EntityTickPipeline.js', needle: '_playerInputSystem.resolvePlayerInput(player, dt, inputManager)' },
    { file: 'src/entities/systems/PlayerInputSystem.js', needle: 'resolvePlayerInput(player, dt, inputManager) {' },
    { file: 'src/entities/systems/PlayerInputSystem.js', needle: '_buildBotObservation(player, policy, runtimeContext) {' },
    { file: 'src/entities/systems/PlayerInputSystem.js', needle: '_resolveRuntimeContext(player, dt, entityManager, options = {}) {' },
    { file: 'src/entities/runtime/EntityEventBus.js', needle: 'emitPlayerDied(player, cause) {' },
    { file: 'src/entities/runtime/EntityEventBus.js', needle: 'emitRoundEnd(winner, outcome = null) {' },
    { file: 'src/entities/runtime/EntityEventBus.js', needle: 'emitHuntDamageEvent(event) {' },
    { file: 'src/entities/runtime/EntityEventBus.js', needle: 'emitPlayerFeedback(player, message) {' },
    { file: 'src/entities/runtime/EntityEventBus.js', needle: 'emitHuntFeed(message) {' },
    { file: 'src/entities/Player.js', needle: 'markRenderDiscontinuity(' },
    { file: 'src/entities/Player.js', needle: 'addToInventory(' },
]);

/**
 * The control server runs code it receives, so it only answers a POST that carries the
 * session token and no Origin header. A web page in a browser always sends Origin on a
 * cross-site POST and cannot read the token, so it can never drive the game.
 */
export function isAuthorizedPlaytestRequest(request, token) {
    if (!request || request.method !== 'POST') return false;
    const headers = request.headers || {};
    if (headers.origin !== undefined) return false;
    const presented = String(headers[PLAYTEST_TOKEN_HEADER] || '');
    const expected = String(token || '');
    if (!expected || presented.length !== expected.length) return false;
    return timingSafeEqual(Buffer.from(presented), Buffer.from(expected));
}
