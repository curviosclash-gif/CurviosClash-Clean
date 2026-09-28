import {
    SUNFLOWER_MEADOW_HONEY_CHAMBER,
    SUNFLOWER_MEADOW_HONEY_CHAMBER_MODELS,
    SUNFLOWER_MEADOW_HONEY_CHAMBER_OBSTACLES,
    SUNFLOWER_MEADOW_HONEY_CHAMBER_TURRETS,
} from './sunflower_meadow/SunflowerMeadowHoneyChamber.js';

const SPAWN_RING_RADIUS = 70;

function ringPoint(angleDeg, radius, y) {
    const angle = (angleDeg * Math.PI) / 180;
    return { x: Math.round(Math.cos(angle) * radius), y, z: Math.round(Math.sin(angle) * radius) };
}

function ringItem(id, type, pickupType, angleDeg, radius, y) {
    const point = ringPoint(angleDeg, radius, y);
    return { id, type, pickupType, x: point.x, y: point.y, z: point.z, weight: type === 'item_rocket' ? 1.2 : 1 };
}

// The sunflower moved here from the dandelion map (user decision 28.09.2026): there it was a
// 15-unit prop with kernels too small to aim at, here it is the landmark. Its GLB is exported
// entirely _nocol, so stalk and head collide through the two authored beams below; the kernels
// are hit through their controller and never collide.
export const SUNFLOWER_MEADOW_MAP = {
    sunflower_meadow: {
        name: 'Sonnenblumen-Wiese',
        size: [200, 170, 200],
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
                targetSize: 150,
            },
            ...SUNFLOWER_MEADOW_HONEY_CHAMBER_MODELS,
        ],
        obstacles: [
            // The stalk, base to head, and the head disc behind its kernels. Invisible: the GLB
            // draws the plant, these only give it a body.
            { id: 'sunflower_meadow_stalk', shape: 'beam', start: [-3.4, 0, -4.1], end: [-1, 112, -1.5], radius: 2.8 },
            // The kernel disc faces up and towards +z (normal 0/0.57/0.82 around 2.7/119.9/1.25);
            // the body sits 3 to 8 units behind it so every kernel stays in front of it.
            { id: 'sunflower_meadow_head', shape: 'beam', start: [2.7, 115.3, -5.3], end: [2.7, 118.2, -1.2], radius: 20 },
            ...SUNFLOWER_MEADOW_HONEY_CHAMBER_OBSTACLES,
        ],
        secretRooms: [SUNFLOWER_MEADOW_HONEY_CHAMBER],
        staticTurrets: SUNFLOWER_MEADOW_HONEY_CHAMBER_TURRETS,
        // Each pair links a low corner with the high opposite one, so the head can be reached
        // from above and the meadow from the canopy.
        portals: [
            { a: [-85, 20, -85], b: [85, 150, 85], color: 0x2fd6c0 },
            { a: [85, 20, -85], b: [-85, 150, 85], color: 0xffa53a },
        ],
        gates: [
            { id: 'sunflower_meadow_orbit_north', type: 'boost', pos: [0, 60, -85], forward: [1, 0, 0], params: { duration: 0.9, forwardImpulse: 30, bonusSpeed: 36, cooldown: 0.8 } },
            { id: 'sunflower_meadow_orbit_south', type: 'boost', pos: [0, 60, 85], forward: [-1, 0, 0], params: { duration: 0.9, forwardImpulse: 30, bonusSpeed: 36, cooldown: 0.8 } },
        ],
        // Eight starts on a ring below the head, 45 degrees apart. The player faces the nodding
        // head from the front; the first bots take the far side of the ring.
        playerSpawn: ringPoint(90, SPAWN_RING_RADIUS, 55),
        botSpawns: [
            ringPoint(-90, SPAWN_RING_RADIUS, 70),
            ringPoint(0, SPAWN_RING_RADIUS, 60),
            ringPoint(180, SPAWN_RING_RADIUS, 65),
            ringPoint(-45, SPAWN_RING_RADIUS, 75),
            ringPoint(225, SPAWN_RING_RADIUS, 58),
            ringPoint(45, SPAWN_RING_RADIUS, 68),
            ringPoint(135, SPAWN_RING_RADIUS, 62),
        ],
        items: [
            // One pickup between every pair of starts, alternating low among the leaves and
            // high beside the head.
            ringItem('sunflower_meadow_rocket_1', 'item_rocket', 'ROCKET_WEAK', 22.5, 50, 35),
            ringItem('sunflower_meadow_shield_1', 'item_shield', 'SHIELD', 67.5, 50, 95),
            ringItem('sunflower_meadow_speed_1', 'item_battery', 'SPEED_UP', 112.5, 50, 35),
            ringItem('sunflower_meadow_health_1', 'item_health', 'HEALTH', 157.5, 50, 95),
            ringItem('sunflower_meadow_rocket_2', 'item_rocket', 'ROCKET_WEAK', 202.5, 50, 35),
            ringItem('sunflower_meadow_shield_2', 'item_shield', 'SHIELD', 247.5, 50, 95),
            ringItem('sunflower_meadow_speed_2', 'item_battery', 'SPEED_UP', 292.5, 50, 35),
            ringItem('sunflower_meadow_health_2', 'item_health', 'HEALTH', 337.5, 50, 95),
            // The high corners, where the portals from the meadow come out.
            { id: 'sunflower_meadow_corner_ne', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 70, y: 140, z: -70, weight: 1.2 },
            { id: 'sunflower_meadow_corner_sw', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -70, y: 140, z: 70, weight: 1.2 },
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
