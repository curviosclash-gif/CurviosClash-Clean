import { getCustomMapConversionScale } from '../../src/entities/CustomMapLoader.js';
import { fromArenaMapDefinition, parseMapJSON, toArenaMapDefinition } from '../../src/entities/MapSchema.js';

// A built-in map as backdrop: its world model, spawns and lighting become an editor map (saved
// with it, so the match lights it the same), and
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
// Editor document lists a block-only game map fills: all of it is backdrop, so it gets locked on
// load and stays out of a copy, like the world model of the other maps.
const BLOCK_BACKDROP_KEYS = Object.freeze(['hardBlocks', 'foamBlocks', 'tunnels', 'portals', 'gates', 'items']);
// Placements the match multiplies by MAP_SCALE only when the map sets scaleAuthoredAnchors
// (Arena anchors and aircraft, StaticTurretSystem, MapUnitSystem).
const ANCHOR_KEYS = Object.freeze(['playerSpawn', 'botSpawns', 'items', 'aircraft', 'staticTurrets', 'mapUnits']);

function finiteOr(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function hasWorldModel(preset) {
    return Array.isArray(preset?.glbModels) && preset.glbModels.length > 0
        && Array.isArray(preset?.size) && preset.size.length === 3;
}

function hasBlockLayout(preset) {
    return Array.isArray(preset?.size) && preset.size.length === 3
        && preset.size.every((value) => Number.isFinite(Number(value)))
        && Array.isArray(preset?.obstacles) && preset.obstacles.length > 0;
}

/** Built-in maps with a world model or block layout, sorted by name. */
export function listBackdropPresets(catalog) {
    return Object.entries(catalog || {})
        .filter(([, preset]) => hasWorldModel(preset) || hasBlockLayout(preset))
        .map(([key, preset]) => ({ key, name: String(preset.name || key) }))
        .sort((left, right) => left.name.localeCompare(right.name, 'de'));
}

/**
 * An editor map always scales its anchors, so the match multiplies its fog height by MAP_SCALE
 * and divides the falloff by it. A preset without scaleAuthoredAnchors states both in world
 * units; converted here they end up at the same world height. Fog distances are world units
 * either way and stay.
 */
function adaptLightingToScaledAnchors(lighting, preset, mapScale) {
    if (!lighting || typeof lighting !== 'object' || preset?.scaleAuthoredAnchors === true) return lighting;
    const fog = lighting.fog;
    if (!fog || typeof fog !== 'object') return lighting;
    const scale = Math.max(0.001, finiteOr(mapScale, 3));
    return {
        ...lighting,
        fog: {
            ...fog,
            ...(fog.height !== undefined ? { height: finiteOr(fog.height, 0) / scale } : {}),
            ...(fog.heightFalloff !== undefined ? { heightFalloff: finiteOr(fog.heightFalloff, 0) * scale } : {}),
        },
    };
}

/**
 * View distance and travelling fog layer. The far plane is world units either way; the layer's
 * heights follow the anchors like the static fog height, so a preset without
 * scaleAuthoredAnchors gets them converted the same way.
 */
function presetViewFields(preset, mapScale) {
    const fields = {};
    const cameraFar = finiteOr(preset?.cameraFar, 0);
    if (cameraFar > 0) fields.cameraFar = cameraFar;
    const stages = preset?.fogLayer?.stages;
    if (Array.isArray(stages)) {
        const scale = preset.scaleAuthoredAnchors === true ? 1 : Math.max(0.001, finiteOr(mapScale, 3));
        fields.fogLayer = {
            stages: stages.map((stage) => ({
                ...stage,
                ...(stage?.ceiling !== undefined ? { ceiling: finiteOr(stage.ceiling, 0) / scale } : {}),
                ...(stage?.floor !== undefined ? { floor: finiteOr(stage.floor, 0) / scale } : {}),
                ...(stage?.ceilingFalloff !== undefined ? { ceilingFalloff: finiteOr(stage.ceilingFalloff, 0) * scale } : {}),
                ...(stage?.floorFalloff !== undefined ? { floorFalloff: finiteOr(stage.floorFalloff, 0) * scale } : {}),
            })),
        };
    }
    return fields;
}

/**
 * Editor map document of a built-in map. Spawns follow the preset's own convention: map units
 * with scaleAuthoredAnchors, match world units without. The document names the preset
 * (editorBackdrop), so a reopened map still copies with that preset's anchor rule.
 */
export function convertPresetToEditorDocument(key, preset, { mapScale = 3 } = {}) {
    if (!Array.isArray(preset?.size) || preset.size.length !== 3) {
        throw new Error('Preset needs a size of three numbers.');
    }
    if ((!Array.isArray(preset?.glbModels) || preset.glbModels.length === 0)
        && Array.isArray(preset?.obstacles) && preset.obstacles.length > 0) {
        const document = fromArenaMapDefinition(preset, { mapScale }).document;
        for (const listKey of BLOCK_BACKDROP_KEYS) {
            document[listKey] = (document[listKey] || []).map((entry, index) => ({
                ...entry,
                id: `${BACKDROP_ID_PREFIX}${entry.id || `${listKey}_${index + 1}`}`,
            }));
        }
        return { document: { ...document, ...presetViewFields(preset, mapScale), editorBackdrop: key } };
    }
    const units = PRESET_EDITOR_UNITS_PER_MAP_UNIT;
    const anchorUnits = preset?.scaleAuthoredAnchors === true ? units : units / Math.max(0.001, finiteOr(mapScale, 3));
    const toAnchor = (entry, id) => (entry ? {
        id,
        x: finiteOr(entry.x, 0) * anchorUnits,
        y: finiteOr(entry.y, 0) * anchorUnits,
        z: finiteOr(entry.z, 0) * anchorUnits,
    } : undefined);
    const [width, height, depth] = preset.size.map((value) => finiteOr(value, 1) * units);
    const glbModels = (Array.isArray(preset.glbModels) ? preset.glbModels : []).map((model, index) => {
        const targetSize = finiteOr(model.targetSize, 0);
        return {
            id: `${model.id || key}#${BACKDROP_ID_PREFIX}${index + 1}`,
            url: model.url,
            position: (Array.isArray(model.position) ? model.position : [0, 0, 0]).map((value) => finiteOr(value, 0) * units),
            rotation: Array.isArray(model.rotation) ? [...model.rotation] : [0, 0, 0],
            ...(targetSize > 0 ? { targetSize: targetSize * units } : { scale: finiteOr(model.scale, 1) * units }),
        };
    });
    const lighting = adaptLightingToScaledAnchors(preset.lighting, preset, mapScale);
    return {
        document: {
            editorBackdrop: key,
            arenaSize: { width, height, depth },
            glbModels,
            ...(lighting ? { lighting } : {}),
            ...presetViewFields(preset, mapScale),
            ...(preset.glbColliderMode ? { glbColliderMode: preset.glbColliderMode } : {}),
            ...(preset.playerSpawn ? { playerSpawn: toAnchor(preset.playerSpawn, 'spawn_player') } : {}),
            botSpawns: (preset.botSpawns || []).map((spawn, index) => toAnchor(spawn, `spawn_bot_${index + 1}`)),
        },
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
    const editorDocument = JSON.parse(mapManager.generateJSONExport(arenaSize));
    if (!includeBackdrop) {
        for (const listKey of BLOCK_BACKDROP_KEYS) {
            if (!Array.isArray(editorDocument[listKey])) continue;
            editorDocument[listKey] = editorDocument[listKey].filter((entry) => !String(entry?.id || '').startsWith(BACKDROP_ID_PREFIX));
        }
    }
    const parsed = parseMapJSON(JSON.stringify(editorDocument));
    const conversion = getCustomMapConversionScale(parsed.map).scale;
    const runtime = toArenaMapDefinition(parsed.map, { mapScale: conversion }).map;
    // A preset without scaleAuthoredAnchors states anchors in world units: the same conversion
    // with MAP_SCALE folded in scales every spatial field the match would scale.
    const anchorScale = preset?.scaleAuthoredAnchors === true ? 1 : Math.max(0.001, finiteOr(mapScale, 3));
    const anchors = anchorScale === 1
        ? runtime
        : toArenaMapDefinition(parsed.map, { mapScale: conversion / anchorScale }).map;

    const result = {};
    if (preset?.scaleAuthoredAnchors === true) result.scaleAuthoredAnchors = true;
    if (anchors.playerSpawn && parsed.map.playerSpawn) result.playerSpawn = anchors.playerSpawn;
    if (anchors.botSpawns?.length) result.botSpawns = anchors.botSpawns;
    for (const key of PLACEMENT_KEYS) {
        const source = ANCHOR_KEYS.includes(key) ? anchors : runtime;
        let entries = Array.isArray(source[key]) ? source[key] : [];
        if (key === 'glbModels') {
            entries = entries
                .filter((model) => includeBackdrop || !String(model.id).includes(`#${BACKDROP_ID_PREFIX}`))
                .map(({ targetSize, ...model }) => (targetSize > 0 ? { ...model, targetSize } : model));
        }
        if (entries.length > 0) result[key] = entries;
    }
    if (runtime.parcours?.checkpoints?.length) result.parcours = runtime.parcours;
    return result;
}
