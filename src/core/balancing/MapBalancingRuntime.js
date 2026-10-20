// Runtime side of per-map balancing: the shipped data/balancing catalog, the in-session
// working copies the F7 console and the balancing MCP edit, and the single place where
// resolved values replace the player's gameplay values in a runtime config.

import { bundledMapDocuments, bundledModesDocument as modesDocument, getAppliedMapBalancing } from '../../shared/maps/MapBalancingBundledData.js';
import {
    createMapBalancingCatalog,
    normalizeMapBalancingLayer,
    resolveMapBalancing,
} from '../../shared/contracts/MapBalancingContract.js';
import { ARCADE_RUN_KINDS, resolveArcadeRunKind } from '../../shared/contracts/ArcadeRunTypeDispatchContract.js';
import { SPLIT_SCREEN_VARIANTS } from '../../four-player-planar/FourPlayerPlanarContract.js';

// Off until the menu rework removes the player sliders for these values (B2); while off the
// player's settings stay in charge so no menu control goes silently dead.
export const MAP_BALANCING_AUTHORITATIVE = false;

const state = {
    /** @type {boolean | null} */
    authoritativeOverride: null,
    // true while the override comes from a live edit and lasts only for that match
    overrideEndsWithMatch: false,
    /** @type {boolean | null} the override to restore when that match ends */
    overrideBeforePreview: null,
    /** @type {Map<string, { values: Record<string, number | boolean> }>} */
    workingLayers: new Map(),
    /** @type {Map<string, { values: Record<string, number | boolean> }>} */
    savedLayers: new Map(),
    /** @type {Set<string>} */
    dirtyMapKeys: new Set(),
};

// runtime config path for each balancing value; the bot range and arcade stage values are
// handled separately (bots) or not yet applied (stage values, B5).
const RUNTIME_PATHS = Object.freeze({
    speed: ['player', 'speed'],
    turnSensitivity: ['player', 'turnSpeed'],
    pitchSensitivity: ['player', 'pitchTurnSpeed'],
    gravityStrength: ['player', 'gravityStrength'],
    planeScale: ['player', 'modelScale'],
    trailWidth: ['trail', 'width'],
    trailLength: ['trail', 'maxSegments'],
    gapSize: ['trail', 'gapDuration'],
    gapFrequency: ['trail', 'gapChance'],
    itemAmount: ['powerup', 'maxOnField'],
    fireRate: ['projectile', 'cooldown'],
    lockOnAngle: ['homing', 'lockOnAngle'],
    mgTrailAimRadius: ['huntCombat', 'mgTrailAimRadius'],
    fightPlayerHp: ['huntCombat', 'fightPlayerHp'],
    fightMgDamage: ['huntCombat', 'fightMgDamage'],
    planarLevelCount: ['gameplay', 'planarLevelCount'],
});

export function isMapBalancingAuthoritative(target = {}) {
    return state.authoritativeOverride ?? (MAP_BALANCING_AUTHORITATIVE || !!getAppliedMapBalancing(target));
}

/** Dev only: lets the F7 console and the MCP play a session with map values while the switch is off. */
export function setMapBalancingAuthoritativeOverride(value = null) {
    state.authoritativeOverride = typeof value === 'boolean' ? value : null;
    state.overrideEndsWithMatch = false;
    state.overrideBeforePreview = null;
    return isMapBalancingAuthoritative();
}

/** A live edit plays the running match with the draft; an explicit developer switch stays as it is. */
export function startMapBalancingMatchPreview() {
    if (state.authoritativeOverride === true) return;
    state.overrideBeforePreview = state.authoritativeOverride;
    state.authoritativeOverride = true;
    state.overrideEndsWithMatch = true;
}

/** Match teardown: later matches run as before the preview (approved values or the explicit switch), not with unsaved drafts. */
export function endMapBalancingMatchPreview() {
    if (!state.overrideEndsWithMatch) return false;
    state.authoritativeOverride = state.overrideBeforePreview;
    state.overrideBeforePreview = null;
    state.overrideEndsWithMatch = false;
    return true;
}

export function getMapBalancingCatalog() {
    const catalog = createMapBalancingCatalog({ modesDocument, mapDocuments: Object.values(bundledMapDocuments) });
    for (const [mapKey, layer] of state.workingLayers) catalog.maps[mapKey] = layer;
    return catalog;
}

export function getMapBalancingWorkingLayer(mapKey) {
    const key = String(mapKey || '');
    return state.workingLayers.get(key) || getMapBalancingCatalog().maps[key] || { values: {} };
}

/** The layer this session believes is on disk: saved in this session, else the shipped file. */
export function getMapBalancingFileLayer(mapKey) {
    const key = String(mapKey || '');
    return state.savedLayers.get(key)
        || createMapBalancingCatalog({ modesDocument, mapDocuments: Object.values(bundledMapDocuments) }).maps[key]
        || { values: {} };
}

/** Replaces this session's copy of a map layer; `saved` tells whether it now matches the file. */
export function setMapBalancingWorkingLayer(mapKey, layer, { saved = false } = {}) {
    const key = String(mapKey || '');
    if (!key) return null;
    const normalized = normalizeMapBalancingLayer(layer);
    state.workingLayers.set(key, normalized);
    if (saved) {
        state.savedLayers.set(key, normalized);
        state.dirtyMapKeys.delete(key);
    } else {
        state.dirtyMapKeys.add(key);
    }
    return normalized;
}

/** Drops unsaved changes: back to the layer saved in this session, else the shipped file. */
export function discardMapBalancingWorkingLayer(mapKey) {
    const key = String(mapKey || '');
    const saved = state.savedLayers.get(key);
    if (saved) state.workingLayers.set(key, saved);
    else state.workingLayers.delete(key);
    state.dirtyMapKeys.delete(key);
    return getMapBalancingWorkingLayer(key);
}

export function isMapBalancingWorkingLayerDirty(mapKey) {
    return state.dirtyMapKeys.has(String(mapKey || ''));
}

export function resetMapBalancingRuntimeState() {
    state.authoritativeOverride = null;
    state.overrideEndsWithMatch = false;
    state.overrideBeforePreview = null;
    state.workingLayers.clear();
    state.savedLayers.clear();
    state.dirtyMapKeys.clear();
}

export function resolveRuntimeMapBalancing({ modePath, mapKey, stageId } = {}) {
    return resolveMapBalancing(getMapBalancingCatalog(), { modePath, mapKey, stageId });
}

// The player's values that balancing replaced, keyed by "section.field".
const UNBALANCED_VALUES_KEY = 'mapBalancingBase';

function restoreUnbalancedValues(runtimeConfig) {
    const base = runtimeConfig[UNBALANCED_VALUES_KEY];
    if (!base || typeof base !== 'object') return runtimeConfig;
    const next = { ...runtimeConfig };
    delete next[UNBALANCED_VALUES_KEY];
    for (const [path, value] of Object.entries(base)) {
        const [section, field] = path.split('.');
        if (next[section] === runtimeConfig[section]) next[section] = { ...runtimeConfig[section] };
        if (value === undefined) delete next[section][field];
        else next[section][field] = value;
    }
    return next;
}

function isFivePortalsRun(runtimeConfig) {
    return runtimeConfig?.arcade?.enabled === true
        && resolveArcadeRunKind(runtimeConfig.arcade.runType) === ARCADE_RUN_KINDS.FIVE_PORTALS;
}

/**
 * Puts the balancing values of the config's own map and mode into a runtime config.
 * `clampBots` limits the player's bot count to the map range; only a fresh match setup may
 * do that, live updates and arcade sectors keep their bot count.
 * @param {any} runtimeConfig
 * @param {{ force?: boolean, clampBots?: boolean }} [options]
 */
export function applyMapBalancingToRuntimeConfig(inputConfig, { force = false, clampBots = false } = {}) {
    if (!inputConfig || typeof inputConfig !== 'object') return inputConfig;
    // A sector change or a live edit starts from an already balanced config: put the
    // player's values back first, so nothing of the previous map carries over.
    const runtimeConfig = restoreUnbalancedValues(inputConfig);
    const session = runtimeConfig.session || {};
    // Private PC approvals and live drafts must never replace a network session's host settings.
    if (!force && session.networkEnabled && !MAP_BALANCING_AUTHORITATIVE) return runtimeConfig;
    const target = { modePath: session.modePath, mapKey: session.mapKey };
    if (!force && !isMapBalancingAuthoritative(target)) return runtimeConfig;
    // A developer preview uses the current draft. Ordinary play uses the immutable approved snapshot.
    const applied = !force && state.authoritativeOverride !== true ? getAppliedMapBalancing(target) : null;
    const { values } = applied || resolveRuntimeMapBalancing(target);
    /** @type {Record<string, unknown>} */
    const base = {};
    const next = { ...runtimeConfig, session: { ...session } };
    for (const [key, [section, field]] of Object.entries(RUNTIME_PATHS)) {
        if (!(key in values)) continue;
        if (next[section] === runtimeConfig[section]) next[section] = { ...runtimeConfig[section] };
        base[`${section}.${field}`] = runtimeConfig[section]?.[field];
        next[section][field] = values[key];
    }
    if (typeof values.portalsEnabled === 'boolean') {
        base['session.portalsEnabled'] = session.portalsEnabled;
        next.session.portalsEnabled = isFivePortalsRun(runtimeConfig) || values.portalsEnabled;
    }
    next[UNBALANCED_VALUES_KEY] = Object.freeze(base);
    const standardSession = session.splitScreenVariant === SPLIT_SCREEN_VARIANTS.STANDARD
        && runtimeConfig.arcade?.enabled !== true;
    if (clampBots && standardSession && typeof values.botCountMin === 'number' && typeof values.botCountMax === 'number') {
        const numBots = Number(session.numBots) || 0;
        next.session.numBots = Math.min(values.botCountMax, Math.max(values.botCountMin, numBots));
    }
    return next;
}
