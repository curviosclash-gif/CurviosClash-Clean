import { STANDARD_MAPS } from './presets/standard.js';
import { ARENA_MAPS } from './presets/arena_maps.js';
import { THEMED_MAPS } from './presets/themed_maps.js';
import { SHOWCASE_MAPS } from './presets/showcase_maps.js';
import { PARCOURS_MAPS } from './presets/parcours_maps.js';
import { PARCOURS_PACK_V130_MAPS } from './presets/parcours_pack_v130.js';
import { EXPERT_MAPS } from './presets/expert_maps.js';
import { NEON_ABYSS_MAP } from './presets/neon_abyss.js';
import { CRYSTAL_RUINS_MAP } from './presets/crystal_ruins.js';
import { VULKAN_ODYSSEY_MAP } from './presets/vulkan_odyssey.js';
import { FROZEN_HELIX_MAP } from './presets/frozen_helix.js';
import { NEON_CIRCUIT_MAP } from './presets/neon_circuit.js';
import { SKY_ISLANDS_MAP } from './presets/sky_islands.js';
import { ABYSSAL_DESCENT_MAP } from './presets/abyssal_descent.js';
import { MAGMA_MAZE_MAP } from './presets/magma_maze.js';

export const MAP_PRESET_CATALOG = {
    ...(STANDARD_MAPS || {}),
    ...(ARENA_MAPS || {}),
    ...(THEMED_MAPS || {}),
    ...(SHOWCASE_MAPS || {}),
    ...(PARCOURS_MAPS || {}),
    ...(PARCOURS_PACK_V130_MAPS || {}),
    ...(EXPERT_MAPS || {}),
    ...(NEON_ABYSS_MAP || {}),
    ...(CRYSTAL_RUINS_MAP || {}),
    ...(VULKAN_ODYSSEY_MAP || {}),
    ...(FROZEN_HELIX_MAP || {}),
    ...(NEON_CIRCUIT_MAP || {}),
    ...(SKY_ISLANDS_MAP || {}),
    ...(ABYSSAL_DESCENT_MAP || {}),
    ...(MAGMA_MAZE_MAP || {}),
};
