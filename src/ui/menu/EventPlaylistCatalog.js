import { findFixedMenuPresetById } from './MenuPresetCatalog.js';
import { MENU_DEFAULT_EVENT_PLAYLIST_ID as DEFAULT_EVENT_PLAYLIST_ID } from './MenuDefaultsEditorConfig.js';

function freezePlaylist(playlist) {
    return Object.freeze({
        ...playlist,
        entries: Object.freeze(
            (Array.isArray(playlist.entries) ? playlist.entries : []).map((entry) => Object.freeze({ ...entry }))
        ),
    });
}

function createPlaylist({ id, name, description, entryPresetIds }) {
    const entries = Array.isArray(entryPresetIds)
        ? entryPresetIds
            .map((presetId, index) => {
                const normalizedPresetId = typeof presetId === 'string' ? presetId.trim() : '';
                if (!normalizedPresetId) return null;
                return {
                    id: `${id}:${index + 1}`,
                    presetId: normalizedPresetId,
                };
            })
            .filter(Boolean)
        : [];

    return freezePlaylist({
        id,
        name,
        description,
        entries,
    });
}

const EVENT_PLAYLIST_CATALOG = Object.freeze([
    createPlaylist({
        id: DEFAULT_EVENT_PLAYLIST_ID,
        name: 'Fun Rotation',
        description: 'Rotiert ueber die vorhandenen Fun- und Fixed-Presets.',
        entryPresetIds: ['arcade', 'chaos', 'competitive'],
    }),
]);

function clonePlaylist(playlist) {
    if (!playlist) return null;
    return {
        ...playlist,
        entries: Array.isArray(playlist.entries)
            ? playlist.entries.map((entry) => ({ ...entry }))
            : [],
    };
}

function normalizePlaylistId(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function normalizeNextIndex(value, fallback = 0) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return fallback;
    return Math.max(0, Math.floor(numericValue));
}

export function resolveEventPlaylistById(playlistId) {
    const normalizedPlaylistId = normalizePlaylistId(playlistId);
    const playlist = EVENT_PLAYLIST_CATALOG.find((entry) => entry.id === normalizedPlaylistId)
        || EVENT_PLAYLIST_CATALOG.find((entry) => entry.id === DEFAULT_EVENT_PLAYLIST_ID)
        || null;
    return clonePlaylist(playlist);
}

export function normalizeEventPlaylistState(eventPlaylistState = null) {
    const source = eventPlaylistState && typeof eventPlaylistState === 'object' ? eventPlaylistState : {};
    const playlist = resolveEventPlaylistById(source.activePlaylistId || DEFAULT_EVENT_PLAYLIST_ID);
    return {
        activePlaylistId: playlist?.id || DEFAULT_EVENT_PLAYLIST_ID,
        nextIndex: normalizeNextIndex(source.nextIndex, 0),
        lastPresetId: normalizePlaylistId(source.lastPresetId),
    };
}

export function getNextEventPlaylistEntry(eventPlaylistState = null) {
    const normalizedState = normalizeEventPlaylistState(eventPlaylistState);
    const playlist = resolveEventPlaylistById(normalizedState.activePlaylistId);
    const entries = Array.isArray(playlist?.entries) ? playlist.entries : [];
    if (entries.length === 0) {
        return {
            playlist,
            entry: null,
            preset: null,
            currentIndex: 0,
            displayIndex: 0,
            totalSteps: 0,
            nextIndex: 0,
            persistedState: normalizeEventPlaylistState({
                activePlaylistId: playlist?.id || DEFAULT_EVENT_PLAYLIST_ID,
                nextIndex: 0,
                lastPresetId: '',
            }),
        };
    }

    const currentIndex = normalizedState.nextIndex % entries.length;
    const entry = { ...entries[currentIndex] };
    const preset = findFixedMenuPresetById(entry.presetId);
    const nextIndex = (currentIndex + 1) % entries.length;

    return {
        playlist,
        entry,
        preset,
        currentIndex,
        displayIndex: currentIndex + 1,
        totalSteps: entries.length,
        nextIndex,
        persistedState: normalizeEventPlaylistState({
            activePlaylistId: playlist?.id || DEFAULT_EVENT_PLAYLIST_ID,
            nextIndex,
            lastPresetId: entry.presetId,
        }),
    };
}
