import { SKYSCRAPER_SITE_MODELS } from './SkyscraperSiteModels.js';
import { SKYSCRAPER_SITE_OBSTACLES, SKYSCRAPER_SITE_ITEMS } from './SkyscraperSiteStructure.js';
import {
    SKYSCRAPER_SITE_CHECKPOINTS, SKYSCRAPER_SITE_FINISH, SKYSCRAPER_SITE_PARCOURS_RULES,
} from './SkyscraperSiteRoute.js';

export const SKYSCRAPER_SITE_MAPS = {
    skyscraper_site: {
        name: 'Wolkenkratzer-Baustelle',
        description: 'Vom Straßencanyon über Gerüste und Stahlträger in den Aufzugsschacht: '
            + 'zwischen drehenden Kränen, Bauaufzug und pendelnden Lasten bis zum Dachfinale.',
        size: [360, 200, 300],
        portalCount: 0,
        scaleAuthoredAnchors: true,
        glbColliderMode: 'scene',
        glbAuthoredObstaclesCollisionOnly: true,
        glbLoadConcurrency: 3,
        glbAnimationClock: { beatSeconds: 2 },
        glbModels: SKYSCRAPER_SITE_MODELS,
        obstacles: SKYSCRAPER_SITE_OBSTACLES,
        items: SKYSCRAPER_SITE_ITEMS,
        lighting: {
            key: { direction: [-60, 35, 45], color: 0xffb46c, intensity: 1.6 },
            fill: { direction: [45, 40, -35], color: 0x8bafff, intensity: 0.48 },
            rim: { direction: [10, 50, -50], color: 0xffd6ad, intensity: 0.5 },
            hemisphere: { skyColor: 0x8494c0, groundColor: 0x3c3030 },
            fog: { color: 0xc18d80, near: 350, far: 1000,
                height: 20, heightFalloff: 0.008, turbulence: 0.04, skyBlend: 0.4,
                colorHigh: 0xc18d80, colorLow: 0x715965, clipClosureStart: 0.85 },
            skyDome: { zenithColor: 0x414c83, horizonColor: 0xe7a17a, nadirColor: 0x59494d },
            starsVisible: false,
            exposureOffset: 0,
        },
        playerSpawn: { x: -160, y: 15, z: 100 },
        botSpawns: [
            { x: -166, y: 15, z: 94 }, { x: -166, y: 15, z: 106 },
            { x: -154, y: 19, z: 94 }, { x: -154, y: 19, z: 106 },
        ],
        missions: [
            { type: 'TIME_TRIAL', params: { target: 94 }, weight: 1.8 },
            { type: 'NO_DAMAGE', params: {}, weight: 0.7 },
        ],
        parcours: {
            enabled: true,
            routeId: 'skyscraper_site_v1',
            rules: SKYSCRAPER_SITE_PARCOURS_RULES,
            checkpoints: SKYSCRAPER_SITE_CHECKPOINTS,
            finish: SKYSCRAPER_SITE_FINISH,
        },
    },
};
