// One bounded coordinate-ascent iteration for the heuristic bot.
// Search state is kept outside the repository so goal continuations can resume without reports.

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRuntimeConfigSnapshot } from '../../../src/core/RuntimeConfig.js';
import { MATCH_KERNEL_FIXED_STEP_SECONDS } from '../../../src/shared/contracts/MatchKernelRuntimeContract.js';
import { createHeadlessMatchKernelRuntime } from '../src/state/HeadlessMatchKernelRuntime.js';
import {
    HEURISTIC_PROFILE_FIELD_BOUNDS,
} from '../../../src/entities/ai/HeuristicBotPolicyOps.js';
import { createRuntimeRng } from '../../../src/shared/contracts/RuntimeRngContract.js';
import { createHeuristicLifeTracker } from './heuristic-improvement-metrics.mjs';
import { HEURISTIC_IMPROVEMENT_BASELINE } from './heuristic-improvement-baseline.mjs';

const FIXED_STEP = MATCH_KERNEL_FIXED_STEP_SECONDS;
const TRAINING_SEEDS = Object.freeze([2, 5, 13, 29]);
const HOLDOUT_SEEDS = Object.freeze([3, 7, 11, 17, 23, 31, 41, 53, 67, 79, 97, 113]);
// Never use these for tuning or candidate selection.
const FINAL_SEEDS = Object.freeze([293, 307, 317, 331, 347, 359, 373, 389, 401, 419, 433, 449]);
const PROFILES = Object.freeze(['defensive', 'balanced', 'aggressive']);
export const TUNABLE_FIELDS = Object.freeze([
    'predictiveSafetyBias',
    'openingFanoutBias',
    'opportunistBias',
    'attackCutoffBias',
    'finisherBias',
    'attackWindow',
    'retreatVitality',
    'escapeLateralBias',
    'openingHookBias',
    'trafficAvoidanceBias',
    'retreatPressure',
    'boostBias',
    'defensiveItemThresholdScale',
    'offensiveItemThresholdScale',
    'safetyDistance',
    'preferredRange',
    'strafeDistance',
]);

const SEARCH_STEPS = Object.freeze([0.20, 0.10, 0.05]);
const DEFAULT_NUM_BOTS = 4;
const DEFAULT_COARSE_MAX_TICKS = 1200;
const DEFAULT_FULL_MAX_TICKS = 5400;
const DEFAULT_TIMEOUT_MS = 90 * 60 * 1000;
const MIN_CONFIRMED_GAIN = 1e-6;
const PLATEAU_GAIN = 0.02;
const TARGET_RATIO = 2;
const STATE_VERSION = 16;
const MIN_ELIMINATION_SURVIVAL_RETENTION = 0.95;
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function hashSourceTree(hash, directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) hashSourceTree(hash, entryPath);
        else if (entry.isFile() && /\.[cm]?js$/.test(entry.name)) {
            hash.update(path.relative(REPOSITORY_ROOT, entryPath));
            hash.update(fs.readFileSync(entryPath));
        }
    }
}

const BENCHMARK_FINGERPRINT = (() => {
    const hash = createHash('sha256');
    for (const relativePath of ['src', 'dev/training/src', 'dev/training/scripts']) {
        hashSourceTree(hash, path.join(REPOSITORY_ROOT, relativePath));
    }
    return hash.digest('hex');
})();

function holdoutCacheKey(fields, seeds, slots, maxTicks) {
    return JSON.stringify([BENCHMARK_FINGERPRINT, fields, seeds, slots, maxTicks]);
}

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

function fightSettings(profile, respawnEnabled, seed) {
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
            respawnEnabled,
            deathmatchKillLimit: 100,
            timeLimitEnabled: false,
        },
        arcade: { seed },
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
    const baseProfile = HEURISTIC_IMPROVEMENT_BASELINE[profileName] || HEURISTIC_IMPROVEMENT_BASELINE.balanced;
    const source = profile && typeof profile === 'object' ? profile : baseProfile;
    const result = { ...baseProfile };
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
        verifiedRatios: {},
        holdoutCache: {},
        profiles: Object.fromEntries(PROFILES.map((profile) => [
            profile,
            clampProfile(profile, HEURISTIC_IMPROVEMENT_BASELINE[profile]),
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
            verifiedRatios: { ...initial.verifiedRatios, ...parsed.verifiedRatios },
            holdoutCache: { ...initial.holdoutCache, ...parsed.holdoutCache },
            profiles: Object.fromEntries(PROFILES.map((profile) => [
                profile,
                clampProfile(profile, parsed.profiles?.[profile] || HEURISTIC_IMPROVEMENT_BASELINE[profile]),
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

async function runMatch({ profile, seed, candidateFields, candidateSlot, maxTicks, respawnEnabled = true }) {
    const originalRandom = Math.random;
    const seededRandom = createRuntimeRng({ seed });
    let runtime = null;
    Math.random = seededRandom.next;
    try {
        const settings = fightSettings(profile, respawnEnabled, seed);
        const runtimeConfig = createRuntimeConfigSnapshot(settings);
        if (runtimeConfig.arcade.seed !== seed || runtimeConfig.hunt.timeLimitSeconds !== 0) {
            throw new Error(`invalid benchmark configuration for seed ${seed}`);
        }
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
        if (em.matchSeed !== seed) throw new Error(`benchmark seed mismatch: ${em.matchSeed} !== ${seed}`);
        // Score hit/assist windows on simulated time, not CPU-dependent wall time.
        em._huntScoring._nowSeconds = () => Math.max(0, Number(em._simulationClockMs) || 0) * 0.001;
        // The headless 1p setup creates one human. Exclude this inert pilot so the
        // measured match is genuinely candidate versus baseline bots only.
        for (const human of em.humanPlayers || []) {
            human.entitySlotActive = false;
            human.kill();
        }
        const bots = em.bots || [];
        if (bots.length < 2 || !bots[candidateSlot]) {
            throw new Error(`head-to-head requires at least two bots and candidate slot ${candidateSlot}`);
        }

        const baselineFields = Object.freeze(clampProfile(profile, HEURISTIC_IMPROVEMENT_BASELINE[profile]));
        for (const bot of bots) bot.ai.profile = baselineFields;
        const candidateBot = bots[candidateSlot];
        const activeCandidateFields = Object.freeze(clampProfile(profile, candidateFields));
        candidateBot.ai.profile = activeCandidateFields;
        const candidateIndex = candidateBot.player.index;
        const lifeTracker = createHeuristicLifeTracker();
        const candidateDeathCauses = {};
        const baselineDeathCauses = {};
        let forced = true;
        const inputFrame = { players: [{ actions: {} }] };
        const tickOptions = {
            tickIndex: 0,
            fixedStepSeconds: FIXED_STEP,
            frameId: 0,
            wallClockMs: 0,
            highResTimestampMs: 0,
        };

        em.onPlayerDied = (deadPlayer, rawCause) => {
            if (!deadPlayer?.isBot) return;
            const cause = String(rawCause || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
            lifeTracker.recordDeath(deadPlayer, Math.max(0, Number(em._simulationClockMs) || 0) * 0.001);
            incrementCauseCount(
                deadPlayer.index === candidateIndex ? candidateDeathCauses : baselineDeathCauses,
                cause
            );
        };

        for (let frame = 1; frame <= maxTicks; frame += 1) {
            tickOptions.tickIndex = runtime.kernel.tickIndex;
            tickOptions.frameId = frame;
            tickOptions.wallClockMs = frame * 16;
            tickOptions.highResTimestampMs = frame * 16;
            runtime.step(inputFrame, tickOptions);
            if (frame === 1) {
                for (const bot of bots) {
                    const expected = bot === candidateBot ? activeCandidateFields : baselineFields;
                    for (const field of TUNABLE_FIELDS) {
                        if (bot.ai.profile[field] !== expected[field]) {
                            throw new Error(`benchmark profile injection lost for ${field}`);
                        }
                    }
                }
            }
            if (respawnEnabled && em._roundEnded) {
                throw new Error(`benchmark match ended early at frame ${frame} of ${maxTicks}`);
            }
            if (!respawnEnabled) {
                let aliveCount = 0;
                for (const player of em.players) if (player?.alive) aliveCount += 1;
                if (aliveCount <= 1) {
                    forced = false;
                    break;
                }
            }
        }

        const scoreboard = em.getHuntScoreboard?.() || [];
        const scoreboardByPlayer = new Map(scoreboard.map((row) => [row.playerIndex, row]));
        const endSeconds = Math.max(0, Number(em._simulationClockMs) || 0) * 0.001;
        const endPositionSignature = bots.map((bot) => [
            Number(bot.player.position?.x).toFixed(3),
            Number(bot.player.position?.y).toFixed(3),
            Number(bot.player.position?.z).toFixed(3),
        ].join(',')).join('|');
        if (respawnEnabled && Math.abs(endSeconds - maxTicks * FIXED_STEP) > FIXED_STEP * 0.1) {
            throw new Error(`benchmark time mismatch: ${endSeconds} vs ${maxTicks * FIXED_STEP}`);
        }
        const candidateLife = lifeTracker.lifeTotals(candidateBot.player, endSeconds);
        const candidateKills = Math.max(0, Number(scoreboardByPlayer.get(candidateIndex)?.kills) || 0);
        let baselineLifeSeconds = 0;
        let baselineLives = 0;
        let baselineKills = 0;
        let baselineCount = 0;
        for (const bot of bots) {
            const playerIndex = bot?.player?.index;
            if (!Number.isInteger(playerIndex) || playerIndex === candidateIndex) continue;
            const life = lifeTracker.lifeTotals(bot.player, endSeconds);
            baselineLifeSeconds += life.seconds;
            baselineLives += life.lives;
            baselineKills += Math.max(0, Number(scoreboardByPlayer.get(playerIndex)?.kills) || 0);
            baselineCount += 1;
        }

        return {
            matchSeed: em.matchSeed,
            endPositionSignature,
            candidateLifeSeconds: candidateLife.seconds,
            candidateLives: candidateLife.lives,
            candidateKills,
            baselineLifeSeconds: baselineCount > 0 ? baselineLifeSeconds / baselineCount : 0,
            baselineLives: baselineCount > 0 ? baselineLives / baselineCount : 0,
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

async function evaluateVariant({ profile, fields, seeds, slots, maxTicks, respawnEnabled = true }) {
    const sums = {
        candidateLifeSeconds: 0,
        candidateLives: 0,
        candidateKills: 0,
        baselineLifeSeconds: 0,
        baselineLives: 0,
        baselineKills: 0,
        forcedMatches: 0,
    };
    const candidateDeathCauses = {};
    const baselineDeathCauses = {};
    let matches = 0;
    for (const seed of seeds) {
        for (const candidateSlot of slots) {
            const result = await runMatch({ profile, seed, candidateFields: fields, candidateSlot, maxTicks, respawnEnabled });
            sums.candidateLifeSeconds += result.candidateLifeSeconds;
            sums.candidateLives += result.candidateLives;
            sums.candidateKills += result.candidateKills;
            sums.baselineLifeSeconds += result.baselineLifeSeconds;
            sums.baselineLives += result.baselineLives;
            sums.baselineKills += result.baselineKills;
            if (result.forced) sums.forcedMatches += 1;
            mergeCauseCounts(candidateDeathCauses, result.candidateDeathCauses);
            mergeCauseCounts(baselineDeathCauses, result.baselineDeathCauses);
            matches += 1;
        }
    }
    const candidateSurvival = sums.candidateLives > 0 ? sums.candidateLifeSeconds / sums.candidateLives : 0;
    const candidateKills = sums.candidateKills / matches;
    const baselineSurvival = sums.baselineLives > 0 ? sums.baselineLifeSeconds / sums.baselineLives : 0;
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
        && candidate.candidateKills > current.candidateKills + MIN_CONFIRMED_GAIN
        && candidate.survivalRatio > current.survivalRatio + MIN_CONFIRMED_GAIN
        && candidate.killRatio > current.killRatio + MIN_CONFIRMED_GAIN;
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

function toRatioRecord(result) {
    return {
        survival: result.survivalRatio,
        kills: result.killRatio,
        candidateSurvival: result.candidateSurvival,
        baselineSurvival: result.baselineSurvival,
        candidateKills: result.candidateKills,
        baselineKills: result.baselineKills,
        candidateDeathCauses: result.candidateDeathCauses,
        baselineDeathCauses: result.baselineDeathCauses,
        forcedMatches: result.forcedMatches,
        candidateTrailDeathShare: result.candidateTrailDeathShare,
        baselineTrailDeathShare: result.baselineTrailDeathShare,
    };
}

function advanceCursor(state, profile, repeatField = false) {
    if (!repeatField) state.fieldCursorByProfile[profile] += 1;
    state.profileCursor = (state.profileCursor + 1) % PROFILES.length;
    const roundComplete = PROFILES.every((name) => state.fieldCursorByProfile[name] >= TUNABLE_FIELDS.length);
    if (!roundComplete) return;

    const score = PROFILES.reduce((sum, name) => {
        const ratios = state.verifiedRatios[name];
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
    let shortCoarseCurrent = null;
    for (const direction of [step, -step, step * 0.5, -step * 0.5]) {
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
        shortCoarseCurrent ||= await evaluateVariant({
            profile,
            fields: HEURISTIC_IMPROVEMENT_BASELINE[profile],
            seeds: TRAINING_SEEDS,
            slots: coarseSlots,
            maxTicks: COARSE_MAX_TICKS,
            respawnEnabled: false,
        });
        const shortCoarseCandidate = await evaluateVariant({
            profile,
            fields,
            seeds: TRAINING_SEEDS,
            slots: coarseSlots,
            maxTicks: COARSE_MAX_TICKS,
            respawnEnabled: false,
        });
        if (shortCoarseCandidate.candidateSurvival
            < shortCoarseCurrent.candidateSurvival * MIN_ELIMINATION_SURVIVAL_RETENTION) continue;
        if (!selected || result.combinedScore > selected.result.combinedScore) {
            selected = { fields, result };
        }
    }

    let decision = 'coarse-reject';
    let reported = coarseCurrent;
    if (selected) {
        const currentCacheKey = holdoutCacheKey(current, HOLDOUT_SEEDS, fullSlots, FULL_MAX_TICKS);
        const fullCurrent = state.holdoutCache[profile]?.key === currentCacheKey
            ? state.holdoutCache[profile].result
            : await evaluateVariant({
                profile,
                fields: current,
                seeds: HOLDOUT_SEEDS,
                slots: fullSlots,
                maxTicks: FULL_MAX_TICKS,
            });
        state.holdoutCache[profile] = { key: currentCacheKey, result: fullCurrent };
        const fullCandidate = await evaluateVariant({
            profile,
            fields: selected.fields,
            seeds: HOLDOUT_SEEDS,
            slots: fullSlots,
            maxTicks: FULL_MAX_TICKS,
        });
        reported = fullCandidate;
        if (isStrictlyBetterOnBoth(fullCandidate, fullCurrent)) {
            const shortCurrent = await evaluateVariant({
                profile,
                fields: HEURISTIC_IMPROVEMENT_BASELINE[profile],
                seeds: HOLDOUT_SEEDS,
                slots: fullSlots,
                maxTicks: COARSE_MAX_TICKS,
                respawnEnabled: false,
            });
            const shortCandidate = await evaluateVariant({
                profile,
                fields: selected.fields,
                seeds: HOLDOUT_SEEDS,
                slots: fullSlots,
                maxTicks: COARSE_MAX_TICKS,
                respawnEnabled: false,
            });
            if (shortCandidate.candidateSurvival < shortCurrent.candidateSurvival * MIN_ELIMINATION_SURVIVAL_RETENTION) {
                decision = 'short-survival-reject';
            } else {
                state.profiles[profile] = selected.fields;
                state.holdoutCache[profile] = {
                    key: holdoutCacheKey(selected.fields, HOLDOUT_SEEDS, fullSlots, FULL_MAX_TICKS),
                    result: fullCandidate,
                };
                state.roundAccepted = true;
                decision = targetReached(fullCandidate) ? 'accept-target' : 'accept';
            }
        } else {
            decision = 'holdout-reject';
        }
    }

    state.lastRatios[profile] = toRatioRecord(reported);
    const completeProfiles = new Set(state.completeProfiles || []);
    if (decision.startsWith('accept')) {
        state.verifiedRatios[profile] = toRatioRecord(reported);
        if (targetReached(reported)) completeProfiles.add(profile);
        else completeProfiles.delete(profile);
    }
    state.completeProfiles = [...completeProfiles];
    advanceCursor(state, profile, decision.startsWith('accept'));
    saveState(state);

    console.log(
        `profile=${profile} candidate=${field}:${Number((selected?.fields || current)[field]).toFixed(4)}`
        + ` stage=${selected ? 'holdout' : 'coarse'}`
        + ` survivalRatio=${formatRatio(reported.survivalRatio)}`
        + ` killRatio=${formatRatio(reported.killRatio)}`
        + ` decision=${decision}`
    );

    if (state.plateauRounds >= 3) process.exitCode = 3;
}

async function verifyCurrentProfiles() {
    const state = loadState();
    const slots = Array.from({ length: NUM_BOTS }, (_, index) => index);
    const completeProfiles = new Set();
    for (const profile of PROFILES) {
        const fields = clampProfile(profile, state.profiles[profile]);
        const result = await evaluateVariant({
            profile,
            fields,
            seeds: FINAL_SEEDS,
            slots,
            maxTicks: FULL_MAX_TICKS,
        });
        state.verifiedRatios[profile] = toRatioRecord(result);
        let shortSafe = true;
        if (targetReached(result)) {
            const shortCurrent = await evaluateVariant({
                profile,
                fields: HEURISTIC_IMPROVEMENT_BASELINE[profile],
                seeds: FINAL_SEEDS,
                slots,
                maxTicks: COARSE_MAX_TICKS,
                respawnEnabled: false,
            });
            const shortCandidate = await evaluateVariant({
                profile,
                fields,
                seeds: FINAL_SEEDS,
                slots,
                maxTicks: COARSE_MAX_TICKS,
                respawnEnabled: false,
            });
            shortSafe = shortCandidate.candidateSurvival
                >= shortCurrent.candidateSurvival * MIN_ELIMINATION_SURVIVAL_RETENTION;
        }
        if (targetReached(result) && shortSafe) completeProfiles.add(profile);
        console.log(
            `profile=${profile} verifiedSurvivalRatio=${formatRatio(result.survivalRatio)}`
            + ` verifiedKillRatio=${formatRatio(result.killRatio)}`
            + ` shortSafe=${shortSafe}`
        );
    }
    state.completeProfiles = [...completeProfiles];
    state.finalVerification = {
        at: new Date().toISOString(),
        seeds: FINAL_SEEDS,
        completeProfiles: [...completeProfiles],
    };
    saveState(state);
}

async function replayMatch() {
    const profile = String(process.argv[3] || '').trim().toLowerCase();
    const seed = Number(process.argv[4]);
    const candidateSlot = Number(process.argv[5] ?? 0);
    if (!PROFILES.includes(profile) || !Number.isInteger(seed) || seed <= 0
        || !Number.isInteger(candidateSlot) || candidateSlot < 0 || candidateSlot >= NUM_BOTS) {
        throw new Error('replay requires profile, positive seed and valid candidate slot');
    }
    const state = loadState();
    const result = await runMatch({
        profile,
        seed,
        candidateFields: state.profiles[profile],
        candidateSlot,
        maxTicks: COARSE_MAX_TICKS,
    });
    console.log(JSON.stringify(result));
}

async function probeCurrentProfile(fullHoldout, adopt = false, shortOnly = false) {
    const profile = String(process.argv[3] || '').trim().toLowerCase();
    if (!PROFILES.includes(profile)) throw new Error(`unknown probe profile: ${profile}`);
    const state = loadState();
    const current = clampProfile(profile, state.profiles[profile]);
    const overrides = {};
    for (const assignment of process.argv.slice(4)) {
        const [field, rawValue, ...extra] = String(assignment).split('=');
        if (!TUNABLE_FIELDS.includes(field) || extra.length > 0 || !Number.isFinite(Number(rawValue))) {
            throw new Error(`invalid probe assignment: ${assignment}`);
        }
        overrides[field] = Number(rawValue);
    }
    if (Object.keys(overrides).length === 0) throw new Error('probe requires at least one field=value');
    const fields = clampProfile(profile, { ...current, ...overrides });
    const seeds = fullHoldout ? HOLDOUT_SEEDS : TRAINING_SEEDS;
    const slots = fullHoldout
        ? Array.from({ length: NUM_BOTS }, (_, index) => index)
        : [...new Set([0, Math.max(0, NUM_BOTS - 1)])];
    const maxTicks = fullHoldout && !shortOnly ? FULL_MAX_TICKS : COARSE_MAX_TICKS;
    const reference = shortOnly ? HEURISTIC_IMPROVEMENT_BASELINE[profile] : current;
    const cacheKey = holdoutCacheKey(reference, seeds, slots, maxTicks);
    const currentResult = fullHoldout && !shortOnly && state.holdoutCache[profile]?.key === cacheKey
        ? state.holdoutCache[profile].result
        : await evaluateVariant({ profile, fields: reference, seeds, slots, maxTicks, respawnEnabled: !shortOnly });
    const result = await evaluateVariant({ profile, fields, seeds, slots, maxTicks, respawnEnabled: !shortOnly });
    const better = shortOnly
        ? result.candidateSurvival >= currentResult.candidateSurvival * MIN_ELIMINATION_SURVIVAL_RETENTION
        : isStrictlyBetterOnBoth(result, currentResult);
    let decision = shortOnly
        ? (better ? 'short-safe' : 'short-unsafe')
        : (better ? 'better-both' : 'not-better-both');
    if (adopt && better) {
        const shortCurrent = await evaluateVariant({
            profile, fields: HEURISTIC_IMPROVEMENT_BASELINE[profile], seeds: HOLDOUT_SEEDS, slots, maxTicks: COARSE_MAX_TICKS, respawnEnabled: false,
        });
        const shortCandidate = await evaluateVariant({
            profile, fields, seeds: HOLDOUT_SEEDS, slots, maxTicks: COARSE_MAX_TICKS, respawnEnabled: false,
        });
        if (shortCandidate.candidateSurvival
            < shortCurrent.candidateSurvival * MIN_ELIMINATION_SURVIVAL_RETENTION) {
            decision = 'short-survival-reject';
        } else {
            state.profiles[profile] = fields;
            state.verifiedRatios[profile] = toRatioRecord(result);
            state.holdoutCache[profile] = {
                key: holdoutCacheKey(fields, seeds, slots, maxTicks),
                result,
            };
            state.completeProfiles = PROFILES.filter((name) => {
                const ratios = state.verifiedRatios[name];
                return ratios?.survival >= TARGET_RATIO && ratios?.kills >= TARGET_RATIO;
            });
            state.roundAccepted = true;
            saveState(state);
            decision = targetReached(result) ? 'accept-target' : 'accept';
        }
    }
    console.log(
        `profile=${profile} probe=${shortOnly ? 'short' : fullHoldout ? 'holdout' : 'coarse'}`
        + ` fields=${Object.entries(overrides).map(([field, value]) => `${field}:${value}`).join(',')}`
        + ` survivalRatio=${formatRatio(result.survivalRatio)}`
        + ` killRatio=${formatRatio(result.killRatio)}`
        + ` survivalGain=${formatRatio(result.candidateSurvival / currentResult.candidateSurvival)}`
        + ` killGain=${formatRatio(result.candidateKills / currentResult.candidateKills)}`
        + ` decision=${decision}`
    );
}

const timer = setTimeout(() => {
    console.error('heuristic improvement iteration timed out');
    process.exit(2);
}, TIMEOUT_MS);
timer.unref?.();

const command = process.argv[2];
const task = command === '--verify'
    ? verifyCurrentProfiles
    : command === '--replay'
    ? replayMatch
    : command === '--probe-coarse' || command === '--probe-full' || command === '--try-full' || command === '--probe-short'
    ? () => probeCurrentProfile(command !== '--probe-coarse', command === '--try-full', command === '--probe-short')
    : runIteration;
task().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
});
