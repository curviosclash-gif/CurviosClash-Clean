import { normalizeArcadeCombatProfile } from '../shared/contracts/EndlessParcoursContract.js';
import { isArenaWavesRunType, normalizeArenaWavesCombatProfile } from '../shared/contracts/ArenaWavesContract.js';
import { FIVE_PORTALS_COMBAT_PROFILE, isFivePortalsRunType } from '../shared/contracts/FivePortalsContract.js';

// A parcours sector on a map without authored respawns forgives three deaths at the last
// checkpoint; the fourth ends the run. Maps that author their own respawn keep it.
const ARCADE_PARCOURS_SECTOR_RULES = Object.freeze({ respawnOnDeath: true, lastCheckpointRespawns: 3, endRunWhenRespawnsExhausted: true });
// Fünf Portale never ends the run on deaths: the fourth death restarts the map attempt instead.
const FIVE_PORTALS_RESPAWN_RULES = Object.freeze({
    respawnOnDeath: true, lastCheckpointRespawns: 3, endRunWhenRespawnsExhausted: false, resetAttemptOnExhaustion: true,
});

export function resolveArcadeRunCombatProfile(runType, combatProfile) {
    if (isFivePortalsRunType(runType)) return FIVE_PORTALS_COMBAT_PROFILE;
    if (isArenaWavesRunType(runType)) return normalizeArenaWavesCombatProfile(combatProfile, runType);
    return normalizeArcadeCombatProfile(combatProfile, runType);
}

export function resolveArcadeParcoursRespawnFallback(runType, isSectorParcours) {
    if (isFivePortalsRunType(runType)) return FIVE_PORTALS_RESPAWN_RULES;
    return isSectorParcours ? ARCADE_PARCOURS_SECTOR_RULES : null;
}
