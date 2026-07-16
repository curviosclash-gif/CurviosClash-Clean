export const VEHICLE_LAB_HANGAR_PUBLISH_VERSION = 'vehicle-lab-hangar-publish.v1';
export const VEHICLE_LAB_HANGAR_PUBLISH_STORAGE_KEY = 'curviosclash.vehicle-lab.hangar-parts.v1';

const FAMILY_SLOTS = Object.freeze({
    core: ['core'],
    nose: ['nose'],
    wing: ['wing_left', 'wing_right'],
    engine: ['engine_left', 'engine_right'],
    utility: ['utility'],
});

function slug(value, fallback = 'part') {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function vehicleKey(value) {
    return String(value || '').trim().toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'custom-vehicle';
}

function resolveFamily(part = {}) {
    const role = String(part.role || '').toLowerCase();
    if (role.startsWith('engine')) return 'engine';
    if (role.startsWith('wing')) return 'wing';
    if (role === 'nose') return 'nose';
    if (role === 'core') return 'core';
    const token = `${part.name || ''} ${part.geo || ''}`.toLowerCase();
    if (/engine|drive|thruster|jet/.test(token)) return 'engine';
    if (/wing|fin|aileron/.test(token)) return 'wing';
    if (/nose|cockpit|tip/.test(token)) return 'nose';
    if (/core|body|hull|fuselage/.test(token)) return 'core';
    return 'utility';
}

function flattenParts(parts, result = []) {
    for (const part of Array.isArray(parts) ? parts : []) {
        if (!part || typeof part !== 'object') continue;
        result.push(part);
        flattenParts(part.children, result);
    }
    return result;
}

export function createVehicleLabHangarPublication(config = {}, options = {}) {
    const vehicleId = vehicleKey(options.vehicleId || config.label);
    const publishedAtMs = Math.max(0, Number(options.publishedAtMs) || Date.now());
    const parts = flattenParts(config.parts).slice(0, 48).map((part, index) => {
        const family = resolveFamily(part);
        const id = `lab-${vehicleId}-${slug(part.name || part.geo, `part-${index + 1}`)}-${index + 1}`;
        const size = Array.isArray(part.size) ? part.size : (Array.isArray(part.scale) ? part.scale : [1, 1, 1]);
        return {
            id,
            label: String(part.name || `Lab Part ${index + 1}`).trim(),
            sourceVehicleId: vehicleId,
            family,
            tier: 'T1',
            minLevel: family === 'utility' ? 5 : 1,
            compatibleSlots: [...FAMILY_SLOTS[family]],
            symmetric: family === 'wing' || family === 'engine',
            visual: 'lab',
            appearance: {
                geometry: String(part.geo || 'box').toLowerCase(),
                size: size.slice(0, 3).map((value) => Math.max(0.1, Math.min(3, Number(value) || 1))),
                color: Number(config.primaryColor) || 0x60a5fa,
            },
            costs: { budget: 7, mass: 5, energy: 4, heat: 3 },
            stats: { speed: 0, agility: 1, maxHp: 4 },
        };
    });
    return { schemaVersion: VEHICLE_LAB_HANGAR_PUBLISH_VERSION, vehicleId, label: String(config.label || vehicleId), publishedAtMs, parts };
}

export function normalizeVehicleLabHangarPublicationRecord(source) {
    const input = source && typeof source === 'object' ? source : {};
    const publications = (Array.isArray(input.publications) ? input.publications : [])
        .filter((entry) => entry?.schemaVersion === VEHICLE_LAB_HANGAR_PUBLISH_VERSION && Array.isArray(entry.parts))
        .slice(0, 24);
    return { schemaVersion: VEHICLE_LAB_HANGAR_PUBLISH_VERSION, publications };
}

export function upsertVehicleLabHangarPublication(source, publication) {
    const record = normalizeVehicleLabHangarPublicationRecord(source);
    const publications = record.publications.filter((entry) => entry.vehicleId !== publication.vehicleId);
    publications.unshift(publication);
    return { schemaVersion: VEHICLE_LAB_HANGAR_PUBLISH_VERSION, publications: publications.slice(0, 24) };
}
