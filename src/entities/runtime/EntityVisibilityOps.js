// What a player can see through the map-wide fog and the sandstorm. Both systems are optional;
// without them everything stays visible.

const IDLE_FOG_STATE = Object.freeze({ active: false, remainingSeconds: 0, visibilityRange: 0 });
const IDLE_SANDSTORM_STATE = Object.freeze({ enabled: false, phase: 'CALM', remainingSeconds: 0, eventIndex: 0, directionIndex: 0, intensity: 0 });

export function getGlobalFogState(manager) {
    return manager._globalFogEffectSystem?.getState?.() || { ...IDLE_FOG_STATE };
}

export function getMapSandstormState(manager) {
    return manager._mapSandstormSystem?.getState?.() || { ...IDLE_SANDSTORM_STATE };
}

export function getGlobalFogVisibilityRange(manager) {
    return manager._globalFogEffectSystem?.getVisibilityRange?.() ?? Infinity;
}

export function isPositionVisibleDuringGlobalFog(manager, observerPosition, targetPosition) {
    return manager._globalFogEffectSystem?.isPositionVisible?.(observerPosition, targetPosition) !== false;
}

export function filterVisiblePlayers(manager, observer, players) {
    const fogVisible = manager._globalFogEffectSystem?.filterVisiblePlayers?.(observer, players) || players;
    return manager._mapSandstormSystem?.filterVisiblePlayers?.(observer, fogVisible) || fogVisible;
}

export function filterVisiblePowerups(manager, observer, powerups) {
    const fogVisible = manager._globalFogEffectSystem?.filterVisiblePowerups?.(observer, powerups) || powerups;
    return manager._mapSandstormSystem?.filterVisiblePowerups?.(observer, fogVisible) || fogVisible;
}

export function isPositionVisible(manager, observerPosition, targetPosition) {
    return manager._globalFogEffectSystem?.isPositionVisible?.(observerPosition, targetPosition) !== false
        && manager._mapSandstormSystem?.isPositionVisible?.(observerPosition, targetPosition) !== false;
}

export function getVisibilityRange(manager, observerPosition) {
    return Math.min(
        manager._globalFogEffectSystem?.getVisibilityRange?.() ?? Infinity,
        manager._mapSandstormSystem?.getVisibilityRange?.(observerPosition) ?? Infinity
    );
}

export function getSandstormProximityCue(manager, playerIndex) {
    return manager._mapSandstormSystem?.getProximityCue?.(manager.players?.[playerIndex], manager.players) || null;
}
