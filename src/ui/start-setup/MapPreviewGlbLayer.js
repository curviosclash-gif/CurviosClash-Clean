import {
    loadGLBMap,
    loadGLBMapCollection,
    shouldDiscardAuthoredObstacleVisuals,
} from '../../entities/GLBMapLoader.js';
import { GAMEPLAY_CONFIG_DEFAULTS } from '../../shared/contracts/GameplayConfigContract.js';
import { disposeObject3DResources } from '../../shared/rendering/ThreeDisposal.js';

// The arena adds a single-model map unplaced, at world scale. The miniature is built in authored
// units, so that model has to shrink by the map scale to line up with the authored markers.
const SINGLE_MODEL_SCALE = 1 / GAMEPLAY_CONFIG_DEFAULTS.ARENA.MAP_SCALE;
const PREVIEW_LOAD_CONCURRENCY = 3;

/**
 * Which models the menu miniature loads for a map. Break scenes and collision-only bodies are
 * never drawn before a round runs, so the preview does not download them at all.
 * @param {any} definition
 */
export function resolveMapPreviewGlbSource(definition) {
    const collection = Array.isArray(definition?.glbModels) ? definition.glbModels : [];
    if (collection.length > 0) {
        const models = collection.filter((entry) => entry
            && entry.hiddenUntilTriggered !== true
            && entry.collisionOnly !== true);
        return models.length > 0 ? { kind: 'collection', models } : null;
    }
    const url = typeof definition?.glbModel === 'string' ? definition.glbModel.trim() : '';
    return url ? { kind: 'single', url } : null;
}

/**
 * Loads the authored models of one map at a time for the menu miniature. A newer request or a
 * release makes an unfinished load stale: its scene is disposed instead of handed out.
 */
export function createMapPreviewGlbLayer({
    loadCollection = loadGLBMapCollection,
    loadSingle = loadGLBMap,
    disposeScene = disposeObject3DResources,
} = {}) {
    let ticket = 0;
    let scene = null;

    function release() {
        ticket += 1;
        if (!scene) return;
        scene.removeFromParent();
        disposeScene(scene);
        scene = null;
    }

    /** @returns {Promise<{ status: 'none'|'stale'|'ready'|'failed', scene?: any, hideAuthoredObstacles?: boolean }>} */
    async function load(definition) {
        release();
        const source = resolveMapPreviewGlbSource(definition);
        if (!source) return { status: 'none' };
        const ownTicket = ticket;
        let result = null;
        try {
            result = source.kind === 'collection'
                ? await loadCollection(source.models, {
                    placementScale: 1,
                    collectColliders: false,
                    concurrency: PREVIEW_LOAD_CONCURRENCY,
                    sceneName: 'map-preview-glb',
                })
                : await loadSingle(source.url, { collectColliders: false, sceneName: 'map-preview-glb' });
        } catch {
            return { status: ownTicket === ticket ? 'failed' : 'stale' };
        }
        if (ownTicket !== ticket) {
            disposeScene(result.scene);
            return { status: 'stale' };
        }
        if (source.kind === 'single') result.scene.scale.setScalar(SINGLE_MODEL_SCALE);
        scene = result.scene;
        return {
            status: 'ready',
            scene,
            hideAuthoredObstacles: shouldDiscardAuthoredObstacleVisuals({
                usedGlbModel: true,
                loadWarnings: Array.isArray(result.warnings) ? result.warnings : [],
                map: definition,
            }),
        };
    }

    return Object.freeze({ load, release });
}
