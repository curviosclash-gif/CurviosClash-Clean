import { isDemolitionConfig } from '../../shared/contracts/DemolitionContract.js';
import {
    isMapDestructibleModeAllowed,
    normalizeMapDestructibles,
} from '../../shared/contracts/MapDestructibleContract.js';

/**
 * Whether a map's destructibles are live in a mode, and so which break scenes a match can ever play.
 *
 * `MapDestructibleSystem.startRound` and the arena build both ask here, so the models the arena
 * loads can never disagree with the segments the round installs.
 */

/**
 * @param {Readonly<{ gameModes?: readonly string[] }> | null | undefined} authored normalized destructibles
 * @param {string} mode upper-case game mode, '' when unknown
 * @param {any} runtimeConfig session runtime config
 * @returns {{ active: boolean, vaultScenario: boolean }}
 */
export function resolveMapDestructibleEligibility(authored, mode, runtimeConfig) {
    const demolitionAllowed = mode === 'ARCADE' && isDemolitionConfig(runtimeConfig);
    const scenarioId = runtimeConfig?.arcade?.scenarioId;
    const vaultScenario = mode === 'ARCADE' && scenarioId === 'vault_breaker'
        && runtimeConfig?.session?.mapKey === 'eiffel_tower_siege';
    return {
        active: isMapDestructibleModeAllowed(authored, mode) || demolitionAllowed || vaultScenario,
        vaultScenario,
    };
}

/**
 * The mode the session was configured with, or '' when it names none. An arena built outside a
 * session (editor, hangar preview) has no mode and must keep every model.
 *
 * @param {any} runtimeConfig
 * @returns {string}
 */
function readSessionGameMode(runtimeConfig) {
    return String(runtimeConfig?.session?.activeGameMode || '').trim().toUpperCase();
}

/**
 * Ids of the hidden break-scene models this session can never trigger, so the loader leaves them
 * out. Empty whenever the mode is unknown or the map's destructibles are live in it.
 *
 * @param {any} map map definition
 * @param {any} runtimeConfig session runtime config
 * @returns {Set<string>}
 */
export function listSkippedBreakSceneModelIds(map, runtimeConfig) {
    const skipped = new Set();
    const authored = normalizeMapDestructibles(map?.destructibles);
    if (!authored || authored.breakScenes.length === 0) return skipped;
    const mode = readSessionGameMode(runtimeConfig);
    if (mode === '' || resolveMapDestructibleEligibility(authored, mode, runtimeConfig).active) return skipped;
    const sceneIds = new Set();
    for (const scene of authored.breakScenes) {
        sceneIds.add(scene.modelId);
        for (const modelId of scene.modelVariants || []) sceneIds.add(modelId);
        for (const attachment of scene.attachedModels) sceneIds.add(attachment.modelId);
    }
    for (const model of Array.isArray(map?.glbModels) ? map.glbModels : []) {
        if (model?.hiddenUntilTriggered === true && sceneIds.has(model.id)) skipped.add(model.id);
    }
    return skipped;
}

/**
 * Part of the arena reuse keys: differs between sessions only where the loaded models differ.
 *
 * @param {any} map
 * @param {any} runtimeConfig
 * @returns {string}
 */
export function resolveBreakSceneLoadKey(map, runtimeConfig) {
    return listSkippedBreakSceneModelIds(map, runtimeConfig).size > 0 ? 'no-break-scenes' : '';
}
