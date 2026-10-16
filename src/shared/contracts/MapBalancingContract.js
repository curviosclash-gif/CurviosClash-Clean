// Per-map balancing: values that decide feel and fairness of a map (speed, trail, items,
// combat numbers, bot range) and no longer belong to the player. They live as JSON in
// data/balancing/: one file with complete mode defaults, one sparse file per map. Layers
// only carry what differs: mode defaults -> map -> arcade stage. The runtime, the Settings
// Studio, the F7 console and the balancing MCP all read and write through this contract,
// so a value that one of them saves is exactly the value a match runs with.

import { SETTINGS_LIMITS } from './SettingsRuntimeContract.js';
import { ARCADE_RUN_SETTINGS_RANGES } from './ArcadeRunSettingsContract.js';
import { stableCanonicalSerialize } from '../utils/CanonicalJson.js';

export const MAP_BALANCING_CONTRACT_VERSION = 1;

export const MAP_BALANCING_MODE_IDS = Object.freeze({
    NORMAL: 'normal',
    FIGHT: 'fight',
    ARCADE: 'arcade',
});

export const MAP_BALANCING_ORIGINS = Object.freeze({
    MODE: 'mode',
    MAP: 'map',
    STAGE: 'stage',
});

/**
 * @typedef {{ min: number, max: number, integer?: boolean }} MapBalancingLimits
 * @typedef {{
 *   key: string, group: 'map' | 'bots' | 'arcadeStage', type: 'number' | 'boolean',
 *   settingsPath: string | null, limits: MapBalancingLimits | null, integer: boolean, step: number,
 *   label: { de: string, en: string }, help: { de: string, en: string }
 * }} MapBalancingField
 * @typedef {Record<string, number | boolean>} MapBalancingValues
 * @typedef {{ values: MapBalancingValues }} MapBalancingLayer
 * @typedef {{ version: number, mapKey: string, values: MapBalancingValues }} MapBalancingMapDocument
 * @typedef {{ version: number, modes: Record<string, MapBalancingLayer> }} MapBalancingModesDocument
 * @typedef {{ modes: Record<string, MapBalancingLayer>, maps: Record<string, MapBalancingLayer>,
 *   stages: Record<string, MapBalancingLayer> }} MapBalancingCatalog
 * @typedef {{ ok: boolean, errors: string[] }} MapBalancingValidation
 */

/**
 * @param {string} key
 * @param {MapBalancingField['group']} group
 * @param {string | null} settingsPath
 * @param {MapBalancingLimits | null} limits
 * @param {number} step
 * @param {[string, string]} label
 * @param {string} help
 * @param {{ type?: 'number' | 'boolean', integer?: boolean }} [options]
 * @returns {MapBalancingField}
 */
function field(key, group, settingsPath, limits, step, label, help, options = {}) {
    const type = options.type || 'number';
    return Object.freeze({
        key,
        group,
        type,
        settingsPath,
        limits,
        integer: type === 'number' && (options.integer === true || limits?.integer === true),
        step,
        label: Object.freeze({ de: label[0], en: label[1] }),
        help: Object.freeze({ de: help, en: help }),
    });
}

const GAMEPLAY = SETTINGS_LIMITS.gameplay;
const ARCADE = ARCADE_RUN_SETTINGS_RANGES;

/** @type {ReadonlyArray<MapBalancingField>} */
export const MAP_BALANCING_FIELDS = Object.freeze([
    field('speed', 'map', 'gameplay.speed', GAMEPLAY.speed, 0.5, ['Tempo', 'Speed'], 'Grundgeschwindigkeit der Flugzeuge.'),
    field('turnSensitivity', 'map', 'gameplay.turnSensitivity', GAMEPLAY.turnSensitivity, 0.1,
        ['Lenkung Links/Rechts (Yaw)', 'Left/right steering (Yaw)'], 'Drehgeschwindigkeit links/rechts; höhere Werte ergeben engere Kurven.'),
    field('pitchSensitivity', 'map', 'gameplay.pitchSensitivity', GAMEPLAY.pitchSensitivity, 0.1,
        ['Lenkung Hoch/Runter (Pitch)', 'Up/down steering (Pitch)'], 'Drehgeschwindigkeit hoch/runter; höher als Yaw ergibt einen kleineren vertikalen Kurvenradius.'),
    field('gravityStrength', 'map', 'gameplay.gravityStrength', GAMEPLAY.gravityStrength, 1,
        ['Gravitationswirkung', 'Gravity'], 'Wie stark Steigen bremst und Sinken beschleunigt.'),
    field('planeScale', 'map', 'gameplay.planeScale', GAMEPLAY.planeScale, 0.05,
        ['Flugzeuggröße', 'Plane scale'], 'Größe der Flugzeuge; muss zu Durchgängen und Ringen passen.'),
    field('trailWidth', 'map', 'gameplay.trailWidth', GAMEPLAY.trailWidth, 0.05,
        ['Strahldicke', 'Trail width'], 'Dicke der Flugspur.'),
    field('trailLength', 'map', 'gameplay.trailLength', GAMEPLAY.trailLength, 100,
        ['Spurlänge', 'Trail length'], 'Wie viele Spursegmente stehen bleiben.'),
    field('gapSize', 'map', 'gameplay.gapSize', GAMEPLAY.gapSize, 0.05,
        ['Lückengröße', 'Gap size'], 'Dauer einer Lücke in der Spur in Sekunden.'),
    field('gapFrequency', 'map', 'gameplay.gapFrequency', GAMEPLAY.gapFrequency, 0.01,
        ['Lückenhäufigkeit', 'Gap frequency'], 'Wahrscheinlichkeit einer neuen Lücke.'),
    field('itemAmount', 'map', 'gameplay.itemAmount', GAMEPLAY.itemAmount, 1,
        ['Gegenstände', 'Item amount'], 'Wie viele Gegenstände höchstens gleichzeitig auf der Karte liegen.'),
    field('fireRate', 'map', 'gameplay.fireRate', GAMEPLAY.fireRate, 0.05,
        ['Schussintervall', 'Fire rate'], 'Sekunden zwischen zwei Schüssen.'),
    field('lockOnAngle', 'map', 'gameplay.lockOnAngle', GAMEPLAY.lockOnAngle, 1,
        ['Zielerfassungswinkel', 'Lock-on angle'], 'Öffnungswinkel der Zielerfassung in Grad.'),
    field('mgTrailAimRadius', 'map', 'gameplay.mgTrailAimRadius', GAMEPLAY.mgTrailAimRadius, 0.05,
        ['MG-Zielsuchradius', 'MG trail aim radius'], 'Trefferradius des Maschinengewehrs an Spuren.'),
    field('fightPlayerHp', 'map', 'gameplay.fightPlayerHp', GAMEPLAY.fightPlayerHp, 5,
        ['Lebenspunkte im Kampf', 'Fight player HP'], 'Lebenspunkte je Flugzeug; wirkt nur im Kampf.'),
    field('fightMgDamage', 'map', 'gameplay.fightMgDamage', GAMEPLAY.fightMgDamage, 0.25,
        ['MG-Schaden', 'Fight MG damage'], 'Schaden je MG-Treffer; wirkt nur im Kampf.'),
    field('portalsEnabled', 'map', 'portalsEnabled', null, 1,
        ['Portale', 'Portals'], 'Ob die Portale der Karte aktiv sind.', { type: 'boolean' }),
    field('planarLevelCount', 'map', 'gameplay.planarLevelCount', GAMEPLAY.planarLevelCount, 1,
        ['Anzahl Ebenen', 'Planar levels'], 'Zahl der Flugebenen im Ebenenflug.'),
    field('botCountMin', 'bots', null, SETTINGS_LIMITS.session.numBots, 1,
        ['Bots mindestens', 'Bots min'], 'Kleinste Bot-Anzahl, die der Spieler auf dieser Karte wählen kann.'),
    field('botCountMax', 'bots', null, SETTINGS_LIMITS.session.numBots, 1,
        ['Bots höchstens', 'Bots max'], 'Größte Bot-Anzahl, die der Spieler auf dieser Karte wählen kann.'),
    field('sectorCount', 'arcadeStage', 'arcade.sectorCount', ARCADE.sectorCount, 1,
        ['Sektoren bis zum Sieg', 'Sector count'], 'Länge einer Arcade-Etappe.', { integer: true }),
    field('comboWindowMs', 'arcadeStage', 'arcade.comboWindowMs', ARCADE.comboWindowMs, 100,
        ['Combo-Fenster', 'Combo window'], 'Millisekunden, in denen eine Combo weiterläuft.', { integer: true }),
    field('maxMultiplier', 'arcadeStage', 'arcade.maxMultiplier', ARCADE.maxMultiplier, 1,
        ['Maximaler Multiplikator', 'Max multiplier'], 'Obergrenze des Punkte-Multiplikators.', { integer: true }),
    field('intermissionSeconds', 'arcadeStage', 'arcade.intermissionSeconds', ARCADE.intermissionSeconds, 1,
        ['Zwischenstopp', 'Intermission'], 'Dauer des Zwischenstopps in Sekunden.'),
    field('comboDecayPerSecond', 'arcadeStage', 'arcade.comboDecayPerSecond', ARCADE.comboDecayPerSecond, 0.1,
        ['Combo-Verfall', 'Combo decay'], 'Wie schnell die Combo je Sekunde verfällt.'),
]);

/** @type {ReadonlyMap<string, MapBalancingField>} */
const FIELD_BY_KEY = new Map(MAP_BALANCING_FIELDS.map((entry) => [entry.key, entry]));
/** @type {ReadonlySet<string>} */
const MODE_ID_SET = new Set(Object.values(MAP_BALANCING_MODE_IDS));
const MAP_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,79}$/i;

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** @param {string} key @returns {MapBalancingField | undefined} */
export function getMapBalancingField(key) {
    return FIELD_BY_KEY.get(key);
}

/** @param {unknown} modePath @returns {string} */
export function normalizeMapBalancingModeId(modePath) {
    const candidate = typeof modePath === 'string' ? modePath.trim().toLowerCase() : '';
    return MODE_ID_SET.has(candidate) ? candidate : MAP_BALANCING_MODE_IDS.NORMAL;
}

/** @param {unknown} mapKey @returns {boolean} */
export function isValidMapBalancingMapKey(mapKey) {
    return typeof mapKey === 'string' && MAP_KEY_PATTERN.test(mapKey);
}

/**
 * Clamps like the runtime does; returns undefined for values that cannot be read at all.
 * @param {MapBalancingField} entry
 * @param {unknown} value
 * @returns {number | boolean | undefined}
 */
function normalizeFieldValue(entry, value) {
    if (entry.type === 'boolean') return typeof value === 'boolean' ? value : undefined;
    if (typeof value !== 'number' || !Number.isFinite(value) || !entry.limits) return undefined;
    const raw = entry.integer ? Math.trunc(value) : value;
    return Math.min(entry.limits.max, Math.max(entry.limits.min, raw));
}

/**
 * @param {MapBalancingField} entry
 * @param {unknown} value
 * @returns {string | null} error text, or null when the value is valid as written
 */
function describeFieldError(entry, value) {
    if (entry.type === 'boolean') return typeof value === 'boolean' ? null : `${entry.key}: expected true or false`;
    if (typeof value !== 'number' || !Number.isFinite(value) || !entry.limits) return `${entry.key}: expected a number`;
    if (entry.integer && !Number.isInteger(value)) return `${entry.key}: expected a whole number`;
    if (value < entry.limits.min || value > entry.limits.max) {
        return `${entry.key}: ${value} outside ${entry.limits.min}..${entry.limits.max}`;
    }
    return null;
}

/**
 * Field order, not insertion order, so a saved file has a stable diff.
 * @param {Record<string, unknown>} values
 * @returns {MapBalancingValues}
 */
function orderValues(values) {
    /** @type {MapBalancingValues} */
    const ordered = {};
    for (const entry of MAP_BALANCING_FIELDS) {
        const value = values[entry.key];
        if (typeof value === 'number' || typeof value === 'boolean') ordered[entry.key] = value;
    }
    return ordered;
}

/**
 * @param {unknown} source a layer in any state
 * @returns {MapBalancingLayer}
 */
export function normalizeMapBalancingLayer(source) {
    const rawValues = isPlainObject(source) && isPlainObject(source.values) ? source.values : {};
    /** @type {Record<string, number | boolean>} */
    const values = {};
    for (const [key, value] of Object.entries(rawValues)) {
        const entry = FIELD_BY_KEY.get(key);
        const normalized = entry ? normalizeFieldValue(entry, value) : undefined;
        if (normalized !== undefined) values[key] = normalized;
    }
    return { values: orderValues(values) };
}

/**
 * @param {unknown} source
 * @returns {MapBalancingMapDocument}
 */
export function normalizeMapBalancingMapDocument(source) {
    const mapKey = isPlainObject(source) && isValidMapBalancingMapKey(source.mapKey) ? String(source.mapKey) : '';
    return { version: MAP_BALANCING_CONTRACT_VERSION, mapKey, ...normalizeMapBalancingLayer(source) };
}

/**
 * @param {unknown} source
 * @returns {MapBalancingModesDocument}
 */
export function normalizeMapBalancingModesDocument(source) {
    const rawModes = isPlainObject(source) && isPlainObject(source.modes) ? source.modes : {};
    /** @type {Record<string, MapBalancingLayer>} */
    const modes = {};
    for (const modeId of Object.values(MAP_BALANCING_MODE_IDS)) {
        modes[modeId] = normalizeMapBalancingLayer(rawModes[modeId]);
        // Older complete mode defaults used one rate for both axes. Sparse map and stage
        // layers stay independent so resetting pitch really restores the inherited value.
        const values = modes[modeId].values;
        if (values.pitchSensitivity === undefined && values.turnSensitivity !== undefined) {
            values.pitchSensitivity = values.turnSensitivity;
        }
    }
    return { version: MAP_BALANCING_CONTRACT_VERSION, modes };
}

/**
 * @param {unknown} rawValues
 * @param {string} prefix
 * @param {string[]} errors
 */
function collectLayerErrors(rawValues, prefix, errors) {
    if (!isPlainObject(rawValues)) {
        errors.push(`${prefix}values: expected an object`);
        return;
    }
    for (const [key, value] of Object.entries(rawValues)) {
        const entry = FIELD_BY_KEY.get(key);
        const error = entry ? describeFieldError(entry, value) : `${key}: unknown balancing value`;
        if (error) errors.push(`${prefix}${error}`);
    }
    const min = rawValues.botCountMin;
    const max = rawValues.botCountMax;
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
        errors.push(`${prefix}botCountMin ${min} is above botCountMax ${max}`);
    }
}

/**
 * @param {Record<string, unknown>} source
 * @param {string[]} errors
 */
function collectVersionError(source, errors) {
    if (source.version !== undefined && source.version !== MAP_BALANCING_CONTRACT_VERSION) {
        errors.push(`version: expected ${MAP_BALANCING_CONTRACT_VERSION}`);
    }
}

/**
 * Strict check before a save: reports instead of clamping, so nothing changes silently.
 * @param {unknown} source
 * @returns {MapBalancingValidation}
 */
export function validateMapBalancingMapDocument(source) {
    /** @type {string[]} */
    const errors = [];
    if (!isPlainObject(source)) return { ok: false, errors: ['document: expected an object'] };
    collectVersionError(source, errors);
    if (!isValidMapBalancingMapKey(source.mapKey)) errors.push('mapKey: expected a plain map id');
    collectLayerErrors(source.values, '', errors);
    return { ok: errors.length === 0, errors };
}

/**
 * Mode defaults must be complete; every later layer inherits from them.
 * @param {unknown} source
 * @returns {MapBalancingValidation}
 */
export function validateMapBalancingModesDocument(source) {
    /** @type {string[]} */
    const errors = [];
    if (!isPlainObject(source) || !isPlainObject(source.modes)) {
        return { ok: false, errors: ['modes: expected an object'] };
    }
    collectVersionError(source, errors);
    for (const modeId of Object.values(MAP_BALANCING_MODE_IDS)) {
        const layer = source.modes[modeId];
        const rawValues = isPlainObject(layer) ? layer.values : undefined;
        collectLayerErrors(rawValues, `${modeId}.`, errors);
        if (!isPlainObject(rawValues)) continue;
        for (const entry of MAP_BALANCING_FIELDS) {
            const required = entry.group !== 'arcadeStage' || modeId === MAP_BALANCING_MODE_IDS.ARCADE;
            const legacyPitch = entry.key === 'pitchSensitivity' && !('pitchSensitivity' in rawValues)
                && 'turnSensitivity' in rawValues;
            if (required && !legacyPitch && !(entry.key in rawValues)) errors.push(`${modeId}.${entry.key}: missing`);
        }
    }
    return { ok: errors.length === 0, errors };
}

/**
 * @param {{ modesDocument?: unknown, mapDocuments?: unknown, stageDocuments?: unknown }} [sources]
 * @returns {MapBalancingCatalog}
 */
export function createMapBalancingCatalog({ modesDocument, mapDocuments, stageDocuments } = {}) {
    /** @type {Record<string, MapBalancingLayer>} */
    const maps = {};
    const mapList = Array.isArray(mapDocuments)
        ? mapDocuments
        : (isPlainObject(mapDocuments) ? Object.values(mapDocuments) : []);
    for (const document of mapList) {
        const normalized = normalizeMapBalancingMapDocument(document);
        if (normalized.mapKey) maps[normalized.mapKey] = { values: normalized.values };
    }
    /** @type {Record<string, MapBalancingLayer>} */
    const stages = {};
    for (const [stageId, layer] of Object.entries(isPlainObject(stageDocuments) ? stageDocuments : {})) {
        stages[stageId] = normalizeMapBalancingLayer(layer);
    }
    return { modes: normalizeMapBalancingModesDocument(modesDocument).modes, maps, stages };
}

/**
 * @typedef {{
 *   version: number, modePath: string, mapKey: string, stageId: string,
 *   values: MapBalancingValues, inherited: MapBalancingValues, origins: Record<string, string>,
 *   hasMapLayer: boolean, hasStageLayer: boolean
 * }} ResolvedMapBalancing
 */

/**
 * Resolves the effective values for one match and tells for each value which layer set it.
 * `inherited` is what the value falls back to when its top layer is reset.
 * @param {MapBalancingCatalog} catalog
 * @param {{ modePath?: unknown, mapKey?: unknown, stageId?: unknown }} [target]
 * @returns {ResolvedMapBalancing}
 */
export function resolveMapBalancing(catalog, { modePath, mapKey, stageId } = {}) {
    const modeId = normalizeMapBalancingModeId(modePath);
    const key = typeof mapKey === 'string' ? mapKey : '';
    const stageKey = typeof stageId === 'string' ? stageId : '';
    const mapLayer = key ? catalog?.maps?.[key] : undefined;
    const stageLayer = stageKey ? catalog?.stages?.[stageKey] : undefined;
    const layers = [
        { origin: MAP_BALANCING_ORIGINS.MODE, values: catalog?.modes?.[modeId]?.values || {} },
        { origin: MAP_BALANCING_ORIGINS.MAP, values: mapLayer?.values || {} },
        { origin: MAP_BALANCING_ORIGINS.STAGE, values: stageLayer?.values || {} },
    ];
    /** @type {MapBalancingValues} */
    const values = {};
    /** @type {MapBalancingValues} */
    const inherited = {};
    /** @type {Record<string, string>} */
    const origins = {};
    for (const entry of MAP_BALANCING_FIELDS) {
        for (const layer of layers) {
            if (!(entry.key in layer.values)) continue;
            if (entry.key in values) inherited[entry.key] = values[entry.key];
            values[entry.key] = layer.values[entry.key];
            origins[entry.key] = layer.origin;
        }
        if (entry.key in values && !(entry.key in inherited)) inherited[entry.key] = values[entry.key];
    }
    if (typeof values.botCountMin === 'number' && typeof values.botCountMax === 'number') {
        values.botCountMax = Math.max(values.botCountMin, values.botCountMax);
    }
    return {
        version: MAP_BALANCING_CONTRACT_VERSION,
        modePath: modeId,
        mapKey: key,
        stageId: stageKey,
        values,
        inherited,
        origins,
        hasMapLayer: !!mapLayer,
        hasStageLayer: !!stageLayer,
    };
}

/**
 * @typedef {{
 *   key: string, group: string, type: string, label: string, help: string,
 *   min: number | null, max: number | null, step: number, integer: boolean,
 *   value: number | boolean | null, origin: string | null, mapValue: number | boolean | null,
 *   inherited: number | boolean | null
 * }} MapBalancingFieldRow
 */

/**
 * One row per value for the tools: effective value, origin, the map's own value and what a
 * reset on this map would bring back. Studio, F7 console and MCP all show this.
 * @param {MapBalancingCatalog} catalog
 * @param {{ modePath?: unknown, mapKey?: unknown }} [target]
 * @returns {{ modePath: string, mapKey: string, hasMapLayer: boolean, fields: MapBalancingFieldRow[] }}
 */
export function describeMapBalancing(catalog, { modePath, mapKey } = {}) {
    const resolved = resolveMapBalancing(catalog, { modePath, mapKey });
    const layerValues = catalog?.maps?.[resolved.mapKey]?.values || {};
    return {
        modePath: resolved.modePath,
        mapKey: resolved.mapKey,
        hasMapLayer: resolved.hasMapLayer,
        fields: MAP_BALANCING_FIELDS.map((entry) => ({
            key: entry.key,
            group: entry.group,
            type: entry.type,
            label: entry.label.de,
            help: entry.help.de,
            min: entry.limits?.min ?? null,
            max: entry.limits?.max ?? null,
            step: entry.step,
            integer: entry.integer,
            value: resolved.values[entry.key] ?? null,
            origin: resolved.origins[entry.key] || null,
            mapValue: layerValues[entry.key] ?? null,
            inherited: (entry.key in layerValues ? resolved.inherited[entry.key] : resolved.values[entry.key]) ?? null,
        })),
    };
}

/**
 * Short stable id of the values a match runs with. Prepared for B5: the lobby compares it so
 * two game versions never play one map with different values, and leaderboards key on it.
 * @param {{ version?: number, modePath?: string, mapKey?: string, values?: MapBalancingValues } | null} resolved
 * @returns {string}
 */
export function fingerprintMapBalancing(resolved) {
    const values = orderValues(isPlainObject(resolved?.values) ? resolved.values : {});
    const source = `${resolved?.version ?? MAP_BALANCING_CONTRACT_VERSION}|${resolved?.modePath || ''}|${resolved?.mapKey || ''}|${stableCanonicalSerialize(values)}`;
    // FNV-1a, 32 bit: enough to tell versions apart, not a security hash.
    let hash = 0x811c9dc5;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= source.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `mb${MAP_BALANCING_CONTRACT_VERSION}-${hash.toString(16).padStart(8, '0')}`;
}

/**
 * @param {unknown} layer
 * @param {string} key
 * @param {unknown} value
 * @returns {MapBalancingLayer}
 */
export function setMapBalancingLayerValue(layer, key, value) {
    const entry = FIELD_BY_KEY.get(key);
    if (!entry) throw new Error(`${key}: unknown balancing value`);
    const error = describeFieldError(entry, value);
    if (error) throw new Error(error);
    const current = normalizeMapBalancingLayer(layer);
    return { values: orderValues({ ...current.values, [key]: /** @type {number | boolean} */ (value) }) };
}

/**
 * Removes the value from this layer so it is inherited again.
 * @param {unknown} layer
 * @param {string} key
 * @returns {MapBalancingLayer}
 */
export function resetMapBalancingLayerValue(layer, key) {
    const values = { ...normalizeMapBalancingLayer(layer).values };
    delete values[key];
    return { values };
}

/**
 * @param {string} mapKey
 * @param {unknown} layer
 * @returns {string}
 */
export function serializeMapBalancingMapDocument(mapKey, layer) {
    const document = {
        version: MAP_BALANCING_CONTRACT_VERSION,
        mapKey,
        values: normalizeMapBalancingLayer(layer).values,
    };
    return `${JSON.stringify(document, null, 2)}\n`;
}
