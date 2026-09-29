import {
    SUNFLOWER_MEADOW_HONEY_CHAMBER,
    SUNFLOWER_MEADOW_HONEY_CHAMBER_MODELS,
    SUNFLOWER_MEADOW_HONEY_CHAMBER_OBSTACLES,
    SUNFLOWER_MEADOW_HONEY_CHAMBER_TURRETS,
} from './sunflower_meadow/SunflowerMeadowHoneyChamber.js';

const SPAWN_RING_RADIUS = 140;

function ringPoint(angleDeg, radius, y) {
    const angle = (angleDeg * Math.PI) / 180;
    return { x: Math.round(Math.cos(angle) * radius), y, z: Math.round(Math.sin(angle) * radius) };
}

function ringItem(id, type, pickupType, angleDeg, radius, y) {
    const point = ringPoint(angleDeg, radius, y);
    return { id, type, pickupType, x: point.x, y: point.y, z: point.z, weight: type === 'item_rocket' ? 1.2 : 1 };
}

// The sunflower moved here from the dandelion map (user decision 28.09.2026): there it was a
// 15-unit prop with kernels too small to aim at, here it is the landmark. The GLB stalk wall
// collides around its two tunnel openings; the head uses one beam behind the shootable kernels.
export const SUNFLOWER_MEADOW_MAP = {
    sunflower_meadow: {
        name: 'Sonnenblumen-Wiese',
        size: [420, 360, 420],
        scaleAuthoredAnchors: true,
        preferAuthoredPortals: true,
        // Summer noon: a high white sun, a clear blue dome and a light meadow haze.
        lighting: {
            key: { direction: [25, 60, 35], color: 0xfff1d6, intensity: 1.7 },
            fill: { direction: [-30, 25, -15], color: 0x9cc4ff, intensity: 0.45 },
            rim: { direction: [-20, 20, -40], color: 0xffe2a8, intensity: 0.5 },
            hemisphere: { skyColor: 0xa8d4ff, groundColor: 0x5a7a3a },
            fog: {
                color: 0xbcd6e8,
                near: 250,
                far: 900,
                height: 6,
                heightFalloff: 0.02,
                turbulence: 0.08,
                skyBlend: 1,
                colorHigh: 0xcfe3f2,
                colorLow: 0x9fb88f,
                clipClosureStart: 0.8,
            },
            skyDome: { zenithColor: 0x3f7fc8, horizonColor: 0xd8ecf5, nadirColor: 0x6f8f5a },
            starsVisible: false,
            exposureOffset: 0,
        },
        floorAppearance: { color: 0x4f7a32, roughness: 0.95 },
        glbColliderMode: 'scene',
        glbModels: [
            {
                id: 'sunflower-meadow-flower',
                url: 'assets/models/sunflower/sunflower_shootable.glb',
                position: [0, 0, 0],
                targetSize: 300,
                collision: true,
            },
            ...SUNFLOWER_MEADOW_HONEY_CHAMBER_MODELS,
        ],
        obstacles: [
            // Behind the enlarged kernel disc (centre near 3/233/13, normal 0/0.57/0.82).
            { id: 'sunflower_meadow_head', shape: 'beam', start: [3, 222, -4], end: [3, 229, 6], radius: 37 },
            ...SUNFLOWER_MEADOW_HONEY_CHAMBER_OBSTACLES,
        ],
        secretRooms: [SUNFLOWER_MEADOW_HONEY_CHAMBER],
        staticTurrets: SUNFLOWER_MEADOW_HONEY_CHAMBER_TURRETS,
        // Each pair links a low corner with the high opposite one, so the head can be reached
        // from above and the meadow from the canopy.
        portals: [
            { a: [-175, 30, -175], b: [175, 300, 175], color: 0x2fd6c0 },
            { a: [175, 30, -175], b: [-175, 300, 175], color: 0xffa53a },
        ],
        gates: [
            { id: 'sunflower_meadow_orbit_north', type: 'boost', pos: [0, 130, -165], forward: [1, 0, 0], params: { duration: 0.9, forwardImpulse: 30, bonusSpeed: 36, cooldown: 0.8 } },
            { id: 'sunflower_meadow_orbit_south', type: 'boost', pos: [0, 130, 165], forward: [-1, 0, 0], params: { duration: 0.9, forwardImpulse: 30, bonusSpeed: 36, cooldown: 0.8 } },
        ],
        // Eight starts on a ring below the head, 45 degrees apart. The player faces the nodding
        // head from the front; the first bots take the far side of the ring.
        playerSpawn: ringPoint(90, SPAWN_RING_RADIUS, 120),
        botSpawns: [
            ringPoint(-90, SPAWN_RING_RADIUS, 135),
            ringPoint(0, SPAWN_RING_RADIUS, 125),
            ringPoint(180, SPAWN_RING_RADIUS, 130),
            ringPoint(-45, SPAWN_RING_RADIUS, 140),
            ringPoint(225, SPAWN_RING_RADIUS, 118),
            ringPoint(45, SPAWN_RING_RADIUS, 133),
            ringPoint(135, SPAWN_RING_RADIUS, 127),
        ],
        items: [
            // One pickup between every pair of starts, alternating low among the leaves and
            // high beside the head.
            ringItem('sunflower_meadow_rocket_1', 'item_rocket', 'ROCKET_WEAK', 22.5, 105, 85),
            ringItem('sunflower_meadow_shield_1', 'item_shield', 'SHIELD', 67.5, 105, 185),
            ringItem('sunflower_meadow_speed_1', 'item_battery', 'SPEED_UP', 112.5, 105, 85),
            ringItem('sunflower_meadow_health_1', 'item_health', 'HEALTH', 157.5, 105, 185),
            ringItem('sunflower_meadow_rocket_2', 'item_rocket', 'ROCKET_WEAK', 202.5, 105, 85),
            ringItem('sunflower_meadow_shield_2', 'item_shield', 'SHIELD', 247.5, 105, 185),
            ringItem('sunflower_meadow_speed_2', 'item_battery', 'SPEED_UP', 292.5, 105, 85),
            ringItem('sunflower_meadow_health_2', 'item_health', 'HEALTH', 337.5, 105, 185),
            // The high corners, where the portals from the meadow come out.
            { id: 'sunflower_meadow_corner_ne', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 145, y: 270, z: -145, weight: 1.2 },
            { id: 'sunflower_meadow_corner_sw', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -145, y: 270, z: 145, weight: 1.2 },
            // Three rewards along the bore, reached through the lower and upper stalk windows.
            { id: 'sunflower_meadow_stalk_shield', type: 'item_shield', pickupType: 'SHIELD', x: -15, y: 82, z: -0.5, weight: 1 },
            { id: 'sunflower_meadow_stalk_speed', type: 'item_battery', pickupType: 'SPEED_UP', x: -13, y: 100, z: 1, weight: 1 },
            { id: 'sunflower_meadow_stalk_rocket', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -11, y: 118, z: 2, weight: 1.2 },
        ],
        singlePlayerScenario: {
            enabled: true,
            id: 'sunflower_meadow_hunt',
            modePath: 'fight',
            gameMode: 'HUNT',
            minBots: 4,
            botRoles: ['guard', 'flanker', 'pursuer', 'interceptor'],
        },
    },
};
