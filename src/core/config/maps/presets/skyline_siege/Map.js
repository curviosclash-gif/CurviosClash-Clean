import { normalizeMapLighting } from '../../../../../shared/contracts/MapLightingContract.js';

export const SKYLINE_SIEGE_DESTRUCTIBLES = Object.freeze({
    gameModes: Object.freeze(['HUNT']),
    segments: Object.freeze([
        Object.freeze({ id: 'spire', label: 'Spire Tower', kind: 'masonry', piece: 'spire_tower', hp: 420,
            meshPrefixes: Object.freeze(['skyline_spire']), anchor: Object.freeze([-32, 58, 0]) }),
        Object.freeze({ id: 'crown', label: 'Crown Tower', kind: 'masonry', piece: 'crown_tower', hp: 480,
            meshPrefixes: Object.freeze(['skyline_crown']), anchor: Object.freeze([0, 52, 0]) }),
        Object.freeze({ id: 'arcology', label: 'Arcology', kind: 'masonry', piece: 'arcology_tower', hp: 520,
            meshPrefixes: Object.freeze(['skyline_arcology']), anchor: Object.freeze([32, 47, 0]) }),
    ]),
    pieces: Object.freeze(['spire_tower', 'crown_tower', 'arcology_tower']),
    breakScenes: Object.freeze([
        Object.freeze({ id: 'fall_spire', trigger: Object.freeze({ segmentId: 'spire' }),
            modelId: 'skyline-spire-collapse', pieces: Object.freeze(['spire_tower']),
            hideModelIds: Object.freeze(['skyline-spire-intact']), yawFromEvent: false,
            blast: Object.freeze({ radius: 18, damage: 35, delaySeconds: 2.2 }) }),
        Object.freeze({ id: 'fall_crown', trigger: Object.freeze({ segmentId: 'crown' }),
            modelId: 'skyline-crown-collapse', pieces: Object.freeze(['crown_tower']),
            hideModelIds: Object.freeze(['skyline-crown-intact']), yawFromEvent: false,
            blast: Object.freeze({ radius: 20, damage: 35, delaySeconds: 2.2 }) }),
        Object.freeze({ id: 'fall_arcology', trigger: Object.freeze({ segmentId: 'arcology' }),
            modelId: 'skyline-arcology-collapse', pieces: Object.freeze(['arcology_tower']),
            hideModelIds: Object.freeze(['skyline-arcology-intact']), yawFromEvent: false,
            blast: Object.freeze({ radius: 22, damage: 35, delaySeconds: 2.2 }) }),
    ]),
});

const SKYLINE_MODELS = Object.freeze([
    ['spire', 'Spire', -32, 0, 58, 0.2],
    ['crown', 'Crown', 0, 18, 52, 0.2],
    ['arcology', 'Arcology', 32, -16, 47, 0.2],
]);

export const SKYLINE_SIEGE_MODELS = Object.freeze(SKYLINE_MODELS.flatMap(([key, label, x, z, height, scale]) => [
    Object.freeze({ id: `skyline-${key}-intact`, url: `assets/maps/skyline_siege/glb/01_${key}.glb`,
        position: [x, 4, z], rotation: [0, 0, 0], scale }),
    Object.freeze({ id: `skyline-${key}-collapse`, url: `assets/maps/skyline_siege/glb/20_${key}_collapse.glb`,
        position: [x, 4, z], rotation: [0, 0, 0], scale, hiddenUntilTriggered: true,
        animationClock: Object.freeze({ mode: 'once', clipName: `Skyline${label}CollapseOnce` }) }),
]));

const SKYLINE_STATIC_BACKDROP = Object.freeze({
    id: 'skyline-static-backdrop', url: 'assets/maps/skyline_siege/glb/00_static_backdrop.glb',
    position: [0, 4, 0], rotation: [0, 0, 0], scale: 0.2, collision: false,
});

export const SKYLINE_SIEGE_MAPS = Object.freeze({
    skyline_siege: Object.freeze({
        name: 'Skyline Siege', size: Object.freeze([180, 100, 180]), scaleAuthoredAnchors: true,
        exclusionZone: Object.freeze({ openFaces: Object.freeze(['minX', 'maxX', 'minZ', 'maxZ', 'maxY']) }),
        obstacles: Object.freeze([Object.freeze({ pos: [0, 2, 0], size: [180, 4, 180], kind: 'foam', compileWithGlb: true })]),
        portals: Object.freeze([]), glbModels: Object.freeze([SKYLINE_STATIC_BACKDROP, ...SKYLINE_SIEGE_MODELS]),
        glbColliderMode: 'scene',
        glbAuthoredObstaclesCollisionOnly: true, destructibles: SKYLINE_SIEGE_DESTRUCTIBLES,
        lighting: normalizeMapLighting({
            key: { direction: [36, 50, -28], color: 0xc9ddff, intensity: 0.95 },
            fill: { direction: [-35, 18, 25], color: 0x324b80, intensity: 0.34 },
            rim: { direction: [0, 16, 45], color: 0x36ddff, intensity: 0.8 },
            hemisphere: { skyColor: 0x25375c, groundColor: 0x101521 },
            fog: { color: 0x17233a, near: 105, far: 340 },
            skyDome: { zenithColor: 0x080c1c, horizonColor: 0x445b8a, nadirColor: 0x060910 },
            starsVisible: false, exposureOffset: 0.08,
        }),
        lights: Object.freeze([
            Object.freeze({ id: 'skyline_spire_beacon', x: -96, y: 106, z: 0, color: 0x35e6ff, intensity: 1800, distance: 90 }),
            Object.freeze({ id: 'skyline_crown_beacon', x: 0, y: 96, z: 54, color: 0xff426c, intensity: 1700, distance: 85 }),
            Object.freeze({ id: 'skyline_arcology_beacon', x: 96, y: 91, z: -48, color: 0x8a6cff, intensity: 1700, distance: 85 }),
        ]),
        playerSpawn: Object.freeze({ x: 0, y: 20, z: -68 }),
        botSpawns: Object.freeze([
            Object.freeze({ x: -52, y: 18, z: -40 }), Object.freeze({ x: 52, y: 18, z: 42 }),
            Object.freeze({ x: 52, y: 23, z: -44 }), Object.freeze({ x: -52, y: 22, z: 46 }),
            Object.freeze({ x: 0, y: 30, z: 66 }),
        ]),
        items: Object.freeze([
            Object.freeze({ pos: [-42, 12, 0] }), Object.freeze({ pos: [42, 12, 0] }),
            Object.freeze({ pos: [0, 25, 40] }),
        ]),
        singlePlayerScenario: Object.freeze({ enabled: true, id: 'skyline_siege', modePath: 'fight',
            gameMode: 'HUNT', minBots: 3, botCount: 5 }),
    }),
});
