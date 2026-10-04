import { normalizeMapLighting } from '../../../../shared/contracts/MapLightingContract.js';

const POSITIONS = Object.freeze([
    [-30, 0, -43], [-62, 0, -8], [62, 0, -8], [-62, 0, 42], [62, 0, 42],
    [30, 0, -43], [-30, 0, 67], [30, 0, 67], [-68, 0, 76], [68, 0, 76],
]);
const TREE_VARIANTS = Object.freeze([
    ['akebono-01', 'assets/maps/cherry_grove/glb/akebono_01.glb', 'assets/maps/cherry_grove/glb/akebono_collision.glb', 9.8, 230],
    ['akebono-02', 'assets/maps/cherry_grove/glb/akebono_02.glb', 'assets/maps/cherry_grove/glb/akebono_collision.glb', 10.2, 145],
    ['akebono-03', 'assets/maps/cherry_grove/glb/akebono_03.glb', 'assets/maps/cherry_grove/glb/akebono_collision.glb', 9.4, 145],
    ['akebono-04', 'assets/maps/cherry_grove/glb/akebono_04.glb', 'assets/maps/cherry_grove/glb/akebono_collision.glb', 10.5, 145],
    ['akebono-05', 'assets/maps/cherry_grove/glb/akebono_05.glb', 'assets/maps/cherry_grove/glb/akebono_collision.glb', 9.6, 145],
    ['kanzan-01', 'assets/maps/cherry_grove/glb/kanzan_01.glb', 'assets/maps/cherry_grove/glb/kanzan_collision.glb', 8.0, 230],
    ['kanzan-02', 'assets/maps/cherry_grove/glb/kanzan_02.glb', 'assets/maps/cherry_grove/glb/kanzan_collision.glb', 8.4, 145],
    ['kanzan-03', 'assets/maps/cherry_grove/glb/kanzan_03.glb', 'assets/maps/cherry_grove/glb/kanzan_collision.glb', 7.7, 145],
    ['kanzan-04', 'assets/maps/cherry_grove/glb/kanzan_04.glb', 'assets/maps/cherry_grove/glb/kanzan_collision.glb', 8.5, 145],
    ['kanzan-05', 'assets/maps/cherry_grove/glb/kanzan_05.glb', 'assets/maps/cherry_grove/glb/kanzan_collision.glb', 7.9, 145],
]);

export const CHERRY_GROVE_MODELS = Object.freeze(TREE_VARIANTS.flatMap(([id, renderUrl, collisionUrl, height, renderDistance], index) => {
    const [x, y, z] = POSITIONS[index];
    const rotation = [0, (index * 1.173) % (Math.PI * 2), 0];
    return [
        Object.freeze({ id: `cherry-${id}-render`, url: renderUrl, position: [x, y + 4, z], rotation, targetSize: height, collision: false, maxRenderDistance: renderDistance }),
        Object.freeze({ id: `cherry-${id}-trunk`, url: collisionUrl, position: [x, y + 4, z], rotation, scale: 1, collisionOnly: true }),
    ];
}));

export const CHERRY_GROVE_MAPS = Object.freeze({
    cherry_grove: Object.freeze({
        name: 'Kirschhain',
        size: Object.freeze([210, 110, 210]),
        scaleAuthoredAnchors: true,
        exclusionZone: Object.freeze({ openFaces: Object.freeze(['minX', 'maxX', 'minZ', 'maxZ', 'maxY']) }),
        obstacles: Object.freeze([Object.freeze({ pos: [0, 2, 0], size: [210, 4, 210], kind: 'foam', compileWithGlb: true })]),
        glbColliderMode: 'scene',
        glbAuthoredObstaclesCollisionOnly: true,
        glbModels: CHERRY_GROVE_MODELS,
        lighting: normalizeMapLighting({
            key: { direction: [32, 55, 24], color: 0xffe6cf, intensity: 1.22 },
            fill: { direction: [-30, 22, -26], color: 0xb9d8f2, intensity: 0.42 },
            rim: { direction: [-14, 18, 36], color: 0xf3a8b9, intensity: 0.42 },
            hemisphere: { skyColor: 0xc8e2ff, groundColor: 0x4d493d },
            fog: { color: 0xc4d2d4, near: 115, far: 330 },
            skyDome: { zenithColor: 0x91bce9, horizonColor: 0xf2d8d3, nadirColor: 0x99a393 },
            starsVisible: false, exposureOffset: 0.04,
        }),
        portals: Object.freeze([
            Object.freeze({ a: [-83, 5, -82], b: [83, 5, 82], color: 0xf7c6d0 }),
            Object.freeze({ a: [83, 5, -82], b: [-83, 5, 82], color: 0xffe6b4 }),
        ]),
        playerSpawn: Object.freeze({ x: 0, y: 8, z: -82 }),
        botSpawns: Object.freeze([
            Object.freeze({ x: -28, y: 8, z: -18 }), Object.freeze({ x: 30, y: 8, z: -12 }),
            Object.freeze({ x: -30, y: 8, z: 30 }), Object.freeze({ x: 28, y: 8, z: 40 }),
        ]),
        items: Object.freeze([
            Object.freeze({ pos: [-34, 6, -5] }), Object.freeze({ pos: [34, 6, 12] }),
            Object.freeze({ pos: [0, 8, 48] }),
        ]),
        singlePlayerScenario: Object.freeze({ enabled: true, id: 'cherry_grove', modePath: 'fight', gameMode: 'HUNT', minBots: 3, botCount: 5 }),
    }),
});
