import {
    HANGAR_SELECTION_PLAYER_SLOTS,
    readHangarMapSelection,
    readHangarVehicleSelection,
    writeHangarMapSelection,
    writeHangarVehicleSelection,
} from '../hangar/HangarSelectionWritebackContract.js';
import { resolveMapPreview, resolveVehiclePreview } from '../menu/MenuPreviewCatalog.js';
import { isMapEligibleForModePath } from '../../shared/contracts/MapModeContract.js';
import { ARCADE_GHOST_DUEL_MODES } from '../../shared/contracts/ArcadeGhostDuelContract.js';
import { renderQuickList } from './StartSetupUiOps.js';

export function resolveArcadeGhostDuelModeLabel(mode) {
    return mode === ARCADE_GHOST_DUEL_MODES.SELF_LONGEST_GHOST
        ? 'Selbstduell (laengste Spur)'
        : 'Aus';
}

function syncFilterControls(ui, startSetup) {
    if (ui.mapSearchInput && ui.mapSearchInput.value !== startSetup.mapSearch) {
        ui.mapSearchInput.value = startSetup.mapSearch;
    }
    if (ui.mapFilterSelect && ui.mapFilterSelect.value !== startSetup.mapFilter) {
        ui.mapFilterSelect.value = startSetup.mapFilter;
    }
    if (ui.vehicleSearchInput && ui.vehicleSearchInput.value !== startSetup.vehicleSearch) {
        ui.vehicleSearchInput.value = startSetup.vehicleSearch;
    }
    if (ui.vehicleFilterSelect && ui.vehicleFilterSelect.value !== startSetup.vehicleFilter) {
        ui.vehicleFilterSelect.value = startSetup.vehicleFilter;
    }
}

function syncGhostDuelControls(ui, ghostDuelState) {
    if (ui.arcadeGhostDuelModeSelect) {
        ui.arcadeGhostDuelModeSelect.value = ghostDuelState.configuredMode;
        ui.arcadeGhostDuelModeSelect.disabled = !ghostDuelState.duelSelectable;
        ui.arcadeGhostDuelModeSelect.title = ghostDuelState.duelSelectable
            ? 'Spielt im Einzelspieler deine laengste gespeicherte Spur ab.'
            : 'Nur im Einzelspieler aktiv.';
    }
    if (ui.arcadeGhostDuelModeHint) {
        if (ghostDuelState.duelSelectable) {
            ui.arcadeGhostDuelModeHint.textContent = `Aktiv: ${resolveArcadeGhostDuelModeLabel(ghostDuelState.configuredMode)}`;
        } else if (ghostDuelState.configuredMode === ARCADE_GHOST_DUEL_MODES.SELF_LONGEST_GHOST) {
            ui.arcadeGhostDuelModeHint.textContent = 'Gespeichert: Selbstduell ist aktiv, sobald Single gewaehlt ist.';
        } else {
            ui.arcadeGhostDuelModeHint.textContent = 'Nur im Einzelspieler aktiv.';
        }
    }
    if (ui.arcadeGhostTrailCollisionToggle) {
        ui.arcadeGhostTrailCollisionToggle.checked = ghostDuelState.configuredTrailCollisionEnabled;
        ui.arcadeGhostTrailCollisionToggle.disabled = !ghostDuelState.trailCollisionSelectable;
        ui.arcadeGhostTrailCollisionToggle.title = ghostDuelState.trailCollisionSelectable
            ? 'Ghost-Spur nimmt an der normalen Trail-Kollision teil.'
            : 'Aktiv, sobald Ghost-Wiedergabe im Einzelspieler laeuft.';
    }
}

function appendVehicleOption(select, vehicleId) {
    const normalizedVehicleId = String(vehicleId || '').trim();
    if (typeof HTMLSelectElement !== 'undefined' && !(select instanceof HTMLSelectElement)) return;
    if (!select || !normalizedVehicleId) return;
    if (Array.from(select.options).some((option) => option.value === normalizedVehicleId)) return;
    const option = document.createElement('option');
    option.value = normalizedVehicleId;
    option.textContent = resolveVehiclePreview(normalizedVehicleId).label;
    select.appendChild(option);
}

function resolveVehicleSelectValue(select, currentValue, vehiclePreviewEntries) {
    const normalizedCurrentValue = String(currentValue || '').trim();
    const knownVehicleIds = new Set(vehiclePreviewEntries.map((entry) => entry.id));
    if (knownVehicleIds.has(normalizedCurrentValue)) {
        appendVehicleOption(select, normalizedCurrentValue);
        return normalizedCurrentValue;
    }
    const fallbackVehicleId = vehiclePreviewEntries[0]?.id || 'ship5';
    appendVehicleOption(select, fallbackVehicleId);
    return fallbackVehicleId;
}

function syncMapSelect({
    ui,
    settings,
    runtimeMaps,
    surfaceMenuState,
    startSetupFilters,
    mapPreviewEntries,
    modePath,
    hangarSelectionModePath,
    surfacePolicyPort,
    formatMapLabel,
    resolveSurfaceFallbackMapKey,
    hasStoredCustomMap,
}) {
    if (!ui.mapSelect) {
        return String(surfaceMenuState.mapKey || settings.mapKey || 'standard');
    }
    const mapSelection = readHangarMapSelection(settings, 'standard', {
        modePath: hangarSelectionModePath,
    });
    const previousValue = String(mapSelection.value || surfaceMenuState.mapKey || settings.mapKey || ui.mapSelect.value || 'standard');
    const fallbackMapKey = resolveSurfaceFallbackMapKey(runtimeMaps, modePath, previousValue);
    ui.mapSelect.replaceChildren();
    mapPreviewEntries
        .filter((entry) => {
            const matchesSearch = !startSetupFilters.mapSearch
                || entry.name.toLowerCase().includes(startSetupFilters.mapSearch)
                || entry.key.toLowerCase().includes(startSetupFilters.mapSearch);
            const matchesFilter = startSetupFilters.mapFilter === 'all' || entry.category === startSetupFilters.mapFilter;
            const mapDefinition = runtimeMaps?.[entry.key];
            const matchesModePath = isMapEligibleForModePath(mapDefinition, modePath);
            const matchesSurfacePolicy = surfacePolicyPort.isMapAllowed(entry.key, modePath);
            return matchesSearch && matchesFilter && matchesModePath && matchesSurfacePolicy;
        })
        .forEach((entry) => {
            const option = document.createElement('option');
            option.value = entry.key;
            option.textContent = formatMapLabel(entry);
            ui.mapSelect.appendChild(option);
        });
    if (hasStoredCustomMap()) {
        const option = document.createElement('option');
        option.value = 'custom';
        option.textContent = formatMapLabel({
            key: 'custom',
            name: 'Custom (lokal)',
            hasGlbModel: true,
        });
        ui.mapSelect.appendChild(option);
    }
    if (ui.mapSelect.options.length === 0) {
        const option = document.createElement('option');
        const fallbackOptionKey = String(fallbackMapKey || previousValue || 'standard');
        option.value = fallbackOptionKey;
        option.textContent = formatMapLabel(resolveMapPreview(fallbackOptionKey));
        ui.mapSelect.appendChild(option);
    }
    const hasPreviousOption = Array.from(ui.mapSelect.options).some((option) => option.value === previousValue);
    const resolvedMapKey = hasPreviousOption
        ? previousValue
        : ui.mapSelect.options[0].value;
    ui.mapSelect.value = resolvedMapKey;
    writeHangarMapSelection(settings, resolvedMapKey, resolvedMapKey, {
        modePath: hangarSelectionModePath,
    });
    return resolvedMapKey;
}

function syncVehicleSelect({ select, settings, slot, hangarSelectionModePath, vehicleCandidates, vehiclePreviewEntries }) {
    if (!select) return;
    const vehicleSelection = readHangarVehicleSelection(
        settings,
        slot,
        'ship5',
        { modePath: hangarSelectionModePath }
    );
    const currentValue = String(settings?.vehicles?.[slot] || vehicleSelection.value || select.value || '').trim().toLowerCase();
    select.replaceChildren();
    vehicleCandidates.forEach((entry) => {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.label;
        select.appendChild(option);
    });
    const resolvedValue = resolveVehicleSelectValue(select, currentValue, vehiclePreviewEntries);
    select.value = resolvedValue;
    if (currentValue === resolvedValue) {
        writeHangarVehicleSelection(
            settings,
            slot,
            resolvedValue,
            resolvedValue,
            { modePath: hangarSelectionModePath }
        );
    }
}

export function syncStartSetupSelectionState({
    ui,
    settings,
    startSetup,
    runtimeMaps,
    surfaceMenuState,
    mapPreviewEntries,
    vehiclePreviewEntries,
    modePath,
    hangarSelectionModePath,
    surfacePolicyPort,
    formatMapLabel,
    resolveSurfaceFallbackMapKey,
    hasStoredCustomMap,
    ghostDuelState,
}) {
    const startSetupFilters = {
        mapSearch: String(startSetup.mapSearch || '').trim().toLowerCase(),
        mapFilter: String(startSetup.mapFilter || 'all').toLowerCase(),
        vehicleSearch: String(startSetup.vehicleSearch || '').trim().toLowerCase(),
        vehicleFilter: String(startSetup.vehicleFilter || 'all').toLowerCase(),
    };

    syncFilterControls(ui, startSetup);
    syncGhostDuelControls(ui, ghostDuelState);
    const effectiveMapKey = syncMapSelect({
        ui,
        settings,
        runtimeMaps,
        surfaceMenuState,
        startSetupFilters,
        mapPreviewEntries,
        modePath,
        hangarSelectionModePath,
        surfacePolicyPort,
        formatMapLabel,
        resolveSurfaceFallbackMapKey,
        hasStoredCustomMap,
    });

    const vehicleCandidates = vehiclePreviewEntries.filter((entry) => {
        const matchesSearch = !startSetupFilters.vehicleSearch
            || entry.label.toLowerCase().includes(startSetupFilters.vehicleSearch)
            || entry.id.toLowerCase().includes(startSetupFilters.vehicleSearch);
        const matchesFilter = startSetupFilters.vehicleFilter === 'all' || entry.category === startSetupFilters.vehicleFilter;
        return matchesSearch && matchesFilter;
    });
    syncVehicleSelect({
        select: ui.vehicleSelectP1,
        settings,
        slot: HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_1,
        hangarSelectionModePath,
        vehicleCandidates,
        vehiclePreviewEntries,
    });
    syncVehicleSelect({
        select: ui.vehicleSelectP2,
        settings,
        slot: HANGAR_SELECTION_PLAYER_SLOTS.PLAYER_2,
        hangarSelectionModePath,
        vehicleCandidates,
        vehiclePreviewEntries,
    });

    renderQuickList(
        ui.mapFavoritesList,
        startSetup.favoriteMaps.filter((mapKey) => surfacePolicyPort.isMapAllowed(mapKey, modePath)),
        'mapKey'
    );
    renderQuickList(
        ui.mapRecentList,
        startSetup.recentMaps.filter((mapKey) => surfacePolicyPort.isMapAllowed(mapKey, modePath)),
        'mapKey'
    );
    renderQuickList(ui.vehicleFavoritesList, startSetup.favoriteVehicles, 'vehicleId');
    renderQuickList(ui.vehicleRecentList, startSetup.recentVehicles, 'vehicleId');

    return { effectiveMapKey };
}
