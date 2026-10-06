/* global window */
// Arcade test driver: the game's own bot logic flies whole gauntlet runs as player 1 and
// the scenario measures every sector (time, damage taken, deaths, points, missions,
// kills). Intermissions continue with the preselected route and reward, a won run is
// finished like "Run abschließen". The session uses its own throwaway profile, so the
// runs never reach the player's real records, rankings or vehicle XP.
import * as D from './playtest-driver.mjs';
import { cancellableSleep, throwIfCancelled } from './playtest-jobs.mjs';

const DEFAULT_SEEDS = Object.freeze([101, 102, 103]);
const RUN_LIMIT_MS = 15 * 60 * 1000;
const POLL_MS = 1000;

/** Per-sector counters of one run; events are attributed to the sector seen at that poll. */
export function createArcadeRunTally() {
    return { sectors: new Map(), lastSeq: 0 };
}

function sectorEntry(tally, sectorIndex) {
    const key = Math.max(1, Math.trunc(Number(sectorIndex) || 1));
    if (!tally.sectors.has(key)) {
        tally.sectors.set(key, {
            sectorIndex: key, damageTaken: 0, shieldAbsorbed: 0, deaths: 0, damageByCause: {}, deathCauses: [], firstSeenMs: null, lastSeenMs: null,
        });
    }
    return tally.sectors.get(key);
}

/** Adds damage and deaths of the human ship from playtest events to the sector. */
export function recordArcadeEvents(tally, sectorIndex, events, { humanIndex = 0, nowMs = 0 } = {}) {
    const entry = sectorEntry(tally, sectorIndex);
    entry.firstSeenMs ??= nowMs;
    entry.lastSeenMs = nowMs;
    for (const event of Array.isArray(events) ? events : []) {
        if (Number(event?.seq) > tally.lastSeq) tally.lastSeq = Number(event.seq);
        if (event?.type === 'damage' && event.targetIndex === humanIndex) {
            const applied = Math.max(0, Number(event.damageResult?.applied) || 0);
            const cause = String(event.cause || 'UNKNOWN');
            entry.damageTaken += applied;
            entry.shieldAbsorbed += Math.max(0, Number(event.damageResult?.absorbedByShield) || 0);
            entry.damageByCause[cause] = (entry.damageByCause[cause] || 0) + applied;
        } else if (event?.type === 'death' && event.isHuman === true && event.player === humanIndex) {
            entry.deaths += 1;
            entry.deathCauses.push(String(event.cause || 'UNKNOWN'));
        }
    }
    return entry;
}

/** Joins the run's own sector history with the tally into one row per reached sector. */
export function buildArcadeSectorRows(tally, sectorHistory = []) {
    const history = new Map((Array.isArray(sectorHistory) ? sectorHistory : []).map((row) => [Number(row?.sectorIndex), row]));
    const indexes = [...new Set([...tally.sectors.keys(), ...history.keys()])].filter(Number.isFinite).sort((a, b) => a - b);
    return indexes.map((sectorIndex) => {
        const measured = tally.sectors.get(sectorIndex) || null;
        const run = history.get(sectorIndex) || null;
        return {
            sectorIndex,
            cleared: run !== null,
            mapKey: run?.mapKey ?? null,
            objectiveId: run?.objectiveId ?? null,
            seconds: Number.isFinite(Number(run?.duration)) ? Math.round(Number(run.duration)) : null,
            points: Number(run?.awardedPoints) || 0,
            missions: run ? `${Number(run.missionsCompleted) || 0}/${Number(run.missionsTotal) || 0}` : null,
            kills: Number(run?.kills) || 0,
            damageTaken: Math.round(measured?.damageTaken || 0),
            shieldAbsorbed: Math.round(measured?.shieldAbsorbed || 0),
            deaths: measured?.deaths || 0,
            deathCauses: measured?.deathCauses ? [...measured.deathCauses] : [],
            damageByCause: Object.fromEntries(Object.entries(measured?.damageByCause || {}).map(([cause, value]) => [cause, Math.round(value)])),
            secondsObserved: measured ? Math.round(((measured.lastSeenMs ?? 0) - (measured.firstSeenMs ?? 0)) / 1000) : null,
        };
    });
}

/**
 * Sums all runs: how many were won, how far they got, and per sector how often it was
 * reached and cleared with mean time and damage. A run that timed out stays in the count.
 */
export function summarizeArcadeRunAttempts(attempts = []) {
    const finished = attempts.filter((attempt) => !attempt.blocked);
    const perSector = new Map();
    for (const attempt of finished) {
        for (const row of attempt.sectors || []) {
            const entry = perSector.get(row.sectorIndex) || { sectorIndex: row.sectorIndex, reached: 0, cleared: 0, seconds: [], damage: [] };
            entry.reached += 1;
            if (row.cleared) {
                entry.cleared += 1;
                if (Number.isFinite(row.seconds)) entry.seconds.push(row.seconds);
            }
            entry.damage.push(row.damageTaken);
            perSector.set(row.sectorIndex, entry);
        }
    }
    const mean = (values) => (values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null);
    return {
        runs: attempts.length,
        blocked: attempts.length - finished.length,
        won: finished.filter((attempt) => attempt.succeeded === true).length,
        timedOut: finished.filter((attempt) => attempt.timedOut === true).length,
        meanClearedSectors: finished.length
            ? Math.round((finished.reduce((sum, attempt) => sum + (Number(attempt.completedSectors) || 0), 0) / finished.length) * 10) / 10
            : null,
        sectors: [...perSector.values()].sort((a, b) => a.sectorIndex - b.sectorIndex).map((entry) => ({
            sectorIndex: entry.sectorIndex, reached: entry.reached, cleared: entry.cleared,
            meanSeconds: mean(entry.seconds), meanDamageTaken: mean(entry.damage),
        })),
    };
}

// Runs in the renderer: reads the run and moves it on where a person would press a button.
function stepArcadeRunInPage() {
    const game = window.GAME_INSTANCE;
    const runtime = game?.runtimeFacade?.arcadeRunRuntime || null;
    const port = game?.matchFlowUiController?.runtimePort || null;
    const snapshot = runtime?.getStateSnapshot?.() || null;
    const phase = String(snapshot?.phase || '');
    let action = null;
    if (phase === 'intermission' && port) {
        port.setArcadeIntermissionPaused?.(false);
        port.setRoundPause?.(0);
        action = 'continue';
    } else if (phase === 'victory' && port) {
        const transition = port.resolveArcadeVictoryChoice?.('finish');
        if (transition) {
            port.applyRoundEndTransition?.(transition);
            action = 'finish';
        }
    }
    const human = game?.entityManager?.humanPlayers?.[0] || null;
    return {
        state: game?.state || null,
        phase,
        action,
        sectorIndex: Number(snapshot?.sectorIndex) || null,
        completedSectors: Number(snapshot?.completedSectors) || 0,
        score: Number(snapshot?.score?.total) || 0,
        hp: human ? Math.round(Number(human.hp) || 0) : null,
        postRunSummary: phase === 'finished' ? runtime?.getPostRunSummary?.() || null : null,
    };
}

async function runOneArcadeRun(run, session, context, { seed, sectorCount, tier, vehicle, huntMapUnits }) {
    const startedAt = Date.now();
    const start = await D.startMatch(session, {
        map: 'standard', mode: 'ARCADE', modePath: 'arcade', bots: 2, vehicle, seed,
        arcade: { runType: 'gauntlet', sectorCount, difficultyTierId: tier, dailyChallenge: false },
    });
    run.interventions.push({ at: new Date().toISOString(), role: session.role, helper: 'start_match', args: { seed, sectorCount, tier, vehicle }, note: 'menu bypassed' });
    if (!start.ok) return { seed, blocked: true, reason: 'run did not start', problems: start.problems };
    await D.configurePilot(session, { mode: 'bot', huntMapUnits });
    const tally = createArcadeRunTally();
    let tick = null;
    let continued = 0;
    let finishedBy = null;
    while (Date.now() - startedAt < RUN_LIMIT_MS) {
        throwIfCancelled(context.signal);
        await cancellableSleep(POLL_MS, context.signal);
        tick = await session.page.evaluate(`(${stepArcadeRunInPage})()`);
        // A sector change may rebuild the match: this re-installs the hooks on the new manager.
        await D.pilotStatus(session);
        const { events } = await D.readEvents(session, tally.lastSeq);
        recordArcadeEvents(tally, tick.sectorIndex, events, { nowMs: Date.now() - startedAt });
        if (tick.action === 'continue') continued += 1;
        if (tick.action === 'finish') finishedBy = 'victory';
        if (tick.phase === 'finished' || tick.state === 'MATCH_END') break;
    }
    const pilot = await D.pilotStatus(session);
    await D.stopPilot(session, 'arcade run over');
    const summary = tick?.postRunSummary || null;
    const attempt = {
        seed,
        succeeded: summary?.succeeded === true,
        timedOut: !(tick?.phase === 'finished' || tick?.state === 'MATCH_END'),
        finishedBy: finishedBy || (summary ? 'run end' : null),
        completedSectors: Number(summary?.completedSectors ?? tick?.completedSectors) || 0,
        score: Number(summary?.score ?? tick?.score) || 0,
        intermissionsContinued: continued,
        seconds: Math.round((Date.now() - startedAt) / 1000),
        sectors: buildArcadeSectorRows(tally, summary?.sectorHistory),
        pilotCounters: pilot?.counters || null,
        errors: (await D.errorsSince(session, startedAt)).map((entry) => ({ kind: entry.kind, window: entry.window, text: entry.text })),
    };
    if (!attempt.succeeded) attempt.screenshot = await D.shot(session, `arcade-run-seed${seed}-end`).catch(() => null);
    return attempt;
}

/**
 * Plays params.seeds (default 101-103) gauntlet runs of params.sectorCount sectors (default
 * 4) on params.tier (default normal) with the game's bot logic; map units are hunted unless
 * params.huntMapUnits is false. A measurement, not an acceptance: it passes when every run
 * played to its end without game errors.
 */
export async function scenarioArcadeRun(run, session, context, {
    seeds = DEFAULT_SEEDS, sectorCount = 4, tier = 'normal', vehicle = 'ship1', huntMapUnits = true,
} = {}) {
    const attempts = [];
    for (const [index, seed] of seeds.entries()) {
        throwIfCancelled(context.signal);
        context.progress({ run: index + 1, of: seeds.length, won: attempts.filter((entry) => entry.succeeded).length });
        const attempt = await runOneArcadeRun(run, session, context, { seed, sectorCount, tier, vehicle, huntMapUnits: huntMapUnits !== false });
        attempts.push(attempt);
        context.log(`seed ${seed}: ${attempt.blocked ? 'blocked' : `${attempt.succeeded ? 'won' : 'lost'} after ${attempt.completedSectors} sectors`}`);
    }
    const summary = summarizeArcadeRunAttempts(attempts);
    const gameBugs = attempts.flatMap((attempt) => (attempt.errors || []).map((error) => ({ seed: attempt.seed, ...error })));
    let status = 'passed';
    if (summary.blocked > 0) status = 'blocked';
    else if (gameBugs.length > 0) status = 'failed';
    else if (summary.timedOut > 0) status = 'unclear';
    return { status, params: { seeds, sectorCount, tier, vehicle, huntMapUnits: huntMapUnits !== false }, summary, attempts, gameBugs };
}
