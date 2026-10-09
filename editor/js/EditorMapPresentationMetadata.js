import { normalizeMapLighting } from '../../src/shared/contracts/MapLightingContract.js';
import { normalizeMapFogLayer } from '../../src/shared/contracts/MapFogLayerContract.js';
import { normalizeMapAnimationClock } from '../../src/shared/contracts/MapAnimationClockContract.js';

// Existing game presentation fields have no editable geometry. Keep their shared contracts
// alongside the authoring schema, without adding another document version or storage format.
export function readEditorMapPresentationMetadata(source) {
    const result = {};
    if (source?.lighting && typeof source.lighting === 'object') result.lighting = normalizeMapLighting(source.lighting);
    const fogLayer = normalizeMapFogLayer(source?.fogLayer);
    if (fogLayer) result.fogLayer = fogLayer;
    if (source?.glbAnimationClock) result.glbAnimationClock = normalizeMapAnimationClock(source.glbAnimationClock);
    return result;
}
