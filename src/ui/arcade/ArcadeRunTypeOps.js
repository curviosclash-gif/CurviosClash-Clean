import { ARENA_WAVES_RUN_TYPE } from '../../shared/contracts/ArenaWavesContract.js';
import { FIVE_PORTALS_RUN_TYPE } from '../../shared/contracts/FivePortalsContract.js';
import { WEAPON_RACE_RUN_TYPE } from '../../shared/contracts/WeaponRaceContract.js';

// Runs that only their own menu button starts. Their run type stays in the saved settings after the
// run, so the generic start button would otherwise replay them (Fünf Portale even forces its first
// map) instead of the map the player picked. Endless parcours stays: a fixed preset selects it.
const BUTTON_ONLY_RUN_TYPES = new Set([FIVE_PORTALS_RUN_TYPE, ARENA_WAVES_RUN_TYPE, WEAPON_RACE_RUN_TYPE]);

export function releaseButtonOnlyArcadeRun(settings) {
    const arcade = settings?.arcade;
    if (!arcade || !BUTTON_ONLY_RUN_TYPES.has(String(arcade.runType || '').trim().toLowerCase())) return false;
    arcade.runType = 'gauntlet';
    arcade.combatProfile = '';
    return true;
}
