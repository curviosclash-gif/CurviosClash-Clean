// ============================================
// MapPresetCatalogExpertData.js - Experten-Map-Presets
// ============================================

import { MAP_PRESET_CATALOG_LARGE_DATA } from './MapPresetCatalogLarge.js';

export const MAP_PRESET_CATALOG_EXPERT_DATA = {
    expert_gauntlet: {
        ...MAP_PRESET_CATALOG_LARGE_DATA.die_festung,
        name: 'Expert Gauntlet',
    },
    mega_maze: {
        name: 'Mega-Labyrinth',
        size: [100, 35, 100],
        obstacles: [
            { pos: [-40, 12, -30], size: [20, 24, 3], tunnel: { radius: 4.0, axis: 'z' } },
            { pos: [0, 23, -30], size: [20, 24, 3], tunnel: { radius: 3.8, axis: 'z' } },
            { pos: [40, 12, -30], size: [20, 24, 3] },
            { pos: [-20, 23, -10], size: [20, 24, 3] },
            { pos: [20, 12, -10], size: [20, 24, 3], tunnel: { radius: 4.2, axis: 'z' } },
            { pos: [-40, 12, 10], size: [20, 24, 3] },
            { pos: [0, 23, 10], size: [20, 24, 3], tunnel: { radius: 3.6, axis: 'z' } },
            { pos: [20, 12, 10], size: [20, 24, 3] },
            { pos: [-20, 23, 30], size: [20, 24, 3], tunnel: { radius: 4.0, axis: 'z' } },
            { pos: [0, 12, 30], size: [20, 24, 3] },
            { pos: [-30, 23, -40], size: [3, 24, 20] },
            { pos: [-30, 12, 0], size: [3, 24, 20], tunnel: { radius: 4.2, axis: 'x' } },
            { pos: [-30, 23, 20], size: [3, 24, 20] },
            { pos: [-10, 12, -20], size: [3, 24, 20] },
            { pos: [-10, 23, 20], size: [3, 24, 20], tunnel: { radius: 3.8, axis: 'x' } },
            { pos: [-10, 12, 40], size: [3, 24, 20] },
            { pos: [10, 23, -40], size: [3, 24, 20] },
            { pos: [10, 12, 0], size: [3, 24, 20] },
            { pos: [30, 12, -20], size: [3, 24, 20] },
            { pos: [30, 23, 0], size: [3, 24, 20], tunnel: { radius: 4.0, axis: 'x' } },
            { pos: [30, 12, 30], size: [3, 24, 20] },
            { pos: [-45, 17.5, -45], size: [3, 35, 3] },
            { pos: [45, 17.5, -45], size: [3, 35, 3] },
            { pos: [-45, 17.5, 45], size: [3, 35, 3] },
            { pos: [45, 17.5, 45], size: [3, 35, 3] },
        ],
        portals: [
            { a: [-40, 5, -40], b: [40, 30, 40], color: 0x00ffcc },
            { a: [40, 5, -40], b: [-40, 30, 40], color: 0xff66ff },
            { a: [-40, 30, 0], b: [40, 5, 0], color: 0xffaa00 },
            { a: [0, 5, -40], b: [0, 30, 40], color: 0x44ff88 },
        ]
    },
    ...MAP_PRESET_CATALOG_LARGE_DATA,
};
