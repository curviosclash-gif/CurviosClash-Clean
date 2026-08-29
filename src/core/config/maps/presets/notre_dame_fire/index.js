// Notre-Dame on the night of 15 April 2019: the roof timbers alight, the spire down through the
// vault, three breaches open into the nave. The same building as ../notre_dame, at the same scale
// and in the same coordinate system -- what differs is its condition and its light.
//
// This first step deliberately changes only the light and the name. Fabric, collision and route
// are still the restoration map's, shared by reference rather than copied: the geometry is what
// this map costs, and a second copy of it would double the load for nothing. The burnt roof, the
// vault breaches and the fire itself replace those shared pieces one at a time, and each swap is
// then visibly a swap rather than a whole new map appearing at once.
//
// The light is the exception, and it is copied on purpose. See NotreDameFireLighting.js.

import { NOTRE_DAME_COMMON } from '../notre_dame/index.js';
import {
    GROUND,
    NOTRE_DAME_ARENA_GATES,
    NOTRE_DAME_ARENA_ITEMS,
} from '../notre_dame/NotreDameStructure.js';
import {
    NOTRE_DAME_CHECKPOINTS,
    NOTRE_DAME_FINISH,
    NOTRE_DAME_PARCOURS_RULES,
} from '../notre_dame/NotreDameRoute.js';
import {
    NOTRE_DAME_FIRE_LIGHTING,
    NOTRE_DAME_FIRE_ARENA_LIGHTING,
    NOTRE_DAME_FIRE_LIGHTS,
} from './NotreDameFireLighting.js';

const NOTRE_DAME_FIRE_COMMON = {
    ...NOTRE_DAME_COMMON,
    lights: NOTRE_DAME_FIRE_LIGHTS,
};

export const NOTRE_DAME_FIRE_MAPS = {
    notre_dame_fire: {
        ...NOTRE_DAME_FIRE_COMMON,
        name: 'Notre-Dame Brand',
        lighting: NOTRE_DAME_FIRE_LIGHTING,
        // Approached up the river from the west, as on the restoration map. The spawns are
        // repeated rather than shared because the burning building is entered differently once
        // the breaches are open, and this is the line that will move then.
        playerSpawn: { x: -210, y: GROUND + 14, z: 0 },
        botSpawns: [
            { x: -210, y: GROUND + 14, z: -13 },
            { x: -210, y: GROUND + 14, z: 13 },
            { x: -198, y: GROUND + 14, z: -20 },
            { x: -198, y: GROUND + 14, z: 20 },
        ],
        missions: [
            { type: 'TIME_TRIAL', params: { target: 270 }, weight: 1.8 },
            { type: 'NO_DAMAGE', params: {}, weight: 0.7 },
            { type: 'ITEM_CHAIN', params: { target: 6 }, weight: 0.8 },
        ],
        parcours: {
            enabled: true,
            // Its own route identity from the start. The stages are still the restoration map's,
            // but they stop being the same course the moment the vault opens, and a shared id
            // would silently rank runs through two different buildings against each other.
            routeId: 'notre_dame_fire_v1',
            rules: NOTRE_DAME_PARCOURS_RULES,
            checkpoints: NOTRE_DAME_CHECKPOINTS,
            finish: NOTRE_DAME_FINISH,
        },
    },

    notre_dame_fire_arena: {
        ...NOTRE_DAME_FIRE_COMMON,
        name: 'Notre-Dame Brand Arena',
        lighting: NOTRE_DAME_FIRE_ARENA_LIGHTING,
        gates: NOTRE_DAME_ARENA_GATES,
        items: NOTRE_DAME_ARENA_ITEMS,
        playerSpawn: { x: -112, y: GROUND + 16, z: 0 },
        botSpawns: [
            { x: -112, y: GROUND + 16, z: -24 },
            { x: -112, y: GROUND + 16, z: 24 },
            { x: 17, y: GROUND + 30, z: -52 },
            { x: 17, y: GROUND + 30, z: 52 },
            { x: 110, y: GROUND + 14, z: 0 },
            { x: -40, y: GROUND + 28, z: 0 },
        ],
        missions: [
            { type: 'NO_DAMAGE', params: {}, weight: 1.0 },
            { type: 'ITEM_CHAIN', params: { target: 5 }, weight: 1.2 },
        ],
    },
};
