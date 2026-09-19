// The Eiffel Tower under siege: the same iron as ../eiffel_tower, on a wider field, and shootable.
//
// Everything expensive about this map -- the lattice, the machines, the triangle collision that
// makes the openings flyable -- is reused unchanged. What is new is that ten parts of the tower
// carry hit points, and that four baked collapses are waiting behind them. See
// EiffelTowerSiegeDestructibles.js for which part plays which fall and in which direction.
//
// Two numbers follow from that and nothing else. The wreck reaches 218.2 m, that is 130.9 authored
// units, from the tower axis (the shaft of 22_topple_shaft, measured on the exported clips), so
// the field is 310 x 310 instead of 200 x 200 (half of 310 is 155, which leaves 24 units of
// margin) and the load-failure ground has to grow with it -- a 200 unit floor under a 310 unit
// map would let a ship drop out of the world along the new edges.
//
// The map is not restricted to a mode: map eligibility is deliberately mode-agnostic in this
// project. The destructibility is what carries the restriction, so Classic and Arcade fly the same
// place as intact iron.

import { EIFFEL_TOWER_COMMON } from '../eiffel_tower/index.js';
import {
    GROUND,
    FIRST_DECK,
    SECOND_DECK,
    TOP_DECK,
    EIFFEL_TOWER_OBSTACLES,
    EIFFEL_TOWER_ARENA_GATES,
    EIFFEL_TOWER_ARENA_ITEMS,
} from '../eiffel_tower/EiffelTowerStructure.js';
import { EIFFEL_TOWER_SIEGE_MODELS } from './EiffelTowerSiegeModels.js';
import { EIFFEL_TOWER_SIEGE_DESTRUCTIBLES } from './EiffelTowerSiegeDestructibles.js';
import {
    EIFFEL_SIEGE_SECRET_ROOM,
    EIFFEL_SIEGE_SECRET_ROOM_OBSTACLES,
    EIFFEL_SIEGE_SECRET_ROOM_TURRETS,
} from './EiffelTowerSiegeSecretRoom.js';
import { EIFFEL_SIEGE_MAP_UNITS } from './EiffelTowerSiegeTanks.js';

/** Half the field, in authored units. The wreck of a toppled tower reaches 130.9 of them. */
export const EIFFEL_SIEGE_HALF_SIZE = 155;
export const EIFFEL_SIEGE_MAP_SIZE = [EIFFEL_SIEGE_HALF_SIZE * 2, 220, EIFFEL_SIEGE_HALF_SIZE * 2];

// The one authored surface that stays active with the GLBs loaded, grown from 200 to the full
// field. It is what keeps a ship that clips the ground scraping rather than falling through the
// world while the esplanade mesh is still streaming in.
const SIEGE_GROUND_OBSTACLE = {
    pos: [0, 4, 0],
    size: [EIFFEL_SIEGE_MAP_SIZE[0], 8, EIFFEL_SIEGE_MAP_SIZE[2]],
    kind: 'foam',
    compileWithGlb: true,
};

// The two landing platforms on the galleries are the one part of the route map's collision that
// cannot come along. They are `renderWithGlb`, so they are drawn as well as compiled - and unlike
// every other authored box here they do not describe iron that the GLBs already draw. Once the
// tower is lying on the esplanade they would be left standing in mid-air, visibly. The approach pad
// on the esplanade stays: the ground it sits on does not fall down.
const GALLERY_PLATFORM_HEIGHTS = [FIRST_DECK + 0.4, SECOND_DECK + 0.4];
const isGalleryPlatform = (obstacle) => obstacle?.renderWithGlb === true
    && GALLERY_PLATFORM_HEIGHTS.includes(obstacle.pos?.[1]);

const EIFFEL_TOWER_SIEGE_OBSTACLES = [
    SIEGE_GROUND_OBSTACLE,
    ...EIFFEL_TOWER_OBSTACLES.slice(1).filter((obstacle) => !isGalleryPlatform(obstacle)),
    // The shell of the vault below the esplanade. It stands outside the room's own bounds, so the
    // playable volume of the room stays free of it - see EiffelTowerSiegeSecretRoom.js.
    ...EIFFEL_SIEGE_SECRET_ROOM_OBSTACLES,
];

// Three rings of spawns, like the arena, but pushed off the structure. On this map the tower is
// the target rather than the arena furniture, so nobody starts inside the shaft: the low ring
// stands out on the esplanade well clear of the 37.5 unit leg square, the deck ring outside the
// first gallery's 21.9 unit edge, and the two high spawns beside the shaft instead of in it.
const LOW_SPREAD = 68;
const DECK_SPREAD = 44;
const HIGH_SPREAD = 26;

export const EIFFEL_TOWER_SIEGE_MAPS = {
    eiffel_tower_siege: {
        ...EIFFEL_TOWER_COMMON,
        name: 'Eiffelturm Belagerung',
        size: EIFFEL_SIEGE_MAP_SIZE,
        obstacles: EIFFEL_TOWER_SIEGE_OBSTACLES,
        // The route map's portals end inside the tower - on the summit platform, in the open middle
        // above the iris. Those are fine places to arrive at while the tower is standing and a way
        // to be dropped into falling scenery once it is not. A siege is fought by flying.
        portals: [],
        glbModels: EIFFEL_TOWER_SIEGE_MODELS,
        destructibles: EIFFEL_TOWER_SIEGE_DESTRUCTIBLES,
        // Breaking a part of the tower opens a portal at the former antenna tip four seconds later.
        // What it leads to, and its three guards, live in EiffelTowerSiegeSecretRoom.js.
        secretRooms: [EIFFEL_SIEGE_SECRET_ROOM],
        staticTurrets: EIFFEL_SIEGE_SECRET_ROOM_TURRETS,
        // A siege needs armour on the ground: two tanks circle the tower (EiffelTowerSiegeTanks.js).
        mapUnits: EIFFEL_SIEGE_MAP_UNITS,
        // The arena light: high and calm, so it never hides the lattice a fight is flown through -
        // and so the falling tower stays readable against the sky.
        lighting: {
            key: { direction: [40, 55, -30], color: 0xd8ecff, intensity: 1.32 },
            fill: { direction: [-35, 26, 30], color: 0xffc98c, intensity: 0.36 },
            rim: { direction: [15, 24, 50], color: 0x7fdcff, intensity: 0.6 },
            hemisphere: { skyColor: 0xa4c2de, groundColor: 0x4c4e54 },
            fog: {
                // Twice the arena profile's range, with the same near/far ratio and fog shape.
                color: 0x16243a, near: 160, far: 400,
                height: 11.3, heightFalloff: 0.033, turbulence: 0.09, skyBlend: 1,
                colorHigh: 0x16243a, colorLow: 0x16243a, clipClosureStart: 0.5,
            },
            skyDome: { zenithColor: 0x0a1930, horizonColor: 0x7d9cbb, nadirColor: 0x080c14 },
            starsVisible: false,
            exposureOffset: 0.04,
        },
        gates: EIFFEL_TOWER_ARENA_GATES,
        items: EIFFEL_TOWER_ARENA_ITEMS,
        // West of the tower, with the whole silhouette in view: this is the map where looking at
        // the building is the point.
        playerSpawn: { x: -96, y: GROUND + 26, z: 0 },
        botSpawns: [
            { x: LOW_SPREAD, y: GROUND + 20, z: LOW_SPREAD },
            { x: -LOW_SPREAD, y: GROUND + 20, z: -LOW_SPREAD },
            { x: DECK_SPREAD, y: FIRST_DECK + 8, z: -DECK_SPREAD },
            { x: -DECK_SPREAD, y: FIRST_DECK + 8, z: DECK_SPREAD },
            { x: HIGH_SPREAD, y: SECOND_DECK + 10, z: 0 },
            { x: -HIGH_SPREAD, y: TOP_DECK + 8, z: 0 },
        ],
        missions: [
            { type: 'NO_DAMAGE', params: {}, weight: 1.0 },
            { type: 'ITEM_CHAIN', params: { target: 5 }, weight: 1.2 },
        ],
        // Picking this map on its own starts the hunt, which is the only mode the tower can be
        // brought down in. Five bots against one player is enough traffic that the tower is still
        // being shot at while somebody is busy elsewhere.
        singlePlayerScenario: {
            enabled: true,
            id: 'eiffel_tower_siege',
            modePath: 'fight',
            gameMode: 'HUNT',
            minBots: 3,
            botCount: 5,
        },
    },
};
