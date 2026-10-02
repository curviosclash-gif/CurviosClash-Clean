import { isArenaWavesConfig, isArenaWavesRunType } from './ArenaWavesContract.js';
import { createDemolitionMapPlan, isDemolitionConfig, isDemolitionRunType } from './DemolitionContract.js';
import { isEndlessParcoursConfig, normalizeArcadeRunType } from './EndlessParcoursContract.js';
import { isFivePortalsConfig, isFivePortalsRunType, resolvePortalChain } from './PortalChainContract.js';
import { isWeaponRaceConfig, isWeaponRaceRunType } from './WeaponRaceContract.js';

export const ARCADE_RUN_KINDS = Object.freeze({
    GAUNTLET: 'gauntlet',
    ENDLESS_PARCOURS: 'endless_parcours',
    FIVE_PORTALS: 'five_portals',
    ARENA_WAVES: 'arena_waves',
    WEAPON_RACE: 'weapon_race',
    DEMOLITION: 'demolition',
});

export function resolveArcadeRunKind(value) {
    const runType = typeof value === 'string' ? value : value?.arcade?.runType;
    if (isDemolitionRunType(runType)) return ARCADE_RUN_KINDS.DEMOLITION;
    if (isFivePortalsRunType(runType)) return ARCADE_RUN_KINDS.FIVE_PORTALS;
    if (isArenaWavesRunType(runType)) return ARCADE_RUN_KINDS.ARENA_WAVES;
    if (isWeaponRaceRunType(runType)) return ARCADE_RUN_KINDS.WEAPON_RACE;
    if (normalizeArcadeRunType(runType) === ARCADE_RUN_KINDS.ENDLESS_PARCOURS) return ARCADE_RUN_KINDS.ENDLESS_PARCOURS;
    return ARCADE_RUN_KINDS.GAUNTLET;
}

export function resolveArcadeRuntimeKind(runtimeConfig) {
    if (isDemolitionConfig(runtimeConfig)) return ARCADE_RUN_KINDS.DEMOLITION;
    if (isFivePortalsConfig(runtimeConfig)) return ARCADE_RUN_KINDS.FIVE_PORTALS;
    if (isArenaWavesConfig(runtimeConfig)) return ARCADE_RUN_KINDS.ARENA_WAVES;
    if (isWeaponRaceConfig(runtimeConfig)) return ARCADE_RUN_KINDS.WEAPON_RACE;
    if (isEndlessParcoursConfig(runtimeConfig)) return ARCADE_RUN_KINDS.ENDLESS_PARCOURS;
    return ARCADE_RUN_KINDS.GAUNTLET;
}

export function resolveArcadeInitialMapKey({ arcadeEnabled = false, arcade = null, fallbackMapKey = 'standard' } = {}) {
    if (!arcadeEnabled) return String(fallbackMapKey || 'standard');
    const kind = resolveArcadeRunKind(arcade?.runType);
    if (kind === ARCADE_RUN_KINDS.FIVE_PORTALS) return resolvePortalChain(arcade?.portalChainId).maps[0];
    if (kind === ARCADE_RUN_KINDS.DEMOLITION) return createDemolitionMapPlan(arcade?.seed).mapKeys[0];
    return String(fallbackMapKey || 'standard');
}
