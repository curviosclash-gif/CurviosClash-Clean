import {
    ensureStartSetupLocalState,
    pushRecentEntry,
    toggleFavoriteEntry,
} from '../../start-setup/StartSetupUiOps.js';

const CATEGORY_IDS = new Set(['all', 'jaeger', 'kreuzer', 'spezial', 'custom']);
const HITBOX_FILTER_IDS = new Set(['all', 'kompakt', 'standard', 'schwer']);
const LEVEL_FILTER_IDS = new Set(['all', 'rookie', 'mid', 'elite']);

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function normalizeCategory(value) {
    const normalized = normalizeString(value, 'all').toLowerCase();
    return CATEGORY_IDS.has(normalized) ? normalized : 'all';
}

function normalizeHitboxFilter(value) {
    const normalized = normalizeString(value, 'all').toLowerCase();
    return HITBOX_FILTER_IDS.has(normalized) ? normalized : 'all';
}

function normalizeLevelFilter(value) {
    const normalized = normalizeString(value, 'all').toLowerCase();
    return LEVEL_FILTER_IDS.has(normalized) ? normalized : 'all';
}

function normalizeVehicleId(value, fallback = '') {
    return normalizeString(value, fallback).toLowerCase();
}

function resolveLevelBand(levelValue) {
    const level = Number(levelValue);
    if (!Number.isFinite(level) || level <= 0) return 'rookie';
    if (level >= 20) return 'elite';
    if (level >= 10) return 'mid';
    return 'rookie';
}

function resolveProfileLevel(profileMap, vehicleId) {
    const rawProfile = profileMap && typeof profileMap === 'object'
        ? profileMap[vehicleId]
        : null;
    return Number(rawProfile?.level) || 1;
}

function indexByVehicleId(catalogEntries) {
    const byId = new Map();
    for (let index = 0; index < catalogEntries.length; index += 1) {
        byId.set(String(catalogEntries[index].vehicleId), catalogEntries[index]);
    }
    return byId;
}

function resolveValidVehicleId(rawVehicleId, catalogById, fallbackVehicleId) {
    const normalized = normalizeVehicleId(rawVehicleId);
    if (catalogById.has(normalized)) return normalized;
    return normalizeVehicleId(fallbackVehicleId, normalized || 'ship5');
}

function filterBySearch(entry, query) {
    if (!query) return true;
    const queryLower = query.toLowerCase();
    if (String(entry.label || '').toLowerCase().includes(queryLower)) return true;
    if (String(entry.vehicleId || '').toLowerCase().includes(queryLower)) return true;
    const keywords = Array.isArray(entry.keywords) ? entry.keywords : [];
    for (let i = 0; i < keywords.length; i += 1) {
        if (String(keywords[i]).toLowerCase().includes(queryLower)) return true;
    }
    return false;
}

export function createVehicleManagerSelectionState({ settings, catalogEntries }) {
    const sourceSettings = settings && typeof settings === 'object' ? settings : {};
    const entries = Array.isArray(catalogEntries) ? catalogEntries.slice() : [];
    entries.sort((left, right) => {
        const leftOrder = Number(left?.sortOrder) || 0;
        const rightOrder = Number(right?.sortOrder) || 0;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return String(left?.label || '').localeCompare(String(right?.label || ''), 'de');
    });

    const fallbackVehicleId = normalizeVehicleId(entries[0]?.vehicleId, 'ship5');
    const catalogById = indexByVehicleId(entries);
    const startSetup = ensureStartSetupLocalState(sourceSettings);

    let selectedVehicleId = resolveValidVehicleId(
        sourceSettings?.vehicles?.PLAYER_1,
        catalogById,
        fallbackVehicleId
    );
    let compareVehicleId = resolveValidVehicleId(
        startSetup.vehicleCompareId,
        catalogById,
        selectedVehicleId
    );
    let category = normalizeCategory(startSetup.vehicleCategoryTab);
    let searchTerm = normalizeString(startSetup.vehicleSearch);
    let hitboxFilter = normalizeHitboxFilter(startSetup.vehicleFilterHitbox);
    let levelFilter = normalizeLevelFilter(startSetup.vehicleFilterLevelBand);
    let favoritesOnly = startSetup.vehicleFavoritesOnly === true;

    function persistLocalSelectionState() {
        startSetup.vehicleCategoryTab = category;
        startSetup.vehicleSearch = searchTerm;
        startSetup.vehicleFilterHitbox = hitboxFilter;
        startSetup.vehicleFilterLevelBand = levelFilter;
        startSetup.vehicleFavoritesOnly = favoritesOnly;
        startSetup.vehicleCompareId = compareVehicleId;
    }

    function getFavorites() {
        const list = Array.isArray(startSetup.favoriteVehicles) ? startSetup.favoriteVehicles : [];
        return list.map((entry) => normalizeVehicleId(entry)).filter(Boolean);
    }

    function getRecents() {
        const list = Array.isArray(startSetup.recentVehicles) ? startSetup.recentVehicles : [];
        return list.map((entry) => normalizeVehicleId(entry)).filter(Boolean);
    }

    function isFavorite(vehicleId) {
        const normalizedVehicleId = normalizeVehicleId(vehicleId);
        return getFavorites().includes(normalizedVehicleId);
    }

    function setSelectedVehicleId(vehicleId, options = {}) {
        const normalizedVehicleId = resolveValidVehicleId(vehicleId, catalogById, selectedVehicleId);
        selectedVehicleId = normalizedVehicleId;
        if (options.skipRecent !== true) {
            pushRecentEntry(startSetup.recentVehicles, normalizedVehicleId, 6);
        }
        if (!catalogById.has(compareVehicleId) || compareVehicleId === selectedVehicleId) {
            const nextCompare = entries.find((entry) => entry.vehicleId !== selectedVehicleId);
            compareVehicleId = normalizeVehicleId(nextCompare?.vehicleId, selectedVehicleId);
        }
        persistLocalSelectionState();
        return selectedVehicleId;
    }

    function setCompareVehicleId(vehicleId) {
        const normalizedVehicleId = resolveValidVehicleId(vehicleId, catalogById, selectedVehicleId);
        compareVehicleId = normalizedVehicleId;
        persistLocalSelectionState();
        return compareVehicleId;
    }

    function setCategory(nextCategory) {
        category = normalizeCategory(nextCategory);
        persistLocalSelectionState();
    }

    function cycleCategory(step = 1) {
        const categoryOrder = ['all', 'jaeger', 'kreuzer', 'spezial', 'custom'];
        const currentIndex = categoryOrder.indexOf(category);
        const safeCurrentIndex = currentIndex >= 0 ? currentIndex : 0;
        const nextIndex = (safeCurrentIndex + step + categoryOrder.length) % categoryOrder.length;
        category = categoryOrder[nextIndex];
        persistLocalSelectionState();
        return category;
    }

    function setSearchTerm(nextSearchTerm) {
        searchTerm = normalizeString(nextSearchTerm);
        persistLocalSelectionState();
    }

    function setHitboxFilter(nextFilter) {
        hitboxFilter = normalizeHitboxFilter(nextFilter);
        persistLocalSelectionState();
    }

    function setLevelFilter(nextFilter) {
        levelFilter = normalizeLevelFilter(nextFilter);
        persistLocalSelectionState();
    }

    function setFavoritesOnly(value) {
        favoritesOnly = value === true;
        persistLocalSelectionState();
    }

    function toggleFavorite(vehicleId) {
        const normalizedVehicleId = normalizeVehicleId(vehicleId, selectedVehicleId);
        toggleFavoriteEntry(startSetup.favoriteVehicles, normalizedVehicleId, 8);
        persistLocalSelectionState();
        return isFavorite(normalizedVehicleId);
    }

    function getVisibleEntries(profileMap = null) {
        const favorites = new Set(getFavorites());
        return entries.filter((entry) => {
            if (!entry || !entry.vehicleId) return false;
            if (category !== 'all' && normalizeCategory(entry.kategorie) !== category) return false;
            if (hitboxFilter !== 'all' && normalizeHitboxFilter(entry.hitboxKlasse) !== hitboxFilter) return false;
            if (!filterBySearch(entry, searchTerm)) return false;
            if (favoritesOnly && !favorites.has(normalizeVehicleId(entry.vehicleId))) return false;
            if (levelFilter !== 'all') {
                const levelBand = resolveLevelBand(resolveProfileLevel(profileMap, entry.vehicleId));
                if (levelBand !== levelFilter) return false;
            }
            return true;
        });
    }

    function getNextVisibleVehicleId(step, profileMap = null) {
        const visibleEntries = getVisibleEntries(profileMap);
        if (visibleEntries.length <= 0) return selectedVehicleId;
        const currentIndex = visibleEntries.findIndex((entry) => entry.vehicleId === selectedVehicleId);
        const safeIndex = currentIndex >= 0 ? currentIndex : 0;
        const nextIndex = (safeIndex + step + visibleEntries.length) % visibleEntries.length;
        return visibleEntries[nextIndex]?.vehicleId || selectedVehicleId;
    }

    persistLocalSelectionState();

    return {
        getSelectedVehicleId: () => selectedVehicleId,
        setSelectedVehicleId,
        getCompareVehicleId: () => compareVehicleId,
        setCompareVehicleId,
        getCategory: () => category,
        setCategory,
        cycleCategory,
        getSearchTerm: () => searchTerm,
        setSearchTerm,
        getHitboxFilter: () => hitboxFilter,
        setHitboxFilter,
        getLevelFilter: () => levelFilter,
        setLevelFilter,
        isFavoritesOnly: () => favoritesOnly,
        setFavoritesOnly,
        toggleFavorite,
        isFavorite,
        getFavorites,
        getRecents,
        getVisibleEntries,
        getNextVisibleVehicleId,
    };
}

