// The reactor site: a nuclear plant in an exclusion zone, and the second map a match can take
// apart. Two cooling towers keel over onto their sides, the discharge stack topples along the
// shot, the turbine hall folds outwards around its machinery, and the containment, once
// breached, sends up a mushroom cloud and ends the demolition.
//
// The plant is built from measurements in one Blender coordinate system (see
// scripts/generate_reactor_site_assets.py) and placed at 0.6 authored units per metre, exactly
// as the Eiffel Tower is. ReactorSiteDestructibles.js carries the break plan; ReactorSiteModels.js
// places the parts and the scenes on top of each other.
//
// The map is not restricted to a mode: map eligibility is deliberately mode-agnostic in this
// project. The destructibility is what carries the restriction, so Classic and Arcade fly the
// same place as intact concrete.

import { REACTOR_SITE_MODELS } from './ReactorSiteModels.js';
import { REACTOR_SITE_DESTRUCTIBLES } from './ReactorSiteDestructibles.js';
import {
    REACTOR_SITE_SECRET_ROOM,
    REACTOR_SITE_SECRET_ROOM_OBSTACLES,
    REACTOR_SITE_SECRET_ROOM_TURRETS,
} from './ReactorSiteSecretRoom.js';
import {
    GROUND,
    up,
    across,
    REACTOR_MAP_SIZE,
    REACTOR_SITE_OBSTACLES,
    REACTOR_SITE_GATES,
    REACTOR_SITE_ITEMS,
    TOWER_X,
    HALL_Z,
    STACK_X,
    STACK_Z,
    SWITCHYARD_Z,
} from './ReactorSiteStructure.js';

export const REACTOR_SITE_MAPS = {
    reactor_site: {
        name: 'Reaktor Sperrzone',
        size: REACTOR_MAP_SIZE,
        exclusionZone: { openFaces: ['minX', 'maxX', 'minZ', 'maxZ', 'maxY'] },
        // The destructible segments are anchored in authored units and the map is built at the
        // runtime scale, so the anchors a hit is measured against have to grow with it.
        scaleAuthoredAnchors: true,
        obstacles: [
            ...REACTOR_SITE_OBSTACLES,
            // The shell of the bunker below the site. It stands outside the room's own bounds, so
            // the playable volume of the room stays free of it - see ReactorSiteSecretRoom.js.
            ...REACTOR_SITE_SECRET_ROOM_OBSTACLES,
        ],
        // No portals: every one of them would end somewhere a collapse can take away.
        portals: [],
        // Breaking any part of the plant opens a portal north of the containment four seconds
        // later. What it leads to, and the three emplacements guarding it, live in
        // ReactorSiteSecretRoom.js.
        secretRooms: [REACTOR_SITE_SECRET_ROOM],
        staticTurrets: REACTOR_SITE_SECRET_ROOM_TURRETS,
        gates: REACTOR_SITE_GATES,
        // Prefer the authored plant routes, but keep random fallback available once every
        // authored anchor is occupied. Without this explicit contract the runtime may ignore
        // the placements below and scatter pickups across the field instead.
        itemSpawnMode: 'hybrid',
        items: REACTOR_SITE_ITEMS,
        glbModels: REACTOR_SITE_MODELS,
        // Triangle/BVH collision off the exported concrete: the gap under the towers, the doors
        // of the hall and the open tops are the level, and no authored box can describe them.
        glbColliderMode: 'scene',
        // The authored boxes describe collision the GLBs already draw; they only compile when a
        // GLB fails to load, and are never drawn beside it.
        glbAuthoredObstaclesCollisionOnly: true,
        glbLoadConcurrency: 3,
        destructibles: REACTOR_SITE_DESTRUCTIBLES,
        // An overcast, slightly sick-green day over the zone: flat light so the concrete reads as
        // volume, a cold horizon, and the fog pushed out as far as the tallest structures need.
        lighting: {
            key: { direction: [35, 60, 25], color: 0xe8f0e4, intensity: 1.2 },
            fill: { direction: [-30, 28, -35], color: 0x9ab5b0, intensity: 0.42 },
            rim: { direction: [-10, 20, 55], color: 0xc9e2a8, intensity: 0.5 },
            hemisphere: { skyColor: 0xb7c6c0, groundColor: 0x4a4f48 },
            fog: {
                // Horizontal map coordinates are multiplied by the runtime world scale, while
                // fog distances are already world units. Keep the plant legible from the
                // south-west spawn instead of closing the fog before the player can see it.
                color: 0x27302c, near: 240, far: 600,
                height: 12, heightFalloff: 0.03, turbulence: 0.1, skyBlend: 1,
                colorHigh: 0x27302c, colorLow: 0x27302c, clipClosureStart: 0.5,
            },
            skyDome: { zenithColor: 0x3c4a52, horizonColor: 0xa9b8ae, nadirColor: 0x121614 },
            starsVisible: false,
            exposureOffset: 0.02,
        },
        // South-west of the plant, high enough to see all of it: this is the map where looking
        // at the buildings is the point.
        playerSpawn: { x: -110, y: up(40), z: -110 },
        botSpawns: [
            { x: 110, y: up(36), z: -110 },
            { x: -110, y: up(36), z: 110 },
            { x: 110, y: up(44), z: 110 },
            { x: 0, y: up(90), z: SWITCHYARD_Z + 40 },
            { x: -TOWER_X, y: up(118), z: 0 },
            { x: STACK_X + across(30), y: up(100), z: STACK_Z },
            { x: 0, y: up(60), z: HALL_Z - across(70) },
        ],
        missions: [
            { type: 'NO_DAMAGE', params: {}, weight: 1.0 },
            { type: 'ITEM_CHAIN', params: { target: 5 }, weight: 1.2 },
        ],
        // Picking this map on its own starts the hunt, which is the only mode the plant can be
        // brought down in. Six bots keep the site under fire while the player works on one thing.
        singlePlayerScenario: {
            enabled: true,
            id: 'reactor_site',
            modePath: 'fight',
            gameMode: 'HUNT',
            minBots: 3,
            botCount: 6,
        },
    },
};

export { GROUND };
