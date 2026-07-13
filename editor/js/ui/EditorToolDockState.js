import {
    findEditorBuildEntryById,
    findEditorBuildEntryByToolAndSubtype,
    getEditorBuildDefaultEntry,
    getEditorBuildEntriesForCategory
} from './EditorBuildCatalog.js';

const TOOL_DOCK_STORAGE_KEY = 'cuviosclash.editor.tool-dock.v1';
const MAX_RECENT_ENTRIES = 6;
const MAX_FAVORITES = 10;

function readStoredState(storage) {
    if (!storage?.getItem) return null;
    try {
        const rawValue = storage.getItem(TOOL_DOCK_STORAGE_KEY);
        if (!rawValue) return null;
        return JSON.parse(rawValue);
    } catch {
        return null;
    }
}

function writeStoredState(storage, state) {
    if (!storage?.setItem) return;
    try {
        storage.setItem(TOOL_DOCK_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Ignore persistence failures in private browsing or blocked storage environments.
    }
}

function normalizeEntryId(entryId, fallbackCategoryId = 'build') {
    const entry = findEditorBuildEntryById(entryId) || getEditorBuildDefaultEntry(fallbackCategoryId);
    return entry?.id || null;
}

function normalizeEntryIdList(entryIds, limit = MAX_RECENT_ENTRIES) {
    if (!Array.isArray(entryIds)) return [];

    const normalized = [];
    for (const rawEntryId of entryIds) {
        const entry = findEditorBuildEntryById(rawEntryId);
        if (!entry || normalized.includes(entry.id)) continue;
        normalized.push(entry.id);
        if (normalized.length >= limit) break;
    }
    return normalized;
}

function normalizeLastEntryMap(lastEntryByCategory = {}) {
    const normalized = {};
    if (!lastEntryByCategory || typeof lastEntryByCategory !== 'object') {
        return normalized;
    }

    for (const [categoryId, rawEntryId] of Object.entries(lastEntryByCategory)) {
        const entry = findEditorBuildEntryById(rawEntryId) || getEditorBuildDefaultEntry(categoryId);
        if (entry && entry.categoryId === categoryId) {
            normalized[categoryId] = entry.id;
        }
    }

    return normalized;
}

function normalizeState(rawState = {}) {
    const fallbackEntry = getEditorBuildDefaultEntry('build');
    const selectedEntryId = normalizeEntryId(rawState?.selectedEntryId, 'build') || fallbackEntry?.id || null;
    const selectedEntry = findEditorBuildEntryById(selectedEntryId) || fallbackEntry;
    const currentCategoryId = String(rawState?.currentCategoryId || selectedEntry?.categoryId || 'build');
    const categoryEntry = getEditorBuildDefaultEntry(currentCategoryId);

    return {
        mode: rawState?.mode === 'place' ? 'place' : 'select',
        currentCategoryId,
        selectedEntryId: selectedEntry?.id || categoryEntry?.id || null,
        favoriteEntryIds: normalizeEntryIdList(rawState?.favoriteEntryIds, MAX_FAVORITES),
        recentEntryIds: normalizeEntryIdList(rawState?.recentEntryIds, MAX_RECENT_ENTRIES),
        lastEntryByCategory: normalizeLastEntryMap(rawState?.lastEntryByCategory)
    };
}

function pushRecentEntry(recentEntryIds, entryId) {
    if (!entryId) return recentEntryIds;

    const nextEntries = recentEntryIds.filter((candidate) => candidate !== entryId);
    nextEntries.unshift(entryId);
    return nextEntries.slice(0, MAX_RECENT_ENTRIES);
}

function resolveEntryForCategory(state, categoryId) {
    const rememberedId = state.lastEntryByCategory?.[categoryId];
    const rememberedEntry = findEditorBuildEntryById(rememberedId);
    if (rememberedEntry && rememberedEntry.categoryId === categoryId) {
        return rememberedEntry;
    }

    return getEditorBuildDefaultEntry(categoryId);
}

export function createEditorToolDockState(options = {}) {
    const storage = options.storage || globalThis?.localStorage || null;
    let state = normalizeState(readStoredState(storage));

    const getSelectedEntry = () => findEditorBuildEntryById(state.selectedEntryId) || getEditorBuildDefaultEntry(state.currentCategoryId);

    const commit = () => {
        const selectedEntry = getSelectedEntry();
        if (selectedEntry) {
            state.selectedEntryId = selectedEntry.id;
            state.currentCategoryId = selectedEntry.categoryId;
            state.lastEntryByCategory[selectedEntry.categoryId] = selectedEntry.id;
        }
        writeStoredState(storage, state);
        return api.getSnapshot();
    };

    const api = {
        getSnapshot() {
            const selectedEntry = getSelectedEntry();
            return {
                ...state,
                selectedEntry,
                recentEntries: state.recentEntryIds.map((entryId) => findEditorBuildEntryById(entryId)).filter(Boolean),
                favoriteEntries: state.favoriteEntryIds.map((entryId) => findEditorBuildEntryById(entryId)).filter(Boolean)
            };
        },

        getActiveEntry() {
            return getSelectedEntry();
        },

        getCurrentCategoryId() {
            return state.currentCategoryId;
        },

        getMode() {
            return state.mode;
        },

        getEntriesForCurrentCategory() {
            return getEditorBuildEntriesForCategory(state.currentCategoryId);
        },

        getEntryUsageState(entryId) {
            const normalizedEntryId = String(entryId || '').trim();
            return {
                isFavorite: state.favoriteEntryIds.includes(normalizedEntryId),
                isRecent: state.recentEntryIds.includes(normalizedEntryId)
            };
        },

        getRecentEntries() {
            return state.recentEntryIds.map((entryId) => findEditorBuildEntryById(entryId)).filter(Boolean);
        },

        getFavoriteEntries() {
            return state.favoriteEntryIds.map((entryId) => findEditorBuildEntryById(entryId)).filter(Boolean);
        },

        getPlacementSubtypeForTool(tool) {
            const entry = getSelectedEntry();
            if (!entry || entry.tool !== tool) return null;
            return entry.subType || null;
        },

        activateSelectionMode() {
            state = {
                ...state,
                mode: 'select'
            };
            return commit();
        },

        activateEntry(entryId, options = {}) {
            const entry = findEditorBuildEntryById(entryId);
            if (!entry) return api.getSnapshot();

            state = {
                ...state,
                mode: 'place',
                currentCategoryId: entry.categoryId,
                selectedEntryId: entry.id,
                recentEntryIds: options.recordRecent === false
                    ? state.recentEntryIds
                    : pushRecentEntry(state.recentEntryIds, entry.id),
                lastEntryByCategory: {
                    ...state.lastEntryByCategory,
                    [entry.categoryId]: entry.id
                }
            };

            return commit();
        },

        activateCategory(categoryId, options = {}) {
            const nextEntry = resolveEntryForCategory(state, categoryId);
            if (!nextEntry) {
                return api.getSnapshot();
            }

            return api.activateEntry(nextEntry.id, options);
        },

        toggleFavorite(entryId = state.selectedEntryId) {
            const entry = findEditorBuildEntryById(entryId);
            if (!entry) return api.getSnapshot();

            const exists = state.favoriteEntryIds.includes(entry.id);
            const nextFavorites = exists
                ? state.favoriteEntryIds.filter((candidate) => candidate !== entry.id)
                : [entry.id, ...state.favoriteEntryIds.filter((candidate) => candidate !== entry.id)].slice(0, MAX_FAVORITES);

            state = {
                ...state,
                favoriteEntryIds: nextFavorites
            };

            return commit();
        },

        syncFromLegacyTool(tool, subType = null) {
            const entry = findEditorBuildEntryByToolAndSubtype(tool, subType);
            if (!entry) return api.getSnapshot();

            state = {
                ...state,
                currentCategoryId: entry.categoryId,
                selectedEntryId: entry.id,
                lastEntryByCategory: {
                    ...state.lastEntryByCategory,
                    [entry.categoryId]: entry.id
                }
            };

            return commit();
        }
    };

    return api;
}
