import { CUSTOM_MAP_KEY, parseMapJSON, toArenaMapDefinition } from '../../src/entities/MapSchema.js';
import { getCustomMapConversionScale } from '../../src/entities/CustomMapLoader.js';
import { getRuntimeMapScale } from '../../src/shared/contracts/RuntimeMapCatalogContract.js';
import { readEditorMapPresentationMetadata } from './EditorMapPresentationMetadata.js';

export function createEditorBuildMapSnapshot(jsonText, { omitEditorId = null } = {}) {
    const parsed = parseMapJSON(jsonText);
    // A moving object is displayed only by the preview. The authored document remains untouched.
    if (omitEditorId) {
        const keep = (entry) => entry?.id !== omitEditorId && !String(entry?.id || '').endsWith(`#${omitEditorId}`);
        for (const [key, value] of Object.entries(parsed.map)) {
            if (Array.isArray(value)) parsed.map[key] = value.filter(keep);
        }
        if (parsed.map.parcours?.checkpoints) {
            parsed.map.parcours = { ...parsed.map.parcours, checkpoints: parsed.map.parcours.checkpoints.filter(keep) };
        }
    }
    const conversion = getCustomMapConversionScale(parsed.map);
    const converted = toArenaMapDefinition(parsed.map, { mapScale: conversion.scale, name: 'Editor-Bauflug' });
    // Transient identity ports survive rescued or skipped runtime portal placement.
    converted.map.portals.forEach((pair, index) => {
        pair.sourceIdA = converted.mapDocument.portals[index * 2]?.id;
        pair.sourceIdB = converted.mapDocument.portals[index * 2 + 1]?.id;
    });
    Object.assign(converted.map, readEditorMapPresentationMetadata(JSON.parse(jsonText)));
    return {
        mapDocument: converted.mapDocument,
        unitsPerWorldUnit: conversion.scale / getRuntimeMapScale(1),
        mapResolution: { isCustom: true, effectiveMapKey: CUSTOM_MAP_KEY,
            mapDefinition: converted.map, mapDocument: converted.mapDocument,
            warnings: [...parsed.warnings, ...converted.warnings], reason: 'editor_session' },
    };
}
