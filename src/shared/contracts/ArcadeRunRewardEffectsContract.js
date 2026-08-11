const EMPTY_EFFECTS = Object.freeze({
    speedBonusPct: 0,
    maxHpBonus: 0,
    comboWindowBonusMs: 0,
    spawnRateMultiplier: 1,
    shieldTopupBonusPct: 0,
});

export const ARCADE_RUN_REWARD_EFFECT_RULES = Object.freeze({
    run_speed_t1: Object.freeze({ effect: 'speedBonusPct', stack: 'add', perStack: 4, cap: 20 }),
    run_armor_t1: Object.freeze({ effect: 'maxHpBonus', stack: 'add', perStack: 12, cap: 48 }),
    run_combo_t1: Object.freeze({ effect: 'comboWindowBonusMs', stack: 'add', perStack: 800, cap: 3200 }),
    run_pickup_t1: Object.freeze({ effect: 'spawnRateMultiplier', stack: 'multiply', perStack: 1.15, cap: 1.75 }),
    run_portal_t1: Object.freeze({ effect: 'shieldTopupBonusPct', stack: 'add', perStack: 25, cap: 100 }),
});

function toFiniteNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeRewardId(entry) {
    const rewardId = typeof entry === 'string' ? entry : entry?.rewardId;
    return String(rewardId || '').trim().toLowerCase();
}

export function createDefaultArcadeRunRewardEffects() {
    return { ...EMPTY_EFFECTS };
}

export function normalizeArcadeRunRewardEffects(source = null) {
    const input = source && typeof source === 'object' ? source : EMPTY_EFFECTS;
    return {
        speedBonusPct: Math.max(0, Math.min(20, toFiniteNumber(input.speedBonusPct, 0))),
        maxHpBonus: Math.max(0, Math.min(48, toFiniteNumber(input.maxHpBonus, 0))),
        comboWindowBonusMs: Math.max(0, Math.min(3200, Math.trunc(toFiniteNumber(input.comboWindowBonusMs, 0)))),
        spawnRateMultiplier: Math.max(1, Math.min(1.75, toFiniteNumber(input.spawnRateMultiplier, 1))),
        shieldTopupBonusPct: Math.max(0, Math.min(100, toFiniteNumber(input.shieldTopupBonusPct, 0))),
    };
}

export function deriveArcadeRunRewardEffects(rewardHistory = null) {
    const effects = createDefaultArcadeRunRewardEffects();
    const entries = Array.isArray(rewardHistory) ? rewardHistory : [];
    for (let index = 0; index < entries.length; index += 1) {
        const rule = ARCADE_RUN_REWARD_EFFECT_RULES[normalizeRewardId(entries[index])];
        if (!rule) continue;
        if (rule.stack === 'multiply') {
            effects[rule.effect] = Math.min(rule.cap, effects[rule.effect] * rule.perStack);
        } else {
            effects[rule.effect] = Math.min(rule.cap, effects[rule.effect] + rule.perStack);
        }
    }
    return normalizeArcadeRunRewardEffects(effects);
}
