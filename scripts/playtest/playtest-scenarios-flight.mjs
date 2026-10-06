/* global window */
// Flight scenarios: direct maneuvers with measured effect, controller reaction, and the
// binding flight acceptance (parcours 9/10, duels 8/10 on NORMAL with ship1, seeds
// 101-110, at most five minutes per attempt, no teleport, invulnerability, extra items
// or triggered hits/checkpoints). Every attempt is evaluated, none is dropped.
import * as D from './playtest-driver.mjs';
import { cancellableSleep, throwIfCancelled } from './playtest-jobs.mjs';
import { evaluateAcceptance } from './playtest-support.mjs';

const ACCEPTANCE_SEEDS = Object.freeze([101, 102, 103, 104, 105, 106, 107, 108, 109, 110]);
const ATTEMPT_LIMIT_MS = 5 * 60 * 1000;

// A seed the runtime reports differently is noted in the attempt, it does not void it.
const blockingProblems = (start) => (start.problems || []).filter((problem) => !problem.startsWith('arcade seed'));

const yawPitchOf = (session, index = 0) => session.page.evaluate((playerIndex) => {
    const ship = window.GAME_INSTANCE.entityManager?.players?.find((entry) => entry.index === playerIndex);
    if (!ship) return null;
    const Vector = ship.position.constructor;
    const forward = new Vector(0, 0, -1).applyQuaternion(ship.quaternion);
    const up = new Vector(0, 1, 0).applyQuaternion(ship.quaternion);
    const right = new Vector(1, 0, 0).applyQuaternion(ship.quaternion);
    return {
        yawDeg: Math.atan2(-forward.x, -forward.z) * 180 / Math.PI,
        pitchDeg: Math.asin(Math.max(-1, Math.min(1, forward.y))) * 180 / Math.PI,
        rollDeg: Math.atan2(right.y, up.y) * 180 / Math.PI,
        y: ship.position.y,
    };
}, index);

const wrapDeg = (value) => {
    let out = value;
    while (out > 180) out -= 360;
    while (out < -180) out += 360;
    return out;
};

async function startDirect(run, session, options) {
    const start = await D.startMatch(session, options);
    run.interventions.push({ at: new Date().toISOString(), role: session.role, helper: 'start_match', args: options, note: 'menu bypassed' });
    return start;
}

/** Direct maneuvers: each one must change heading, pitch, height or roll in the asked direction. */
export async function scenarioFlightManeuvers(run, session, context) {
    const start = await startDirect(run, session, { map: 'standard', mode: 'CLASSIC', bots: 0, vehicle: 'ship1', paused: true, seed: 101 });
    if (!start.ok) return { status: 'blocked', reason: 'match did not start', start };
    const checks = [];
    const measure = async (label, input, ms, judge) => {
        throwIfCancelled(context.signal);
        const before = await yawPitchOf(session);
        const result = await D.maneuver(session, input, ms);
        const after = await yawPitchOf(session);
        const delta = {
            yaw: Math.round(wrapDeg(after.yawDeg - before.yawDeg)), pitch: Math.round(after.pitchDeg - before.pitchDeg),
            roll: Math.round(wrapDeg(after.rollDeg - before.rollDeg)), height: Math.round(after.y - before.y),
        };
        const passed = judge(delta);
        checks.push({ label, input, ms, frames: result.frames, delta, passed });
        context.log(`${label}: ${passed ? 'ok' : 'FAILED'} ${JSON.stringify(delta)}`);
        // Level out between maneuvers so each one starts from a comparable attitude.
        await D.maneuver(session, { climb: -Math.sign(after.pitchDeg) * Math.min(1, Math.abs(after.pitchDeg) / 40) }, Math.min(600, Math.abs(after.pitchDeg) * 12 + 1));
    };
    await measure('turn right', { turn: 1 }, 600, (d) => d.yaw <= -40);
    await measure('turn left', { turn: -1 }, 600, (d) => d.yaw >= 40);
    await measure('climb', { climb: 1 }, 400, (d) => d.pitch >= 20);
    await measure('dive', { climb: -1 }, 400, (d) => d.pitch <= -20);
    await measure('roll right', { roll: 1 }, 300, (d) => Math.abs(d.roll) >= 20);
    await measure('turn right while climbing', { turn: 1, climb: 0.6 }, 500, (d) => d.yaw <= -25 && d.pitch >= 8);
    await D.setPaused(session, false);
    const passed = checks.every((check) => check.passed);
    return { status: passed ? 'passed' : 'failed', control: 'pilot maneuver (virtual input device)', checks };
}

/**
 * Reaction: the commands must change when the goal or the obstacle situation changes.
 * (a) a waypoint far to the right, then switched to the left mid-flight;
 * (b) a goal straight behind a wall: the pilot must log an avoidance and steer off.
 */
export async function scenarioReaction(run, session, context) {
    const start = await startDirect(run, session, { map: 'standard', mode: 'CLASSIC', bots: 0, vehicle: 'ship1', seed: 102 });
    if (!start.ok) return { status: 'blocked', reason: 'match did not start', start };
    const self = (await D.observe(session, { vector: false })).self;
    const right = [self.pos[0] - self.forward[2] * 80, self.pos[1], self.pos[2] + self.forward[0] * 80];
    const left = [self.pos[0] + self.forward[2] * 80, self.pos[1], self.pos[2] - self.forward[0] * 80];
    await D.configurePilot(session, { mode: 'waypoints', points: [right], arriveRadius: 4 });
    await cancellableSleep(500, context.signal);
    const toRight = (await D.pilotStatus(session)).lastCommand;
    await D.updatePilot(session, { points: [left] });
    await cancellableSleep(500, context.signal);
    const toLeft = (await D.pilotStatus(session)).lastCommand;
    const goalReaction = Boolean(toRight && toLeft && toRight.turn > 0.3 && toLeft.turn < -0.3);
    context.log(`goal switch: turn ${toRight?.turn} -> ${toLeft?.turn}`);

    // Obstacle: find the nearest wall straight ahead by a ray, then aim beyond it.
    const probe = await session.page.evaluate(() => {
        const em = window.GAME_INSTANCE.entityManager;
        const ship = em.humanPlayers[0];
        const arena = window.GAME_INSTANCE.arena || em.arena;
        const forward = new ship.position.constructor(0, 0, -1).applyQuaternion(ship.quaternion);
        const hit = arena.raycast(ship.position.clone(), forward, 400);
        return { hit: Boolean(hit?.hit), distance: hit?.distance ?? null, pos: [ship.position.x, ship.position.y, ship.position.z], forward: [forward.x, forward.y, forward.z] };
    });
    await D.stopPilot(session, 'reaction part a done');
    let obstacleReaction = null;
    if (probe.hit) {
        const beyond = probe.pos.map((value, index) => value + probe.forward[index] * (probe.distance + 40));
        const before = (await D.pilotStatus(session)).counters.avoidances;
        await D.configurePilot(session, { mode: 'waypoints', points: [beyond], arriveRadius: 6 });
        const deadline = Date.now() + 15_000;
        let status = await D.pilotStatus(session);
        while (Date.now() < deadline && status.counters.avoidances <= before && status.status === 'active') {
            await cancellableSleep(250, context.signal);
            status = await D.pilotStatus(session);
        }
        const alive = (await D.observe(session, { vector: false })).self?.alive;
        obstacleReaction = { wallDistance: Math.round(probe.distance), avoidances: status.counters.avoidances - before, replans: status.counters.replans, alive, decisions: status.decisions.filter((entry) => entry.kind === 'avoid' || entry.kind === 'plan').slice(-4) };
        await D.stopPilot(session, 'reaction part b done');
    }
    const passed = goalReaction && (!obstacleReaction || (obstacleReaction.avoidances > 0 || obstacleReaction.replans > 0));
    return { status: passed ? 'passed' : (probe.hit ? 'failed' : 'unclear'), goalSwitch: { toRight, toLeft, goalReaction }, obstacle: obstacleReaction };
}

async function errorsDuring(session, since) {
    return (await D.errorsSince(session, since)).map((entry) => ({ kind: entry.kind, window: entry.window, text: entry.text }));
}

/** Ten parcours attempts with the pilot; passed at 9 or more completed runs. */
export async function scenarioParcoursAcceptance(run, session, context, { map = 'parcours_rift', seeds = ACCEPTANCE_SEEDS } = {}) {
    const attempts = [];
    for (const [index, seed] of seeds.entries()) {
        throwIfCancelled(context.signal);
        context.progress({ map, attempt: index + 1, of: seeds.length, completed: attempts.filter((entry) => entry.completed).length });
        const startedAt = Date.now();
        const start = await startDirect(run, session, { map, mode: 'ARCADE', bots: 0, winsNeeded: 1, vehicle: 'ship1', difficulty: 'NORMAL', seed });
        if (!start.ok || blockingProblems(start).length) {
            attempts.push({ seed, completed: false, blocked: true, problems: start.problems });
            continue;
        }
        await D.configurePilot(session, { mode: 'parcours' });
        let observed = null;
        while (Date.now() - startedAt < ATTEMPT_LIMIT_MS) {
            await cancellableSleep(1000, context.signal);
            observed = await D.observe(session, { vector: false });
            if (observed.parcours?.completed || observed.roundEnded || observed.state !== 'PLAYING') break;
        }
        const pilot = await D.pilotStatus(session);
        await D.stopPilot(session, 'attempt over');
        const events = (await D.readEvents(session, 0)).events;
        const completed = observed?.parcours?.completed === true
            || events.some((entry) => entry.type === 'round_end' && entry.reason === 'PARCOURS_COMPLETE');
        const attempt = {
            seed, completed, seconds: Math.round((Date.now() - startedAt) / 1000),
            deaths: events.filter((entry) => entry.type === 'death' && entry.isHuman).length,
            resets: observed?.parcours?.resets ?? null, lastExpected: observed?.parcours?.next ?? null,
            outcome: events.find((entry) => entry.type === 'round_end')?.reason || (completed ? 'PARCOURS_COMPLETE' : 'time limit'),
            pilotCounters: pilot.counters, errors: await errorsDuring(session, startedAt),
        };
        if (!completed) attempt.screenshot = await D.shot(session, `parcours-${map}-seed${seed}-fail`).catch(() => null);
        attempts.push(attempt);
        context.log(`${map} seed ${seed}: ${completed ? 'completed' : 'not completed'} in ${attempt.seconds}s`);
    }
    return evaluateAcceptance({ kind: 'parcours', map, attempts, required: 9, successKey: 'completed' });
}

/** Ten HUNT duels against one NORMAL bot; passed at 8 or more real wins. */
export async function scenarioDuelAcceptance(run, session, context, { map = 'standard', seeds = ACCEPTANCE_SEEDS, tactic = 'balanced' } = {}) {
    const attempts = [];
    for (const [index, seed] of seeds.entries()) {
        throwIfCancelled(context.signal);
        context.progress({ map, attempt: index + 1, of: seeds.length, won: attempts.filter((entry) => entry.won).length });
        const startedAt = Date.now();
        const start = await startDirect(run, session, { map, mode: 'HUNT', modePath: 'fight', bots: 1, winsNeeded: 1, vehicle: 'ship1', difficulty: 'NORMAL', seed });
        if (!start.ok || blockingProblems(start).length) {
            attempts.push({ seed, won: false, blocked: true, problems: start.problems });
            continue;
        }
        await D.configurePilot(session, { mode: 'combat', tactic });
        let roundEnd = null;
        while (Date.now() - startedAt < ATTEMPT_LIMIT_MS + 30_000) {
            await cancellableSleep(1000, context.signal);
            const events = (await D.readEvents(session, 0)).events;
            roundEnd = events.find((entry) => entry.type === 'round_end') || null;
            if (roundEnd) break;
        }
        const pilot = await D.pilotStatus(session);
        await D.stopPilot(session, 'attempt over');
        const observed = await D.observe(session, { vector: false });
        const attempt = {
            seed, won: roundEnd?.humanWon === true, reason: roundEnd?.reason || 'no round end within the limit',
            seconds: Math.round((Date.now() - startedAt) / 1000), scoreboard: observed.huntScoreboard,
            pilotCounters: pilot.counters, errors: await errorsDuring(session, startedAt),
        };
        if (!attempt.won) attempt.screenshot = await D.shot(session, `duel-${map}-seed${seed}-lost`).catch(() => null);
        attempts.push(attempt);
        context.log(`${map} seed ${seed}: ${attempt.won ? 'won' : 'lost'} (${attempt.reason})`);
    }
    return evaluateAcceptance({ kind: 'duel', map, attempts, required: 8, successKey: 'won' });
}
