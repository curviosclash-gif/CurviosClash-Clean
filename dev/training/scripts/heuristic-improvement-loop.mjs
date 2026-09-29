// One bounded coordinate-ascent iteration for the heuristic bot.
// Search state is kept outside the repository so goal continuations can resume without reports.

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    HEURISTIC_PROFILES,
} from '../../../src/entities/ai/HeuristicBotPolicyOps.js';
import { retainsHeuristicEngagement } from './heuristic-improvement-metrics.mjs';
import {
    HEURISTIC_SEARCH_STATE_VERSION, isInertTacticStep, judgeCandidate,
} from './heuristic-improvement-acceptance.mjs';
import {
    HEURISTIC_IMPROVEMENT_BASELINE, resolveHeuristicBenchmarkSetup,
} from './heuristic-improvement-baseline.mjs';
import {
    BENCHMARK_OPPONENTS, clampProfile, clampScalar, NUM_BOTS, parsePositiveInteger, runMatch, TUNABLE_FIELDS,
} from './heuristic-improvement-match.mjs';
import { createMatchPool } from './heuristic-improvement-pool.mjs';

export { TUNABLE_FIELDS };

const TRAINING_SEEDS = Object.freeze([2, 5, 13, 29]);
const HOLDOUT_SEEDS = Object.freeze([3, 7, 11, 17, 23, 31, 41, 53, 67, 79, 97, 113]);
// Fixed evaluation splits; once inspected, their results are development data.
const FINAL_SEEDS = Object.freeze([293, 307, 317, 331, 347, 359, 373, 389, 401, 419, 433, 449]);
const CONFIRMATION_SEEDS = Object.freeze([457, 461, 479, 487, 499, 503, 521, 541, 557, 569, 587, 601]);
const AUDIT_SEEDS = Object.freeze([607, 613, 617, 619, 631, 641, 643, 647, 653, 659, 661, 673]);
const FIXED_SEEDS = new Set([...TRAINING_SEEDS, ...HOLDOUT_SEEDS, ...FINAL_SEEDS, ...CONFIRMATION_SEEDS, ...AUDIT_SEEDS]);
const PROFILES = Object.freeze(['defensive', 'balanced', 'aggressive']);

const SEARCH_STEPS = Object.freeze([0.20, 0.10, 0.05]);
const DEFAULT_COARSE_MAX_TICKS = 1200;
const DEFAULT_FULL_MAX_TICKS = 5400;
const DEFAULT_TIMEOUT_MS = 90 * 60 * 1000;
const MIN_CONFIRMED_GAIN = 1e-6;
const PLATEAU_GAIN = 0.02;
const TARGET_RATIO = 2;
const STATE_VERSION = HEURISTIC_SEARCH_STATE_VERSION;
const MIN_ELIMINATION_SURVIVAL_RETENTION = 0.95;
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../', import.meta.url));

function parseFreshAuditSeeds(raw) {
    const tokens = String(raw || '').split(',');
    if (tokens.length !== 12 || tokens.some((token) => !/^[1-9]\d*$/.test(token))) {
        throw new Error('fresh audit requires exactly twelve comma-separated positive integer seeds');
    }
    const seeds = tokens.map(Number);
    if (seeds.some((seed) => !Number.isSafeInteger(seed) || FIXED_SEEDS.has(seed))
        || new Set(seeds).size !== seeds.length) {
        throw new Error('fresh audit seeds must be distinct and outside the fixed evaluation splits');
    }
    return seeds;
}

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

const COARSE_MAX_TICKS = parsePositiveInteger(
    process.env.HEURISTIC_LOOP_COARSE_MAX_TICKS,
    DEFAULT_COARSE_MAX_TICKS
);
const FULL_MAX_TICKS = parsePositiveInteger(
    process.env.HEURISTIC_LOOP_MAX_TICKS,
    DEFAULT_FULL_MAX_TICKS
);
const TIMEOUT_MS = parsePositiveInteger(process.env.HEURISTIC_LOOP_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
const matchPool = createMatchPool();
const STATE_PATH = path.resolve(
    process.env.HEURISTIC_LOOP_STATE_PATH
        || path.join(os.tmpdir(), 'curviosclash-heuristic-improvement-state.json')
);

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

function isTrailDeath(cause) {
    return cause === 'TRAIL_SELF' || cause === 'TRAIL_OTHER';
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

async function evaluateVariant({
    profile, fields, seeds, slots, maxTicks, respawnEnabled = true, opponent = 'baseline',
}) {
    const sums = {
        candidateLifeSeconds: 0,
        candidateLives: 0,
        candidateKills: 0,
        candidateDamage: 0,
        baselineLifeSeconds: 0,
        baselineLives: 0,
        baselineKills: 0,
        baselineDamage: 0,
        forcedMatches: 0,
        candidateUpdates: 0,
        candidateSafetyUpdates: 0,
        candidateShots: 0,
        baselineUpdates: 0,
        baselineSafetyUpdates: 0,
        baselineShots: 0,
    };
    const candidateDeathCauses = {};
    const baselineDeathCauses = {};
    const jobs = [];
    for (const [seedIndex, seed] of seeds.entries()) {
        const setup = resolveHeuristicBenchmarkSetup(seedIndex);
        for (const candidateSlot of slots) {
            jobs.push({ profile, seed, setup, candidateFields: fields, candidateSlot, maxTicks, respawnEnabled, opponent });
        }
    }
    // Matches are independent; the pool returns them in job order, so every sum below is formed
    // in the same order as on one thread and the result is bit-identical.
    const results = await matchPool.runMatches(jobs);
    const matchRows = [];
    for (const [index, result] of results.entries()) {
        const { seed, candidateSlot } = jobs[index];
        sums.candidateLifeSeconds += result.candidateLifeSeconds;
        sums.candidateLives += result.candidateLives;
        sums.candidateKills += result.candidateKills;
        sums.candidateDamage += result.candidateDamage;
        sums.baselineLifeSeconds += result.baselineLifeSeconds;
        sums.baselineLives += result.baselineLives;
        sums.baselineKills += result.baselineKills;
        sums.baselineDamage += result.baselineDamage;
        if (result.forced) sums.forcedMatches += 1;
        sums.candidateUpdates += result.candidateEngagement.updates;
        sums.candidateSafetyUpdates += result.candidateEngagement.safetyUpdates;
        sums.candidateShots += result.candidateEngagement.shots;
        sums.baselineUpdates += result.baselineEngagement.updates;
        sums.baselineSafetyUpdates += result.baselineEngagement.safetyUpdates;
        sums.baselineShots += result.baselineEngagement.shots;
        mergeCauseCounts(candidateDeathCauses, result.candidateDeathCauses);
        mergeCauseCounts(baselineDeathCauses, result.baselineDeathCauses);
        // One row per seed and slot, so two evaluations can be compared match by match.
        matchRows.push({
            seed,
            slot: candidateSlot,
            candidateLifeSeconds: result.candidateLifeSeconds,
            candidateLives: result.candidateLives,
            candidateKills: result.candidateKills,
            candidateDamage: result.candidateDamage,
        });
    }
    const matches = matchRows.length;
    const candidateSurvival = sums.candidateLives > 0 ? sums.candidateLifeSeconds / sums.candidateLives : 0;
    const candidateKills = sums.candidateKills / matches;
    const baselineSurvival = sums.baselineLives > 0 ? sums.baselineLifeSeconds / sums.baselineLives : 0;
    const baselineKills = sums.baselineKills / matches;
    const survivalRatio = ratio(candidateSurvival, baselineSurvival);
    const killRatio = ratio(candidateKills, baselineKills);
    const candidateDamage = sums.candidateDamage / matches;
    const baselineDamage = sums.baselineDamage / matches;
    return {
        candidateSurvival,
        candidateKills,
        baselineSurvival,
        baselineKills,
        survivalRatio,
        killRatio,
        candidateDamage,
        baselineDamage,
        damageRatio: ratio(candidateDamage, baselineDamage),
        combinedScore: Math.sqrt(survivalRatio * killRatio),
        forcedMatches: sums.forcedMatches,
        candidateSafetyShare: sums.candidateUpdates > 0 ? sums.candidateSafetyUpdates / sums.candidateUpdates : 0,
        baselineSafetyShare: sums.baselineUpdates > 0 ? sums.baselineSafetyUpdates / sums.baselineUpdates : 0,
        candidateShotsPerMatch: sums.candidateShots / matches,
        baselineShotsPerMatch: sums.baselineShots / matches,
        candidateDeathCauses,
        baselineDeathCauses,
        candidateTrailDeathShare: trailDeathShare(candidateDeathCauses),
        baselineTrailDeathShare: trailDeathShare(baselineDeathCauses),
        matches: matchRows,
    };
}

function perturb(profile, field, step) {
    return {
        ...profile,
        [field]: clampScalar(field, Number(profile[field]) * (1 + step)),
    };
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

function formatPairs(pairs) {
    return Object.entries(pairs)
        .map(([metric, { better, equal, worse }]) => `${metric}:${better}/${equal}/${worse}`)
        .join(',');
}

function toRatioRecord(result) {
    return {
        survival: result.survivalRatio,
        kills: result.killRatio,
        candidateSurvival: result.candidateSurvival,
        baselineSurvival: result.baselineSurvival,
        candidateKills: result.candidateKills,
        baselineKills: result.baselineKills,
        damage: result.damageRatio,
        candidateDamage: result.candidateDamage,
        baselineDamage: result.baselineDamage,
        candidateDeathCauses: result.candidateDeathCauses,
        baselineDeathCauses: result.baselineDeathCauses,
        forcedMatches: result.forcedMatches,
        candidateSafetyShare: result.candidateSafetyShare,
        baselineSafetyShare: result.baselineSafetyShare,
        candidateShotsPerMatch: result.candidateShotsPerMatch,
        baselineShotsPerMatch: result.baselineShotsPerMatch,
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
    const candidates = [step, -step, step * 0.5, -step * 0.5]
        .map((direction) => perturb(current, field, direction))
        .filter((fields) => fields[field] !== current[field]
            && !isInertTacticStep(field, current[field], fields[field]));
    if (candidates.length === 0) {
        advanceCursor(state, profile);
        saveState(state);
        console.log(`profile=${profile} candidate=${field}:${Number(current[field]).toFixed(4)} decision=inert-skip`);
        if (state.plateauRounds >= 3) process.exitCode = 3;
        return;
    }
    const coarseCurrent = await evaluateVariant({
        profile,
        fields: current,
        seeds: TRAINING_SEEDS,
        slots: coarseSlots,
        maxTicks: COARSE_MAX_TICKS,
    });

    let selected = null;
    let shortCoarseCurrent = null;
    for (const fields of candidates) {
        const result = await evaluateVariant({
            profile,
            fields,
            seeds: TRAINING_SEEDS,
            slots: coarseSlots,
            maxTicks: COARSE_MAX_TICKS,
        });
        if (result.combinedScore <= coarseCurrent.combinedScore + MIN_CONFIRMED_GAIN) continue;
        if (!retainsHeuristicEngagement(result)) continue;
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
    let verdict = null;
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
        verdict = judgeCandidate(fullCandidate, fullCurrent);
        if (verdict.accepted && retainsHeuristicEngagement(fullCandidate)) {
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
        + ` damageRatio=${formatRatio(reported.damageRatio)}`
        + ` safetyShare=${reported.candidateSafetyShare.toFixed(3)}`
        + ` shots=${reported.candidateShotsPerMatch.toFixed(1)}`
        + ` decision=${decision}`
        + (verdict ? ` failed=${verdict.failed.join('+') || 'none'} pairs=${formatPairs(verdict.pairs)}` : '')
    );

    if (state.plateauRounds >= 3) process.exitCode = 3;
}

async function verifyCurrentProfiles(seeds = FINAL_SEEDS, persist = true, product = false, profiles = PROFILES) {
    const state = loadState();
    const slots = Array.from({ length: NUM_BOTS }, (_, index) => index);
    const completeProfiles = new Set();
    for (const profile of profiles) {
        const fields = clampProfile(profile, product ? HEURISTIC_PROFILES[profile] : state.profiles[profile]);
        const result = await evaluateVariant({
            profile,
            fields,
            seeds,
            slots,
            maxTicks: FULL_MAX_TICKS,
        });
        if (persist) state.verifiedRatios[profile] = toRatioRecord(result);
        let shortSafe = true;
        if (targetReached(result)) {
            const shortCurrent = await evaluateVariant({
                profile,
                fields: HEURISTIC_IMPROVEMENT_BASELINE[profile],
                seeds,
                slots,
                maxTicks: COARSE_MAX_TICKS,
                respawnEnabled: false,
            });
            const shortCandidate = await evaluateVariant({
                profile,
                fields,
                seeds,
                slots,
                maxTicks: COARSE_MAX_TICKS,
                respawnEnabled: false,
            });
            shortSafe = shortCandidate.candidateSurvival
                >= shortCurrent.candidateSurvival * MIN_ELIMINATION_SURVIVAL_RETENTION;
        }
        if (targetReached(result) && shortSafe) completeProfiles.add(profile);
        console.log(
            `profile=${profile} ${product ? 'product' : persist ? 'verified' : 'confirmed'}SurvivalRatio=${formatRatio(result.survivalRatio)}`
            + ` ${product ? 'product' : persist ? 'verified' : 'confirmed'}KillRatio=${formatRatio(result.killRatio)}`
            + (product ? ` candidateKills=${result.candidateKills.toFixed(3)} baselineKills=${result.baselineKills.toFixed(3)}` : '')
            + ` safetyShare=${result.candidateSafetyShare.toFixed(3)}/${result.baselineSafetyShare.toFixed(3)}`
            + ` shots=${result.candidateShotsPerMatch.toFixed(1)}/${result.baselineShotsPerMatch.toFixed(1)}`
            + ` shortSafe=${shortSafe}`
        );
    }
    if (!persist) return;
    state.completeProfiles = [...completeProfiles];
    state.finalVerification = {
        at: new Date().toISOString(),
        seeds,
        completeProfiles: [...completeProfiles],
    };
    saveState(state);
}

// The search tunes against the frozen July profiles. This check shows how the search profiles fare
// against what players meet today: the shipped heuristic profiles and the standard Hunt bot.
async function checkOpponents() {
    const requestedProfile = String(process.argv[3] || 'all').trim().toLowerCase();
    const profiles = requestedProfile === 'all' ? PROFILES : [requestedProfile];
    if (!profiles.every((profile) => PROFILES.includes(profile))) throw new Error(`unknown profile: ${requestedProfile}`);
    const opponents = process.argv[4] ? String(process.argv[4]).split(',').map((name) => name.trim()) : BENCHMARK_OPPONENTS;
    if (!opponents.every((opponent) => BENCHMARK_OPPONENTS.includes(opponent))) {
        throw new Error(`opponents must be among ${BENCHMARK_OPPONENTS.join(',')}`);
    }
    const state = loadState();
    const slots = Array.from({ length: NUM_BOTS }, (_, index) => index);
    const checks = {};
    for (const profile of profiles) {
        const fields = clampProfile(profile, state.profiles[profile]);
        checks[profile] = { at: new Date().toISOString(), seeds: FINAL_SEEDS, maxTicks: FULL_MAX_TICKS, results: {} };
        for (const opponent of opponents) {
            const result = await evaluateVariant({
                profile, fields, seeds: FINAL_SEEDS, slots, maxTicks: FULL_MAX_TICKS, opponent,
            });
            checks[profile].results[opponent] = toRatioRecord(result);
            console.log(
                `profile=${profile} opponent=${opponent}`
                + ` survivalRatio=${formatRatio(result.survivalRatio)}`
                + ` killRatio=${formatRatio(result.killRatio)}`
                + ` damageRatio=${formatRatio(result.damageRatio)}`
                + ` kills=${result.candidateKills.toFixed(2)}/${result.baselineKills.toFixed(2)}`
                + ` damage=${result.candidateDamage.toFixed(0)}/${result.baselineDamage.toFixed(0)}`
                + ` survival=${result.candidateSurvival.toFixed(1)}s/${result.baselineSurvival.toFixed(1)}s`
            );
        }
    }
    // A search may have saved its state meanwhile; add the checks to the newest state only.
    const latest = loadState();
    latest.opponentChecks = { ...latest.opponentChecks, ...checks };
    saveState(latest);
}

async function replayMatch(product = false) {
    const profile = String(process.argv[3] || '').trim().toLowerCase();
    const seed = Number(process.argv[4]);
    const candidateSlot = Number(process.argv[5] ?? 0);
    if (!PROFILES.includes(profile) || !Number.isInteger(seed) || seed <= 0
        || !Number.isInteger(candidateSlot) || candidateSlot < 0 || candidateSlot >= NUM_BOTS) {
        throw new Error('replay requires profile, positive seed and valid candidate slot');
    }
    const setup = {
        difficulty: String(process.argv[6] || 'NORMAL').trim().toUpperCase(),
        mapKey: String(process.argv[7] || 'standard').trim(),
    };
    const state = loadState();
    const result = await runMatch({
        profile,
        seed,
        setup,
        candidateFields: product ? HEURISTIC_PROFILES[profile] : state.profiles[profile],
        candidateSlot,
        maxTicks: COARSE_MAX_TICKS,
        trace: true,
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
    const verdict = shortOnly ? null : judgeCandidate(result, currentResult);
    const better = shortOnly
        ? result.candidateSurvival >= currentResult.candidateSurvival * MIN_ELIMINATION_SURVIVAL_RETENTION
        : verdict.accepted && retainsHeuristicEngagement(result);
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
        + ` damageGain=${formatRatio(result.candidateDamage / currentResult.candidateDamage)}`
        + ` safetyShare=${result.candidateSafetyShare.toFixed(3)}/${currentResult.candidateSafetyShare.toFixed(3)}`
        + ` shots=${result.candidateShotsPerMatch.toFixed(1)}/${currentResult.candidateShotsPerMatch.toFixed(1)}`
        + ` decision=${decision}`
        + (verdict ? ` failed=${verdict.failed.join('+') || 'none'} pairs=${formatPairs(verdict.pairs)}` : '')
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
    : command === '--confirm'
    ? () => verifyCurrentProfiles(CONFIRMATION_SEEDS, false)
    : command === '--verify-product'
    ? () => verifyCurrentProfiles(FINAL_SEEDS, false, true)
    : command === '--confirm-product'
    ? () => verifyCurrentProfiles(CONFIRMATION_SEEDS, false, true)
    : command === '--audit-product'
    ? () => verifyCurrentProfiles(AUDIT_SEEDS, false, true)
    : command === '--audit-product-seeds'
    ? () => {
        const profile = process.argv[4];
        if (profile && !PROFILES.includes(profile)) throw new Error(`unknown audit profile: ${profile}`);
        return verifyCurrentProfiles(parseFreshAuditSeeds(process.argv[3]), false, true, profile ? [profile] : PROFILES);
    }
    : command === '--check-opponents'
    ? checkOpponents
    : command === '--replay'
    ? replayMatch
    : command === '--replay-product'
    ? () => replayMatch(true)
    : command === '--probe-coarse' || command === '--probe-full' || command === '--try-full' || command === '--probe-short'
    ? () => probeCurrentProfile(command !== '--probe-coarse', command === '--try-full', command === '--probe-short')
    : runIteration;
task().catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
}).finally(async () => {
    await matchPool.close();
});
