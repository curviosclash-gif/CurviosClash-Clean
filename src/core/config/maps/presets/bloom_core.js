import { resolveBloomEscapeOpenSeconds } from '../../../../shared/contracts/ArcadeScenarioContract.js';

// The whole floor is built at the final size. Only the collision walls move as each ring opens.
export const BLOOM_CORE_FINAL_OPEN_SECONDS = resolveBloomEscapeOpenSeconds();

const STAGES = Object.freeze([
    { id: 'bud', label: 'Kern', atSeconds: 0, size: [68, 80, 68] },
    { id: 'petals', label: 'Blütenring', atSeconds: 35, size: [116, 80, 116] },
    { id: 'canopy', label: 'Kronenring', atSeconds: 70, size: [164, 80, 164] },
    { id: 'open', label: 'Freies Feld', atSeconds: BLOOM_CORE_FINAL_OPEN_SECONDS, size: [200, 80, 200] },
]);

const PILLARS = Object.freeze([
    [-18, -18], [18, -18], [18, 18], [-18, 18],
    [-53, 0], [53, 0], [0, -53], [0, 53],
    [-73, -73], [73, -73], [73, 73], [-73, 73],
].map(([x, z], index) => Object.freeze({
    pos: [x, 10 + (index % 3) * 3, z], size: [5, 20 + (index % 3) * 6, 5], kind: 'hard',
})));

export const BLOOM_CORE_MAP = Object.freeze({
    bloom_core: Object.freeze({
        name: 'Blütenkern',
        size: Object.freeze([200, 80, 200]),
        expansion: Object.freeze({ stages: STAGES }),
        obstacles: PILLARS,
        portals: Object.freeze([]),
        playerSpawn: Object.freeze({ x: 0, y: 22, z: 0 }),
        botSpawns: Object.freeze([
            { x: -24, y: 18, z: 0 }, { x: 24, y: 18, z: 0 },
            { x: 0, y: 20, z: -24 }, { x: 0, y: 20, z: 24 },
        ]),
        items: Object.freeze([
            { pos: [-12, 14, 0] }, { pos: [12, 14, 0] },
            { pos: [0, 14, -12] }, { pos: [0, 14, 12] },
            { pos: [-47, 16, -47] }, { pos: [47, 16, 47] },
        ]),
        lighting: Object.freeze({
            key: { direction: [30, 55, -20], color: 0xffd9a8, intensity: 1.2 },
            fill: { direction: [-25, 25, 35], color: 0x8debc7, intensity: 0.48 },
            rim: { direction: [0, 35, -40], color: 0xf485bf, intensity: 0.55 },
            hemisphere: { skyColor: 0xc5e5df, groundColor: 0x485c4b },
            fog: { color: 0x9bbdb1, near: 130, far: 330 },
            skyDome: { zenithColor: 0x244455, horizonColor: 0xd5bda5, nadirColor: 0x203e36 },
            starsVisible: false,
        }),
    }),
});
