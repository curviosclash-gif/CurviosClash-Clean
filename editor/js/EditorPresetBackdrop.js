import { getCustomMapConversionScale } from '../../src/entities/CustomMapLoader.js';
import { parseMapJSON, toArenaMapDefinition } from '../../src/entities/MapSchema.js';

// A built-in map as backdrop: its world model, spawns and lighting become an editor map, and
// what the author places on top is handed back in the preset's own coordinates. Pure: the
// caller passes the preset catalog in, so the editor can load it lazily.

// Built-in maps measure at least 15 map units; times 35 that is far above the 500-unit line from
// which the export converts with the legacy playtest scale of 35, so both directions agree.
export const PRESET_EDITOR_UNITS_PER_MAP_UNIT = 35;
export const BACKDROP_ID_PREFIX = 'backdrop_';

// Placement lists of a map definition that an author can extend; everything else is metadata.
const PLACEMENT_KEYS = Object.freeze([
    'obstacles', 'staticTurrets', 'portals', 'gates', 'items', 'aircraft', 'glbModels', 'mapUnits',
]);
// Positions the match multiplies by MAP_SCALE only when the map sets scaleAuthoredAnchors.
const ANCHOR_KEYS = Object.freeze(['playerSpawn', 'botSpawns', 'items']);

function finiteOr(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function hasWorldModel(preset) {
    return Array.isArray(preset?.glbModels) && preset.glbModels.length > 0
        && Array.isArray(preset?.size) && preset.size.length === 3;
}

/** Built-in maps with a world model, sorted by name. */
export function listBackdropPresets(catalog) {
    return Object.entries(catalog || {})
        .filter(([, preset]) => hasWorldModel(preset))
        .map(([key, preset]) => ({ key, name: String(preset.name || key) }))
        .sort((left, right) => left.name.localeCompare(right.name, 'de'));
}

/**
 * Editor map document of a built-in map. Spawns follow the preset's own convention: map units
 * with scaleAuthoredAnchors, match world units without.
 */
export function convertPresetToEditorDocument(key, preset, { mapScale = 3 } = {}) {
    const units = PRESET_EDITOR_UNITS_PER_MAP_UNIT;
    const anchorUnits = preset?.scaleAuthoredAnchors === true ? units : units / Math.max(0.001, finiteOr(mapScale, 3));
    const toAnchor = (entry, id) => (entry ? {
        id,
        x: finiteOr(entry.x, 0) * anchorUnits,
        y: finiteOr(entry.y, 0) * anchorUnits,
        z: finiteOr(entry.z, 0) * anchorUnits,
    } : undefined);
    const [width, height, depth] = preset.size.map((value) => finiteOr(value, 1) * units);
    const glbModels = preset.glbModels.map((model, index) => {
        const targetSize = finiteOr(model.targetSize, 0);
        return {
            id: `${model.id || key}#${BACKDROP_ID_PREFIX}${index + 1}`,
            url: model.url,
            position: (Array.isArray(model.position) ? model.position : [0, 0, 0]).map((value) => finiteOr(value, 0) * units),
            rotation: Array.isArray(model.rotation) ? [...model.rotation] : [0, 0, 0],
            ...(targetSize > 0 ? { targetSize: targetSize * units } : { scale: finiteOr(model.scale, 1) * units }),
        };
    });
    return {
        document: {
            arenaSize: { width, height, depth },
            glbModels,
            ...(preset.glbColliderMode ? { glbColliderMode: preset.glbColliderMode } : {}),
            ...(preset.playerSpawn ? { playerSpawn: toAnchor(preset.playerSpawn, 'spawn_player') } : {}),
            botSpawns: (preset.botSpawns || []).map((spawn, index) => toAnchor(spawn, `spawn_bot_${index + 1}`)),
        },
        lighting: preset.lighting,
    };
}

export function isBackdropObject(object) {
    return String(object?.userData?.id || '').startsWith(BACKDROP_ID_PREFIX);
}

/**
 * The editor map as the preset file would write it: map units, anchors in the preset's own
 * convention, backdrop models left out unless asked for.
 */
export function exportPlacementsInPresetFormat(mapManager, arenaSize, { preset = null, mapScale = 3, includeBackdrop = false } = {}) {
    const parsed = parseMapJSON(mapManager.generateJSONExport(arenaSize));
    const conversion = getCustomMapConversionScale(parsed.map).scale;
    const runtime = toArenaMapDefinition(parsed.map, { mapScale: conversion }).map;
    const anchorScale = preset?.scaleAuthoredAnchors === true ? 1 : Math.max(0.001, finiteOr(mapScale, 3));
    const toPresetAnchor = (entry) => ({ ...entry, x: entry.x * anchorScale, y: entry.y * anchorScale, z: entry.z * anchorScale });

    const result = {};
    if (preset?.scaleAuthoredAnchors === true) result.scaleAuthoredAnchors = true;
    if (runtime.playerSpawn && parsed.map.playerSpawn) result.playerSpawn = toPresetAnchor(runtime.playerSpawn);
    if (runtime.botSpawns?.length) result.botSpawns = runtime.botSpawns.map(toPresetAnchor);
    for (const key of PLACEMENT_KEYS) {
        let entries = Array.isArray(runtime[key]) ? runtime[key] : [];
        if (key === 'glbModels') {
            entries = entries
                .filter((model) => includeBackdrop || !String(model.id).includes(`#${BACKDROP_ID_PREFIX}`))
                .map(({ targetSize, ...model }) => (targetSize > 0 ? { ...model, targetSize } : model));
        }
        if (ANCHOR_KEYS.includes(key)) entries = entries.map(toPresetAnchor);
        if (entries.length > 0) result[key] = entries;
    }
    if (runtime.parcours?.checkpoints?.length) result.parcours = runtime.parcours;
    return result;
}
