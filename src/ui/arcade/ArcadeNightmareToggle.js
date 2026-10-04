import { ARCADE_DIFFICULTY_TIERS, loadArcadeDifficultyProgress, resolveArcadeRunTier } from '../../shared/contracts/ArcadeDifficultyContract.js';

export const ARCADE_NIGHTMARE_TOGGLE_ID = 'arcade-difficulty-tier';

export function createArcadeNightmareToggle(doc = document) {
    const label = doc.createElement('label');
    label.className = 'arcade-surface-toggle';
    const input = doc.createElement('select');
    input.className = 'menu-select';
    input.id = ARCADE_NIGHTMARE_TOGGLE_ID;
    input.setAttribute('aria-label', 'Run-Schwierigkeit');
    for (const tier of ARCADE_DIFFICULTY_TIERS) {
        const option = doc.createElement('option');
        option.value = tier.id;
        option.textContent = tier.label;
        input.appendChild(option);
    }
    const text = doc.createElement('span');
    text.textContent = 'Run-Schwierigkeit';
    label.append(text, input);
    return { label, input };
}

export function bindArcadeNightmareToggle(input, settings, bind, onChange) {
    if (!input || typeof bind !== 'function') return;
    bind(input, 'change', () => {
        if (!settings.arcade || typeof settings.arcade !== 'object') settings.arcade = {};
        settings.arcade.difficultyTierId = input.value;
        onChange?.();
    });
}

export function syncArcadeNightmareToggle(input, settings, store = null) {
    if (!input) return;
    const progress = loadArcadeDifficultyProgress(store).progress;
    const exceptions = settings?.arcade?.dailyChallenge === true || ['five_portals', 'weapon_race', 'demolition', 'hangar_test'].includes(settings?.arcade?.runType);
    input.disabled = exceptions;
    for (const option of input.options) {
        const tier = ARCADE_DIFFICULTY_TIERS.find((item) => item.id === option.value);
        option.disabled = !progress.unlockedTierIds.includes(option.value);
        option.textContent = `${tier?.label || option.value}${option.disabled ? ' · gesperrt' : ''}`;
    }
    input.value = resolveArcadeRunTier(settings?.arcade?.difficultyTierId, progress, { runType: settings?.arcade?.runType || 'gauntlet', dailyChallenge: settings?.arcade?.dailyChallenge });
    input.title = 'Hart/Albtraum: Auf der vorigen Stufe 5 Sektoren gewinnen, Welle 8 in Fünf Fronten oder 5 Endlos-Wellen abschließen.';
}
