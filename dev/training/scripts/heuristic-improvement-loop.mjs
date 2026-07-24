// heuristic-improvement-loop.mjs
//
// Read-only coordinate-ascent loop for HEURISTIC_PROFILES. Runs headless HUNT
// deathmatches, scores each variant by 0.6 * normalizedSurvival + 0.4 *
// normalizedKills, and emits console recommendations per profile. Product
// sources (HeuristicBotPolicyOps.js) are NOT modified.
//
// Configurable via env (defaults = "Voll"):
//   HEURISTIC_LOOP_SEEDS     csv seeds            (default: 12 fixed seeds)
//   HEURISTIC_LOOP_PASSES    csv step multipliers (default: 0.20,0.10,0.05)
//   HEURISTIC_LOOP_MAX_TICKS cap ticks per match  (default: 5400 = 90s)
//   HEURISTIC_LOOP_PROFILES  csv profiles          (default: defensive,balanced,aggressive)
//   HEURISTIC_LOOP_NUM_BOTS                       (default: 4)
//   HEURISTIC_LOOP_TIMEOUT_MS                     (default: 5400000 = 90 min)

import { createRuntimeConfigSnapshot } from '../../../src/core/RuntimeConfig.js';
import {
    MATCH_KERNEL_FIXED_STEP_SECONDS,
} from '../../../src/shared/contracts/MatchKernelRuntimeContract.js';
import {
    createHeadlessMatchKernelRuntime,
} from '../src/state/HeadlessMatchKernelRuntime.js';
import {
    HEURISTIC_PROFILES,
} from '../../../src/entities/ai/HeuristicBotPolicyOps.js';
import { createRuntimeRng } from '../../../src/shared/contracts/RuntimeRngContract.js';

const FIXED_STEP = MATCH_KERNEL_FIXED_STEP_SECONDS;

const DEFAULT_SEEDS = [3, 7, 11, 17, 23, 31, 41, 53, 67, 79, 97, 113];
const DEFAULT_PASSES = [0.20, 0.10, 0.05];
const DEFAULT_MAX_TICKS = 5400;
const DEFAULT_PROFILES = ['defensive', 'balanced', 'aggressive'];
const DEFAULT_NUM_BOTS = 4;
const DEFAULT_TIMEOUT_MS = 90 * 60 * 1000;

const SURVIVAL_REF_SECONDS = 60;
const KILL_REF = 4;
const SURVIVAL_WEIGHT = 0.6;
const KILLS_WEIGHT = 0.4;

const TUNABLE_FIELDS = Object.freeze([
    'retreatVitality',
    'retreatPressure',
    'boostBias',
    'defensiveItemThresholdScale',
    'offensiveItemThresholdScale',
    'attackWindow',
    'safetyDistance',
    'preferredRange',
    'strafeDistance',
]);

const FIELD_BOUNDS = Object.freeze({
    retreatVitality: [0.10, 0.80],
    retreatPressure: [0.40, 1.00],
    boostBias: [0.50, 1.60],
    defensiveItemThresholdScale: [0.50, 1.50],
    offensiveItemThresholdScale: [0.50, 1.50],
    attackWindow: [0.30, 1.00],
    safetyDistance: [0.08, 0.60],
    preferredRange: [0.10, 0.70],
    strafeDistance: [0.20, 0.80],
});

function parseCsvInt(value, fallback) {
    if (!value) return fallback;
    return String(value).split(',')
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n));
}
function parseCsvFloat(value, fallback) {
    if (!value) return fallback;
    return String(value).split(',')
        .map((s) => Number.parseFloat(s.trim()))
        .filter((n) => Number.isFinite(n));
}
function parseCsvStr(value, fallback) {
    if (!value) return fallback;
    return String(value).split(',').map((s) => s.trim()).filter(Boolean);
}

const SEEDS = parseCsvInt(process.env.HEURISTIC_LOOP_SEEDS, DEFAULT_SEEDS);
const PASSES = parseCsvFloat(process.env.HEURISTIC_LOOP_PASSES, DEFAULT_PASSES);
const MAX_TICKS = Number.parseInt(process.env.HEURISTIC_LOOP_MAX_TICKS, 10) || DEFAULT_MAX_TICKS;
const PROFILES = parseCsvStr(process.env.HEURISTIC_LOOP_PROFILES, DEFAULT_PROFILES);
const NUM_BOTS = Number.parseInt(process.env.HEURISTIC_LOOP_NUM_BOTS, 10) || DEFAULT_NUM_BOTS;
const TIMEOUT_MS = Number.parseInt(process.env.HEURISTIC_LOOP_TIMEOUT_MS, 10) || DEFAULT_TIMEOUT_MS;

function fightSettings(profile) {
    return {
        localSettings: { modePath: 'fight', sessionType: 'single' },
        mode: '1p', mapKey: 'standard', gameMode: 'HUNT',
        numBots: NUM_BOTS, winsNeeded: 1,
        botDifficulty: 'NORMAL', botPolicyStrategy: 'heuristic', botHeuristicProfile: profile,
        gameplay: { planarMode: false, fightPlayerHp: 100, fightMgDamage: 15, mgTrailAimRadius: 0.3 },
        hunt: { respawnEnabled: false, deathmatchKillLimit: 50, deathmatchTimeLimitSeconds: 0 },
        portalsEnabled: false,
    };
}

function clampScalar(field, value) {
    const [lo, hi] = FIELD_BOUNDS[field];
    const n = Number(value);
    if (!Number.isFinite(n)) return (lo + hi) * 0.5;
    return Math.max(lo, Math.min(hi, n));
}

async function runMatch(settings, seed, candidateProfile, candidateFields) {
    const originalRandom = Math.random;
    const seededRandom = createRuntimeRng({ seed });
    let runtime = null;
    Math.random = seededRandom.next;
    try {
        const runtimeConfig = createRuntimeConfigSnapshot(settings);
        runtime = await Promise.resolve(createHeadlessMatchKernelRuntime({
            settings, runtimeConfig,
            requestedMapKey: runtimeConfig.session.mapKey,
            profile: { sessionId: `improve-run-${seed}`, fixedStepSeconds: FIXED_STEP, deterministic: true },
        }));

        const em = runtime.session.entityManager;
        const bots = em.bots || [];
        if (bots.length === 0) {
            return { survivalSeconds: 0, kills: 0, forced: true, ticks: 0 };
        }
        const testBot = bots[0];
        const testPlayer = testBot.player;
        if (candidateFields && testBot.ai && testBot.ai.profile) {
            const candidateObj = Object.assign({}, testBot.ai.profile, candidateFields);
            for (const field of TUNABLE_FIELDS) {
                if (Object.prototype.hasOwnProperty.call(candidateObj, field)) {
                    candidateObj[field] = clampScalar(field, candidateObj[field]);
                }
            }
            Object.setPrototypeOf(candidateObj, Object.getPrototypeOf(testBot.ai.profile));
            testBot.ai.profile = candidateObj;
        }
        const testIndex = testPlayer.index;
        let testDiedAtTick = MAX_TICKS;
        let endTick = MAX_TICKS;
        let forced = true;

        for (let frame = 1; frame <= MAX_TICKS; frame++) {
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
            if (testPlayer.alive === false && testDiedAtTick === MAX_TICKS) {
                testDiedAtTick = frame;
            }
            const aliveCount = em.players.filter((p) => p && p.alive).length;
            if (aliveCount <= 1) { endTick = frame; forced = false; break; }
        }

        const survivalTick = Math.min(testDiedAtTick, endTick);
        const survivalSeconds = survivalTick * FIXED_STEP;
        const scoreboard = em.getHuntScoreboard ? em.getHuntScoreboard() : [];
        const row = scoreboard.find((r) => r.playerIndex === testIndex);
        const kills = Math.max(0, Number(row?.kills) || 0);
        return { survivalSeconds, kills, forced, ticks: endTick };
    } finally {
        runtime?.dispose?.();
        Math.random = originalRandom;
    }
}

async function evaluateVariant(profile, candidateFields) {
    const settings = fightSettings(profile);
    let sumSurvival = 0, sumKills = 0, forcedCount = 0;
    for (const seed of SEEDS) {
        const res = await runMatch(settings, seed, profile, candidateFields);
        sumSurvival += res.survivalSeconds;
        sumKills += res.kills;
        if (res.forced) forcedCount += 1;
    }
    const meanSurvival = sumSurvival / SEEDS.length;
    const meanKills = sumKills / SEEDS.length;
    const normSurvival = Math.min(1, meanSurvival / SURVIVAL_REF_SECONDS);
    const normKills = Math.min(1, meanKills / KILL_REF);
    const score = SURVIVAL_WEIGHT * normSurvival + KILLS_WEIGHT * normKills;
    return {
        meanSurvivalSeconds: meanSurvival,
        meanKills,
        forcedRate: forcedCount / SEEDS.length,
        score,
    };
}

function perturb(currentProfile, field, stepMultiplier) {
    const base = Number(currentProfile[field]) || 0;
    const candidate = base * (1 + stepMultiplier);
    return clampScalar(field, candidate);
}

async function climbProfile(profileName, log) {
    const base = HEURISTIC_PROFILES[profileName];
    if (!base) throw new Error(`unknown profile: ${profileName}`);
    const current = Object.assign({}, base);
    log(`--- baseline ${profileName} ---`);
    const baselineEval = await evaluateVariant(profileName, null);
    log(`baseline: surv=${baselineEval.meanSurvivalSeconds.toFixed(1)}s kills=${baselineEval.meanKills.toFixed(2)} score=${baselineEval.score.toFixed(3)}`);
    let bestScore = baselineEval.score;
    const history = [{ phase: 'baseline', ...baselineEval, fields: { ...current } }];

    for (let passIndex = 0; passIndex < PASSES.length; passIndex++) {
        const step = PASSES[passIndex];
        log(`--- ${profileName} pass ${passIndex + 1} step=${step} ---`);
        let improvedThisPass = false;
        for (const field of TUNABLE_FIELDS) {
            const candidates = [
                { delta: +step, value: perturb(current, field, +step) },
                { delta: -step, value: perturb(current, field, -step) },
            ];
            let bestDir = null;
            let bestDirScore = bestScore;
            for (const cand of candidates) {
                if (Math.abs(cand.value - Number(current[field])) < 1e-6) continue;
                const candidateFields = { [field]: cand.value };
                const evalRes = await evaluateVariant(profileName, candidateFields);
                if (evalRes.score > bestDirScore + 1e-5) {
                    bestDirScore = evalRes.score;
                    bestDir = { ...cand, eval: evalRes };
                }
            }
            if (bestDir) {
                current[field] = bestDir.value;
                bestScore = bestDirScore;
                improvedThisPass = true;
                log(`  ${field.padEnd(32)} -> ${bestDir.value.toFixed(3)} (score=${bestScore.toFixed(3)} surv=${bestDir.eval.meanSurvivalSeconds.toFixed(1)}s kills=${bestDir.eval.meanKills.toFixed(2)})`);
            }
        }
        history.push({ phase: `pass-${passIndex + 1}`, step, score: bestScore, fields: { ...current }, improved: improvedThisPass });
        if (!improvedThisPass) {
            log(`no improvement in pass ${passIndex + 1}; converging early`);
            break;
        }
    }
    return { profile: profileName, baseline: base, improved: current, baselineScore: baselineEval.score, improvedScore: bestScore, history };
}

function printDelta(field, baseValue, improvedValue) {
    const b = Number(baseValue), i = Number(improvedValue);
    const d = i - b;
    const pct = b !== 0 ? (d / b) * 100 : 0;
    const arrow = d > 0 ? '+' : d < 0 ? '-' : '=';
    return `${field.padEnd(32)} base ${b.toFixed(3)}  new ${i.toFixed(3)}  ${arrow}${Math.abs(pct).toFixed(1)}%`;
}

async function main() {
    const log = (msg) => console.log(msg);
    console.log('=== HEURISTIC IMPROVEMENT LOOP ===');
    console.log(`mode: read-only coordinate ascent over HEURISTIC_PROFILES`);
    console.log(`profiles=${PROFILES.join(',')} seeds=${SEEDS.join(',')} passes=${PASSES.join(',')} maxTicks=${MAX_TICKS} numBots=${NUM_BOTS}`);
    console.log(`weights: survival=${SURVIVAL_WEIGHT} kills=${KILLS_WEIGHT} (survival ref=${SURVIVAL_REF_SECONDS}s kills ref=${KILL_REF})`);
    console.log(`(product file HeuristicBotPolicyOps.js is NOT modified)\n`);
    const t0 = Date.now();

    const results = [];
    for (const profileName of PROFILES) {
        const res = await climbProfile(profileName, log);
        results.push(res);
    }

    const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`\n=== RECOMMENDATIONS (elapsed ${elapsedSec}s) ===\n`);
    for (const res of results) {
        console.log(`### ${res.profile} ###`);
        console.log(`baseline score ${res.baselineScore.toFixed(3)} -> improved score ${res.improvedScore.toFixed(3)} (delta ${(res.improvedScore - res.baselineScore).toFixed(3)})`);
        for (const field of TUNABLE_FIELDS) {
            console.log(`  ${printDelta(field, res.baseline[field], res.improved[field])}`);
        }
        console.log('');
    }
    console.log('=== END ===');
}

const TIMER = setTimeout(() => { console.error('timeout'); process.exit(2); }, TIMEOUT_MS);
TIMER.unref?.();
main().catch((e) => { console.error(e?.stack || e); process.exit(1); });