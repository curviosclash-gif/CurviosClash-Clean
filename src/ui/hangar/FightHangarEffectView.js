// ============================================
// FightHangarEffectView.js - what a fight build changes in the match
// ============================================
//
// The shared workshop shows blueprint values of the chassis (speed 108 + ..., hit points
// 70 + ...). A fight match does not use them: it applies the percentage bonuses of
// FightHangarBalanceContract. The fight hangar therefore leads with those bonuses and keeps
// the blueprint values below under their own heading.

import { createUiNode as el } from '../arcade/vehicle-manager/VehicleManagerUiPrimitives.js';
import { deltaText, signed } from './HangarWorkshopRenderText.js';

const FIGHT_EFFECT_ROWS = Object.freeze([
    Object.freeze({ key: 'speedBonusPct', label: 'Tempo', unit: '%', hint: 'Tempo im Kampf gegenüber dem Standard-Setup' }),
    Object.freeze({ key: 'turningBonusPct', label: 'Wendigkeit', unit: '%', hint: 'Wendigkeit im Kampf gegenüber dem Standard-Setup' }),
    Object.freeze({ key: 'maxHpBonus', label: 'Lebenspunkte', unit: '', hint: 'Lebenspunkte im Kampf gegenüber dem Standard-Setup' }),
]);

// Blueprint rows that name the same thing as a fight effect row and would contradict it.
const SHADOWED_BLUEPRINT_METRICS = new Set(['speed', 'agility', 'maxHp']);

function readBonuses(build, validateBuild) {
    if (!build || typeof validateBuild !== 'function') return {};
    return validateBuild(build)?.bonuses || {};
}

/**
 * @param {object} build current draft
 * @param {object|null} baselineBuild saved build to compare against (null = standard setup)
 * @param {(build: object) => { bonuses?: object }} validateBuild
 */
export function projectFightHangarEffect(build, baselineBuild, validateBuild) {
    const current = readBonuses(build, validateBuild);
    const baseline = readBonuses(baselineBuild, validateBuild);
    return FIGHT_EFFECT_ROWS.map((row) => {
        const value = Number(current[row.key]) || 0;
        return {
            ...row,
            value,
            deltaToBaseline: Math.round((value - (Number(baseline[row.key]) || 0)) * 10) / 10,
        };
    });
}

/**
 * Puts the fight effect on top of the statistics view and moves the blueprint values under
 * their own heading.
 */
export function prependFightEffectRows(statRows, { draft, baselineBuild, baselineLabel }, validateBuild) {
    if (!statRows) return;
    for (const row of Array.from(statRows.children)) {
        if (SHADOWED_BLUEPRINT_METRICS.has(row.dataset?.metric)) row.remove();
    }
    const blueprintHeading = el('h4', 'hangar-stat-section-title', 'Bauplanwerte');
    statRows.prepend(blueprintHeading);
    const effectRows = projectFightHangarEffect(draft, baselineBuild, validateBuild).map((metric) => {
        const row = el('div', 'arcade-vehicle-compare-row hangar-stat-row is-fight-effect');
        row.dataset.metric = metric.key;
        const value = el('strong', 'hangar-stat-value', signed(metric.value, metric.unit ? ` ${metric.unit}` : ''));
        value.title = metric.hint;
        const tone = metric.deltaToBaseline === 0 ? 'neutral' : (metric.deltaToBaseline > 0 ? 'positive' : 'negative');
        const comparisons = el('div', 'hangar-stat-comparisons');
        comparisons.append(el('span', `hangar-stat-delta is-${tone}`, `Seit ${baselineLabel}: ${deltaText(metric.deltaToBaseline)}`));
        row.append(el('span', 'arcade-vehicle-compare-label', metric.label), value, comparisons);
        return row;
    });
    statRows.prepend(el('h4', 'hangar-stat-section-title', 'Wirkung im Kampf'), ...effectRows);
}
