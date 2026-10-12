// Live balancing for developer tools (F7 console, balancing MCP): read the values of the map
// being played with their origin, change them in the running match, and take over a layer
// that a tool has just saved to data/balancing. Nothing here writes files.

import {
    describeMapBalancing,
    resetMapBalancingLayerValue,
    setMapBalancingLayerValue,
} from '../../shared/contracts/MapBalancingContract.js';
import { applyRuntimeConfigLive } from '../runtime/RuntimeConfigLiveApply.js';
import {
    applyMapBalancingToRuntimeConfig,
    discardMapBalancingWorkingLayer,
    getMapBalancingCatalog,
    getMapBalancingWorkingLayer,
    isMapBalancingAuthoritative,
    isMapBalancingWorkingLayerDirty,
    setMapBalancingAuthoritativeOverride,
    setMapBalancingWorkingLayer,
} from './MapBalancingRuntime.js';

/** @type {(() => any) | null} */
let resolveLiveFacade = null;

/** The running game registers how to reach its runtime facade; the latest game wins. */
export function registerMapBalancingLiveSource(getFacade) {
    resolveLiveFacade = typeof getFacade === 'function' ? getFacade : null;
}

function readTarget() {
    const facade = resolveLiveFacade?.() || null;
    const runtimeState = facade?.getRuntimeState?.() || null;
    const runtimeConfig = runtimeState?.runtimeConfig || null;
    const settings = facade?.game?.settings || null;
    return {
        facade,
        runtimeState,
        runtimeConfig,
        inMatch: !!(runtimeState?.entityManager && runtimeConfig),
        mapKey: String(runtimeConfig?.session?.mapKey || settings?.mapKey || ''),
        modePath: String(runtimeConfig?.session?.modePath || settings?.localSettings?.modePath || 'normal'),
    };
}

function applyToRunningMatch(target) {
    if (!target.inMatch) return false;
    const next = applyMapBalancingToRuntimeConfig(target.runtimeConfig, { force: true });
    applyRuntimeConfigLive(target.facade.getRuntimeBundle?.(), target.runtimeState, next);
    return true;
}

function describe(target, { mapKey, modePath } = {}) {
    const key = String(mapKey || target.mapKey || '');
    const description = describeMapBalancing(getMapBalancingCatalog(), { mapKey: key, modePath: modePath || target.modePath });
    return {
        ...description,
        inMatch: target.inMatch,
        isRunningMap: key === target.mapKey,
        authoritative: isMapBalancingAuthoritative(),
        dirty: isMapBalancingWorkingLayerDirty(key),
        layer: getMapBalancingWorkingLayer(key),
    };
}

function changeLayer(mapKey, change) {
    const target = readTarget();
    const key = String(mapKey || target.mapKey || '');
    if (!key) return { ok: false, reason: 'no_map' };
    try {
        setMapBalancingWorkingLayer(key, change(getMapBalancingWorkingLayer(key)));
    } catch (error) {
        return { ok: false, reason: 'invalid_value', detail: error instanceof Error ? error.message : String(error) };
    }
    let liveApplied = false;
    if (key === target.mapKey && target.inMatch) {
        // Tuning a map means playing it with map values; the session keeps them from here on.
        setMapBalancingAuthoritativeOverride(true);
        liveApplied = applyToRunningMatch(target);
    }
    return { ok: true, liveApplied, value: describe(readTarget(), { mapKey: key }) };
}

/** One API for every developer tool; all results are plain JSON. */
export function createMapBalancingLiveApi() {
    return Object.freeze({
        describe: (options = {}) => ({ ok: true, value: describe(readTarget(), options) }),
        setValue: (key, value, { mapKey } = {}) => changeLayer(mapKey, (layer) => setMapBalancingLayerValue(layer, String(key), value)),
        resetValue: (key, { mapKey } = {}) => changeLayer(mapKey, (layer) => resetMapBalancingLayerValue(layer, String(key))),
        discard: ({ mapKey } = {}) => {
            const target = readTarget();
            const key = String(mapKey || target.mapKey || '');
            discardMapBalancingWorkingLayer(key);
            const liveApplied = key === target.mapKey && isMapBalancingAuthoritative() && applyToRunningMatch(target);
            return { ok: true, liveApplied, value: describe(readTarget(), { mapKey: key }) };
        },
        /** After a tool wrote the file: the working copy now equals the saved state. */
        markSaved: (mapKey, layer) => {
            const key = String(mapKey || '');
            if (!key) return { ok: false, reason: 'no_map' };
            setMapBalancingWorkingLayer(key, layer, { saved: true });
            const target = readTarget();
            const liveApplied = key === target.mapKey && isMapBalancingAuthoritative() && applyToRunningMatch(target);
            return { ok: true, liveApplied, value: describe(target, { mapKey: key }) };
        },
        setAuthoritative: (enabled) => {
            const authoritative = setMapBalancingAuthoritativeOverride(typeof enabled === 'boolean' ? enabled : null);
            const target = readTarget();
            // Switching off takes effect with the next match; the running one keeps its values.
            const liveApplied = authoritative && applyToRunningMatch(target);
            return { ok: true, liveApplied, value: describe(target) };
        },
    });
}
