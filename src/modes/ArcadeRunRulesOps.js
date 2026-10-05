import {
    ENDLESS_PARCOURS_COMBAT_PROFILE,
    normalizeArcadeCombatProfile,
    normalizeArcadeRunType,
} from '../shared/contracts/EndlessParcoursContract.js';
import { isArenaWavesRunType, normalizeArenaWavesCombatProfile } from '../shared/contracts/ArenaWavesContract.js';
import { FIVE_PORTALS_COMBAT_PROFILE, isFivePortalsRunType } from '../shared/contracts/FivePortalsContract.js';
import { WEAPON_RACE_RESPAWN_DELAY_SECONDS, isWeaponRaceRunType } from '../shared/contracts/WeaponRaceContract.js';
import { DEMOLITION_COMBAT_PROFILE, isDemolitionRunType } from '../shared/contracts/DemolitionContract.js';

// A parcours sector on a map without authored respawns forgives three deaths at the last
// checkpoint; the fourth ends the run. Maps that author their own respawn keep it.
const ARCADE_PARCOURS_SECTOR_RULES = Object.freeze({ respawnOnDeath: true, lastCheckpointRespawns: 3, endRunWhenRespawnsExhausted: true });
// Fünf Portale never ends the run on deaths: the fourth death restarts the map attempt instead.
const FIVE_PORTALS_RESPAWN_RULES = Object.freeze({
    respawnOnDeath: true, lastCheckpointRespawns: 3, endRunWhenRespawnsExhausted: false, resetAttemptOnExhaustion: true,
});
const WEAPON_RACE_RESPAWN_RULES = Object.freeze({
    respawnOnDeath: true,
    lastCheckpointRespawns: Number.MAX_SAFE_INTEGER,
    endRunWhenRespawnsExhausted: false,
    resetAttemptOnExhaustion: false,
    preserveProgressOnDeath: true,
    respawnDelaySeconds: WEAPON_RACE_RESPAWN_DELAY_SECONDS,
});

export function resolveArcadeRunCombatProfile(runType, combatProfile) {
    if (runType === 'hangar_test') return ENDLESS_PARCOURS_COMBAT_PROFILE;
    if (isDemolitionRunType(runType)) return DEMOLITION_COMBAT_PROFILE;
    if (isWeaponRaceRunType(runType)) return 'hunt';
    if (isFivePortalsRunType(runType)) return FIVE_PORTALS_COMBAT_PROFILE;
    if (isArenaWavesRunType(runType)) return normalizeArenaWavesCombatProfile(combatProfile, runType);
    // A scenario sector of a gauntlet run fights with hunt weapons; its runtime profile sets this.
    if (normalizeArcadeRunType(runType) === 'gauntlet' && combatProfile === ENDLESS_PARCOURS_COMBAT_PROFILE) return combatProfile;
    return normalizeArcadeCombatProfile(combatProfile, runType);
}

export function resolveArcadeParcoursRespawnFallback(runType, isSectorParcours) {
    if (isWeaponRaceRunType(runType)) return WEAPON_RACE_RESPAWN_RULES;
    if (isFivePortalsRunType(runType)) return FIVE_PORTALS_RESPAWN_RULES;
    return isSectorParcours ? ARCADE_PARCOURS_SECTOR_RULES : null;
}
