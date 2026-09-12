export const EXCLUSION_ZONE_FACE_ORDER = Object.freeze([
    'minX',
    'maxX',
    'minZ',
    'maxZ',
    'maxY',
]);

const EXCLUSION_ZONE_FACE_SET = new Set(EXCLUSION_ZONE_FACE_ORDER);

export function normalizeExclusionZoneOpenFaces(value) {
    if (!Array.isArray(value)) return Object.freeze([]);
    const selected = new Set();
    for (const face of value) {
        if (typeof face !== 'string') continue;
        const normalized = face.trim();
        if (EXCLUSION_ZONE_FACE_SET.has(normalized)) selected.add(normalized);
    }
    return Object.freeze(EXCLUSION_ZONE_FACE_ORDER.filter((face) => selected.has(face)));
}

export function resolveMapExclusionZone(mapDefinition) {
    return Object.freeze({
        openFaces: normalizeExclusionZoneOpenFaces(mapDefinition?.exclusionZone?.openFaces),
    });
}

export function isExclusionZoneFaceOpen(openFaces, face) {
    return Array.isArray(openFaces) && openFaces.includes(face);
}
