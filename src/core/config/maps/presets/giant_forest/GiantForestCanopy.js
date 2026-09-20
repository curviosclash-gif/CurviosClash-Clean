import { CANOPY_DECK, FOREST_GROUND } from './GiantForestStructure.js';

// The two built parts of the forest, from scripts/generate_giant_forest_assets.py. Both are
// authored at true size and centred on the origin, so they are placed at scale 1 and the only
// number that matters is the height their underside sits at - which is what the loader stands a
// model on.

/** How deep the ground slab reaches below its surface, as the generator exports it. */
const FLOOR_MODEL_DEPTH = 6;

/** How thick the walkways are, so the surface a ship lands on is the deck plus its planks. */
export const CANOPY_WALK_THICKNESS = 3;

/**
 * The forest floor. Decoration: the map's collision floor is an authored box at the same height,
 * and a second, triangle-accurate ground would only add a few thousand colliders that answer the
 * same question. Its surface therefore sits exactly at the collision height - a millimetre above
 * would be a lip to catch on, a millimetre below a seam to see through.
 */
export const GIANT_FOREST_FLOOR = Object.freeze([
    Object.freeze({
        id: 'giant-forest-floor',
        url: 'assets/maps/giant_forest/glb/01_forest_floor.glb',
        position: Object.freeze([0, FOREST_GROUND - FLOOR_MODEL_DEPTH, 0]),
        scale: 1,
        collision: false,
    }),
]);

/**
 * The canopy storey: four decks around the middle of the map, joined into a ring by four
 * walkways. Solid, and deliberately the only solid horizontal surface up here - everything else a
 * player stands on in the canopy is a branch of an actual tree.
 *
 * The ring leaves the heart of the map open, so the central clearing stays a shaft from the
 * ground storey all the way out of the crowns.
 */
export const GIANT_FOREST_CANOPY = Object.freeze([
    Object.freeze({
        id: 'giant-forest-canopy-walks',
        url: 'assets/maps/giant_forest/glb/02_canopy_walks.glb',
        position: Object.freeze([0, CANOPY_DECK, 0]),
        scale: 1,
    }),
]);
