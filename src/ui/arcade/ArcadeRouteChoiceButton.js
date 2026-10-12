import { resolveArcadeMapLabel } from './postrun/ArcadePostRunBlocks.js';

// One route button of the intermission. Besides map and modifier it weighs risk against reward:
// the score bonus the modifier pays and the pressure the sector profile derives from it. A missing
// or zero value stays off the button.

function toPositiveNumber(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

/** Squad pressures run from 0.35 to 0.88 before modifiers; the bands split that range in three. */
export function formatArcadeRoutePressure(pressure) {
    const value = toPositiveNumber(pressure);
    if (!value) return '';
    if (value >= 0.75) return 'Druck hoch';
    return value >= 0.5 ? 'Druck mittel' : 'Druck niedrig';
}

export function formatArcadeRouteScoreBonus(scoreBonus) {
    const percent = Math.round(toPositiveNumber(scoreBonus) * 100);
    return percent > 0 ? `+${percent} % Punkte` : '';
}

/** "+18 % Punkte · Druck hoch", or an empty string when the route carries neither value. */
export function formatArcadeRouteRisk(choice = {}) {
    return [
        formatArcadeRouteScoreBonus(choice?.scoreBonus),
        formatArcadeRoutePressure(choice?.pressure),
    ].filter(Boolean).join(' · ');
}

function appendText(parent, tagName, text, className = '') {
    const node = document.createElement(tagName);
    if (className) node.className = className;
    node.textContent = text;
    parent.appendChild(node);
}

/**
 * @param {object} entry one of intermission.choices
 * @param {boolean} active whether this route is the selected one
 * @param {(choiceId: string) => void} onSelect
 */
export function createArcadeRouteChoiceButton(entry, active, onSelect) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `arcade-overlay-choice-btn${active ? ' is-active' : ''}`;
    const choiceId = String(entry?.id || '');
    btn.setAttribute('data-arcade-choice-id', choiceId);
    btn.id = `arcade-choice-${choiceId}`;
    btn.setAttribute('aria-pressed', String(active));
    appendText(btn, 'strong', resolveArcadeMapLabel(entry?.mapKey, entry?.mapLabel));
    appendText(btn, 'span', String(entry?.modifierLabel || 'Kein Modifikator'));
    appendText(btn, 'small', String(entry?.modifierEffect || '').trim() || 'Standardsektor');
    const risk = formatArcadeRouteRisk(entry);
    if (risk) appendText(btn, 'small', risk, 'arcade-overlay-choice-risk');
    btn.addEventListener('click', () => {
        if (choiceId) onSelect(choiceId);
    });
    return btn;
}
