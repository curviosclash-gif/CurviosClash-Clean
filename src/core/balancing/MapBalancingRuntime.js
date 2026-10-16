// Runtime side of per-map balancing: the shipped data/balancing catalog, the in-session
// working copies the F7 console and the balancing MCP edit, and the single place where
// resolved values replace the player's gameplay values in a runtime config.

import { bundledMapDocuments, bundledModesDocument as modesDocument } from '../../shared/maps/MapBalancingBundledData.js';
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

export function isMapBalancingAuthoritative() {
    return state.authoritativeOverride ?? MAP_BALANCING_AUTHORITATIVE;
}

/** Dev only: lets the F7 console and the MCP play a session with map values while the switch is off. */
export function setMapBalancingAuthoritativeOverride(value = null) {
    state.authoritativeOverride = typeof value === 'boolean' ? value : null;
    return isMapBalancingAuthoritative();
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
    state.workingLayers.clear();
    state.savedLayers.clear();
    state.dirtyMapKeys.clear();
}

export function resolveRuntimeMapBalancing({ modePath, mapKey, stageId } = {}) {
    return resolveMapBalancing(getMapBalancingCatalog(), { modePath, mapKey, stageId });
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
export function applyMapBalancingToRuntimeConfig(runtimeConfig, { force = false, clampBots = false } = {}) {
    if (!runtimeConfig || typeof runtimeConfig !== 'object') return runtimeConfig;
    if (!force && !isMapBalancingAuthoritative()) return runtimeConfig;
    const session = runtimeConfig.session || {};
    const { values } = resolveRuntimeMapBalancing({ modePath: session.modePath, mapKey: session.mapKey });
    const next = { ...runtimeConfig, session: { ...session } };
    for (const [key, [section, field]] of Object.entries(RUNTIME_PATHS)) {
        if (!(key in values)) continue;
        if (next[section] === runtimeConfig[section]) next[section] = { ...runtimeConfig[section] };
        next[section][field] = values[key];
    }
    if (typeof values.portalsEnabled === 'boolean') {
        next.session.portalsEnabled = isFivePortalsRun(runtimeConfig) || values.portalsEnabled;
    }
    const standardSession = session.splitScreenVariant === SPLIT_SCREEN_VARIANTS.STANDARD
        && runtimeConfig.arcade?.enabled !== true;
    if (clampBots && standardSession && typeof values.botCountMin === 'number' && typeof values.botCountMax === 'number') {
        const numBots = Number(session.numBots) || 0;
        next.session.numBots = Math.min(values.botCountMax, Math.max(values.botCountMin, numBots));
    }
    return next;
}
