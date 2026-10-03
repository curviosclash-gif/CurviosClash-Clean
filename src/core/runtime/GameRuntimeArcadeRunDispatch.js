import { ARENA_WAVES_BOT_CAPACITY } from '../../shared/contracts/ArenaWavesContract.js';
import { resolveArcadeRuntimeKind, ARCADE_RUN_KINDS } from '../../shared/contracts/ArcadeRunTypeDispatchContract.js';
import { resolvePortalChain } from '../../shared/contracts/PortalChainContract.js';
import { WEAPON_RACE_BOT_COUNT, WEAPON_RACE_MAP_KEY } from '../../shared/contracts/WeaponRaceContract.js';
import { createDemolitionMapPlan } from '../../shared/contracts/DemolitionContract.js';

const UNHANDLED = Object.freeze({ handled: false, profile: null });

export function resolveDedicatedArcadeMatchStart(runtimeConfig, fivePortalsState = null, demolitionState = null) {
    const kind = resolveArcadeRuntimeKind(runtimeConfig);
    if (kind === ARCADE_RUN_KINDS.FIVE_PORTALS) {
        const state = fivePortalsState && typeof fivePortalsState === 'object' ? fivePortalsState : {};
        const mapIndex = state.phase === 'idle' || state.phase === 'finished' ? 0 : Math.max(0, Number(state.mapIndex) || 0);
        return Object.freeze({
            handled: true,
            profile: Object.freeze({
                mapKey: resolvePortalChain(runtimeConfig?.arcade?.portalChainId).maps[mapIndex],
                botCount: 0,
                fivePortals: true,
            }),
        });
    }
    if (kind === ARCADE_RUN_KINDS.ARENA_WAVES) {
        return Object.freeze({
            handled: true,
            profile: Object.freeze({ mapKey: 'notre_dame_arena', botCount: ARENA_WAVES_BOT_CAPACITY, arenaWaves: true }),
        });
    }
    if (kind === ARCADE_RUN_KINDS.WEAPON_RACE) {
        return Object.freeze({
            handled: true,
            profile: Object.freeze({ mapKey: WEAPON_RACE_MAP_KEY, botCount: WEAPON_RACE_BOT_COUNT, weaponRace: true }),
        });
    }
    if (kind === ARCADE_RUN_KINDS.ENDLESS_PARCOURS) {
        return Object.freeze({ handled: true, profile: null });
    }
    if (kind === ARCADE_RUN_KINDS.DEMOLITION) {
        const state = demolitionState && typeof demolitionState === 'object' ? demolitionState : {};
        const plan = createDemolitionMapPlan(runtimeConfig?.arcade?.seed);
        const mapIndex = state.phase === 'idle' || state.phase === 'finished'
            ? 0
            : Math.min(plan.maps.length - 1, Math.max(0, Number(state.mapIndex) || 0));
        const profile = plan.maps[mapIndex];
        return Object.freeze({
            handled: true,
            profile: Object.freeze({
                mapKey: profile.mapKey,
                botCount: profile.botCount,
                combatProfile: profile.combatProfile,
                demolition: true,
            }),
        });
    }
    return UNHANDLED;
}

export function shouldBindLocalArcadePlayerProfiles(runtimeConfig) {
    const sessionType = runtimeConfig?.session?.sessionType;
    const localSession = sessionType === 'single' || sessionType === 'splitscreen';
    return runtimeConfig?.arcade?.enabled === true
        && localSession
        && Number(runtimeConfig?.session?.numHumans) >= 1
        && Number(runtimeConfig?.session?.numHumans) <= 3
        && resolveArcadeRuntimeKind(runtimeConfig) !== ARCADE_RUN_KINDS.DEMOLITION;
}
