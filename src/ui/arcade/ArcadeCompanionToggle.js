import { ARCADE_COMPANION_MAX, normalizeArcadeCompanionCount } from '../../shared/contracts/ArcadeCompanionContract.js';

export const ARCADE_COMPANION_TOGGLE_ID = 'arcade-companion-count';

const COMPANION_LABELS = Object.freeze(['Keine', '1 Mitstreiter', '2 Mitstreiter']);

export function createArcadeCompanionToggle(doc = document) {
    const label = doc.createElement('label');
    label.className = 'arcade-surface-toggle';
    const input = doc.createElement('select');
    input.className = 'menu-select';
    input.id = ARCADE_COMPANION_TOGGLE_ID;
    input.setAttribute('aria-label', 'Mitstreiter');
    for (let count = 0; count <= ARCADE_COMPANION_MAX; count += 1) {
        const option = doc.createElement('option');
        option.value = String(count);
        option.textContent = COMPANION_LABELS[count] || `${count} Mitstreiter`;
        input.appendChild(option);
    }
    const text = doc.createElement('span');
    text.textContent = 'Mitstreiter';
    label.append(text, input);
    return { label, input };
}

export function bindArcadeCompanionToggle(input, settings, bind, onChange) {
    if (!input || typeof bind !== 'function') return;
    bind(input, 'change', () => {
        if (!settings.arcade || typeof settings.arcade !== 'object') settings.arcade = {};
        settings.arcade.companionCount = normalizeArcadeCompanionCount(input.value);
        onChange?.();
    });
}

/** Companions only fly in a normal run with one player; the daily and the special runs lock the choice. */
export function syncArcadeCompanionToggle(input, settings) {
    if (!input) return;
    const runType = String(settings?.arcade?.runType || 'gauntlet');
    const locked = settings?.arcade?.dailyChallenge === true || runType !== 'gauntlet';
    input.disabled = locked;
    input.value = String(locked ? 0 : normalizeArcadeCompanionCount(settings?.arcade?.companionCount));
    input.title = locked
        ? 'Mitstreiter gibt es nur im normalen Arcade-Run.'
        : 'Verbündete Bots fliegen mit dir (nur allein, nicht im geteilten Bildschirm). Ihre Abschüsse zählen für Ziele, aber nur halb für die Punkte; ein Run mit Mitstreitern kommt nicht in die Rangliste.';
}
