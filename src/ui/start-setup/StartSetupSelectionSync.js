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
import { isMapOfferedForModePath } from './StartSetupMapOffer.js';

const MAP_FILTER_OPTIONS = Object.freeze([
    ['arena', 'Sammlung: Arenen'],
    ['themed', 'Sammlung: Themenwelten'],
    ['adventure', 'Sammlung: Abenteuer'],
    ['parcours-collection', 'Sammlung: Parcours'],
    ['expert', 'Sammlung: Expertenkarten'],
    ['showcase', 'Sammlung: Showcase & Tests'],
    ['custom', 'Sammlung: Eigene Karten'],
    ['small', 'Größe: Klein'],
    ['medium', 'Größe: Mittel'],
    ['large', 'Größe: Groß'],
    ['parcours', 'Merkmal: Parcours'],
    ['glb', 'Merkmal: 3D-Art'],
]);

export function resolveArcadeGhostDuelModeLabel(mode) {
    if (mode === ARCADE_GHOST_DUEL_MODES.SELF_BEST_TIME_GHOST) return 'Persönliche Bestzeit';
    return mode === ARCADE_GHOST_DUEL_MODES.SELF_LONGEST_GHOST
        ? 'Selbstduell (laengste Spur)'
        : 'Aus';
}

function syncFilterControls(ui, startSetup) {
    if (ui.mapFilterSelect) {
        const allMapsOption = Array.from(ui.mapFilterSelect.options || []).find((option) => option.value === 'all');
        if (allMapsOption) allMapsOption.textContent = 'Alle Karten';
        for (const [value, label] of MAP_FILTER_OPTIONS) {
            if (Array.from(ui.mapFilterSelect.options || []).some((option) => option.value === value)) continue;
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            ui.mapFilterSelect.appendChild(option);
        }
    }
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
            ? 'Spielt im Einzelspieler die längste Spur oder deine persönliche Bestzeit ab.'
            : 'Nur im Einzelspieler aktiv.';
    }
    if (ui.arcadeGhostDuelModeHint) {
        if (ghostDuelState.duelSelectable) {
            ui.arcadeGhostDuelModeHint.textContent = `Aktiv: ${resolveArcadeGhostDuelModeLabel(ghostDuelState.configuredMode)}`;
        } else if (ghostDuelState.configuredMode !== ARCADE_GHOST_DUEL_MODES.OFF) {
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

function assignMapOptionCollection(option, entry = {}) {
    if (!option?.dataset) return;
    option.dataset.mapCollection = String(entry.collection || 'other');
    option.dataset.mapCollectionLabel = String(entry.collectionLabel || 'Weitere Karten');
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
            if (entry.hiddenFromMapPicker === true) return false;
            const matchesSearch = !startSetupFilters.mapSearch
                || entry.name.toLowerCase().includes(startSetupFilters.mapSearch)
                || entry.key.toLowerCase().includes(startSetupFilters.mapSearch);
            const matchesFilter = startSetupFilters.mapFilter === 'all'
                || entry.category === startSetupFilters.mapFilter
                || entry.collection === startSetupFilters.mapFilter
                || (startSetupFilters.mapFilter === 'parcours-collection' && entry.collection === 'parcours')
                || entry.filterTags?.includes(startSetupFilters.mapFilter);
            const mapDefinition = runtimeMaps?.[entry.key];
            const matchesModePath = isMapEligibleForModePath(mapDefinition, modePath)
                && isMapOfferedForModePath(entry, mapDefinition, modePath, startSetupFilters.mapFilter);
            const matchesSurfacePolicy = surfacePolicyPort.isMapAllowed(entry.key, modePath);
            return matchesSearch && matchesFilter && matchesModePath && matchesSurfacePolicy;
        })
        .forEach((entry) => {
            const option = document.createElement('option');
            option.value = entry.key;
            option.textContent = formatMapLabel(entry);
            assignMapOptionCollection(option, entry);
            ui.mapSelect.appendChild(option);
        });
    if (hasStoredCustomMap()) {
        const option = Array.from(ui.mapSelect.options).find((entry) => entry.value === 'custom')
            || document.createElement('option');
        option.value = 'custom';
        option.textContent = formatMapLabel({
            key: 'custom',
            name: 'Custom (lokal)',
            hasGlbModel: true,
        });
        assignMapOptionCollection(option, { collection: 'custom', collectionLabel: 'Eigene Karten' });
        if (!Array.from(ui.mapSelect.options).includes(option)) ui.mapSelect.appendChild(option);
    }
    let hasPreviousOption = Array.from(ui.mapSelect.options).some((option) => option.value === previousValue);
    const previousMapDefinition = runtimeMaps?.[previousValue];
    // Explicit tutorial/scenario starts must survive UI synchronization even when
    // their map is intentionally absent from the general picker.
    const scenario = previousMapDefinition?.singlePlayerScenario;
    const isActiveScenario = scenario?.enabled === true
        && settings?.localSettings?.sessionType === 'single'
        && settings?.gameMode === scenario.gameMode
        && modePath === scenario.modePath;
    const canRetainPreviousMap = previousValue === 'custom'
        ? hasStoredCustomMap()
        : !!previousMapDefinition
            && (previousMapDefinition.hiddenFromMapPicker !== true || isActiveScenario)
            && isMapEligibleForModePath(previousMapDefinition, modePath)
            && surfacePolicyPort.isMapAllowed(previousValue, modePath);
    if (!hasPreviousOption && canRetainPreviousMap) {
        const previousEntry = mapPreviewEntries.find((entry) => entry.key === previousValue)
            || resolveMapPreview(previousValue);
        const option = document.createElement('option');
        option.value = previousValue;
        option.textContent = formatMapLabel(previousEntry);
        option.hidden = previousMapDefinition?.hiddenFromMapPicker === true;
        if (option.dataset) option.dataset.filterRetained = 'true';
        assignMapOptionCollection(option, previousEntry);
        ui.mapSelect.appendChild(option);
        hasPreviousOption = true;
    }
    if (ui.mapSelect.options.length === 0) {
        const option = document.createElement('option');
        const fallbackOptionKey = String(fallbackMapKey || previousValue || 'standard');
        option.value = fallbackOptionKey;
        const fallbackEntry = resolveMapPreview(fallbackOptionKey);
        option.textContent = formatMapLabel(fallbackEntry);
        assignMapOptionCollection(option, fallbackEntry);
        ui.mapSelect.appendChild(option);
    }
    const resolvedMapKey = hasPreviousOption
        ? previousValue
        : ui.mapSelect.options[0].value;
    ui.mapSelect.value = resolvedMapKey;
    if (previousMapDefinition?.hiddenFromMapPicker === true && previousValue !== resolvedMapKey) {
        writeHangarMapSelection(settings, resolvedMapKey, resolvedMapKey, {
            modePath: hangarSelectionModePath,
        });
    }
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

    const resolveMapQuickLabel = (mapKey) => mapPreviewEntries.find((entry) => entry.key === mapKey)?.name
        || resolveMapPreview(mapKey).name;
    const isQuickMapOffered = (mapKey) => surfacePolicyPort.isMapAllowed(mapKey, modePath)
        && isMapOfferedForModePath(resolveMapPreview(mapKey), runtimeMaps?.[mapKey], modePath, startSetup.mapFilter);
    renderQuickList(
        ui.mapFavoritesList,
        startSetup.favoriteMaps.filter(isQuickMapOffered),
        'mapKey',
        resolveMapQuickLabel
    );
    renderQuickList(
        ui.mapRecentList,
        startSetup.recentMaps.filter(isQuickMapOffered),
        'mapKey',
        resolveMapQuickLabel
    );
    renderQuickList(ui.vehicleFavoritesList, startSetup.favoriteVehicles, 'vehicleId');
    renderQuickList(ui.vehicleRecentList, startSetup.recentVehicles, 'vehicleId');

    if (ui.mapFavoriteToggleButton) {
        const isFavorite = startSetup.favoriteMaps.includes(effectiveMapKey);
        ui.mapFavoriteToggleButton.classList.toggle('active', isFavorite);
        ui.mapFavoriteToggleButton.setAttribute('aria-pressed', String(isFavorite));
        ui.mapFavoriteToggleButton.textContent = isFavorite ? '★ Favorit' : '☆ Favorit';
        ui.mapFavoriteToggleButton.title = isFavorite
            ? 'Karte aus Favoriten entfernen'
            : 'Karte als Favorit speichern';
    }

    return { effectiveMapKey };
}
