// ============================================
// RewardCalculator.js - deterministic additive reward shaping for training
// ============================================
//
// Expected reward ranges per step (with default weights):
//   baseStep:     0        (constant)
//   survival:     0..0.12  (per step - baseline survival reward)
//   survivalPressureBonus: 0..0.06  (per step - extra reward when surviving under pressure)
//   kill:         0..1     (rare, 0-1 per step)
//   crash:       -6..0     (rare - explicit death penalty)
//   stuck:       -0.35..0  (rare)
//   itemPickup:   0..0.08  (0-1 per step)
//   itemUse:      0..0.03  (0-1 per step)
//   damageDealt:  0..~0.5  (0-25 damage units typical)
//   damageTaken: -3..0     (0-20 damage units typical - 6x penalty)
//   wallRisk:    -0.08..0  (continuous near-wall penalty)
//   trailRisk:   -0.12..0  (continuous trail-pressure penalty)
//   opponentRisk:-0.08..0  (continuous close-opponent penalty)
//   lowHealthThreat: -0.2..0 (extra penalty when fragile under pressure)
//   win:          0..1.5   (terminal only)
//   loss:        -1.5..0   (terminal only)
//   checkpointReached: 0..0.5 (rare - parcours checkpoint; only when parcoursEnabled=true)
//   parcoursCompleted: 0..2.0 (terminal only - parcours finish; only when parcoursEnabled=true)
//   wrongOrder:  -0.3..0   (rare - wrong checkpoint order; only when parcoursEnabled=true)
//
// Typical per-step range: ~[-9.0, +3.2]; with parcours: ~[-9.3, +3.7]
// Terminal step range:    ~[-10.0, +4.5]; with parcours: ~[-10.0, +6.5]
// Trainer clamps rewards to [-rewardClamp, +rewardClamp] (default +-10)
// ============================================

import { toFiniteNumber } from '../../utils/MathOps.js';

const REWARD_PRECISION = 1_000_000;

export const DEFAULT_TRAINING_REWARD_WEIGHTS = Object.freeze({
    baseStep: 0,
    survival: 0.12,
    survivalPressureBonus: 0.06,
    kill: 1,
    crash: -6,
    stuck: -0.35,
    itemPickup: 0.08,
    itemUse: 0.03,
    damageDealt: 0.02,
    damageTaken: -0.15,
    wallRisk: -0.08,
    trailRisk: -0.12,
    opponentRisk: -0.08,
    lowHealthThreat: -0.2,
    win: 1.5,
    loss: -1.5,
    checkpointReached: 0.5,
    parcoursCompleted: 2.0,
    wrongOrder: -0.3,
});

function roundReward(value) {
    return Math.round(Number(value) * REWARD_PRECISION) / REWARD_PRECISION;
}

function toCount(value) {
    if (value === true) return 1;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.trunc(numeric));
}

function clamp01(value, fallback = 0) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    if (numeric <= 0) return 0;
    if (numeric >= 1) return 1;
    return numeric;
}

function resolveRiskValue(source, key) {
    if (source && typeof source === 'object' && Object.prototype.hasOwnProperty.call(source, key)) {
        return clamp01(source[key], 0);
    }
    return 0;
}

function resolveWeightMap(input = {}) {
    const source = input?.weights && typeof input.weights === 'object'
        ? input.weights
        : input;
    const weights = { ...DEFAULT_TRAINING_REWARD_WEIGHTS };
    for (const key of Object.keys(weights)) {
        if (source && Object.prototype.hasOwnProperty.call(source, key)) {
            weights[key] = toFiniteNumber(source[key], weights[key]);
        }
    }
    return weights;
}

function resolveTerminalWinLoss(signals, episodeSnapshot) {
    const won = signals?.won === true
        || String(episodeSnapshot?.terminalReason || '').toLowerCase() === 'match-win';
    const lost = signals?.lost === true
        || String(episodeSnapshot?.terminalReason || '').toLowerCase() === 'match-loss';
    return { won, lost };
}

export function sumRewardComponents(components = {}) {
    let total = 0;
    for (const value of Object.values(components)) {
        total += toFiniteNumber(value, 0);
    }
    return roundReward(total);
}

export function calculateReward(signals = {}, options = {}) {
    const weights = resolveWeightMap(options);
    const episodeSnapshot = options?.episodeSnapshot || null;
    const killCount = toCount(signals.kills ?? signals.killCount);
    const crashCount = toCount(signals.crashes ?? (signals.crashed ? 1 : 0));
    const stuckCount = toCount(signals.stuckEvents ?? (signals.stuck ? 1 : 0));
    const itemPickupCount = toCount(signals.itemsCollected ?? signals.itemPickups);
    const itemUseCount = toCount(signals.itemUses);
    const damageDealt = Math.max(0, toFiniteNumber(signals.damageDealt, 0));
    const damageTaken = Math.max(0, toFiniteNumber(signals.damageTaken, 0));
    const survived = signals.survival !== false;
    const healthRatio = clamp01(signals.healthRatio, 1);
    const pressureLevel = clamp01(signals.pressureLevel, 0);
    const riskProximity = signals.riskProximity && typeof signals.riskProximity === 'object'
        ? signals.riskProximity
        : null;
    const wallRisk = clamp01(signals.wallRisk ?? resolveRiskValue(riskProximity, 'wall'), 0);
    const trailRisk = clamp01(signals.trailRisk ?? resolveRiskValue(riskProximity, 'trail'), 0);
    const opponentRisk = clamp01(signals.opponentRisk ?? resolveRiskValue(riskProximity, 'opponent'), 0);
    const projectileThreat = clamp01(signals.projectileThreat, 0);
    const riskPressure = clamp01(
        Math.max(pressureLevel, wallRisk, trailRisk, opponentRisk, projectileThreat),
        0
    );
    const survivalPressureScale = survived
        ? riskPressure * (0.55 + (1 - healthRatio) * 0.45)
        : 0;
    const lowHealthThreatScale = healthRatio < 0.5
        ? riskPressure * ((0.5 - healthRatio) / 0.5)
        : 0;
    const { won, lost } = resolveTerminalWinLoss(signals, episodeSnapshot);
    const parcoursEnabled = signals.parcoursEnabled === true;
    const checkpointCount = parcoursEnabled
        ? toCount(signals.checkpointReached ?? signals.parcoursCheckpoints)
        : 0;
    const parcoursFinished = parcoursEnabled && signals.parcoursCompleted === true;
    const wrongOrderCount = parcoursEnabled
        ? toCount(signals.wrongOrderCount ?? signals.wrongOrder)
        : 0;

    const components = {
        baseStep: roundReward(weights.baseStep),
        survival: roundReward(survived ? weights.survival : 0),
        survivalPressureBonus: roundReward(survivalPressureScale * weights.survivalPressureBonus),
        kill: roundReward(killCount * weights.kill),
        crash: roundReward(crashCount * weights.crash),
        stuck: roundReward(stuckCount * weights.stuck),
        itemPickup: roundReward(itemPickupCount * weights.itemPickup),
        itemUse: roundReward(itemUseCount * weights.itemUse),
        damageDealt: roundReward(damageDealt * weights.damageDealt),
        damageTaken: roundReward(damageTaken * weights.damageTaken),
        wallRisk: roundReward(wallRisk * weights.wallRisk),
        trailRisk: roundReward(trailRisk * weights.trailRisk),
        opponentRisk: roundReward(opponentRisk * weights.opponentRisk),
        lowHealthThreat: roundReward(lowHealthThreatScale * weights.lowHealthThreat),
        win: roundReward(won ? weights.win : 0),
        loss: roundReward(lost ? weights.loss : 0),
        checkpointReached: roundReward(checkpointCount * weights.checkpointReached),
        parcoursCompleted: roundReward(parcoursFinished ? weights.parcoursCompleted : 0),
        wrongOrder: roundReward(wrongOrderCount * weights.wrongOrder),
        external: roundReward(toFiniteNumber(signals.bonusReward, 0)),
    };
    const total = sumRewardComponents(components);

    return {
        total,
        components,
    };
}

// ============================================
// Curriculum stages: gradually increase reward complexity
// ============================================
export const CURRICULUM_STAGES = Object.freeze([
    {
        name: 'navigate',
        minSteps: 0,
        description: 'Navigation + survival only',
        weightOverrides: {
            kill: 0, crash: -3, stuck: -0.5, itemPickup: 0, itemUse: 0,
            damageDealt: 0, damageTaken: 0, win: 0, loss: 0,
            survival: 0.22, survivalPressureBonus: 0.1, baseStep: 0.001,
            wallRisk: -0.14, trailRisk: -0.18, opponentRisk: -0.06, lowHealthThreat: -0.28,
        },
    },
    {
        name: 'combat',
        minSteps: 5000,
        description: 'Navigation + shooting',
        weightOverrides: {
            itemPickup: 0, itemUse: 0,
            survival: 0.14, survivalPressureBonus: 0.07, baseStep: 0,
            wallRisk: -0.1, trailRisk: -0.14, opponentRisk: -0.08, lowHealthThreat: -0.24,
        },
    },
    {
        name: 'full',
        minSteps: 15000,
        description: 'Full complexity with items',
        weightOverrides: {},
    },
]);

export function resolveCurriculumStage(totalSteps, stages = CURRICULUM_STAGES) {
    let resolved = stages[0];
    for (const stage of stages) {
        if (totalSteps >= stage.minSteps) {
            resolved = stage;
        }
    }
    return resolved;
}

export class RewardCalculator {
    constructor(options = {}) {
        this.weights = resolveWeightMap(options);
        this.curriculumEnabled = options.curriculum === true;
        this.curriculumStages = options.curriculumStages || CURRICULUM_STAGES;
        this._currentStage = null;
    }

    compute(signals = {}, episodeSnapshot = null) {
        let weights = this.weights;
        if (this.curriculumEnabled && typeof signals.totalEnvSteps === 'number') {
            const stage = resolveCurriculumStage(signals.totalEnvSteps, this.curriculumStages);
            if (stage && stage.weightOverrides) {
                weights = { ...this.weights, ...stage.weightOverrides };
                this._currentStage = stage.name;
            }
        }
        return calculateReward(signals, {
            weights,
            episodeSnapshot,
        });
    }

    get currentStage() {
        return this._currentStage;
    }
}
