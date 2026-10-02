import { isFourPlayerPlanarVariant } from '../../four-player-planar/FourPlayerPlanarContract.js';

export function resolveDemolitionLocalPlayerCount(settings) {
    if (isFourPlayerPlanarVariant(settings)) return 4;
    if (settings?.localSettings?.threePlayerSplit?.enabled === true
        || settings?.mode === '3p'
        || Number(settings?.localSettings?.humanEntityCount) >= 3) return 3;
    if (settings?.mode === '2p' || settings?.localSettings?.sessionType === 'splitscreen') return 2;
    return 1;
}

function fillProfileOptions(selects, runtimeAccess, settings) {
    const profiles = runtimeAccess?.getPlayerProfiles?.() || [];
    const activeId = String(runtimeAccess?.getActivePlayerProfile?.()?.id || '');
    const selectedIds = settings.localSettings?.startSetup?.demolitionProfileIds;
    for (let index = 0; index < selects.length; index += 1) {
        const select = selects[index];
        if (!select) continue;
        const currentId = String(select.value || '').trim();
        select.replaceChildren();
        const savedId = Array.isArray(selectedIds) ? selectedIds[index] : '';
        const requested = currentId || (Array.isArray(selectedIds) ? String(savedId || '') : (index === 0 ? activeId : ''));
        const isValid = profiles.some((profile) => profile.id === requested);
        if (!isValid) {
            const missing = document.createElement('option');
            missing.value = '';
            missing.textContent = String(savedId || '').trim()
                ? 'Profil fehlt – neu zuordnen'
                : `Spieler ${index + 1}: Profil auswählen`;
            select.appendChild(missing);
        }
        for (const profile of profiles) {
            const option = document.createElement('option');
            option.value = String(profile.id || '');
            option.textContent = String(profile.displayName || 'Spielerprofil');
            select.appendChild(option);
        }
        select.value = isValid ? requested : '';
    }
}

export function setupArcadeDemolitionProfileSelection(refs, runtimeAccess, settings, bind) {
    const selects = refs?.demolitionProfileSelects || [];
    fillProfileOptions(selects, runtimeAccess, settings);
    const save = (changedSelect = null) => {
        const profiles = runtimeAccess?.getPlayerProfiles?.() || [];
        const savedIds = settings.localSettings?.startSetup?.demolitionProfileIds;
        const ids = [];
        const persistedIds = selects.map((select, index) => {
            const requested = String(select?.value || '');
            const isValid = profiles.some((profile) => profile.id === requested);
            ids.push(isValid ? requested : '');
            const savedId = Array.isArray(savedIds) ? String(savedIds[index] || '') : '';
            return isValid ? requested : (select !== changedSelect && savedId
                && !profiles.some((profile) => profile.id === savedId) ? savedId : '');
        });
        settings.localSettings ||= {};
        settings.localSettings.startSetup ||= {};
        settings.localSettings.startSetup.demolitionProfileIds = persistedIds;
        runtimeAccess?.saveSettings?.(settings);
        return ids;
    };
    for (const select of selects) {
        bind(select, 'focus', () => fillProfileOptions(selects, runtimeAccess, settings));
        bind(select, 'change', () => save(select));
    }
    return {
        save,
        hasUnsupportedPlayerCount: () => resolveDemolitionLocalPlayerCount(settings) > selects.length,
        hasMissingActiveProfile: (ids) => ids.slice(0, resolveDemolitionLocalPlayerCount(settings)).some((id) => !id),
    };
}
