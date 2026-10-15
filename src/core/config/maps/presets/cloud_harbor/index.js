// Wolkenhafen: a sky city of floating islands above a sea of clouds, flown from the mooring dock
// through the cargo bay of a docked freight zeppelin, the rotor discs of two windmills, a split
// over the market isle, up the weather tower through its gyroscope rings and down the cable-car
// line under the anchor chains to the harbor gate. See scripts/cloud_harbor_layout.py for the
// shared course data and scripts/generate_cloud_harbor_assets.py for the fourteen GLB parts.

import { CLOUD_HARBOR_MODELS, CLOUD_HARBOR_BEAT_SECONDS } from './CloudHarborModels.js';
import {
    CloudHarborObstacles,
    CloudHarborItems,
    CloudHarborAircraft,
} from './CloudHarborStructure.js';
import {
    CLOUD_HARBOR_CHECKPOINTS,
    CLOUD_HARBOR_FINISH,
    CLOUD_HARBOR_PARCOURS_RULES,
} from './CloudHarborRoute.js';

// scripts/cloud_harbor_layout.py: ARENA_SIZE = (360.0, 180.0, 300.0).
const MAP_SIZE = [360, 180, 300];

export const CLOUD_HARBOR_MAPS = {
    cloud_harbor: {
        name: 'Wolkenhafen',
        description: 'Eine Himmelsstadt über dem Wolkenmeer: durch den Frachtraum eines '
            + 'Zeppelins, die Rotoren zweier Windmühlen, durch die Basargasse oder über die '
            + 'Dachgärten, hinauf um den Wetterturm durch seine Kreiselringe und entlang der '
            + 'Seilbahn zwischen den Ankerketten hindurch zum Hafentor.',
        size: MAP_SIZE,
        scaleAuthoredAnchors: true,
        // Every part is modelled in one shared map frame at scale 1 and recentred by the loader
        // onto its own bounding box, like the Orbital Shipyard; the openings a run flies through
        // (the cargo bay, the rotor discs, the harbor gate) are geometry a box cannot describe, so
        // collision has to come straight off the exported triangles.
        glbColliderMode: 'scene',
        glbAuthoredObstaclesCollisionOnly: true,
        glbLoadConcurrency: 3,
        glbAnimationClock: { beatSeconds: CLOUD_HARBOR_BEAT_SECONDS },
        glbModels: CLOUD_HARBOR_MODELS,
        obstacles: CloudHarborObstacles,
        items: CloudHarborItems,
        aircraft: CloudHarborAircraft,
        // A bright late-afternoon sky: a warm low sun, a cool blue fill from the open sky and a
        // pale hemisphere that keeps the island undersides from going black. The fog is in world
        // units (MAP_SCALE 3) and only hazes the far islands; the longest course leg is ~79
        // authored = ~240 world units, so the next ring stays visible past that.
        lighting: {
            key: { direction: [-40, 45, 30], color: 0xffe2b8, intensity: 1.35 },
            fill: { direction: [35, 20, -30], color: 0x8fb4e8, intensity: 0.42 },
            rim: { direction: [20, 30, -45], color: 0xffc58a, intensity: 0.35 },
            hemisphere: { skyColor: 0xa8c8f0, groundColor: 0xe8e4dc },
            fog: {
                color: 0xc4d6ec, near: 320, far: 900,
                height: 30, heightFalloff: 0.015, turbulence: 0.08, skyBlend: 1,
                colorHigh: 0xb0c8e8, colorLow: 0xeef2f6, clipClosureStart: 0.7,
            },
            skyDome: { zenithColor: 0x4f86c8, horizonColor: 0xd8e6f4, nadirColor: 0xf2f4f6 },
            starsVisible: false,
            exposureOffset: 0,
        },
        playerSpawn: { x: -152, y: 68, z: 100 },
        // Above the mooring dock's deck, spread across its width.
        botSpawns: [
            { x: -166, y: 64, z: 92 },
            { x: -160, y: 70, z: 108 },
            { x: -170, y: 72, z: 104 },
            { x: -158, y: 64, z: 94 },
        ],
        missions: [
            { type: 'TIME_TRIAL', params: { target: 120 }, weight: 1.8 },
            { type: 'NO_DAMAGE', params: {}, weight: 0.7 },
            { type: 'ITEM_CHAIN', params: { target: 6 }, weight: 0.8 },
        ],
        parcours: {
            enabled: true,
            routeId: 'cloud_harbor_v1',
            rules: CLOUD_HARBOR_PARCOURS_RULES,
            checkpoints: CLOUD_HARBOR_CHECKPOINTS,
            finish: CLOUD_HARBOR_FINISH,
        },
    },
};
