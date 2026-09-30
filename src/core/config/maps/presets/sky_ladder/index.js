import { SKY_LADDER_ABYSS_MAP } from './AbyssStage.js';
import { SKY_LADDER_FOUNDRY_MAP } from './FoundryStage.js';
import { SKY_LADDER_STORM_MAP } from './StormStage.js';
import { SKY_LADDER_STAR_MAP } from './StarStage.js';

// Himmelsleiter: four procedural parcours stages chained by exit portals,
// climbing from the deep sea to the stars.
export const SKY_LADDER_MAP_KEYS = Object.freeze([
    'sky_ladder_abyss',
    'sky_ladder_foundry',
    'sky_ladder_storm',
    'sky_ladder_star',
]);

export const SKY_LADDER_MAPS = {
    sky_ladder_abyss: SKY_LADDER_ABYSS_MAP,
    sky_ladder_foundry: SKY_LADDER_FOUNDRY_MAP,
    sky_ladder_storm: SKY_LADDER_STORM_MAP,
    sky_ladder_star: SKY_LADDER_STAR_MAP,
};
