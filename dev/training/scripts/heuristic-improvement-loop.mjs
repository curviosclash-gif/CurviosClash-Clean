// One bounded coordinate-ascent iteration for the heuristic bot.
// Search state is kept outside the repository so goal continuations can resume without reports.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { createRuntimeConfigSnapshot } from '../../../src/core/RuntimeConfig.js';
import { MATCH_KERNEL_FIXED_STEP_SECONDS } from '../../../src/shared/contracts/MatchKernelRuntimeContract.js';
import { createHeadlessMatchKernelRuntime } from '../src/state/HeadlessMatchKernelRuntime.js';
import {
    HEURISTIC_PROFILE_FIELD_BOUNDS,
    HEURISTIC_PROFILES,
} from '../../../src/entities/ai/HeuristicBotPolicyOps.js';
import { createRuntimeRng } from '../../../src/shared/contracts/RuntimeRngContract.js';

const FIXED_STEP = MATCH_KERNEL_FIXED_STEP_SECONDS;
const TRAINING_SEEDS = Object.freeze([2, 5, 13, 29]);
const HOLDOUT_SEEDS = Object.freeze([3, 7, 11, 17, 23, 31, 41, 53, 67, 79, 97, 113]);
const PROFILES = Object.freeze(['defensive', 'balanced', 'aggressive']);
export const TUNABLE_FIELDS = Object.freeze([
    'openingHookBias',
    'openingFanoutBias',
    'trafficAvoidanceBias',
    'predictiveSafetyBias',
    'opportunistBias',
    'retreatVitality',
    'retreatPressure',
    'boostBias',
    'defensiveItemThresholdScale',
    'escapeLateralBias',
    'attackCutoffBias',
    'offensiveItemThresholdScale',
    'attackWindow',
    'safetyDistance',
    'preferredRange',
    'strafeDistance',
    'finisherBias',
]);

const SEARCH_STEPS = Object.freeze([0.20, 0.10, 0.05]);
const DEFAULT_NUM_BOTS = 4;
const DEFAULT_COARSE_MAX_TICKS = 1200;
const DEFAULT_FULL_MAX_TICKS = 5400;
const DEFAULT_TIMEOUT_MS = 90 * 60 * 1000;
const MIN_CONFIRMED_GAIN = 1e-6;
const PLATEAU_GAIN = 0.02;
const TARGET_RATIO = 2;
const STATE_VERSION = 12;

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const NUM_BOTS = parsePositiveInteger(process.env.HEURISTIC_LOOP_NUM_BOTS, DEFAULT_NUM_BOTS);
const COARSE_MAX_TICKS = parsePositiveInteger(
    process.env.HEURISTIC_LOOP_COARSE_MAX_TICKS,
    DEFAULT_COARSE_MAX_TICKS
);
const FULL_MAX_TICKS = parsePositiveInteger(
    process.env.HEURISTIC_LOOP_MAX_TICKS,
    DEFAULT_FULL_MAX_TICKS
);
const TIMEOUT_MS = parsePositiveInteger(process.env.HEURISTIC_LOOP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
const STATE_PATH = path.resolve(
    process.env.HEURISTIC_LOOP_STATE_PATH
        || path.join(os.tmpdir(), 'curviosclash-heuristic-improvement-state.json')
);

function fightSettings(profile) {
    return {
        localSettings: { modePath: 'fight', sessionType: 'single' },
        mode: '1p',
        mapKey: 'standard',
        gameMode: 'HUNT',
        numBots: NUM_BOTS,
        winsNeeded: 1,
        botDifficulty: 'NORMAL',
        botPolicyStrategy: 'heuristic',
        botHeuristicProfile: profile,
        gameplay: {
            planarMode: false,
            fightPlayerHp: 100,
            fightMgDamage: 15,
            mgTrailAimRadius: 0.3,
        },
        hunt: {
            respawnEnabled: false,
            deathmatchKillLimit: 50,
            deathmatchTimeLimitSeconds: 0,
        },
        portalsEnabled: false,
    };
}

function clampScalar(field, value, fallbackValue) {
    const bounds = HEURISTIC_PROFILE_FIELD_BOUNDS[field];
    const numeric = Number(value);
    const fallback = Number(fallbackValue);
    if (!bounds) return Number.isFinite(numeric) ? numeric : (Number.isFinite(fallback) ? fallback : 0);
    if (!Number.isFinite(numeric)) {
        return Math.max(bounds[0], Math.min(bounds[1], Number.isFinite(fallback) ? fallback : 0));
    }
    return Math.max(bounds[0], Math.min(bounds[1], numeric));
}

function clampProfile(profileName, profile) {
    const baseProfile = HEURISTIC_PROFILES[profileName] || HEURISTIC_PROFILES.balanced;
    const source = profile && typeof profile === 'object' ? profile : baseProfile;
    const result = { ...baseProfile, ...source };
    for (const field of TUNABLE_FIELDS) {
        result[field] = clampScalar(field, source[field], baseProfile[field]);
    }
    return result;
}

function createInitialState() {
    return {
        version: STATE_VERSION,
        profileCursor: 0,
        fieldCursorByProfile: Object.fromEntries(PROFILES.map((profile) => [profile, 0])),
        stepIndex: 0,
        plateauRounds: 0,
        roundStartCombinedScore: 0,
        roundAccepted: false,
        completeProfiles: [],
        profiles: Object.fromEntries(PROFILES.map((profile) => [
            profile,
            clampProfile(profile, HEURISTIC_PROFILES[profile]),
        ])),
        lastRatios: {},
    };
}

function loadState() {
    try {
        const parsed = JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
        if (parsed?.version !== STATE_VERSION) return createInitialState();
        const initial = createInitialState();
        return {
            ...initial,
            ...parsed,
            fieldCursorByProfile: { ...initial.fieldCursorByProfile, ...parsed.fieldCursorByProfile },
            profiles: Object.fromEntries(PROFILES.map((profile) => [
                profile,
                clampProfile(profile, parsed.profiles?.[profile] || HEURISTIC_PROFILES[profile]),
            ])),
        };
    } catch {
        return createInitialState();
    }
}

function saveState(state) {
    const directory = path.dirname(STATE_PATH);
    fs.mkdirSync(directory, { recursive: true });
    const temporaryPath = `${STATE_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    fs.renameSync(temporaryPath, STATE_PATH);
}

function incrementCauseCount(target, cause) {
    target[cause] = (target[cause] || 0) + 1;
}

function isTrailDeath(cause) {
    return cause === 'TRAIL_SELF' || cause === 'TRAIL_OTHER';
}

async function runMatch({ profile, seed, candidateFields, candidateSlot, maxTicks }) {
    const originalRandom = Math.random;
    const seededRandom = createRuntimeRng({ seed });
    let runtime = null;
    Math.random = seededRandom.next;
    try {
        const settings = fightSettings(profile);
        const runtimeConfig = createRuntimeConfigSnapshot(settings);
        runtime = await Promise.resolve(createHeadlessMatchKernelRuntime({
            settings,
            runtimeConfig,
            requestedMapKey: runtimeConfig.session.mapKey,
            profile: {
                sessionId: `heuristic-h2h-${profile}-${seed}-${candidateSlot}`,
                fixedStepSeconds: FIXED_STEP,
                deterministic: true,
            },
        }));

        const em = runtime.session.entityManager;
        const bots = em.bots || [];
        if (bots.length < 2 || !bots[candidateSlot]) {
            throw new Error(`head-to-head requires at least two bots and candidate slot ${candidateSlot}`);
        }

        const candidateBot = bots[candidateSlot];
        candidateBot.ai.profile = Object.freeze(clampProfile(profile, candidateFields));
        const candidateIndex = candidateBot.player.index;
        const deathTicks = new Map();
        const candidateDeathCauses = {};
        const baselineDeathCauses = {};
        let endTick = maxTicks;
        let forced = true;

        em.onPlayerDied = (deadPlayer, rawCause) => {
            if (!deadPlayer?.isBot || deathTicks.has(deadPlayer.index)) return;
            const cause = String(rawCause || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
            deathTicks.set(deadPlayer.index, runtime.kernel.tickIndex);
            incrementCauseCount(
                deadPlayer.index === candidateIndex ? candidateDeathCauses : baselineDeathCauses,
                cause
            );
        };

        for (let frame = 1; frame <= maxTicks; frame += 1) {
            runtime.step(
                { players: [{ actions: {} }] },
                {
                    tickIndex: runtime.kernel.tickIndex,
                    fixedStepSeconds: FIXED_STEP,
                    frameId: frame,
                    wallClockMs: frame * 16,
                    highResTimestampMs: frame * 16,
                }
            );
            const aliveCount = em.players.filter((player) => player?.alive).length;
            if (aliveCount <= 1) {
                endTick = frame;
                forced = false;
                break;
            }
        }

        const scoreboard = em.getHuntScoreboard?.() || [];
        const scoreboardByPlayer = new Map(scoreboard.map((row) => [row.playerIndex, row]));
        const candidateSurvivalSeconds = Math.min(deathTicks.get(candidateIndex) || endTick, endTick) * FIXED_STEP;
        const candidateKills = Math.max(0, Number(scoreboardByPlayer.get(candidateIndex)?.kills) || 0);
        let baselineSurvivalSeconds = 0;
        let baselineKills = 0;
        let baselineCount = 0;
        for (const bot of bots) {
            const playerIndex = bot?.player?.index;
            if (!Number.isInteger(playerIndex) || playerIndex === candidateIndex) continue;
            baselineSurvivalSeconds += Math.min(deathTicks.get(playerIndex) || endTick, endTick) * FIXED_STEP;
            baselineKills += Math.max(0, Number(scoreboardByPlayer.get(playerIndex)?.kills) || 0);
            baselineCount += 1;
        }

        return {
            candidateSurvivalSeconds,
            candidateKills,
            baselineSurvivalSeconds: baselineCount > 0 ? baselineSurvivalSeconds / baselineCount : 0,
            baselineKills: baselineCount > 0 ? baselineKills / baselineCount : 0,
            candidateDeathCauses,
            baselineDeathCauses,
            forced,
        };
    } finally {
        runtime?.dispose?.();
        Math.random = originalRandom;
    }
}

function ratio(candidate, baseline) {
    if (baseline > 0) return candidate / baseline;
    return candidate > 0 ? TARGET_RATIO : 1;
}

function mergeCauseCounts(target, source) {
    for (const [cause, count] of Object.entries(source || {})) {
        target[cause] = (target[cause] || 0) + Math.max(0, Number(count) || 0);
    }
}

function trailDeathShare(counts) {
    let total = 0;
    let trail = 0;
    for (const [cause, count] of Object.entries(counts || {})) {
        total += count;
        if (isTrailDeath(cause)) trail += count;
    }
    return total > 0 ? trail / total : 0;
}

async function evaluateVariant({ profile, fields, seeds, slots, maxTicks }) {
    const sums = {
        candidateSurvivalSeconds: 0,
        candidateKills: 0,
        baselineSurvivalSeconds: 0,
        baselineKills: 0,
        forcedMatches: 0,
    };
    const candidateDeathCauses = {};
    const baselineDeathCauses = {};
    let matches = 0;
    for (const seed of seeds) {
        for (const candidateSlot of slots) {
            const result = await runMatch({ profile, seed, candidateFields: fields, candidateSlot, maxTicks });
            sums.candidateSurvivalSeconds += result.candidateSurvivalSeconds;
            sums.candidateKills += result.candidateKills;
            sums.baselineSurvivalSeconds += result.baselineSurvivalSeconds;
            sums.baselineKills += result.baselineKills;
            if (result.forced) sums.forcedMatches += 1;
            mergeCauseCounts(candidateDeathCauses, result.candidateDeathCauses);
            mergeCauseCounts(baselineDeathCauses, result.baselineDeathCauses);
            matches += 1;
        }
    }
    const candidateSurvival = sums.candidateSurvivalSeconds / matches;
    const candidateKills = sums.candidateKills / matches;
    const baselineSurvival = sums.baselineSurvivalSeconds / matches;
    const baselineKills = sums.baselineKills / matches;
    const survivalRatio = ratio(candidateSurvival, baselineSurvival);
    const killRatio = ratio(candidateKills, baselineKills);
    return {
        candidateSurvival,
        candidateKills,
        baselineSurvival,
        baselineKills,
        survivalRatio,
        killRatio,
        combinedScore: Math.sqrt(survivalRatio * killRatio),
        forcedMatches: sums.forcedMatches,
        candidateDeathCauses,
        baselineDeathCauses,
        candidateTrailDeathShare: trailDeathShare(candidateDeathCauses),
        baselineTrailDeathShare: trailDeathShare(baselineDeathCauses),
    };
}

function perturb(profile, field, step) {
    return {
        ...profile,
        [field]: clampScalar(field, Number(profile[field]) * (1 + step)),
    };
}

function isStrictlyBetterOnBoth(candidate, current) {
    return candidate.candidateSurvival > current.candidateSurvival + MIN_CONFIRMED_GAIN
        && candidate.candidateKills > current.candidateKills + MIN_CONFIRMED_GAIN;
}

function targetReached(result) {
    const survivalReached = result.baselineSurvival === 0
        ? result.candidateSurvival > 0
        : result.survivalRatio >= TARGET_RATIO;
    const killsReached = result.baselineKills === 0
        ? result.candidateKills > 0
        : result.killRatio >= TARGET_RATIO;
    return survivalReached && killsReached;
}

function formatRatio(value) {
    return Number.isFinite(value) ? value.toFixed(3) : 'inf';
}

function advanceCursor(state, profile) {
    state.fieldCursorByProfile[profile] += 1;
    state.profileCursor = (state.profileCursor + 1) % PROFILES.length;
    const roundComplete = PROFILES.every((name) => state.fieldCursorByProfile[name] >= TUNABLE_FIELDS.length);
    if (!roundComplete) return;

    const score = PROFILES.reduce((sum, name) => {
        const ratios = state.lastRatios[name];
        return sum + (ratios ? Math.sqrt(ratios.survival * ratios.kills) : 1);
    }, 0) / PROFILES.length;
    const gain = state.roundStartCombinedScore > 0
        ? (score - state.roundStartCombinedScore) / state.roundStartCombinedScore
        : (state.roundAccepted ? 1 : 0);
    state.plateauRounds = gain < PLATEAU_GAIN ? state.plateauRounds + 1 : 0;
    state.roundStartCombinedScore = score;
    state.roundAccepted = false;
    state.stepIndex = Math.min(state.stepIndex + 1, SEARCH_STEPS.length - 1);
    for (const name of PROFILES) state.fieldCursorByProfile[name] = 0;
}

async function runIteration() {
    const state = loadState();
    const profile = PROFILES[state.profileCursor % PROFILES.length];
    const fieldIndex = state.fieldCursorByProfile[profile] % TUNABLE_FIELDS.length;
    const field = TUNABLE_FIELDS[fieldIndex];
    const step = SEARCH_STEPS[state.stepIndex] || SEARCH_STEPS.at(-1);
    const current = clampProfile(profile, state.profiles[profile]);
    const coarseSlots = [...new Set([0, Math.max(0, NUM_BOTS - 1)])];
    const fullSlots = Array.from({ length: NUM_BOTS }, (_, index) => index);
    const coarseCurrent = await evaluateVariant({
        profile,
        fields: current,
        seeds: TRAINING_SEEDS,
        slots: coarseSlots,
        maxTicks: COARSE_MAX_TICKS,
    });

    let selected = null;
    for (const direction of [step, -step]) {
        const fields = perturb(current, field, direction);
        if (fields[field] === current[field]) continue;
        const result = await evaluateVariant({
            profile,
            fields,
            seeds: TRAINING_SEEDS,
            slots: coarseSlots,
            maxTicks: COARSE_MAX_TICKS,
        });
        if (result.combinedScore <= coarseCurrent.combinedScore + MIN_CONFIRMED_GAIN) continue;
        if (!selected || result.combinedScore > selected.result.combinedScore) {
            selected = { fields, result };
        }
    }

    let decision = 'coarse-reject';
    let reported = coarseCurrent;
    if (selected) {
        const fullCurrent = await evaluateVariant({
            profile,
            fields: current,
            seeds: HOLDOUT_SEEDS,
            slots: fullSlots,
            maxTicks: FULL_MAX_TICKS,
        });
        const fullCandidate = await evaluateVariant({
            profile,
            fields: selected.fields,
            seeds: HOLDOUT_SEEDS,
            slots: fullSlots,
            maxTicks: FULL_MAX_TICKS,
        });
        reported = fullCandidate;
        if (isStrictlyBetterOnBoth(fullCandidate, fullCurrent)) {
            state.profiles[profile] = selected.fields;
            state.roundAccepted = true;
            decision = targetReached(fullCandidate) ? 'accept-target' : 'accept';
        } else {
            decision = 'holdout-reject';
        }
    }

    state.lastRatios[profile] = {
        survival: reported.survivalRatio,
        kills: reported.killRatio,
        candidateSurvival: reported.candidateSurvival,
        baselineSurvival: reported.baselineSurvival,
        candidateKills: reported.candidateKills,
        baselineKills: reported.baselineKills,
        candidateDeathCauses: reported.candidateDeathCauses,
        baselineDeathCauses: reported.baselineDeathCauses,
        forcedMatches: reported.forcedMatches,
        candidateTrailDeathShare: reported.candidateTrailDeathShare,
        baselineTrailDeathShare: reported.baselineTrailDeathShare,
    };
    const completeProfiles = new Set(state.completeProfiles || []);
    if (targetReached(reported) && decision.startsWith('accept')) completeProfiles.add(profile);
    state.completeProfiles = [...completeProfiles];
    advanceCursor(state, profile);
    saveState(state);

    console.log(
        `profile=${profile} candidate=${field}:${Number((selected?.fields || current)[field]).toFixed(4)}`
        + ` survivalRatio=${formatRatio(reported.survivalRatio)}`
        + ` killRatio=${formatRatio(reported.killRatio)}`
        + ` decision=${decision}`
    );

    if (state.plateauRounds >= 3) process.exitCode = 3;
}

const timer = setTimeout(() => {
    console.error('heuristic improvement iteration timed out');
    process.exit(2);
}, TIMEOUT_MS);
timer.unref?.();

runIteration().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
});
