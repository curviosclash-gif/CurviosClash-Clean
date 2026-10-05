/* global window */
// Hooks that let an agent play instead of only watch: freeze the fixed-step simulation
// and advance it frame by frame, hold a control input on the human ship, let the bot
// pilot fly it, read a situation report and a log of game events. Everything is
// installed into the running renderer and re-installed after each match start, because
// every match builds a new entity manager. Page callbacks run in the renderer.
import { OBSERVATION_SEMANTICS_V1 } from '../../src/entities/ai/observation/ObservationSemantics.js';
import { framesForMs, nameObservation, sanitizePlaytestAction, SIM_STEP_SECONDS } from './playtest-support.mjs';

const EVENT_LOG_LIMIT = 1000;

/**
 * Idempotent: gates the game loop's update step (pause / step), wraps the input
 * resolution of the current entity manager (act / autopilot) and taps its event bus.
 */
export async function installControl(session) {
    return session.page.evaluate((eventLimit) => {
        const game = window.GAME_INSTANCE;
        const control = window.__playtest || (window.__playtest = {
            paused: false, budget: 0, simFrame: 0, action: null, actionFrames: 0,
            pilot: false, pilotType: null, events: [], eventSeq: 0,
        });
        const loop = game.gameLoop;
        if (loop && !loop.__playtestGate) {
            const update = loop.updateFn;
            loop.updateFn = (dt) => {
                if (control.paused) {
                    if (control.budget <= 0) return undefined;
                    control.budget -= 1;
                }
                control.simFrame += 1;
                return update(dt);
            };
            loop.__playtestGate = true;
        }
        const manager = game.entityManager;
        const inputSystem = manager?._playerInputSystem;
        if (inputSystem && !inputSystem.__playtestHooked) {
            const resolve = inputSystem.resolvePlayerInput.bind(inputSystem);
            const createPilot = (type) => {
                const pilot = manager.botPolicyRegistry.create(type || manager.botPolicyType, {
                    difficulty: manager.botDifficulty, recorder: manager.recorder, runtimeConfig: manager.runtimeConfig,
                    runtimeProfiler: manager.runtimeProfiler, entityRuntimeConfig: manager.entityRuntimeConfig,
                    bridgeEnabled: manager.botBridgeEnabled, activeGameMode: manager.combatModeType,
                    isDesktopRuntime: manager.botIsDesktopRuntime, runtimeRng: manager.runtimeRng,
                });
                pilot.__playtestPilot = true;
                return pilot;
            };
            inputSystem.__playtestCreatePilot = createPilot;
            inputSystem.resolvePlayerInput = (player, dt, inputManager) => {
                if (player !== manager.humanPlayers[0]) return resolve(player, dt, inputManager);
                if (control.action) {
                    // Keyboard path with no key down, then the agent's held input on top.
                    const input = resolve(player, dt, inputManager);
                    Object.assign(input, control.action);
                    control.actionFrames -= 1;
                    if (control.actionFrames <= 0) control.action = null;
                    return input;
                }
                if (!control.pilot) return resolve(player, dt, inputManager);
                // The guided-rocket routing clears autopilotActive every frame, so the
                // human counts as a bot only while its own input is resolved.
                if (!manager.botByPlayer.get(player)) manager.botByPlayer.set(player, createPilot(control.pilotType));
                const wasBot = player.isBot;
                player.isBot = true;
                try { return resolve(player, dt, inputManager); } finally { player.isBot = wasBot; }
            };
            inputSystem.__playtestHooked = true;
        }
        const bus = manager?._eventBus;
        if (bus && !bus.__playtestTapped) {
            const flat = (value) => {
                if (value == null || typeof value !== 'object') return value ?? null;
                const out = {};
                for (const [key, entry] of Object.entries(value).slice(0, 24)) {
                    if (['string', 'number', 'boolean'].includes(typeof entry)) out[key] = entry;
                    else if (Number.isInteger(entry?.index)) out[`${key}Index`] = entry.index;
                }
                return out;
            };
            const push = (type, data) => {
                try {
                    control.events.push({ seq: ++control.eventSeq, frame: control.simFrame, type, ...data });
                    if (control.events.length > eventLimit) control.events.shift();
                } catch { /* the log must never break the game */ }
            };
            const tap = (method, describe) => {
                const original = bus[method].bind(bus);
                bus[method] = (...args) => { push(...describe(...args)); return original(...args); };
            };
            const human = () => manager.humanPlayers[0];
            tap('emitPlayerDied', (player, cause) => ['death', { player: player?.index ?? null, isHuman: player === human(), cause: flat(cause) }]);
            tap('emitRoundEnd', (winner, outcome) => ['round_end', {
                winner: winner?.index ?? null, humanWon: Boolean(winner) && winner === human(), outcome: flat(outcome),
            }]);
            tap('emitHuntDamageEvent', (event) => ['damage', flat(event) || {}]);
            tap('emitPlayerFeedback', (player, message) => ['feedback', { player: player?.index ?? null, message: String(message) }]);
            tap('emitHuntFeed', (message) => ['feed', { message: typeof message === 'string' ? message : flat(message) }]);
            bus.__playtestTapped = true;
        }
        return { loop: Boolean(loop?.__playtestGate), input: Boolean(inputSystem?.__playtestHooked), events: Boolean(bus?.__playtestTapped) };
    }, EVENT_LOG_LIMIT);
}

/** Clears pause, held input and the event log; the autopilot choice survives. */
export async function resetControl(session) {
    return session.page.evaluate(() => {
        const control = window.__playtest;
        if (!control) return;
        Object.assign(control, { paused: false, budget: 0, action: null, actionFrames: 0, events: [] });
    });
}

/** Waits in the page until the step budget (paused) or the held input (running) is used up. */
async function waitForControl(session, frames) {
    const limitMs = Math.round(frames * SIM_STEP_SECONDS * 1000 * 4) + 5000;
    return session.page.evaluate(async (maxMs) => {
        const control = window.__playtest;
        const startedAt = performance.now();
        const done = () => (control.paused ? control.budget <= 0 : !control.action);
        while (!done() && performance.now() - startedAt < maxMs) await new Promise((resolve) => setTimeout(resolve, 16));
        const leftover = control.action ? control.actionFrames : 0;
        // A dead or despawned ship never consumes its input; drop it instead of replaying it later.
        control.action = null;
        control.actionFrames = 0;
        return { completed: done() && leftover === 0, leftoverFrames: leftover, simFrame: control.simFrame, waitedMs: Math.round(performance.now() - startedAt) };
    }, limitMs);
}

export async function setPaused(session, paused) {
    await installControl(session);
    return session.page.evaluate((value) => {
        const control = window.__playtest;
        control.paused = value;
        control.budget = 0;
        return { paused: control.paused, simFrame: control.simFrame };
    }, Boolean(paused));
}

/** Advances a paused game by ms of game time (whole 1/60 s steps) and stays paused. */
export async function step(session, ms = 100) {
    await installControl(session);
    const frames = framesForMs(ms);
    await session.page.evaluate((count) => {
        const control = window.__playtest;
        control.paused = true;
        control.budget = count;
    }, frames);
    return { frames, ...(await waitForControl(session, frames)) };
}

/**
 * Holds a control input on the human ship for ms of game time. Paused: the game advances
 * exactly that long and stays paused (one gym-style step). Running: real time passes.
 */
export async function act(session, action, ms = 250) {
    const sanitized = sanitizePlaytestAction(action);
    await installControl(session);
    const frames = framesForMs(ms);
    await session.page.evaluate(({ input, count }) => {
        const control = window.__playtest;
        control.action = input;
        control.actionFrames = count;
        if (control.paused) control.budget = count;
    }, { input: sanitized, count: frames });
    return { frames, ...(await waitForControl(session, frames)) };
}

/** Lets the game's own bot policy fly the human ship, across rounds and new matches. */
export async function enableAutopilot(session, policyType = null) {
    await installControl(session);
    return session.page.evaluate((requestedType) => {
        const control = window.__playtest;
        const manager = window.GAME_INSTANCE.entityManager;
        const human = manager?.humanPlayers?.[0];
        control.pilot = true;
        control.pilotType = requestedType;
        if (!human) return false;
        const current = manager.botByPlayer.get(human);
        if (!current || current.__playtestPilot) {
            manager.botByPlayer.set(human, manager._playerInputSystem.__playtestCreatePilot(requestedType));
        }
        return true;
    }, policyType);
}

export async function disableAutopilot(session) {
    return session.page.evaluate(() => {
        const control = window.__playtest;
        if (control) control.pilot = false;
        const manager = window.GAME_INSTANCE.entityManager;
        const human = manager?.humanPlayers?.[0];
        if (human && manager.botByPlayer.get(human)?.__playtestPilot) manager.botByPlayer.delete(human);
    });
}

/** Game events since `sinceSeq` (deaths, round ends, hunt damage, feedback, feed lines). */
export async function readEvents(session, sinceSeq = 0) {
    await installControl(session);
    return session.page.evaluate((since) => {
        const control = window.__playtest;
        return { lastSeq: control.eventSeq, events: control.events.filter((entry) => entry.seq > since) };
    }, Number(sinceSeq) || 0);
}

/**
 * Situation report for deciding the next input: own ship, every other ship relative to
 * the own nose (ahead / right / up, angle off the nose) and the bots' observation vector
 * with names (wall distances, threat, target alignment, ...).
 */
export async function observe(session, { vector = true } = {}) {
    await installControl(session);
    const raw = await session.page.evaluate((wantVector) => {
        const game = window.GAME_INSTANCE;
        const control = window.__playtest;
        const manager = game.entityManager;
        const human = manager?.humanPlayers?.[0];
        const round = (value, digits = 1) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);
        const base = {
            state: game.state, simFrame: control.simFrame, paused: control.paused, autopilot: control.pilot,
            roundEnded: manager?._roundEnded === true, lastEventSeq: control.eventSeq,
        };
        if (!human) return base;
        const origin = human.position;
        const Vector = origin.constructor;
        const toLocal = human.quaternion.clone().invert();
        const forward = new Vector(0, 0, -1).applyQuaternion(human.quaternion);
        const opponents = [];
        for (const other of manager.players || []) {
            if (!other || other === human) continue;
            const relative = new Vector().subVectors(other.position, origin);
            const distance = relative.length();
            relative.applyQuaternion(toLocal);
            const ahead = -relative.z;
            opponents.push({
                index: other.index, bot: Boolean(other.isBot), alive: other.alive !== false, hp: round(other.hp),
                distance: Math.round(distance), ahead: Math.round(ahead), right: Math.round(relative.x), up: Math.round(relative.y),
                offNoseDeg: distance > 0 ? Math.round(Math.acos(Math.max(-1, Math.min(1, ahead / distance))) * 180 / Math.PI) : 0,
            });
        }
        opponents.sort((left, right) => (right.alive - left.alive) || (left.distance - right.distance));
        let observation = null;
        if (wantVector) {
            try {
                const inputSystem = manager._playerInputSystem;
                const context = inputSystem._resolveRuntimeContext(human, 1 / 60, manager, { includeObservationContext: true });
                const built = inputSystem._buildBotObservation(human, { requiresObservation: true }, context);
                observation = built && typeof built.length === 'number' ? Array.from(built, Number) : null;
            } catch (error) {
                observation = `ERR ${error?.message || error}`;
            }
        }
        return {
            ...base,
            self: {
                alive: human.alive !== false, hp: round(human.hp), maxHp: human.maxHp ?? null, shield: round(human.shieldHP),
                speed: round(human.speed), pos: [origin.x, origin.y, origin.z].map(Math.round),
                forward: [forward.x, forward.y, forward.z].map((value) => round(value, 2)),
                inventory: Array.isArray(human.inventory) ? [...human.inventory] : null,
                selectedItem: human.selectedItemIndex ?? null, score: human.score ?? null, vehicle: human.vehicleId || null,
            },
            opponents: opponents.slice(0, 8),
            aliveOpponents: opponents.filter((entry) => entry.alive).length,
            observation,
        };
    }, vector);
    if (Array.isArray(raw.observation)) {
        raw.observationLength = raw.observation.length;
        raw.observation = nameObservation(raw.observation, OBSERVATION_SEMANTICS_V1);
    }
    return raw;
}
