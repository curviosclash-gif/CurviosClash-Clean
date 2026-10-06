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

/**
 * Which app window a URL belongs to. The editor playtest shares the main window's title,
 * so the URL is the only reliable mark.
 */
export function classifyPlaytestWindow(url) {
    let parsed = null;
    try { parsed = new URL(String(url || '')); } catch { return 'unknown'; }
    const pathname = decodeURIComponent(parsed.pathname).replace(/\\/g, '/');
    if (parsed.searchParams.get('playtest') === '1') return 'editor-playtest';
    if (pathname.endsWith('/hangar.html')) return 'hangar';
    if (pathname.endsWith('/editor/map-editor-3d.html')) return 'editor';
    if (pathname.includes('/prototypes/vehicle-lab/')) return 'vehicle-lab';
    if (pathname.endsWith('/tuning-console/tuning.html') || (parsed.protocol === 'data:' && /tuning/i.test(pathname))) return 'tuning';
    if (pathname.endsWith('/settings-studio.html')) return 'settings-studio';
    if (parsed.protocol.startsWith('http') && (pathname === '/' || pathname.endsWith('/index.html'))) return 'main';
    return 'unknown';
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

const MANEUVER_AXES = ['turn', 'climb', 'roll'];
const MANEUVER_TAPS = ['boost', 'fireRocket', 'useItem', 'nextItem'];
const MANEUVER_HOLDS = ['fireMG'];

/**
 * A direct maneuver in the pilot's words: turn (+ right), climb (+ nose up), roll
 * (+ right) from -1 to 1, fireMG held, boost / fireRocket / useItem / nextItem tapped
 * once. The pilot turns this into device input and compensates the player's own invert
 * settings, as a person at the controls would. Unknown fields are refused, so a typo
 * cannot reach the game as a silent no-op.
 */
export function sanitizePilotManeuver(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const known = [...MANEUVER_AXES, ...MANEUVER_TAPS, ...MANEUVER_HOLDS];
    const unknown = Object.keys(source).filter((key) => !known.includes(key));
    if (unknown.length) throw new Error(`unknown maneuver field(s): ${unknown.join(', ')}; allowed: ${known.join(', ')}`);
    const sanitized = {};
    for (const key of MANEUVER_AXES) {
        const value = Number(source[key] ?? 0);
        sanitized[key] = Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
    }
    for (const key of [...MANEUVER_TAPS, ...MANEUVER_HOLDS]) sanitized[key] = source[key] === true;
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
    if (Number.isInteger(request.bots) && Number.isInteger(result.bots) && result.bots !== request.bots) {
        problems.push(`bots are ${result.bots}, not ${request.bots}`);
    }
    if (Number.isInteger(request.winsNeeded) && Number.isInteger(result.winsNeeded) && result.winsNeeded !== request.winsNeeded) {
        problems.push(`winsNeeded is ${result.winsNeeded}, not ${request.winsNeeded}`);
    }
    if (Number.isInteger(request.seed) && request.mode === 'ARCADE' && Number.isInteger(result.seedActual) && result.seedActual !== request.seed) {
        problems.push(`arcade seed is ${result.seedActual}, not ${request.seed}`);
    }
    return problems;
}

export const ACCEPTANCE_ATTEMPTS = 10;

/**
 * The flight acceptance verdict. Every attempt counts, a blocked one as a miss; the
 * threshold is never lowered. passed: at least `required` successes out of ten.
 * blocked: blocked attempts alone made the threshold unreachable. unclear: fewer than
 * ten attempts were run. failed: otherwise. Errors seen during attempts are listed
 * separately as game bugs with the seed that reproduces them.
 */
export function evaluateAcceptance({ kind, map, attempts = [], required, successKey }) {
    const successes = attempts.filter((attempt) => attempt?.[successKey] === true).length;
    const blocked = attempts.filter((attempt) => attempt?.blocked === true).length;
    let status = 'failed';
    if (attempts.length < ACCEPTANCE_ATTEMPTS) status = 'unclear';
    else if (successes >= required) status = 'passed';
    else if (successes + blocked >= required) status = 'blocked';
    const gameBugs = attempts.flatMap((attempt, index) => (attempt?.errors || []).map((error) => ({
        attempt: index + 1, seed: attempt.seed ?? null, map, ...error,
    })));
    return {
        status, kind, map, required: `${required}/${ACCEPTANCE_ATTEMPTS}`, result: `${successes}/${attempts.length}`,
        successes, blocked, attempts, gameBugs,
    };
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
    { file: 'src/core/InputManager.js', needle: 'getKeyboardInput(playerIndex, options = {}) {' },
    { file: 'src/core/GameRuntimeFacade.js', needle: 'get arcadeRunRuntime()' },
    { file: 'src/core/arcade/ArcadeRunRuntime.js', needle: 'getStateSnapshot() {' },
    { file: 'src/entities/EntityManager.js', needle: 'getParcoursRouteSnapshot' },
    { file: 'src/entities/EntityManager.js', needle: 'getHuntScoreboard()' },
    { file: 'src/entities/EntityManager.js', needle: 'getHuntOverheatSnapshot()' },
    { file: 'src/entities/systems/ParcoursProgressSystem.js', needle: 'getPlayerProgressSnapshot(' },
    { file: 'src/entities/systems/MapUnitSystem.js', needle: 'this.units = []' },
    { file: 'src/entities/Powerup.js', needle: 'this.items = []' },
    { file: 'src/entities/arena/ArenaCollision.js', needle: 'checkCollisionFast(position, radius = 0) {' },
    { file: 'src/entities/arena/ArenaGeometryCompilePipeline.js', needle: 'innerRadius: solid ? 0 : safeInnerRadius' },
    // Arcade test driver: continue intermissions, finish a won run, read the summary, hunt map units.
    { file: 'src/core/main.js', needle: 'this.matchFlowUiController' },
    { file: 'src/ui/MatchFlowUiController.js', needle: 'this.runtimePort = ' },
    { file: 'src/shared/runtime/UiControllerRuntimePorts.js', needle: 'controllerPort.setArcadeIntermissionPaused = ' },
    { file: 'src/shared/runtime/UiControllerRuntimePorts.js', needle: 'controllerPort.setRoundPause = ' },
    { file: 'src/shared/runtime/UiControllerRuntimePorts.js', needle: 'controllerPort.resolveArcadeVictoryChoice = ' },
    { file: 'src/shared/runtime/UiControllerRuntimePorts.js', needle: 'controllerPort.applyRoundEndTransition = ' },
    { file: 'src/core/arcade/ArcadeRunRuntime.js', needle: 'getPostRunSummary() {' },
    { file: 'src/entities/ai/BotTargetingOps.js', needle: 'player.botTargetsMapUnits === true' },
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
