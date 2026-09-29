// One head-to-head benchmark match: a candidate heuristic profile in one bot slot against fixed
// comparison profiles in all other slots, on simulated time with a seeded Math.random.

import { createRuntimeConfigSnapshot } from '../../../src/core/RuntimeConfig.js';
import { MATCH_KERNEL_FIXED_STEP_SECONDS } from '../../../src/shared/contracts/MatchKernelRuntimeContract.js';
import { createHeadlessMatchKernelRuntime } from '../src/state/HeadlessMatchKernelRuntime.js';
import { HEURISTIC_PROFILE_FIELD_BOUNDS } from '../../../src/entities/ai/HeuristicBotPolicyOps.js';
import { createRuntimeRng } from '../../../src/shared/contracts/RuntimeRngContract.js';
import {
    createHeuristicEngagementTracker, createHeuristicLifeTracker,
} from './heuristic-improvement-metrics.mjs';
import {
    HEURISTIC_BENCHMARK_BASE_CONFIG, HEURISTIC_IMPROVEMENT_BASELINE, verifyHeuristicBenchmarkArena,
} from './heuristic-improvement-baseline.mjs';

export const FIXED_STEP = MATCH_KERNEL_FIXED_STEP_SECONDS;

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

const DEFAULT_NUM_BOTS = 4;
const SIMULATED_CLOCK_ORIGIN_MS = 1_000_000;

export function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const NUM_BOTS = parsePositiveInteger(process.env.HEURISTIC_LOOP_NUM_BOTS, DEFAULT_NUM_BOTS);

function fightSettings(profile, respawnEnabled, seed, { difficulty, mapKey }) {
    return {
        localSettings: { modePath: 'fight', sessionType: 'single' },
        mode: '1p',
        mapKey,
        gameMode: 'HUNT',
        numBots: NUM_BOTS,
        winsNeeded: 1,
        botDifficulty: difficulty,
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

export function clampScalar(field, value, fallbackValue) {
    const bounds = HEURISTIC_PROFILE_FIELD_BOUNDS[field];
    const numeric = Number(value);
    const fallback = Number(fallbackValue);
    if (!bounds) return Number.isFinite(numeric) ? numeric : (Number.isFinite(fallback) ? fallback : 0);
    if (!Number.isFinite(numeric)) {
        return Math.max(bounds[0], Math.min(bounds[1], Number.isFinite(fallback) ? fallback : 0));
    }
    return Math.max(bounds[0], Math.min(bounds[1], numeric));
}

export function clampProfile(profileName, profile) {
    const baseProfile = HEURISTIC_IMPROVEMENT_BASELINE[profileName] || HEURISTIC_IMPROVEMENT_BASELINE.balanced;
    const source = profile && typeof profile === 'object' ? profile : baseProfile;
    const result = { ...baseProfile };
    for (const field of TUNABLE_FIELDS) {
        result[field] = clampScalar(field, source[field], baseProfile[field]);
    }
    return result;
}

function incrementCauseCount(target, cause) {
    target[cause] = (target[cause] || 0) + 1;
}

export async function runMatch({
    profile, seed, setup, candidateFields, candidateSlot, maxTicks, respawnEnabled = true, trace = false,
}) {
    const originalRandom = Math.random;
    const originalDateNow = Date.now;
    const originalPerformanceNow = performance.now;
    // Some systems (wall probe reuse, regen delay, pickup bobbing) read the wall clock. Headless
    // ticks run far faster than real time, so show them simulated time as the game at 60 fps would.
    let simulatedNowMs = SIMULATED_CLOCK_ORIGIN_MS;
    Date.now = () => simulatedNowMs;
    performance.now = () => simulatedNowMs;
    const seededRandom = createRuntimeRng({ seed });
    let runtime = null;
    Math.random = seededRandom.next;
    try {
        const settings = fightSettings(profile, respawnEnabled, seed, setup);
        const runtimeConfig = createRuntimeConfigSnapshot(settings, { baseConfig: HEURISTIC_BENCHMARK_BASE_CONFIG });
        if (runtimeConfig.arcade.seed !== seed || runtimeConfig.hunt.timeLimitSeconds !== 0
            || runtimeConfig.session.mapKey !== setup.mapKey || runtimeConfig.bot.activeDifficulty !== setup.difficulty) {
            throw new Error(`invalid benchmark configuration for seed ${seed}`);
        }
        runtime = await Promise.resolve(createHeadlessMatchKernelRuntime({
            settings,
            runtimeConfig,
            baseConfig: HEURISTIC_BENCHMARK_BASE_CONFIG,
            requestedMapKey: runtimeConfig.session.mapKey,
            profile: {
                sessionId: `heuristic-h2h-${profile}-${seed}-${candidateSlot}`,
                fixedStepSeconds: FIXED_STEP,
                deterministic: true,
            },
        }));

        const em = runtime.session.entityManager;
        verifyHeuristicBenchmarkArena(em.arena, setup.mapKey);
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
        const engagement = createHeuristicEngagementTracker();
        for (const bot of bots) {
            const wrappedUpdate = bot.ai.update;
            bot.ai.update = function (dt, player, context) {
                const action = wrappedUpdate.call(this, dt, player, context);
                engagement.record(player?.index, action, this._safetyState?.state);
                return action;
            };
        }
        const actionTrace = trace ? {
            updates: 0,
            modes: {},
            targetDistanceBuckets: {},
            safetyStates: {},
            safetyReasons: {},
            intents: {},
            turnChoices: {},
            yawTies: 0,
            bothSafeTurns: 0,
            collisionNormalUpdates: 0,
            activeBounceWindowUpdates: 0,
            inventoryUpdates: 0,
            rocketUpdates: 0,
            itemUses: 0,
            mgShots: 0,
            rocketShots: 0,
            itemShots: 0,
            boosts: 0,
            deaths: [],
            recentSafety: [],
        } : null;
        if (actionTrace) {
            const originalUpdate = candidateBot.ai.update;
            candidateBot.ai.update = function (dt, player, context) {
                const action = originalUpdate.call(this, dt, player, context);
                const decision = this.getDecisionSnapshot();
                actionTrace.updates += 1;
                incrementCauseCount(actionTrace.modes, decision.mode);
                incrementCauseCount(actionTrace.targetDistanceBuckets, String(Math.floor(decision.targetDistanceRatio * 10) / 10));
                incrementCauseCount(actionTrace.safetyStates, decision.safetyState);
                incrementCauseCount(actionTrace.safetyReasons, decision.safetyReason || 'none');
                incrementCauseCount(actionTrace.intents, decision.intent);
                const safety = this._safetyState;
                incrementCauseCount(actionTrace.turnChoices, `${safety.turnAxis}:${safety.turnDirection}`);
                if (Math.abs(safety.leftClearance - safety.rightClearance) <= 0.06) actionTrace.yawTies += 1;
                if (safety.leftClearance > 0.9 && safety.rightClearance > 0.9) actionTrace.bothSafeTurns += 1;
                if (safety.hasCollisionNormal) actionTrace.collisionNormalUpdates += 1;
                if (safety.bounceWindowTimer > 0) actionTrace.activeBounceWindowUpdates += 1;
                actionTrace.recentSafety.push({
                    reason: decision.safetyReason,
                    turn: `${safety.turnAxis}:${safety.turnDirection}`,
                    front: safety.frontClearance,
                    left: safety.leftClearance,
                    right: safety.rightClearance,
                    planned: safety.plannedClearance,
                });
                if (actionTrace.recentSafety.length > 8) actionTrace.recentSafety.shift();
                if (Array.isArray(player?.inventory) && player.inventory.length > 0) actionTrace.inventoryUpdates += 1;
                if (Array.isArray(player?.rocketInventory) && player.rocketInventory.length > 0) actionTrace.rocketUpdates += 1;
                if (action.useItem >= 0) actionTrace.itemUses += 1;
                if (action.shootMG) actionTrace.mgShots += 1;
                if (action.shootRocket) actionTrace.rocketShots += 1;
                if (action.shootItem) actionTrace.itemShots += 1;
                if (action.boost) actionTrace.boosts += 1;
                return action;
            };
        }
        const candidateIndex = candidateBot.player.index;
        const lifeTracker = createHeuristicLifeTracker();
        const candidateDeathCauses = {};
        const baselineDeathCauses = {};
        let lastCandidateKills = 0;
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
            if (actionTrace) {
                const rows = em.getHuntScoreboard?.() || [];
                const currentKills = Number(rows.find((row) => row.playerIndex === candidateIndex)?.kills) || 0;
                const distance = candidateBot.player.position?.distanceTo?.(deadPlayer.position);
                actionTrace.deaths.push({
                    second: Math.round((Number(em._simulationClockMs) || 0) * 0.001),
                    victim: deadPlayer.index === candidateIndex ? 'candidate' : 'baseline',
                    cause,
                    candidateKill: currentKills > lastCandidateKills,
                    distance: Number.isFinite(distance) ? Math.round(distance) : null,
                    ...(deadPlayer.index === candidateIndex
                        ? { recentSafety: [...actionTrace.recentSafety] }
                        : {}),
                });
                lastCandidateKills = currentKills;
            }
        };

        for (let frame = 1; frame <= maxTicks; frame += 1) {
            tickOptions.tickIndex = runtime.kernel.tickIndex;
            tickOptions.frameId = frame;
            tickOptions.wallClockMs = frame * 16;
            tickOptions.highResTimestampMs = frame * 16;
            simulatedNowMs = SIMULATED_CLOCK_ORIGIN_MS + frame * FIXED_STEP * 1000;
            runtime.step(inputFrame, tickOptions);
            if (frame === 1) {
                for (const bot of bots) {
                    if (bot.ai.difficultyName !== setup.difficulty.toLowerCase()) {
                        throw new Error(`benchmark difficulty lost: ${bot.ai.difficultyName} !== ${setup.difficulty}`);
                    }
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
        const baselineEngagement = { updates: 0, safetyUpdates: 0, shots: 0 };
        for (const bot of bots) {
            const playerIndex = bot?.player?.index;
            if (!Number.isInteger(playerIndex) || playerIndex === candidateIndex) continue;
            const botEngagement = engagement.totals(playerIndex);
            baselineEngagement.updates += botEngagement.updates;
            baselineEngagement.safetyUpdates += botEngagement.safetyUpdates;
            baselineEngagement.shots += botEngagement.shots;
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
            candidateEngagement: engagement.totals(candidateIndex),
            baselineEngagement,
            forced,
            ...(actionTrace ? { actionTrace } : {}),
        };
    } finally {
        runtime?.dispose?.();
        Math.random = originalRandom;
        Date.now = originalDateNow;
        performance.now = originalPerformanceNow;
    }
}
