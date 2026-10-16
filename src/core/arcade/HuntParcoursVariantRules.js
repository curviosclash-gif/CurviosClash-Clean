import { resolveHuntParcoursVariant } from '../../shared/contracts/HuntParcoursContract.js';

export const HUNT_PARCOURS_NEMESIS_KILL_TARGET = 3;

/** Returns the immutable contract data used by runtime systems for one Hunt-Parcours variant. */
export function resolveHuntParcoursVariantRules(variantId) {
    const variant = resolveHuntParcoursVariant(variantId);
    if (!variant) return null;
    return Object.freeze({
        variantId: variant.id,
        maps: variant.mapKeys,
        botCount: variant.botCount,
        raceWeight: variant.raceWeight,
        roundSeconds: variant.roundSeconds,
        rulesId: variant.rulesId || variant.id,
        nemesisKillTarget: variant.id === 'nemesis' ? HUNT_PARCOURS_NEMESIS_KILL_TARGET : 0,
    });
}

/**
 * The first Nemesis gate can end from either its authored parcours finish or three credited
 * human kills. Other variants end their stage through their own event/ring objective.
 */
export function resolveHuntParcoursStageResult({ variantId = '', finished = false, completionReason = 'finish', finishWinnerSide = '', humanKills = 0, rivalKills = 0 } = {}) {
    const rules = resolveHuntParcoursVariantRules(variantId);
    if (!rules) return Object.freeze({ complete: false, winnerSide: '', reason: '' });
    if (finished === true && (finishWinnerSide === 'human' || finishWinnerSide === 'rival')) {
        return Object.freeze({ complete: true, winnerSide: finishWinnerSide, reason: completionReason === 'kills' ? 'kills' : 'finish' });
    }
    if (rules.nemesisKillTarget > 0 && Number(humanKills) >= rules.nemesisKillTarget) {
        return Object.freeze({ complete: true, winnerSide: 'human', reason: 'kills' });
    }
    if (rules.nemesisKillTarget > 0 && Number(rivalKills) >= rules.nemesisKillTarget) {
        return Object.freeze({ complete: true, winnerSide: 'rival', reason: 'rival_kills' });
    }
    return Object.freeze({ complete: false, winnerSide: '', reason: '' });
}
