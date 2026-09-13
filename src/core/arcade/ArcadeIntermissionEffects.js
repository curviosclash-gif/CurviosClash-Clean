import { reanchorArcadeCombo } from '../../state/arcade/ArcadeScoreOps.js';
import { toSafeNumber } from '../../shared/utils/ArcadeUtils.js';
import { deriveArcadeRunRewardEffects } from '../../shared/contracts/ArcadeRunRewardEffectsContract.js';

function toSafeInt(value, fallback = 0) {
    return Math.trunc(toSafeNumber(value, fallback));
}

export function captureArcadeHumanVitals(players = null) {
    const playerList = Array.isArray(players) ? players : [];
    return playerList
        .filter((entry) => entry && entry.isBot !== true && entry.alive !== false)
        .map((entry) => ({
            playerIndex: Math.max(0, toSafeInt(entry.index ?? entry.playerIndex, 0)),
            hp: Math.max(0, toSafeNumber(entry.hp, 0)),
            maxHp: Math.max(1, toSafeNumber(entry.maxHp, 100)),
            shieldHP: Math.max(0, toSafeNumber(entry.shieldHP, 0)),
            maxShieldHp: Math.max(0, toSafeNumber(entry.maxShieldHp, 40)),
            hasShield: entry.hasShield === true,
        }));
}

function restoreArcadeHumanVitals(player, humanVitals = null) {
    if (!player || !Array.isArray(humanVitals)) return false;
    const playerIndex = Math.max(0, toSafeInt(player.index ?? player.playerIndex, 0));
    const saved = humanVitals.find((entry) => entry?.playerIndex === playerIndex) || null;
    if (!saved) return false;
    const maxHp = Math.max(1, toSafeNumber(player.maxHp, saved.maxHp));
    player.hp = Math.max(0, Math.min(maxHp, toSafeNumber(saved.hp, maxHp)));
    const maxShieldHp = Math.max(0, toSafeNumber(player.maxShieldHp, saved.maxShieldHp));
    player.shieldHP = Math.max(0, Math.min(maxShieldHp, toSafeNumber(saved.shieldHP, 0)));
    player.hasShield = saved.hasShield === true && player.shieldHP > 0;
    return true;
}

export function applyArcadeIntermissionEffects({
    players = null,
    strategy = null,
    context = null,
    state = null,
} = {}) {
    const humans = (Array.isArray(players) ? players : [])
        .filter((entry) => entry && entry.isBot !== true && entry.alive !== false);
    const result = {
        healedTotal: 0,
        shieldTotal: 0,
        playersAffected: 0,
        playersRestored: 0,
        comboFreezeGrantedMs: 0,
        selectedRewardId: context?.selectedRewardId || null,
        selectedChoiceId: context?.selectedChoiceId || null,
    };

    for (let i = 0; i < humans.length; i += 1) {
        const player = humans[i];
        if (restoreArcadeHumanVitals(player, context?.humanVitals)) result.playersRestored += 1;
        if (typeof strategy?.applyIntermissionHealing !== 'function') continue;
        const healResult = strategy.applyIntermissionHealing(player, {
            selectedRewardId: context?.selectedRewardId,
            completedMissions: context?.missionsCompleted,
            totalMissions: context?.missionsTotal,
        });
        result.healedTotal += Math.max(0, toSafeNumber(healResult?.healed, 0));
        result.shieldTotal += Math.max(0, toSafeNumber(healResult?.shieldGranted, 0));
        result.playersAffected += 1;
    }

    if (state) state.lastIntermissionHeal = result;
    return result;
}

export function syncArcadeRunRewardEffects(state = null, strategy = null) {
    if (!state || typeof state !== 'object') {
        strategy?.applyRunRewardEffects?.(null);
        return null;
    }
    const effects = deriveArcadeRunRewardEffects(state.rewardHistory);
    const baseComboWindowMs = Math.max(800, Number(state.rewardBaseComboWindowMs ?? state?.config?.comboWindowMs) || 5000);
    if (state.config.comboWindowMs !== Math.min(20_000, baseComboWindowMs + effects.comboWindowBonusMs)) reanchorArcadeCombo(state);
    state.rewardBaseComboWindowMs = baseComboWindowMs;
    state.rewardEffects = effects;
    state.config = {
        ...state.config,
        comboWindowMs: Math.min(20_000, baseComboWindowMs + effects.comboWindowBonusMs),
    };
    strategy?.applyRunRewardEffects?.(effects);
    return effects;
}
