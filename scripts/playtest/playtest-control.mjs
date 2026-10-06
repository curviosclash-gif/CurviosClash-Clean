/* global window */
// Hooks that let an agent play instead of only watch: freeze the fixed-step simulation
// and advance it frame by frame, run the test pilot once per simulation step and feed
// its input in as a player device, read a situation report and a log of game events.
// Everything is installed into the running renderer; the per-match parts (event bus)
// are re-attached after each match start, because every match builds a new entity
// manager. Page callbacks run in the renderer.
import { OBSERVATION_SEMANTICS_V1 } from '../../src/entities/ai/observation/ObservationSemantics.js';
import { installPilotRuntime, PILOT_VERSION } from './playtest-pilot-runtime.mjs';
import { framesForMs, nameObservation, sanitizePilotManeuver, SIM_STEP_SECONDS } from './playtest-support.mjs';

const EVENT_LOG_LIMIT = 1000;

/**
 * Idempotent: gates the game loop's update step (pause / step) and runs the pilot in
 * front of it, routes pilot input through the input manager's device query, and taps
 * the event bus, the game state and the arcade run phase.
 */
export async function installControl(session) {
    await session.page.evaluate(`(${installPilotRuntime})(${JSON.stringify(PILOT_VERSION)})`);
    return session.page.evaluate((eventLimit) => {
        const game = window.GAME_INSTANCE;
        const control = window.__playtest || (window.__playtest = {
            paused: false, budget: 0, simFrame: 0, events: [], eventSeq: 0, lastState: null, lastArcadePhase: null,
        });
        const flat = (value, depth = 0) => {
            if (value == null || typeof value !== 'object') return value ?? null;
            const out = {};
            for (const [key, entry] of Object.entries(value).slice(0, 30)) {
                if (['string', 'number', 'boolean'].includes(typeof entry)) out[key] = entry;
                else if (Number.isInteger(entry?.index)) out[`${key}Index`] = entry.index;
                else if (depth < 1 && entry && typeof entry === 'object' && !Array.isArray(entry)) out[key] = flat(entry, depth + 1);
            }
            return out;
        };
        const push = (type, data) => {
            try {
                control.events.push({ seq: ++control.eventSeq, frame: control.simFrame, type, ...data });
                if (control.events.length > eventLimit) control.events.shift();
            } catch { /* the log must never break the game */ }
        };
        control.push = push;
        control.flat = flat;
        const watchState = () => {
            const state = game.state;
            if (state !== control.lastState) {
                push('state', { from: control.lastState, to: state });
                if (state === 'MATCH_END') {
                    const players = game.entityManager?.players || [];
                    push('match_end', { roundWins: players.map((player) => ({ player: player.index, wins: player.score ?? 0 })) });
                }
                control.lastState = state;
            }
            // The run's public snapshot; some run types (endless parcours, five portals, arena
            // waves, demolition) return null there, then the raw state is the only source.
            const arcadeRuntime = game.runtimeFacade?.arcadeRunRuntime || game.runtimeFacade?._arcadeSupport?.arcadeRunRuntime || null;
            const arcade = arcadeRuntime?.getStateSnapshot?.() || arcadeRuntime?._state || null;
            const phase = arcade?.phase || null;
            if (phase !== control.lastArcadePhase) {
                if (phase || control.lastArcadePhase) push('arcade_phase', { from: control.lastArcadePhase, to: phase, arcade: flat(arcade) });
                control.lastArcadePhase = phase;
            }
        };
        const loop = game.gameLoop;
        if (loop && !loop.__playtestGate) {
            const update = loop.updateFn;
            loop.updateFn = (dt) => {
                if (control.paused) {
                    if (control.budget <= 0) return undefined;
                    control.budget -= 1;
                }
                control.simFrame += 1;
                try { window.__playtestPilotRuntime?.tick(); } catch (error) { push('pilot_error', { message: String(error?.message || error) }); }
                const result = update(dt);
                watchState();
                return result;
            };
            loop.__playtestGate = true;
        }
        const input = game.input;
        if (input && !input.__playtestDevice) {
            const readDevice = input.getKeyboardInput.bind(input);
            // The pilot is a virtual input device: it answers where the keyboard of that
            // player slot would, below every input source, so splitscreen and the LAN
            // guest forwarding see it exactly like a real device.
            input.getKeyboardInput = (index, options) => {
                const pilotInput = window.__playtestPilotRuntime?.inputFor(index);
                const base = readDevice(index, options);
                return pilotInput ? { ...base, ...pilotInput } : base;
            };
            input.__playtestDevice = true;
        }
        const manager = game.entityManager;
        const bus = manager?._eventBus;
        if (bus && !bus.__playtestTapped) {
            const tap = (method, describe) => {
                const original = bus[method].bind(bus);
                bus[method] = (...args) => { push(...describe(...args)); return original(...args); };
            };
            const humanIndexes = () => (manager.humanPlayers || []).map((player) => player.index);
            tap('emitPlayerDied', (player, cause) => ['death', { player: player?.index ?? null, isHuman: humanIndexes().includes(player?.index), cause: flat(cause) }]);
            tap('emitRoundEnd', (winner, outcome) => ['round_end', {
                winner: winner?.index ?? null, humanWon: Boolean(winner) && humanIndexes().includes(winner.index),
                reason: outcome?.reason ?? null, outcome: flat(outcome),
            }]);
            tap('emitHuntDamageEvent', (event) => ['damage', flat(event) || {}]);
            tap('emitPlayerFeedback', (player, message) => ['feedback', { player: player?.index ?? null, message: String(message) }]);
            tap('emitHuntFeed', (message) => ['feed', { message: typeof message === 'string' ? message : flat(message) }]);
            bus.__playtestTapped = true;
        }
        const anyPlayer = manager?.players?.[0];
        const proto = anyPlayer ? Object.getPrototypeOf(anyPlayer) : null;
        if (proto?.addToInventory && !proto.__playtestItemTap) {
            const addToInventory = proto.addToInventory;
            proto.addToInventory = function addToInventoryTapped(type, ...rest) {
                const added = addToInventory.call(this, type, ...rest);
                if (added) window.__playtest?.push?.('item_gained', { player: this.index ?? null, item: String(type) });
                return added;
            };
            proto.__playtestItemTap = true;
        }
        if (control.lastState === null) control.lastState = game.state;
        return { loop: Boolean(loop?.__playtestGate), device: Boolean(input?.__playtestDevice), events: Boolean(bus?.__playtestTapped) };
    }, EVENT_LOG_LIMIT);
}

/** Clears pause and the event log; a configured pilot keeps its goal. */
export async function resetControl(session) {
    return session.page.evaluate(() => {
        const control = window.__playtest;
        if (!control) return;
        Object.assign(control, { paused: false, budget: 0, events: [] });
    });
}

/** Waits in the page until the step budget is used up (paused) or ms passed. */
async function waitForBudget(session, frames) {
    const limitMs = Math.round(frames * SIM_STEP_SECONDS * 1000 * 4) + 5000;
    return session.page.evaluate(async (maxMs) => {
        const control = window.__playtest;
        const startedAt = performance.now();
        while (control.paused && control.budget > 0 && performance.now() - startedAt < maxMs) {
            await new Promise((resolve) => setTimeout(resolve, 16));
        }
        return { completed: !control.paused || control.budget <= 0, simFrame: control.simFrame, waitedMs: Math.round(performance.now() - startedAt) };
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
    return { frames, ...(await waitForBudget(session, frames)) };
}

// ---- pilot ------------------------------------------------------------------------------

/** Sets the pilot's goal (see playtest-pilot-runtime.mjs for the modes). */
export async function configurePilot(session, spec) {
    await installControl(session);
    return session.page.evaluate((value) => window.__playtestPilotRuntime.configure(value), spec);
}

/** Changes goal details of the running pilot (target, tactic, branch, points). */
export async function updatePilot(session, changes) {
    await installControl(session);
    return session.page.evaluate((value) => window.__playtestPilotRuntime.update(value), changes);
}

export async function stopPilot(session, reason = 'stopped by request') {
    if (!session?.page || session.page.isClosed()) return null;
    return session.page.evaluate((why) => window.__playtestPilotRuntime?.stop(why) ?? null, reason).catch(() => null);
}

export async function pilotStatus(session) {
    await installControl(session);
    return session.page.evaluate(() => window.__playtestPilotRuntime.describe());
}

/**
 * Holds a direct maneuver (turn/climb/roll -1..1, boost/fireRocket/useItem/nextItem as a
 * tap, fireMG held) for ms of game time. Paused: the game advances exactly that long and
 * stays paused, so observe -> maneuver -> observe is one decision step.
 */
export async function maneuver(session, input, ms = 250, player = 0) {
    const sanitized = sanitizePilotManeuver(input);
    const frames = framesForMs(ms);
    await configurePilot(session, { mode: 'maneuver', input: sanitized, frames, player });
    const paused = await session.page.evaluate((count) => {
        const control = window.__playtest;
        if (control.paused) control.budget = count;
        return control.paused;
    }, frames);
    const limitMs = Math.round(frames * SIM_STEP_SECONDS * 1000 * 4) + 5000;
    const status = await session.page.evaluate(async ({ maxMs }) => {
        const pilot = window.__playtestPilotRuntime;
        const control = window.__playtest;
        const startedAt = performance.now();
        while (pilot.describe().status === 'active' && performance.now() - startedAt < maxMs) {
            if (control.paused && control.budget <= 0) break;
            await new Promise((resolve) => setTimeout(resolve, 16));
        }
        if (pilot.describe().status === 'active') pilot.stop('maneuver did not finish (ship dead or game not playing)');
        return pilot.describe();
    }, { maxMs: limitMs });
    return { frames, paused, applied: sanitized, pilot: status };
}

/** Compatibility: the game's own bot policy flies the ship through the pilot's device input. */
export async function enableAutopilot(session, policyType = null, player = 0) {
    const described = await configurePilot(session, { mode: 'bot', policy: policyType, player });
    return described.status === 'active';
}

export async function disableAutopilot(session) {
    return stopPilot(session, 'autopilot disabled');
}

/** Game events since `sinceSeq` (deaths, round/match ends, damage, items, arcade phases, ...). */
export async function readEvents(session, sinceSeq = 0) {
    await installControl(session);
    return session.page.evaluate((since) => {
        const control = window.__playtest;
        return { lastSeq: control.eventSeq, events: control.events.filter((entry) => entry.seq > since) };
    }, Number(sinceSeq) || 0);
}

/**
 * Situation report for deciding the next input: the chosen player's ship (direction,
 * speed, health), every other ship relative to its nose (ahead / right / up, angle off
 * the nose), parcours progress, arcade run state, scores, and the bots' observation
 * vector with names (wall distances, threat, target alignment, ...).
 */
export async function observe(session, { vector = true, player = 0 } = {}) {
    await installControl(session);
    const raw = await session.page.evaluate(({ wantVector, playerIndex }) => {
        const game = window.GAME_INSTANCE;
        const control = window.__playtest;
        const manager = game.entityManager;
        const self = (manager?.players || []).find((entry) => entry?.index === playerIndex) || null;
        const round = (value, digits = 1) => (Number.isFinite(value) ? Math.round(value * 10 ** digits) / 10 ** digits : null);
        // The run's public snapshot; some run types (endless parcours, five portals, arena
            // waves, demolition) return null there, then the raw state is the only source.
            const arcadeRuntime = game.runtimeFacade?.arcadeRunRuntime || game.runtimeFacade?._arcadeSupport?.arcadeRunRuntime || null;
            const arcade = arcadeRuntime?.getStateSnapshot?.() || arcadeRuntime?._state || null;
        const base = {
            state: game.state, simFrame: control.simFrame, paused: control.paused,
            mapKey: game.arena?.currentMapKey || null, gameMode: game.settings?.gameMode || null,
            roundEnded: manager?._roundEnded === true, lastEventSeq: control.eventSeq,
            pilot: window.__playtestPilotRuntime?.describe?.() || null,
            arcade: arcade ? {
                phase: arcade.phase ?? null, sectorIndex: arcade.sectorIndex ?? null, completedSectors: arcade.completedSectors ?? null,
                score: arcade.score ? control.flat(arcade.score) : null, gameplayTimeMs: arcade.gameplayTimeMs ?? null,
                mapSequence: Array.isArray(arcade.mapSequence) ? arcade.mapSequence.slice(0, 12) : null,
                encounters: Array.isArray(arcade.encounterSequence) ? arcade.encounterSequence.slice(0, 12).map((entry) => control.flat(entry)) : null,
                config: arcade.config ? control.flat(arcade.config) : null,
                objective: arcade.objectiveState ? control.flat(arcade.objectiveState) : null,
                intermission: arcade.intermission ? control.flat(arcade.intermission) : null,
                scenarioId: game.runtimeConfig?.arcade?.scenarioId ?? null, combatProfile: game.runtimeConfig?.arcade?.combatProfile ?? null,
            } : null,
            mapUnits: Array.isArray(manager?._mapUnitSystem?.units) ? manager._mapUnitSystem.units.slice(0, 12).map((unit) => ({
                kind: unit.kind ?? null, id: unit.id ?? null, alive: unit.alive !== false, hp: round(unit.hp),
            })) : null,
            roundWins: (manager?.players || []).map((entry) => ({ player: entry.index, wins: entry.score ?? 0, human: !entry.isBot })),
            huntScoreboard: manager?.getHuntScoreboard?.() || null,
        };
        if (!self) return base;
        const origin = self.position;
        const Vector = origin.constructor;
        const toLocal = self.quaternion.clone().invert();
        const forward = new Vector(0, 0, -1).applyQuaternion(self.quaternion);
        const opponents = [];
        for (const other of manager.players || []) {
            if (!other || other === self) continue;
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
        const progress = manager?._parcoursProgressSystem?.getPlayerProgressSnapshot?.(playerIndex) || null;
        let observation = null;
        if (wantVector) {
            try {
                const inputSystem = manager._playerInputSystem;
                const wasRamped = self.controlRampEnabled;
                const context = inputSystem._resolveRuntimeContext(self, 1 / 60, manager, { includeObservationContext: true });
                const built = inputSystem._buildBotObservation(self, { requiresObservation: true }, context);
                self.controlRampEnabled = wasRamped;
                observation = built && typeof built.length === 'number' ? Array.from(built, Number) : null;
            } catch (error) {
                observation = `ERR ${error?.message || error}`;
            }
        }
        return {
            ...base,
            self: {
                index: self.index, alive: self.alive !== false, hp: round(self.hp), maxHp: self.maxHp ?? null, shield: round(self.shieldHP),
                speed: round(self.speed), boosting: self.isBoosting === true, pos: [origin.x, origin.y, origin.z].map(Math.round),
                forward: [forward.x, forward.y, forward.z].map((value) => round(value, 2)),
                inventory: Array.isArray(self.inventory) ? [...self.inventory] : null,
                selectedItem: self.selectedItemIndex ?? null, score: self.score ?? null, vehicle: self.vehicleId || null,
                invertPitch: Boolean(self.invertPitchBase) !== Boolean(self.invertControls),
                weapons: {
                    mgOverheat: manager?.getHuntOverheatSnapshot?.()?.[self.index] ?? null,
                    shootCooldown: round(self.shootCooldown, 2),
                    rockets: Array.isArray(self.rocketInventory) ? [...self.rocketInventory] : null,
                    boostCharge: round(self.boostCharge, 2), boostTimer: round(self.boostTimer, 2), boostCooldown: round(self.boostCooldown, 2),
                },
            },
            parcours: progress ? {
                next: progress.expectedCheckpointIds || [], passed: progress.passedCheckpointIds || [],
                completed: progress.completed === true, segmentElapsedMs: progress.segmentElapsedMs ?? null,
                resets: progress.resetCount ?? null, error: progress.errorMessage || null,
            } : null,
            opponents: opponents.slice(0, 8),
            aliveOpponents: opponents.filter((entry) => entry.alive).length,
            observation,
        };
    }, { wantVector: vector, playerIndex: player });
    if (Array.isArray(raw.observation)) {
        raw.observationLength = raw.observation.length;
        raw.observation = nameObservation(raw.observation, OBSERVATION_SEMANTICS_V1);
    }
    return raw;
}
