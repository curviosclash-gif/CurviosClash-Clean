import { STANDARD_MAPS } from './presets/standard.js';
import { ARENA_MAPS } from './presets/arena_maps.js';
import { THEMED_MAPS } from './presets/themed_maps.js';
import { SHOWCASE_MAPS } from './presets/showcase_maps.js';
import { PARCOURS_MAPS } from './presets/parcours_maps.js';
import { PARCOURS_PACK_V130_MAPS } from './presets/parcours_pack_v130.js';
import { EXPERT_MAPS } from './presets/expert_maps.js';
import { GLB_GALLERY_MAPS } from './presets/glb_gallery.js';
import { GLB_ADVENTURE_MAPS } from './presets/glb_adventure_maps.js';
import { NEON_ABYSS_MAP } from './presets/neon_abyss.js';
import { CRYSTAL_RUINS_MAP } from './presets/crystal_ruins.js';
import { VULKAN_ODYSSEY_MAP } from './presets/vulkan_odyssey.js';
import { FROZEN_HELIX_MAP } from './presets/frozen_helix.js';
import { NEON_CIRCUIT_MAP } from './presets/neon_circuit.js';
import { SKY_ISLANDS_MAP } from './presets/sky_islands.js';
import { ABYSSAL_DESCENT_MAP } from './presets/abyssal_descent.js';
import { MAGMA_MAZE_MAP } from './presets/magma_maze.js';
import { CHRONO_FORGE_NEXUS_MAP } from './presets/chrono_forge_nexus.js';
import { ECLIPSE_FOUNDRY_MAP } from './presets/eclipse_foundry.js';
import { KINETIC_TIDE_MAP } from './presets/kinetic_tide.js';
import { VERDANT_APERTURE_MAP } from './presets/verdant_aperture.js';
import { AETHERION_ORRERY_MAP } from './presets/aetherion_orrery.js';
import { NOTRE_DAME_MAPS } from './presets/notre_dame/index.js';
import { NOTRE_DAME_FIRE_MAPS } from './presets/notre_dame_fire/index.js';
import { EIFFEL_TOWER_MAPS } from './presets/eiffel_tower/index.js';
import { EIFFEL_TOWER_SIEGE_MAPS } from './presets/eiffel_tower_siege/index.js';
import { REACTOR_SITE_MAPS } from './presets/reactor_site/index.js';
import { FALKENWACHT_MAPS } from './presets/burg_falkenwacht/index.js';

export const MAP_PRESET_CATALOG = {
    ...(STANDARD_MAPS || {}),
    ...(ARENA_MAPS || {}),
    ...(THEMED_MAPS || {}),
    ...(SHOWCASE_MAPS || {}),
    ...(PARCOURS_MAPS || {}),
    ...(PARCOURS_PACK_V130_MAPS || {}),
    ...(EXPERT_MAPS || {}),
    ...(GLB_GALLERY_MAPS || {}),
    ...(GLB_ADVENTURE_MAPS || {}),
    ...(NEON_ABYSS_MAP || {}),
    ...(CRYSTAL_RUINS_MAP || {}),
    ...(VULKAN_ODYSSEY_MAP || {}),
    ...(FROZEN_HELIX_MAP || {}),
    ...(NEON_CIRCUIT_MAP || {}),
    ...(SKY_ISLANDS_MAP || {}),
    ...(ABYSSAL_DESCENT_MAP || {}),
    ...(MAGMA_MAZE_MAP || {}),
    ...(CHRONO_FORGE_NEXUS_MAP || {}),
    ...(ECLIPSE_FOUNDRY_MAP || {}),
    ...(KINETIC_TIDE_MAP || {}),
    ...(VERDANT_APERTURE_MAP || {}),
    ...(AETHERION_ORRERY_MAP || {}),
    ...(NOTRE_DAME_MAPS || {}),
    ...(NOTRE_DAME_FIRE_MAPS || {}),
    ...(EIFFEL_TOWER_MAPS || {}),
    ...(EIFFEL_TOWER_SIEGE_MAPS || {}),
    ...(REACTOR_SITE_MAPS || {}),
    ...FALKENWACHT_MAPS,
};
