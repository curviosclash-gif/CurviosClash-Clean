// One bounded coordinate-ascent iteration for heuristic team-objective play.
// Search state stays in the operating-system temp directory and is never promoted automatically.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRuntimeConfigSnapshot } from '../../../src/core/RuntimeConfig.js';
import {
    HEURISTIC_PROFILE_FIELD_BOUNDS,
    HEURISTIC_PROFILES,
} from '../../../src/entities/ai/HeuristicBotPolicyOps.js';
import { MATCH_KERNEL_FIXED_STEP_SECONDS } from '../../../src/shared/contracts/MatchKernelRuntimeContract.js';
import { createRuntimeRng } from '../../../src/shared/contracts/RuntimeRngContract.js';
import { TEAM_IDS } from '../../../src/shared/contracts/TeamCombatContract.js';
import { createHeadlessMatchKernelRuntime } from '../src/state/HeadlessMatchKernelRuntime.js';
import {
    combineTeamObjectiveResults,
    createTeamObjectiveMatchTracker,
    isTeamObjectiveCandidateBetter,
} from './team-objective-improvement-metrics.mjs';

const FIXED_STEP = MATCH_KERNEL_FIXED_STEP_SECONDS;
export const TEAM_OBJECTIVE_TRAINING_SEEDS = Object.freeze([7331]);
export const TEAM_OBJECTIVE_HOLDOUT_SEEDS = Object.freeze([9341]);
// Never use these seeds for candidate selection. Run once after the search is frozen.
export const TEAM_OBJECTIVE_AUDIT_SEEDS = Object.freeze([12101, 12113, 12119]);
export const TEAM_OBJECTIVE_TUNABLE_FIELDS = Object.freeze([
    'trafficAvoidanceBias',
    'predictiveSafetyBias',
    'safetyDistance',
    'boostBias',
    'retreatVitality',
    'retreatPressure',
]);

const OBJECTIVES = Object.freeze(['FLAGS', 'ESCORT']);
const CANDIDATE_TEAMS = Object.freeze([TEAM_IDS.ALPHA, TEAM_IDS.BRAVO]);
const SEARCH_STEPS = Object.freeze([0.10, 0.05]);
const STATE_VERSION = 1;
const DEFAULT_MAX_TICKS = 1800;
const DEFAULT_TIMEOUT_MS = 45 * 60 * 1000;
const SAMPLE_INTERVAL_TICKS = 15;
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const MAX_TICKS = parsePositiveInteger(process.env.TEAM_OBJECTIVE_LOOP_MAX_TICKS, DEFAULT_MAX_TICKS);
const TIMEOUT_MS = parsePositiveInteger(process.env.TEAM_OBJECTIVE_LOOP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
export const TEAM_OBJECTIVE_STATE_PATH = path.resolve(
    process.env.TEAM_OBJECTIVE_LOOP_STATE_PATH
        || path.join(os.tmpdir(), 'curviosclash-team-objective-improvement-state.json')
);

const BENCHMARK_FINGERPRINT = (() => {
    const hash = createHash('sha256');
    for (const relativePath of [
        'src/hunt/HuntBotFlagOps.js',
        'src/hunt/HuntBotEscortOps.js',
        'src/hunt/HuntBotObjectiveOps.js',
        'src/entities/ai/HeuristicBotPolicyOps.js',
        'dev/training/scripts/team-objective-improvement-metrics.mjs',
    ]) {
        hash.update(relativePath);
        hash.update(fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath)));
    }
    return hash.digest('hex');
})();

function clampField(field, value, fallback) {
    const bounds = HEURISTIC_PROFILE_FIELD_BOUNDS[field];
    const numeric = Number(value);
    const resolved = Number.isFinite(numeric) ? numeric : Number(fallback);
    return Math.max(bounds[0], Math.min(bounds[1], resolved));
}

export function clampTeamObjectiveProfile(profile = {}) {
    const baseline = HEURISTIC_PROFILES.balanced;
    const result = { ...baseline };
    for (const field of TEAM_OBJECTIVE_TUNABLE_FIELDS) {
        result[field] = clampField(field, profile[field], baseline[field]);
    }
    return result;
}

export function createInitialTeamObjectiveState() {
    return {
        version: STATE_VERSION,
        benchmarkFingerprint: BENCHMARK_FINGERPRINT,
        maxTicks: MAX_TICKS,
        fieldCursor: 0,
        stepIndex: 0,
        roundAccepted: false,
        plateauRounds: 0,
        iterations: 0,
        profile: clampTeamObjectiveProfile(HEURISTIC_PROFILES.balanced),
        lastDecision: null,
        lastHoldout: null,
    };
}

export function loadTeamObjectiveState(statePath = TEAM_OBJECTIVE_STATE_PATH) {
    try {
        const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
        if (parsed?.version !== STATE_VERSION
            || parsed?.benchmarkFingerprint !== BENCHMARK_FINGERPRINT
            || parsed?.maxTicks !== MAX_TICKS) {
            return createInitialTeamObjectiveState();
        }
        return {
            ...createInitialTeamObjectiveState(),
            ...parsed,
            profile: clampTeamObjectiveProfile(parsed.profile),
        };
    } catch {
        return createInitialTeamObjectiveState();
    }
}

function saveTeamObjectiveState(state, statePath = TEAM_OBJECTIVE_STATE_PATH) {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, statePath);
}

function createTeamSettings(objective, seed) {
    return {
        localSettings: { modePath: 'fight', sessionType: 'splitscreen' },
        mode: '2p',
        mapKey: 'standard',
        gameMode: 'HUNT',
        winsNeeded: 1,
        botDifficulty: 'NORMAL',
        botPolicyStrategy: 'heuristic',
        botHeuristicProfile: 'balanced',
        gameplay: {
            planarMode: false,
            fightPlayerHp: 100,
            fightMgDamage: 15,
            mgTrailAimRadius: 0.3,
        },
        hunt: {
            respawnEnabled: true,
            deathmatchKillLimit: 100,
            timeLimitEnabled: false,
            teamMode: true,
            teamObjective: objective,
            teamSize: 3,
            teamBotDifficulty: { ALPHA: 'NORMAL', BRAVO: 'NORMAL' },
        },
        arcade: { seed },
        portalsEnabled: false,
    };
}

function seedForMatch(seed, objective) {
    return seed + (objective === 'ESCORT' ? 10_000 : 0);
}

async function runTeamObjectiveMatch({ objective, seed, candidateTeamId, candidateProfile, deadlineMs }) {
    const matchSeed = seedForMatch(seed, objective);
    const originalRandom = Math.random;
    Math.random = createRuntimeRng({ seed: matchSeed }).next;
    let runtime = null;
    try {
        const settings = createTeamSettings(objective, matchSeed);
        const runtimeConfig = createRuntimeConfigSnapshot(settings);
        runtime = await Promise.resolve(createHeadlessMatchKernelRuntime({
            settings,
            runtimeConfig,
            requestedMapKey: runtimeConfig.session.mapKey,
            profile: {
                sessionId: `team-objective-${objective.toLowerCase()}-${matchSeed}-${candidateTeamId.toLowerCase()}`,
                fixedStepSeconds: FIXED_STEP,
                deterministic: true,
            },
        }));

        const entityManager = runtime.session.entityManager;
        entityManager._huntScoring._nowSeconds = () => (
            Math.max(0, Number(entityManager._simulationClockMs) || 0) * 0.001
        );
        for (const human of entityManager.humanPlayers || []) {
            human.entitySlotActive = false;
            human.kill();
        }
        entityManager.spawnAll();

        const baselineProfile = Object.freeze(clampTeamObjectiveProfile(HEURISTIC_PROFILES.balanced));
        const activeCandidate = Object.freeze(clampTeamObjectiveProfile(candidateProfile));
        const bots = entityManager.bots || [];
        const teamCounts = { [TEAM_IDS.ALPHA]: 0, [TEAM_IDS.BRAVO]: 0 };
        for (const bot of bots) {
            const teamId = bot?.player?.teamId;
            if (teamCounts[teamId] != null) teamCounts[teamId] += 1;
            bot.ai.profile = teamId === candidateTeamId ? activeCandidate : baselineProfile;
        }
        if (teamCounts.ALPHA !== 2 || teamCounts.BRAVO !== 2) {
            throw new Error(`team benchmark requires two active bots per team, got ${JSON.stringify(teamCounts)}`);
        }

        const tracker = createTeamObjectiveMatchTracker({ teamId: candidateTeamId, objective });
        const inputFrame = { players: [{ actions: {} }, { actions: {} }] };
        const tickOptions = {
            tickIndex: 0,
            fixedStepSeconds: FIXED_STEP,
            frameId: 0,
            wallClockMs: 0,
            highResTimestampMs: 0,
        };
        for (let frame = 1; frame <= MAX_TICKS; frame += 1) {
            if ((frame & 255) === 0 && Date.now() > deadlineMs) {
                throw new Error(`team objective benchmark timed out after ${frame} ticks`);
            }
            tickOptions.tickIndex = runtime.kernel.tickIndex;
            tickOptions.frameId = frame;
            tickOptions.wallClockMs = frame * 16;
            tickOptions.highResTimestampMs = frame * 16;
            runtime.step(inputFrame, tickOptions);
            if (frame === 1) {
                for (const bot of bots) {
                    const expected = bot.player.teamId === candidateTeamId ? activeCandidate : baselineProfile;
                    for (const field of TEAM_OBJECTIVE_TUNABLE_FIELDS) {
                        if (bot.ai.profile[field] !== expected[field]) {
                            throw new Error(`team benchmark profile injection lost for ${field}`);
                        }
                    }
                }
            }
            if (frame % SAMPLE_INTERVAL_TICKS === 0) tracker.sample(entityManager);
            if (entityManager._roundEnded) break;
        }

        return tracker.summarize(
            entityManager,
            Math.max(0, Number(entityManager._simulationClockMs) || 0) * 0.001
        );
    } finally {
        runtime?.dispose?.();
        Math.random = originalRandom;
    }
}

export async function evaluateTeamObjectiveProfile({ profile, seeds, timeoutMs = TIMEOUT_MS }) {
    const deadlineMs = Date.now() + timeoutMs;
    const results = [];
    for (const seed of seeds) {
        for (const objective of OBJECTIVES) {
            for (const candidateTeamId of CANDIDATE_TEAMS) {
                results.push(await runTeamObjectiveMatch({
                    objective,
                    seed,
                    candidateTeamId,
                    candidateProfile: profile,
                    deadlineMs,
                }));
            }
        }
    }
    return combineTeamObjectiveResults(results);
}

function candidateProfile(current, field, delta) {
    return clampTeamObjectiveProfile({
        ...current,
        [field]: Number(current[field]) + delta,
    });
}

export function advanceTeamObjectiveSearchState(state, accepted) {
    state.iterations += 1;
    state.roundAccepted = state.roundAccepted || accepted;
    state.fieldCursor += 1;
    if (state.fieldCursor < TEAM_OBJECTIVE_TUNABLE_FIELDS.length) return state;

    state.fieldCursor = 0;
    if (state.roundAccepted) {
        state.roundAccepted = false;
        state.plateauRounds = 0;
        return state;
    }
    state.roundAccepted = false;
    if (state.stepIndex < SEARCH_STEPS.length - 1) state.stepIndex += 1;
    else state.plateauRounds += 1;
    return state;
}

function compactResult(result) {
    return {
        score: result.score,
        assignmentRate: result.assignmentRate,
        proximityRate: result.proximityRate,
        objectives: result.objectives,
        matches: result.matches,
    };
}

async function runIteration() {
    const startedAt = Date.now();
    const state = loadTeamObjectiveState();
    const field = TEAM_OBJECTIVE_TUNABLE_FIELDS[state.fieldCursor];
    const step = SEARCH_STEPS[state.stepIndex];
    const current = clampTeamObjectiveProfile(state.profile);
    const trainingCurrent = await evaluateTeamObjectiveProfile({
        profile: current,
        seeds: TEAM_OBJECTIVE_TRAINING_SEEDS,
        timeoutMs: TIMEOUT_MS - (Date.now() - startedAt),
    });

    let selected = null;
    for (const direction of [-1, 1]) {
        const profile = candidateProfile(current, field, step * direction);
        if (profile[field] === current[field]) continue;
        const result = await evaluateTeamObjectiveProfile({
            profile,
            seeds: TEAM_OBJECTIVE_TRAINING_SEEDS,
            timeoutMs: TIMEOUT_MS - (Date.now() - startedAt),
        });
        if (!isTeamObjectiveCandidateBetter(result, trainingCurrent, {
            minimumGain: 0.05,
            objectiveRetention: 0.95,
            assignmentRetention: 0.95,
        })) continue;
        if (!selected || result.score > selected.result.score) selected = { profile, result };
    }

    let decision = 'training-reject';
    let holdoutCurrent = null;
    let holdoutCandidate = null;
    if (selected) {
        holdoutCurrent = await evaluateTeamObjectiveProfile({
            profile: current,
            seeds: TEAM_OBJECTIVE_HOLDOUT_SEEDS,
            timeoutMs: TIMEOUT_MS - (Date.now() - startedAt),
        });
        holdoutCandidate = await evaluateTeamObjectiveProfile({
            profile: selected.profile,
            seeds: TEAM_OBJECTIVE_HOLDOUT_SEEDS,
            timeoutMs: TIMEOUT_MS - (Date.now() - startedAt),
        });
        if (isTeamObjectiveCandidateBetter(holdoutCandidate, holdoutCurrent)) {
            state.profile = selected.profile;
            decision = 'accept';
        } else {
            decision = 'holdout-reject';
        }
    }

    const accepted = decision === 'accept';
    state.lastDecision = {
        at: new Date().toISOString(),
        field,
        step,
        decision,
        trainingCurrent: compactResult(trainingCurrent),
        trainingCandidate: selected ? compactResult(selected.result) : null,
    };
    state.lastHoldout = holdoutCurrent ? {
        current: compactResult(holdoutCurrent),
        candidate: compactResult(holdoutCandidate),
    } : null;
    advanceTeamObjectiveSearchState(state, accepted);
    saveTeamObjectiveState(state);

    const reported = holdoutCandidate || selected?.result || trainingCurrent;
    console.log(
        `team-objective field=${field} value=${Number(state.profile[field]).toFixed(4)}`
        + ` step=${step.toFixed(2)} score=${Number(reported.score).toFixed(3)}`
        + ` flags=${Number(reported.objectives.FLAGS.score).toFixed(3)}`
        + ` escort=${Number(reported.objectives.ESCORT.score).toFixed(3)}`
        + ` assignment=${Number(reported.assignmentRate).toFixed(3)}`
        + ` decision=${decision} state=${TEAM_OBJECTIVE_STATE_PATH}`
    );
}

async function verifyCurrent(seeds = TEAM_OBJECTIVE_HOLDOUT_SEEDS, split = 'holdout') {
    const state = loadTeamObjectiveState();
    const product = await evaluateTeamObjectiveProfile({
        profile: HEURISTIC_PROFILES.balanced,
        seeds,
    });
    const candidate = await evaluateTeamObjectiveProfile({
        profile: state.profile,
        seeds,
    });
    const passed = isTeamObjectiveCandidateBetter(candidate, product);
    console.log(JSON.stringify({ split, seeds, passed, product: compactResult(product), candidate: compactResult(candidate) }));
    if (!passed) process.exitCode = 3;
}

function printStatus() {
    console.log(JSON.stringify({
        statePath: TEAM_OBJECTIVE_STATE_PATH,
        state: loadTeamObjectiveState(),
    }, null, 2));
}

async function runCli() {
    if (process.argv.includes('--status')) return printStatus();
    if (process.argv.includes('--audit')) return verifyCurrent(TEAM_OBJECTIVE_AUDIT_SEEDS, 'audit');
    if (process.argv.includes('--verify')) return verifyCurrent();
    return runIteration();
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) {
    runCli().catch((error) => {
        console.error(error?.stack || error);
        process.exitCode = 1;
    });
}
