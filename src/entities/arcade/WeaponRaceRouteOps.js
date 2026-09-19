import {
    WEAPON_RACE_FINISH_GRACE_SECONDS,
    WEAPON_RACE_GHOST_ROUTE_ID,
} from '../../shared/contracts/WeaponRaceContract.js';

export function createWeaponRaceRoute(route) {
    if (!route || typeof route !== 'object') return null;
    if (route.routeId === WEAPON_RACE_GHOST_ROUTE_ID) return route;
    return {
        ...route,
        routeId: WEAPON_RACE_GHOST_ROUTE_ID,
        rules: {
            ...(route.rules || {}),
            ordered: true,
            showGhost: true,
            winnerByParcoursComplete: true,
            wrongOrderPenaltyMs: 0,
            maxSegmentTimeMs: 0,
            finishGraceMs: WEAPON_RACE_FINISH_GRACE_SECONDS * 1000,
        },
    };
}
