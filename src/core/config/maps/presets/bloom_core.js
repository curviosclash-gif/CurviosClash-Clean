import { BLOOM_CORE_FINAL_OPEN_SECONDS } from '../../../../shared/contracts/BloomCoreTimingContract.js';
import { normalizeMapLighting } from '../../../../shared/contracts/MapLightingContract.js';

export { BLOOM_CORE_FINAL_OPEN_SECONDS };

// The whole floor is built at the final size. Only the collision walls move as each ring opens.

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
        // Spawns and item anchors are written in world units (no scaleAuthoredAnchors); the stage
        // sizes and obstacles above are map units, x3. The stages reach +-102, +-174, +-246 and
        // +-300 world units, so everything below is placed against those four squares.
        playerSpawn: Object.freeze({ x: 0, y: 22, z: 0 }),
        // Every start lies inside the first stage, 80 units from the player and 113 from each other.
        botSpawns: Object.freeze([
            { x: -80, y: 18, z: 0 }, { x: 80, y: 18, z: 0 },
            { x: 0, y: 20, z: -80 }, { x: 0, y: 20, z: 80 },
        ]),
        // Four anchors per stage ring, so a ring that has just opened holds new items: the pickup
        // manager only offers the anchors inside the bounds that are open right now.
        items: Object.freeze([
            // Kern (bounds 102): between the player and the inner pillars at +-54.
            { pos: [-34, 16, -34] }, { pos: [34, 16, -34] },
            { pos: [-34, 16, 34] }, { pos: [34, 16, 34] },
            // Blütenring (bounds 174): corners behind the mid pillars at +-159.
            { pos: [-138, 20, -138] }, { pos: [138, 20, -138] },
            { pos: [-138, 20, 138] }, { pos: [138, 20, 138] },
            // Kronenring (bounds 246): the four axes, clear of the outer pillars at +-219.
            { pos: [-210, 26, 0] }, { pos: [210, 26, 0] },
            { pos: [0, 26, -210] }, { pos: [0, 26, 210] },
            // Freies Feld (bounds 300): the far corners.
            { pos: [-272, 32, -272] }, { pos: [272, 32, -272] },
            { pos: [-272, 32, 272] }, { pos: [272, 32, 272] },
        ]),
        lighting: normalizeMapLighting({
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
