import { reanchorArcadeCombo } from '../../state/arcade/ArcadeScoreOps.js';
import { getMasteryPerks } from '../../state/arcade/ArcadeVehicleProfile.js';
import { toSafeNumber } from '../../shared/utils/ArcadeUtils.js';

export function syncArcadeMasteryPerks(state, profile = null) {
    const perks = getMasteryPerks(state?.isDailyChallenge || state?.config?.dailyChallenge ? 1 : profile?.level);
    if (state?.masteryPerks && state.masteryPerks.comboDecaySlowPct !== perks.comboDecaySlowPct) reanchorArcadeCombo(state);
    if (state) state.masteryPerks = { ...perks };
    return perks;
}

export function applyArcadeMasteryScoreBonus(score, perks = null) {
    const bonusPct = Math.max(0, Math.min(100, toSafeNumber(perks?.scoreBonusPct, 0)));
    return Math.round(Math.max(0, toSafeNumber(score, 0)) * (1 + bonusPct / 100));
}
