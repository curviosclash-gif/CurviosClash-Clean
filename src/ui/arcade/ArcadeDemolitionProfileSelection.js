import { isFourPlayerPlanarVariant } from '../../four-player-planar/FourPlayerPlanarContract.js';

export function resolveDemolitionLocalPlayerCount(settings) {
    const localSettings = settings?.localSettings;
    const sessionType = String(localSettings?.sessionType || '').trim().toLowerCase();
    if (sessionType === 'single') return 1;
    if (sessionType === 'multiplayer' || sessionType === 'lan' || sessionType === 'online') {
        const localHumanCount = Number(localSettings?.localHumanCount);
        return Number.isFinite(localHumanCount) && localHumanCount > 0
            ? Math.max(1, Math.floor(localHumanCount))
            : 1;
    }
    if (isFourPlayerPlanarVariant(settings)) return 4;
    if (settings?.localSettings?.threePlayerSplit?.enabled === true
        || settings?.mode === '3p'
        || Number(settings?.localSettings?.humanEntityCount) >= 3) return 3;
    if (settings?.mode === '2p' || settings?.localSettings?.sessionType === 'splitscreen') return 2;
    return 1;
}

export function shouldShowArcadePlayerProfileControls(settings) {
    return settings?.arcade?.runType === 'demolition' || resolveDemolitionLocalPlayerCount(settings) > 1;
}

function getSavedProfileIds(settings) {
    const setup = settings.localSettings?.startSetup;
    const selectedIds = setup?.arcadePlayerProfileIds;
    return Array.isArray(selectedIds) && selectedIds.some((id) => String(id || '').trim())
        ? selectedIds
        : setup?.demolitionProfileIds;
}

function fillProfileOptions(selects, runtimeAccess, settings) {
    const profiles = runtimeAccess?.getPlayerProfiles?.() || [];
    const activeId = String(runtimeAccess?.getActivePlayerProfile?.()?.id || '');
    const selectedIds = getSavedProfileIds(settings);
    for (let index = 0; index < selects.length; index += 1) {
        const select = selects[index];
        if (!select) continue;
        const currentId = String(select.value || '').trim();
        select.replaceChildren();
        const savedId = Array.isArray(selectedIds) ? selectedIds[index] : '';
        const savedIdText = String(savedId || '').trim();
        const requested = currentId || savedIdText || (index === 0 ? activeId : '');
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

export function setupArcadePlayerProfileSelection(refs, runtimeAccess, settings, bind) {
    const selects = refs?.demolitionProfileSelects || [];
    fillProfileOptions(selects, runtimeAccess, settings);
    const save = (changedSelect = null) => {
        const profiles = runtimeAccess?.getPlayerProfiles?.() || [];
        const savedIds = getSavedProfileIds(settings);
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
        settings.localSettings.startSetup.arcadePlayerProfileIds = persistedIds;
        settings.localSettings.startSetup.demolitionProfileIds = persistedIds;
        runtimeAccess?.saveSettings?.(settings);
        return ids;
    };
    for (const select of selects) {
        bind(select, 'focus', () => fillProfileOptions(selects, runtimeAccess, settings));
        bind(select, 'change', () => save(select));
    }
    const resolvePlayerCount = (playerCount) => Number.isInteger(playerCount)
        ? playerCount
        : resolveDemolitionLocalPlayerCount(settings);
    const readSelectedProfileIds = (playerCount = null) => {
        const profiles = runtimeAccess?.getPlayerProfiles?.() || [];
        const count = resolvePlayerCount(playerCount);
        return selects.map((select, index) => {
            const requested = String(select?.value || '').trim();
            return index < count && profiles.some((profile) => profile.id === requested) ? requested : '';
        });
    };
    return {
        save,
        readSelectedProfileIds,
        refreshForSoloStart: (playerCount = null) => {
            if (resolvePlayerCount(playerCount) === 1) {
                fillProfileOptions(selects, runtimeAccess, settings);
                if (selects[0]) {
                    selects[0].value = String(runtimeAccess?.getActivePlayerProfile?.()?.id || '');
                }
            }
        },
        hasUnsupportedPlayerCount: (playerCount = null) => resolvePlayerCount(playerCount) > selects.length,
        hasMissingActiveProfile: (ids, playerCount = null) => ids.slice(0, resolvePlayerCount(playerCount)).some((id) => !id),
        hasDuplicateActiveProfiles: (ids, playerCount = null) => {
            const activeIds = ids.slice(0, resolvePlayerCount(playerCount));
            return new Set(activeIds).size !== activeIds.length;
        },
    };
}

export function validateArcadePlayerProfileSelection(selection, playerCount = null) {
    if (selection?.hasUnsupportedPlayerCount?.(playerCount)) return { ok: false, reason: 'unsupported_player_count' };
    const profileIds = selection?.readSelectedProfileIds?.(playerCount);
    if (!Array.isArray(profileIds)) return { ok: false, reason: 'missing_profile' };
    if (selection?.hasMissingActiveProfile?.(profileIds, playerCount)) return { ok: false, reason: 'missing_profile' };
    if (selection?.hasDuplicateActiveProfiles?.(profileIds, playerCount)) return { ok: false, reason: 'duplicate_profile' };
    selection?.save?.();
    return { ok: true, profileIds };
}

export function validateLocalArcadeProfileStart(settings, selection, runtimeAccess, { playerCount = null } = {}) {
    selection?.refreshForSoloStart?.(playerCount);
    const validation = validateArcadePlayerProfileSelection(selection, playerCount);
    if (validation.ok) return true;
    const activePlayerCount = Number.isInteger(playerCount) ? playerCount : resolveDemolitionLocalPlayerCount(settings);
    const messages = {
        unsupported_player_count: 'Arcade unterstützt höchstens drei lokale Spielerprofile.',
        duplicate_profile: 'Jeder lokale Arcade-Spieler benötigt ein eigenes Profil.',
        missing_profile: activePlayerCount > 1
            ? 'Bitte ordne jedem lokalen Arcade-Spieler ein vorhandenes Profil zu.'
            : 'Das aktive Spielerprofil ist nicht mehr verfügbar.',
    };
    const message = messages[validation.reason] || 'Bitte wähle gültige lokale Spielerprofile.';
    runtimeAccess?.showStatusToast?.(message, 1800, 'warning');
    return false;
}

export function bindValidatedArcadeStartCapture(bind, button, shouldValidate, validate, onValid) {
    if (!button) return;
    bind(button, 'click', (event) => {
        if (!shouldValidate()) return;
        if (!validate()) {
            event.preventDefault();
            event.stopImmediatePropagation();
            return;
        }
        onValid(event);
    }, true);
}

export const setupArcadeDemolitionProfileSelection = setupArcadePlayerProfileSelection;
