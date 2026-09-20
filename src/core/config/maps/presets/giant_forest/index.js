// The giant forest: ten generated ancient trees planted eighty units apart, and a fog that
// decides which half of them is worth being in.
//
// The round has an arc without a single new rule. For the first hundred seconds the fog fills
// everything below the canopy deck: the ground is a blind place to be, and the fight happens up
// in the branches. Over the next forty seconds the band rises and turns inside out - from then on
// the fog sits above the deck instead, the canopy goes blind and the forest floor opens up. Both
// storeys are worth holding, in turn, and nobody has to be told when it changes: they can see it.
//
// The parts of the map, and where each one lives:
//   GiantForestStructure.js  the field, the clearings, spawns, pickups, the four updraughts
//   GiantForestTrees.js      the trees, each one a drawn crown plus an invisible collision body
//   GiantForestCanopy.js     the decks and bridges that make the branches a storey
//
// Collision: 'scene', so the exported triangles are the level. The crowns carry `collision:
// false` and are flyable; the collision bodies carry `collisionOnly: true` and are solid without
// being drawn; the canopy walks are plain models and are both.

import { GIANT_FOREST_CANOPY, GIANT_FOREST_FLOOR } from './GiantForestCanopy.js';
import { GIANT_FOREST_TREES, GIANT_FOREST_UNDERGROWTH } from './GiantForestTrees.js';
import {
    CANOPY_DECK,
    FOREST_BOT_SPAWNS,
    FOREST_GATES,
    FOREST_ITEMS,
    FOREST_MAP_SIZE,
    FOREST_OBSTACLES,
    FOREST_PLAYER_SPAWN,
} from './GiantForestStructure.js';

/**
 * The travelling fog, in the map's own units.
 *
 * Stage one holds for a hundred seconds: a lid at the canopy deck, no floor, so everything below
 * is fog. Stage three is the same band turned over: a floor at the deck, no lid. The forty
 * seconds between them are one interpolation, during which both edges are half established and
 * the fog is a band with clear air above and below - the moment the map is at its most readable,
 * and the moment to change storey.
 */
const GIANT_FOREST_FOG_LAYER = Object.freeze({
    stages: Object.freeze([
        Object.freeze({ atSeconds: 0, ceiling: CANOPY_DECK, ceilingFalloff: 0.05, floor: 0, floorFalloff: 0 }),
        Object.freeze({ atSeconds: 100, ceiling: CANOPY_DECK, ceilingFalloff: 0.05, floor: 0, floorFalloff: 0 }),
        // The ceiling is pushed past the top of the map rather than switched off alone, so the
        // band never snaps shut over the deck on its way out.
        Object.freeze({ atSeconds: 140, ceiling: 400, ceilingFalloff: 0, floor: CANOPY_DECK, floorFalloff: 0.05 }),
    ]),
});

export const GIANT_FOREST_MAPS = {
    giant_forest: {
        name: 'Riesenwald',
        size: FOREST_MAP_SIZE,
        obstacles: FOREST_OBSTACLES,
        // No portals: a portal mouth between the trunks would be unreadable in the fog, and the
        // four updraughts already answer the one question the map asks, which storey to be on.
        portals: [],
        gates: FOREST_GATES,
        playerSpawn: FOREST_PLAYER_SPAWN,
        botSpawns: FOREST_BOT_SPAWNS,
        itemSpawnMode: 'hybrid',
        items: FOREST_ITEMS,
        glbModels: [
            ...GIANT_FOREST_FLOOR,
            ...GIANT_FOREST_TREES,
            ...GIANT_FOREST_CANOPY,
            ...GIANT_FOREST_UNDERGROWTH,
        ],
        glbColliderMode: 'scene',
        glbLoadConcurrency: 4,
        fogLayer: GIANT_FOREST_FOG_LAYER,
        // Overcast light filtered through a closed canopy: a weak, cold key from high up, a green
        // bounce from the leaves, and a fog the colour of the air between the trunks. The distance
        // range is deliberately short - it is the fog that makes a forest of eighty-unit trees
        // affordable, and it is also what makes it a forest rather than a field of columns.
        lighting: {
            key: { direction: [25, 70, 15], color: 0xdfeccd, intensity: 1.05 },
            fill: { direction: [-30, 25, -30], color: 0x6f8f5a, intensity: 0.42 },
            rim: { direction: [-15, 35, 45], color: 0x9fc27a, intensity: 0.38 },
            hemisphere: { skyColor: 0x8ba173, groundColor: 0x2b301f },
            fog: {
                color: 0x5c6b4e,
                near: 70,
                far: 290,
                height: CANOPY_DECK,
                heightFalloff: 0.05,
                turbulence: 0.22,
                skyBlend: 1,
                colorHigh: 0x6a7a58,
                colorLow: 0x3a412c,
                clipClosureStart: 0.7,
            },
            skyDome: { zenithColor: 0x49563a, horizonColor: 0x8c9b72, nadirColor: 0x1b1f14 },
            starsVisible: false,
            exposureOffset: 0.05,
        },
    },
};
