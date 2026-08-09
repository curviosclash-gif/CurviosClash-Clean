// Pure label helpers for the hangar workshop renderer: no DOM, no state.

import { resolveFightPartTradeoff } from '../../shared/contracts/FightHangarBalanceContract.js';

export const VEHICLE_CATEGORY_LABELS = Object.freeze({
    jaeger: 'Jäger',
    kreuzer: 'Kreuzer',
    spezial: 'Spezial',
    custom: 'Custom',
});

export const STAT_VALUE_HINTS = Object.freeze({
    speed: 'Abstrakter Geschwindigkeitswert',
    agility: 'Abstrakter Wendigheitswert',
    maxHp: 'Lebenspunkte',
    mass: 'Verbrauchtes Massebudget',
    energy: 'Verbrauchtes Energiebudget',
    heat: 'Erzeugte Hitze',
    partCount: 'Eingesetzte Steine',
    budget: 'Verbrauchtes Editorbudget',
});

export function deltaText(value) {
    const number = Number(value) || 0;
    if (number > 0) return `↑ +${number}`;
    if (number < 0) return `↓ ${number}`;
    return '→ ±0';
}

export function partStatsText(part) {
    return [
        Number(part.stats.speed) ? `Tempo +${part.stats.speed}` : '',
        Number(part.stats.agility) ? `Wende +${part.stats.agility}` : '',
        Number(part.stats.maxHp) ? `HP +${part.stats.maxHp}` : '',
    ].filter(Boolean).join(' · ');
}

export function signed(value, suffix = '') {
    const number = Number(value) || 0;
    return `${number > 0 ? '+' : ''}${number}${suffix}`;
}

export function partRunBonusesText(part, multiplier = 1, mode = 'arcade') {
    const bonuses = mode === 'fight' ? resolveFightPartTradeoff(part) : (part.bonuses || {});
    return [
        Number(bonuses.speedBonusPct) ? `Tempo ${signed(bonuses.speedBonusPct * multiplier, '%')}` : '',
        Number(bonuses.turningBonusPct) ? `Wende ${signed(bonuses.turningBonusPct * multiplier, '%')}` : '',
        Number(bonuses.maxHpBonus) ? `HP ${signed(bonuses.maxHpBonus * multiplier)}` : '',
    ].filter(Boolean).join(' · ') || 'keine direkten Run-Boni';
}

export function partCostsText(part, paired) {
    const multiplier = paired ? 2 : 1;
    const costs = part.costs;
    return `${paired ? 'Paarpreis' : 'Kosten'}: B ${costs.budget * multiplier} · M ${costs.mass * multiplier} · E ${costs.energy * multiplier} · H ${costs.heat * multiplier}`;
}

/** Progress line for the arcade profile box: level, mastery, xp inside the level, spendable points. */
export function progressionSummaryText(progression) {
    return `Level ${progression.level} · Mastery ${progression.masteryCount}`
        + ` · XP ${progression.xpIntoLevel}/${progression.xpForNextLevel}`
        + ` · XRP ${progression.spendableXrp}`;
}

/** Second line: how far the next level still is, in plain words. */
export function progressionDetailText(progression) {
    const base = 'XRP sind deine Kaufpunkte für Steine im Hangar';
    if (progression.xpForNextLevel <= 0) return `Höchstes Level erreicht · ${base}`;
    return `Noch ${progression.xpRemaining} XP bis Level ${progression.level + 1} · ${base}`;
}
