// ============================================
// Clockwork Canyon - Wüsten-Canyon mit Riesen-Uhrwerk
// Boden, Zahnräder, Uhrturm, Routen und Beute liegen in eigenen Modulen
// ============================================

import { CLOCKWORK_CANYON_APPEARANCE } from './ClockworkCanyonAppearance.js';
import { CLOCKWORK_CANYON_FLOOR_OBSTACLES } from './ClockworkCanyonFloor.js';
import { CLOCKWORK_CANYON_GEAR_OBSTACLES } from './ClockworkCanyonGears.js';
import { CLOCKWORK_CANYON_TOWER_OBSTACLES } from './ClockworkCanyonTower.js';
import { CLOCKWORK_CANYON_GATES, CLOCKWORK_CANYON_PORTALS } from './ClockworkCanyonRoutes.js';
import {
    CLOCKWORK_CANYON_AIRCRAFT,
    CLOCKWORK_CANYON_BOT_SPAWNS,
    CLOCKWORK_CANYON_EXIT_PORTAL,
    CLOCKWORK_CANYON_ITEMS,
    CLOCKWORK_CANYON_MISSIONS,
    CLOCKWORK_CANYON_PLAYER_SPAWN,
} from './ClockworkCanyonLoot.js';

export const CLOCKWORK_CANYON_MAPS = {
    clockwork_canyon: {
        name: 'Clockwork Canyon',
        size: [150, 70, 150],
        preferAuthoredPortals: true,
        portalLevels: [10, 25, 40],
        ...CLOCKWORK_CANYON_APPEARANCE,
        obstacles: [
            ...CLOCKWORK_CANYON_FLOOR_OBSTACLES,
            ...CLOCKWORK_CANYON_GEAR_OBSTACLES,
            ...CLOCKWORK_CANYON_TOWER_OBSTACLES,
        ],
        portals: CLOCKWORK_CANYON_PORTALS,
        gates: CLOCKWORK_CANYON_GATES,
        playerSpawn: CLOCKWORK_CANYON_PLAYER_SPAWN,
        botSpawns: CLOCKWORK_CANYON_BOT_SPAWNS,
        items: CLOCKWORK_CANYON_ITEMS,
        aircraft: CLOCKWORK_CANYON_AIRCRAFT,
        exitPortal: CLOCKWORK_CANYON_EXIT_PORTAL,
        missions: CLOCKWORK_CANYON_MISSIONS,
    },
};
