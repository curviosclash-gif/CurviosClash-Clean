// Orbitalwerft: a half-built capital ship in a floating drydock, flown from the launch bay through
// the scaffold yard, the rib cage of the hull, a timed airlock split, up the drydock tower's helix
// and rotor, and down into the fuel canyon to the finish dock. See
// scripts/orbital_shipyard_layout.py for the shared course data and
// scripts/generate_orbital_shipyard_assets.py for the thirteen GLB parts.

import { ORBITAL_SHIPYARD_MODELS, ORBITAL_SHIPYARD_BEAT_SECONDS } from './OrbitalShipyardModels.js';
import {
    OrbitalShipyardObstacles,
    OrbitalShipyardItems,
    OrbitalShipyardAircraft,
} from './OrbitalShipyardStructure.js';
import {
    ORBITAL_SHIPYARD_CHECKPOINTS,
    ORBITAL_SHIPYARD_FINISH,
    ORBITAL_SHIPYARD_PARCOURS_RULES,
} from './OrbitalShipyardRoute.js';

// scripts/orbital_shipyard_layout.py: ARENA_SIZE = (360.0, 170.0, 300.0).
const MAP_SIZE = [360, 170, 300];

export const ORBITAL_SHIPYARD_MAPS = {
    orbital_shipyard: {
        name: 'Orbitalwerft',
        description: 'Ein halbfertiges Kapitalschiff im Trockendock: durch die Startbucht, das '
            + 'Gerüst unter einem schwenkenden Kran, den Rippenkäfig des Rumpfs, eine getaktete '
            + 'Schleuse oder den Wartungsschacht darüber, die Helix des Dockturms durch den Rotor '
            + 'und im Sturzflug durch den Treibstoffcanyon zum Zieldock.',
        size: MAP_SIZE,
        scaleAuthoredAnchors: true,
        // Every part is modelled in one shared map frame at scale 1 and recentred by the loader
        // onto its own bounding box, exactly like the Eiffel Tower and Notre-Dame; the openings a
        // run flies through (the rib cage, the airlock, the rotor) are geometry a box cannot
        // describe, so collision has to come straight off the exported triangles.
        glbColliderMode: 'scene',
        glbAuthoredObstaclesCollisionOnly: true,
        glbLoadConcurrency: 3,
        glbAnimationClock: { beatSeconds: ORBITAL_SHIPYARD_BEAT_SECONDS },
        glbModels: ORBITAL_SHIPYARD_MODELS,
        obstacles: OrbitalShipyardObstacles,
        items: OrbitalShipyardItems,
        aircraft: OrbitalShipyardAircraft,
        // A dark space scene: a hard white-blue key light standing in for the sun, a cool dim fill
        // so the shadow side never goes fully black, and a near-black hemisphere. The fog only
        // softens the far side of the station: it is in world units (MAP_SCALE 3), and the longest
        // course leg is ~90 authored = ~270 world units, so the next ring must stay visible past that.
        lighting: {
            key: { direction: [35, 60, -25], color: 0xdbe8ff, intensity: 1.6 },
            fill: { direction: [-40, 15, 35], color: 0x33407a, intensity: 0.28 },
            rim: { direction: [-15, 25, -45], color: 0x6fa8ff, intensity: 0.45 },
            hemisphere: { skyColor: 0x0c1430, groundColor: 0x05060c },
            fog: {
                color: 0x03040a, near: 280, far: 700,
                height: 20, heightFalloff: 0.02, turbulence: 0.05, skyBlend: 1,
                colorHigh: 0x03040a, colorLow: 0x03040a, clipClosureStart: 0.7,
            },
            skyDome: { zenithColor: 0x01020a, horizonColor: 0x0a1226, nadirColor: 0x000000 },
            starsVisible: true,
            exposureOffset: -0.05,
        },
        playerSpawn: { x: -150, y: 40, z: 110 },
        // Inside the launch bay, spread across the bounds the crew deck occupies.
        botSpawns: [
            { x: -165, y: 36, z: 104 },
            { x: -140, y: 44, z: 116 },
            { x: -162, y: 42, z: 114 },
            { x: -143, y: 38, z: 106 },
        ],
        missions: [
            { type: 'TIME_TRIAL', params: { target: 150 }, weight: 1.8 },
            { type: 'NO_DAMAGE', params: {}, weight: 0.7 },
            { type: 'ITEM_CHAIN', params: { target: 6 }, weight: 0.8 },
        ],
        parcours: {
            enabled: true,
            routeId: 'orbital_shipyard_v1',
            rules: ORBITAL_SHIPYARD_PARCOURS_RULES,
            checkpoints: ORBITAL_SHIPYARD_CHECKPOINTS,
            finish: ORBITAL_SHIPYARD_FINISH,
        },
    },
};
