export const FIGHT_HANGAR_BALANCE_CONTRACT_VERSION = 'fight-hangar-balance.v1';

export const FIGHT_HANGAR_STAT_LIMITS = Object.freeze({
    speedBonusPct: Object.freeze({ min: -30, max: 30 }),
    turningBonusPct: Object.freeze({ min: -30, max: 30 }),
    maxHpBonus: Object.freeze({ min: -60, max: 60 }),
});

const TIER_RANK = Object.freeze({ T1: 0, T2: 1, T3: 2 });

// Every tier step has an integer-weighted power score of exactly zero.
// This keeps Fight customization horizontal while still making builds tangible.
const TRADEOFF_PER_TIER = Object.freeze({
    blue: Object.freeze({ speedBonusPct: 4, turningBonusPct: -2, maxHpBonus: -6 }),
    green: Object.freeze({ speedBonusPct: -2, turningBonusPct: 4, maxHpBonus: -6 }),
    gold: Object.freeze({ speedBonusPct: -2, turningBonusPct: -2, maxHpBonus: 12 }),
    cyan: Object.freeze({ speedBonusPct: 2, turningBonusPct: 2, maxHpBonus: -12 }),
    violet: Object.freeze({ speedBonusPct: 3, turningBonusPct: 1, maxHpBonus: -12 }),
});

function round1(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
}
function clamp(value, limits) {
    return Math.max(limits.min, Math.min(limits.max, round1(value)));
}

export function resolveFightPartTradeoff(part = null) {
    const colorId = String(part?.colorId || '').trim().toLowerCase();
    const tier = String(part?.tier || 'T1').trim().toUpperCase();
    const rank = TIER_RANK[tier] ?? 0;
    const perTier = TRADEOFF_PER_TIER[colorId] || null;
    if (!perTier || rank <= 0) {
        return Object.freeze({ speedBonusPct: 0, turningBonusPct: 0, maxHpBonus: 0, balanceScore: 0 });
    }
    const speedBonusPct = perTier.speedBonusPct * rank;
    const turningBonusPct = perTier.turningBonusPct * rank;
    const maxHpBonus = perTier.maxHpBonus * rank;
    return Object.freeze({
        speedBonusPct,
        turningBonusPct,
        maxHpBonus,
        balanceScore: (speedBonusPct * 3) + (turningBonusPct * 3) + maxHpBonus,
    });
}

export function evaluateFightHangarParts(parts = []) {
    const source = Array.isArray(parts) ? parts.filter(Boolean) : [];
    const totals = { speedBonusPct: 0, turningBonusPct: 0, maxHpBonus: 0, balanceScore: 0 };
    let upgradedPartCount = 0;
    let tradeoffPartCount = 0;

    for (const part of source) {
        const tradeoff = resolveFightPartTradeoff(part);
        totals.speedBonusPct += tradeoff.speedBonusPct;
        totals.turningBonusPct += tradeoff.turningBonusPct;
        totals.maxHpBonus += tradeoff.maxHpBonus;
        totals.balanceScore += tradeoff.balanceScore;
        const deltas = [tradeoff.speedBonusPct, tradeoff.turningBonusPct, tradeoff.maxHpBonus];
        if (deltas.some((value) => value !== 0)) upgradedPartCount += 1;
        if (deltas.some((value) => value > 0) && deltas.some((value) => value < 0)) tradeoffPartCount += 1;
    }

    const bonuses = Object.freeze({
        speedBonusPct: clamp(totals.speedBonusPct, FIGHT_HANGAR_STAT_LIMITS.speedBonusPct),
        turningBonusPct: clamp(totals.turningBonusPct, FIGHT_HANGAR_STAT_LIMITS.turningBonusPct),
        maxHpBonus: clamp(totals.maxHpBonus, FIGHT_HANGAR_STAT_LIMITS.maxHpBonus),
    });
    const errors = [];
    if (Math.abs(round1(totals.balanceScore)) > 0.001) {
        errors.push({ code: 'fight_power_budget', message: 'Der Fight-Build überschreitet das neutrale Leistungsbudget.' });
    }
    if (tradeoffPartCount !== upgradedPartCount) {
        errors.push({ code: 'fight_tradeoff_required', message: 'Jede Fight-Verbesserung benötigt einen spürbaren Nachteil.' });
    }
    for (const [key, limits] of Object.entries(FIGHT_HANGAR_STAT_LIMITS)) {
        if (round1(totals[key]) < limits.min || round1(totals[key]) > limits.max) {
            errors.push({ code: 'fight_stat_limit', stat: key, message: `${key} liegt außerhalb des Fight-Limits.` });
        }
    }

    return Object.freeze({
        contractVersion: FIGHT_HANGAR_BALANCE_CONTRACT_VERSION,
        ok: errors.length === 0,
        bonuses,
        balanceScore: round1(totals.balanceScore),
        upgradedPartCount,
        errors: Object.freeze(errors),
    });
}
