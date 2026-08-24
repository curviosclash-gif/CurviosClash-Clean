export const VEHICLE_LAB_CONFIG_LIMITS = Object.freeze({
    maxParts: 128,
    maxDepth: 8,
    maxLabelLength: 80,
    maxPartNameLength: 80,
    maxAbsPosition: 100,
    maxAbsRotation: 36000,
    maxSize: 50,
    maxScale: 20,
});

export const VEHICLE_LAB_CATALOG_VERSION = 'vehicle-lab-catalog.v1';
export const VEHICLE_LAB_CATALOG_STORAGE_KEY = 'curviosclash.vehicle-lab.catalog.v1';
export const VEHICLE_LAB_GAME_VEHICLE_IDS = Object.freeze([
    'ship5', 'aircraft', 'spaceship', 'arrow', 'manta', 'drone', 'orb',
    'ship1', 'ship2', 'ship3', 'ship4', 'ship6', 'ship7', 'ship8', 'ship9',
]);
export const VEHICLE_LAB_PART_ROLES = Object.freeze([
    'auto',
    'core',
    'nose',
    'wing_left',
    'wing_right',
    'engine_left',
    'engine_right',
    'utility',
]);

export const VEHICLE_LAB_GEOMETRIES = Object.freeze([
    'box',
    'sphere',
    'cylinder',
    'cone',
    'torus',
    'capsule',
    'pylon',
    'engine',
    'forcefield',
    'flame',
]);

const VEHICLE_LAB_MATERIALS = new Set(['primary', 'secondary', 'glass', 'glow']);
const VEHICLE_LAB_ANIMATIONS = new Set(['rotate', 'bob', 'pulse']);
const VEHICLE_LAB_AXES = new Set(['x', 'y', 'z']);
const VEHICLE_LAB_ROLE_SET = new Set(VEHICLE_LAB_PART_ROLES);
const VEHICLE_LAB_GAME_VEHICLE_ID_SET = new Set(VEHICLE_LAB_GAME_VEHICLE_IDS);
const VEHICLE_LAB_CATALOG_LIMIT = 24;

function finiteNumber(value, fallback, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.max(min, Math.min(max, numeric));
}

function normalizeVector(source, fallback, min, max) {
    const input = Array.isArray(source) ? source : fallback;
    return fallback.map((defaultValue, index) => finiteNumber(input[index], defaultValue, min, max));
}

function normalizeColor(value, fallback = 0x60a5fa) {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) return Number.parseInt(value.slice(1), 16);
    const numeric = Number(value);
    return Number.isFinite(numeric)
        ? Math.max(0, Math.min(0xffffff, Math.trunc(numeric)))
        : fallback;
}

function normalizeAnimation(source) {
    if (!source || typeof source !== 'object' || !VEHICLE_LAB_ANIMATIONS.has(source.type)) return null;
    const animation = {
        type: source.type,
        speed: finiteNumber(source.speed, 1, -20, 20),
        amount: finiteNumber(source.amount, 1, 0, 20),
    };
    if (source.type === 'rotate') {
        animation.axis = VEHICLE_LAB_AXES.has(source.axis) ? source.axis : 'y';
    }
    return animation;
}

export function normalizeVehicleLabConfig(raw, options = {}) {
    const errors = [];
    const warnings = [];
    const limits = VEHICLE_LAB_CONFIG_LIMITS;
    const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;

    if (!source) {
        return { ok: false, config: null, errors: ['Fahrzeug-Konfiguration muss ein Objekt sein.'], warnings };
    }

    const requestedBaseVehicleId = String(source.baseVehicleId || '').trim().toLowerCase();
    const baseVehicleId = VEHICLE_LAB_GAME_VEHICLE_ID_SET.has(requestedBaseVehicleId)
        ? requestedBaseVehicleId
        : '';
    const inputParts = Array.isArray(source.parts) ? source.parts : [];
    if (!Array.isArray(source.parts)) errors.push('"parts" muss ein Array sein.');
    if (requestedBaseVehicleId && !baseVehicleId) warnings.push('Unbekanntes Grundmodell wurde entfernt.');
    if (options.requireParts !== false && inputParts.length === 0 && !baseVehicleId) {
        errors.push('Das Fahrzeug benötigt mindestens ein Bauteil.');
    }

    let partCount = 0;
    const normalizePart = (part, depth, path) => {
        if (!part || typeof part !== 'object' || Array.isArray(part)) {
            warnings.push(`Ungültiges Bauteil ${path} wurde übersprungen.`);
            return null;
        }
        if (depth > limits.maxDepth) {
            warnings.push(`Verschachtelung bei ${path} wurde auf ${limits.maxDepth} Ebenen begrenzt.`);
            return null;
        }
        if (partCount >= limits.maxParts) {
            warnings.push(`Bauteillimit von ${limits.maxParts} erreicht.`);
            return null;
        }
        partCount += 1;

        const geo = VEHICLE_LAB_GEOMETRIES.includes(String(part.geo || '').toLowerCase())
            ? String(part.geo).toLowerCase()
            : 'box';
        const normalized = {
            ...part,
            name: String(part.name || `Part ${partCount}`).trim().slice(0, limits.maxPartNameLength) || `Part ${partCount}`,
            geo,
            size: normalizeVector(part.size, [1, 1, 1], 0.01, limits.maxSize),
            pos: normalizeVector(part.pos, [0, 0, 0], -limits.maxAbsPosition, limits.maxAbsPosition),
            rot: normalizeVector(part.rot, [0, 0, 0], -limits.maxAbsRotation, limits.maxAbsRotation),
            scale: normalizeVector(part.scale, [1, 1, 1], 0.01, limits.maxScale),
            material: VEHICLE_LAB_MATERIALS.has(part.material) ? part.material : 'primary',
        };

        const role = String(part.role || 'auto').trim().toLowerCase();
        if (role !== 'auto' && VEHICLE_LAB_ROLE_SET.has(role)) normalized.role = role;
        else delete normalized.role;

        if (part.color !== undefined) normalized.color = normalizeColor(part.color, 0xffffff);
        if (part.opacity !== undefined) normalized.opacity = finiteNumber(part.opacity, 1, 0, 1);
        if (part.emissive !== undefined) normalized.emissive = normalizeColor(part.emissive, 0x000000);
        normalized.emissiveIntensity = finiteNumber(part.emissiveIntensity, 0, 0, 20);

        const mirrorAxis = VEHICLE_LAB_AXES.has(part.mirrorAxis)
            ? part.mirrorAxis
            : (part.mirror === true ? 'x' : null);
        if (mirrorAxis) normalized.mirrorAxis = mirrorAxis;
        else {
            delete normalized.mirrorAxis;
            delete normalized.mirror;
        }

        const animation = normalizeAnimation(part.anim);
        if (animation) normalized.anim = animation;
        else delete normalized.anim;

        const children = Array.isArray(part.children) ? part.children : [];
        normalized.children = children
            .map((child, index) => normalizePart(child, depth + 1, `${path}.${index}`))
            .filter(Boolean);
        if (normalized.children.length === 0) delete normalized.children;
        return normalized;
    };

    const parts = inputParts
        .map((part, index) => normalizePart(part, 0, String(index)))
        .filter(Boolean);
    if (options.requireParts !== false && parts.length === 0 && !baseVehicleId && errors.length === 0) {
        errors.push('Das Fahrzeug enthält keine verwendbaren Bauteile.');
    }

    const config = {
        ...source,
        label: String(source.label || options.fallbackLabel || 'Custom Vehicle')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, limits.maxLabelLength) || 'Custom Vehicle',
        primaryColor: normalizeColor(source.primaryColor),
        parts,
    };
    if (baseVehicleId) {
        const transform = source.baseTransform && typeof source.baseTransform === 'object'
            ? source.baseTransform
            : {};
        config.baseVehicleId = baseVehicleId;
        config.baseTransform = {
            pos: normalizeVector(transform.pos, [0, 0, 0], -limits.maxAbsPosition, limits.maxAbsPosition),
            rot: normalizeVector(transform.rot, [0, 0, 0], -limits.maxAbsRotation, limits.maxAbsRotation),
            scale: normalizeVector(transform.scale, [1, 1, 1], 0.01, limits.maxScale),
        };
    } else {
        delete config.baseVehicleId;
        delete config.baseTransform;
    }

    return { ok: errors.length === 0, config, errors, warnings };
}

export function formatVehicleLabConfigIssues(result) {
    return [...(result?.errors || []), ...(result?.warnings || [])].join('\n');
}

/**
 * Zerlegt Umlaute und Akzente in ihre Grundbuchstaben ("Ümläut" wird zu
 * "Umlaut"). Grundlage jeder Namensregel im Vehicle Lab; wer stattdessen nur
 * unerlaubte Zeichen filtert, macht aus "Müll" ein "M-ll".
 * @param {string} text
 * @returns {string}
 */
export function foldVehicleLabDiacritics(text) {
    return String(text || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Bildet aus einem Fahrzeugnamen den technischen Schluessel.
 * Umlaute und Akzente werden in ihre Grundbuchstaben zerlegt ("muell" statt
 * "m-ll"), alles Uebrige wird zu Bindestrichen. Einzige Namensregel des
 * Vehicle Lab: Katalog, Dateiname und Hangar-Veroeffentlichung nutzen sie.
 * @param {string} label
 * @param {string} [fallback]
 * @returns {string}
 */
export function createVehicleLabSlug(label, fallback = 'vehicle') {
    return foldVehicleLabDiacritics(label)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || fallback;
}

function createVehicleId(label) {
    return `editor_vehicle_${createVehicleLabSlug(label)}`;
}

function normalizeVehicleId(value, fallbackLabel = '') {
    const id = String(value || '').trim().toLowerCase();
    return /^editor_vehicle_[a-z0-9-]+$/.test(id) ? id : createVehicleId(fallbackLabel);
}

export const VEHICLE_LAB_HITBOX_SCALE = 0.35;
export const VEHICLE_LAB_HITBOX_MIN_RADIUS = 0.6;
export const VEHICLE_LAB_HITBOX_MAX_RADIUS = 2.5;

function collectVehicleLabBounds(parts, offset, bounds) {
    for (const part of Array.isArray(parts) ? parts : []) {
        if (!part || typeof part !== 'object') continue;
        const rawPos = Array.isArray(part.pos) ? part.pos : [0, 0, 0];
        const size = Array.isArray(part.size) && part.size.length > 0 ? part.size : [1, 1, 1];
        const scale = Array.isArray(part.scale) && part.scale.length > 0 ? part.scale : [1, 1, 1];
        const pos = [0, 1, 2].map((axis) => (Number(rawPos[axis]) || 0) + offset[axis]);
        for (const axis of [0, 1, 2]) {
            const extent = Number(size[axis]) || Number(size[0]) || 1;
            const factor = Number(scale[axis]) || 1;
            const half = Math.abs(extent * factor) / 2;
            bounds.min[axis] = Math.min(bounds.min[axis], pos[axis] - half);
            bounds.max[axis] = Math.max(bounds.max[axis], pos[axis] + half);
        }
        collectVehicleLabBounds(part.children, pos, bounds);
    }
    return bounds;
}

/**
 * Schaetzt den Kollisionsradius eines im Lab gebauten Fahrzeugs.
 *
 * Grundlage ist die halbe Raumdiagonale der umschliessenden Box, also die
 * tatsaechliche Ausdehnung aller Bauteile. Der Faktor ist daran geeicht, dass
 * die Vorlage lab_jet_fighter (halbe Diagonale 4.11) ungefaehr den Radius des
 * eingebauten Jet-Fighter trifft; die eingebauten Fahrzeuge liegen zwischen
 * 0.8 und 1.6. Die frueheren Werte kamen aus "groesster Einzelwert geteilt
 * durch sechs" und wuchsen deshalb nicht mit dem Fahrzeug.
 *
 * @param {object} vehicleConfig
 * @returns {number}
 */
export function estimateVehicleLabHitboxRadius(vehicleConfig) {
    const bounds = collectVehicleLabBounds(vehicleConfig?.parts, [0, 0, 0], {
        min: [Infinity, Infinity, Infinity],
        max: [-Infinity, -Infinity, -Infinity],
    });
    if (!Number.isFinite(bounds.min[0])) return 1.2;

    const extents = [0, 1, 2].map((axis) => Math.max(0, bounds.max[axis] - bounds.min[axis]));
    const halfDiagonal = Math.hypot(...extents) / 2;
    if (halfDiagonal <= 0) return VEHICLE_LAB_HITBOX_MIN_RADIUS;

    const scaled = halfDiagonal * VEHICLE_LAB_HITBOX_SCALE;
    return Math.max(
        VEHICLE_LAB_HITBOX_MIN_RADIUS,
        Math.min(VEHICLE_LAB_HITBOX_MAX_RADIUS, Number(scaled.toFixed(2)))
    );
}

function normalizeCatalogVehicle(entry) {
    const normalized = normalizeVehicleLabConfig(entry?.config, {
        fallbackLabel: entry?.label,
        requireParts: true,
    });
    if (!normalized.ok) return null;
    const label = normalized.config.label;
    return {
        id: normalizeVehicleId(entry?.id, label),
        label,
        hitbox: { radius: estimateVehicleLabHitboxRadius(normalized.config) },
        config: normalized.config,
        updatedAtMs: Math.max(0, Number(entry?.updatedAtMs) || 0),
    };
}

export function normalizeVehicleLabCatalogRecord(source) {
    const input = source && typeof source === 'object' ? source : {};
    const seen = new Set();
    const vehicles = [];
    for (const entry of Array.isArray(input.vehicles) ? input.vehicles : []) {
        const vehicle = normalizeCatalogVehicle(entry);
        if (!vehicle || seen.has(vehicle.id)) continue;
        seen.add(vehicle.id);
        vehicles.push(vehicle);
        if (vehicles.length >= VEHICLE_LAB_CATALOG_LIMIT) break;
    }
    return { schemaVersion: VEHICLE_LAB_CATALOG_VERSION, vehicles };
}

export function upsertVehicleLabCatalogVehicle(source, config, options = {}) {
    const record = normalizeVehicleLabCatalogRecord(source);
    const normalized = normalizeVehicleLabConfig({
        ...config,
        label: options.label || config?.label,
    }, { requireParts: true });
    if (!normalized.ok) throw new Error(formatVehicleLabConfigIssues(normalized));

    const labelKey = normalized.config.label.toLowerCase();
    const matching = record.vehicles.find((entry) => entry.label.toLowerCase() === labelKey);
    const requestedId = options.vehicleId ? normalizeVehicleId(options.vehicleId, normalized.config.label) : '';
    let vehicleId = requestedId || matching?.id || createVehicleId(normalized.config.label);
    if (!requestedId && !matching) {
        const baseId = vehicleId;
        let suffix = 2;
        while (record.vehicles.some((entry) => entry.id === vehicleId)) vehicleId = `${baseId}-${suffix++}`;
    }
    const overwritesExisting = !!matching || record.vehicles.some((entry) => entry.id === vehicleId);
    if (!overwritesExisting && record.vehicles.length >= VEHICLE_LAB_CATALOG_LIMIT) {
        throw new Error(`Fahrzeuglimit von ${VEHICLE_LAB_CATALOG_LIMIT} erreicht. Bitte zuerst ein Fahrzeug löschen.`);
    }

    const vehicle = normalizeCatalogVehicle({
        id: vehicleId,
        label: normalized.config.label,
        config: normalized.config,
        updatedAtMs: Number(options.updatedAtMs) || Date.now(),
    });
    const vehicles = record.vehicles.filter((entry) => entry.id !== vehicle.id && entry !== matching);
    vehicles.unshift(vehicle);
    return {
        record: { schemaVersion: VEHICLE_LAB_CATALOG_VERSION, vehicles: vehicles.slice(0, VEHICLE_LAB_CATALOG_LIMIT) },
        vehicle,
        overwritten: overwritesExisting,
    };
}

export function renameVehicleLabCatalogVehicle(source, vehicleId, label) {
    const record = normalizeVehicleLabCatalogRecord(source);
    const current = record.vehicles.find((entry) => entry.id === String(vehicleId || '').trim());
    if (!current) throw new Error('Fahrzeug wurde nicht gefunden.');
    const renamedConfig = normalizeVehicleLabConfig({ ...current.config, label }, { requireParts: true });
    if (!renamedConfig.ok) throw new Error(formatVehicleLabConfigIssues(renamedConfig));
    const labelKey = renamedConfig.config.label.toLowerCase();
    if (record.vehicles.some((entry) => (
        entry.id !== current.id && entry.label.toLowerCase() === labelKey
    ))) {
        throw new Error('Ein Fahrzeug mit diesem Namen existiert bereits.');
    }
    const withoutCurrent = {
        ...record,
        vehicles: record.vehicles.filter((entry) => entry.id !== current.id),
    };
    const result = upsertVehicleLabCatalogVehicle(withoutCurrent, renamedConfig.config, { label: renamedConfig.config.label });
    return { ...result, previousVehicleId: current.id };
}

export function deleteVehicleLabCatalogVehicle(source, vehicleId) {
    const record = normalizeVehicleLabCatalogRecord(source);
    const id = String(vehicleId || '').trim();
    const vehicles = record.vehicles.filter((entry) => entry.id !== id);
    return {
        record: { schemaVersion: VEHICLE_LAB_CATALOG_VERSION, vehicles },
        deleted: vehicles.length !== record.vehicles.length,
    };
}

export function loadVehicleLabCatalog(storage = globalThis.localStorage) {
    try {
        return normalizeVehicleLabCatalogRecord(JSON.parse(storage?.getItem?.(VEHICLE_LAB_CATALOG_STORAGE_KEY) || 'null'));
    } catch {
        return normalizeVehicleLabCatalogRecord(null);
    }
}

export function saveVehicleLabCatalog(record, storage = globalThis.localStorage) {
    const normalized = normalizeVehicleLabCatalogRecord(record);
    storage?.setItem?.(VEHICLE_LAB_CATALOG_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
}
