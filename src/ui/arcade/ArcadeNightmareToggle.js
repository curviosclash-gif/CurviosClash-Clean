// Arcade-only run tier "Albtraum" (settings.arcade.nightmare). The global bot difficulty stays
// Leicht/Normal/Schwer; this switch only makes the arcade sector plan harder.

export const ARCADE_NIGHTMARE_TOGGLE_ID = 'arcade-nightmare-toggle';

export function createArcadeNightmareToggle(doc = document) {
    const label = doc.createElement('label');
    label.className = 'arcade-surface-toggle';
    const input = doc.createElement('input');
    input.type = 'checkbox';
    input.id = ARCADE_NIGHTMARE_TOGGLE_ID;
    const text = doc.createElement('span');
    text.textContent = 'Run-Stufe Albtraum (stärkere Sektoren, nicht in der Daily)';
    label.append(input, text);
    return { label, input };
}

export function bindArcadeNightmareToggle(input, settings, bind, onChange) {
    if (!input || typeof bind !== 'function') return;
    bind(input, 'change', () => {
        if (!settings.arcade || typeof settings.arcade !== 'object') settings.arcade = {};
        settings.arcade.nightmare = input.checked === true;
        onChange?.();
    });
}

export function syncArcadeNightmareToggle(input, settings) {
    if (input) input.checked = settings?.arcade?.nightmare === true;
}
