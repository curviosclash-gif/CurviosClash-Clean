export const PLAYER_HEALTH_AURA_VIEWER_LAYER_BASE = 1;
export const PLAYER_HEALTH_AURA_MAX_VIEWERS = 10;

export function resolvePlayerHealthAuraViewerLayer(playerIndex) {
    if (!Number.isInteger(playerIndex) || playerIndex < 0 || playerIndex >= PLAYER_HEALTH_AURA_MAX_VIEWERS) {
        return null;
    }
    return PLAYER_HEALTH_AURA_VIEWER_LAYER_BASE + playerIndex;
}

export function configurePlayerHealthAuraCamera(camera, playerIndex) {
    const layer = resolvePlayerHealthAuraViewerLayer(playerIndex);
    if (!camera?.layers) return false;
    for (let index = 0; index < PLAYER_HEALTH_AURA_MAX_VIEWERS; index += 1) {
        camera.layers.disable(PLAYER_HEALTH_AURA_VIEWER_LAYER_BASE + index);
    }
    camera.layers.enable(0);
    if (layer === null) return false;
    camera.layers.enable(layer);
    return true;
}

export function configurePlayerHealthAuraObserverCamera(camera) {
    if (!camera?.layers) return false;
    camera.layers.enable(0);
    for (let index = 0; index < PLAYER_HEALTH_AURA_MAX_VIEWERS; index += 1) {
        camera.layers.enable(PLAYER_HEALTH_AURA_VIEWER_LAYER_BASE + index);
    }
    return true;
}

export function configurePlayerHealthAuraCaptureCamera(camera, ownerPlayerIndex = null) {
    return configurePlayerHealthAuraCamera(camera, ownerPlayerIndex)
        || configurePlayerHealthAuraObserverCamera(camera);
}

export function configurePlayerHealthAuraObject(object, ownerPlayerIndex) {
    if (!object?.layers) return false;

    object.layers.disableAll();
    const ownerLayer = resolvePlayerHealthAuraViewerLayer(ownerPlayerIndex);
    for (let index = 0; index < PLAYER_HEALTH_AURA_MAX_VIEWERS; index += 1) {
        const layer = PLAYER_HEALTH_AURA_VIEWER_LAYER_BASE + index;
        if (layer !== ownerLayer) object.layers.enable(layer);
    }
    return true;
}
