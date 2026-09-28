import {
    DANDELION_SKY_ROOT_CHAMBER,
    DANDELION_SKY_ROOT_CHAMBER_MODELS,
    DANDELION_SKY_ROOT_CHAMBER_OBSTACLES,
    DANDELION_SKY_ROOT_CHAMBER_TURRETS,
} from './dandelion_sky/DandelionSkySecretRoom.js';

// The seed crown does not sit over the stem base: the GLB leans it to x=39. Spawns and pickups
// are laid out around that point, so no start is nearer to the seeds than another.
const CROWN_X = 39;
const SPAWN_RING_RADIUS = 145;

function ringPoint(angleDeg, radius, y) {
    const angle = (angleDeg * Math.PI) / 180;
    return {
        x: Math.round(CROWN_X + Math.cos(angle) * radius),
        y,
        z: Math.round(Math.sin(angle) * radius),
    };
}

// The GLB is authored at ~11 m and targetSize preserves its oversized seed crown here;
// other maps can reuse the same file at any size.
export const DANDELION_SKY_MAP = {
    dandelion_sky: {
        name: 'Pusteblumen-Himmel',
        // The map is built around its chamber and guns, which CLASSIC does not have; there it is
        // only a vast empty sky where trails never close anything off (user decision 28.09.2026).
        excludedModes: ['CLASSIC'],
        // The horizontal play space is intentionally tighter than the previous 520 m square.
        // The open upper face leaves room for the oversized crown above the compact flight box.
        size: [420, 400, 420],
        exclusionZone: { openFaces: ['minX', 'maxX', 'minZ', 'maxZ', 'maxY'] },
        scaleAuthoredAnchors: true,
        preferAuthoredPortals: true,
        portalLevels: [29, 135, 230],
        // Golden hour (user decision 28.09.2026): a low warm sun backlights the ivory crown
        // against a blue zenith, and a warm meadow haze replaces the old night sky.
        lighting: {
            key: { direction: [-40, 18, 25], color: 0xffb46e, intensity: 1.6 },
            fill: { direction: [30, 25, -20], color: 0x7d93d8, intensity: 0.45 },
            rim: { direction: [35, 12, -30], color: 0xffd6a0, intensity: 0.7 },
            hemisphere: { skyColor: 0xf2c48e, groundColor: 0x4f5a3a },
            // Four times the standard automatic range (55/190) for the far end, so the full
            // landmark stays readable across the map; the nearer start lets distant petals and
            // spawns pale a little instead of every depth looking equally sharp.
            fog: {
                color: 0x9a8fa6,
                near: 200,
                far: 1000,
                height: 9,
                heightFalloff: 0.014,
                turbulence: 0.12,
                skyBlend: 1,
                colorHigh: 0xc7a3a0,
                colorLow: 0x77806f,
                clipClosureStart: 0.8,
            },
            skyDome: { zenithColor: 0x2d5a8f, horizonColor: 0xf0b98a, nadirColor: 0x5a5f4a },
            starsVisible: false,
            exposureOffset: 0,
        },
        // A meadow under the flower instead of the technical checker floor.
        floorAppearance: { color: 0x44602f, roughness: 0.95 },
        glbColliderMode: 'scene',
        glbModels: [
            {
                id: 'dandelion-sky-flower',
                url: 'assets/models/giant_dandelion/giant_dandelion_shootable.glb',
                position: [0, 0, 0],
                targetSize: 368,
            },
            {
                id: 'dandelion-sky-sunflower',
                url: 'assets/models/sunflower/sunflower_shootable.glb',
                position: [10, 216, -135],
                targetSize: 15,
                collision: false,
            },
            // The root chamber lights itself. Its models live with the rest of the chamber, not
            // here, so the room stays one thing to read and to move.
            ...DANDELION_SKY_ROOT_CHAMBER_MODELS,
        ],
        obstacles: DANDELION_SKY_ROOT_CHAMBER_OBSTACLES,
        secretRooms: [DANDELION_SKY_ROOT_CHAMBER],
        staticTurrets: DANDELION_SKY_ROOT_CHAMBER_TURRETS,
        // Lower and upper flight lanes keep both the whole silhouette and individual pappus
        // seeds accessible without making the flower itself a traffic-blocking level wall. The
        // third pair links the middle band, which had no way in or out of its own. Strong, distinct
        // colours read against the ivory crown; turquoise matches the chamber below.
        portals: [
            { a: [-108, 30.5, -108], b: [-126, 227, -120], color: 0x2fd6c0 },
            { a: [114, 30.5, 108], b: [132, 227, 114], color: 0xffa53a },
            { a: [-160, 150, 110], b: [175, 185, -95], color: 0xc77dff },
        ],
        gates: [
            { id: 'dandelion_sky_updraft_west', type: 'slingshot', pos: [-120, 131, -120], forward: [0.2, 1, 0.2], up: [0, 1, 0], params: { duration: 1.8, forwardImpulse: 40, liftImpulse: 34, cooldown: 1.5 } },
            { id: 'dandelion_sky_updraft_east', type: 'slingshot', pos: [126, 131, 114], forward: [-0.2, 1, -0.2], up: [0, 1, 0], params: { duration: 1.8, forwardImpulse: 40, liftImpulse: 34, cooldown: 1.5 } },
            { id: 'dandelion_sky_orbit_north', type: 'boost', pos: [0, 135, -155], forward: [1, 0, 0], params: { duration: 0.9, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
            { id: 'dandelion_sky_orbit_south', type: 'boost', pos: [0, 135, 155], forward: [-1, 0, 0], params: { duration: 0.9, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
        ],
        // Eight starts on one ring around the crown, 45 degrees apart. The first bots take the
        // far side of the ring, so the ones next to the player only join in larger matches, and
        // no two players share a start before the ninth.
        playerSpawn: ringPoint(-90, SPAWN_RING_RADIUS, 227),
        botSpawns: [
            ringPoint(90, SPAWN_RING_RADIUS, 250),
            ringPoint(0, SPAWN_RING_RADIUS, 245),
            ringPoint(180, SPAWN_RING_RADIUS, 229),
            ringPoint(135, SPAWN_RING_RADIUS, 238),
            // Raised well above the eastern upper portal end, which sits on the same bearing.
            ringPoint(45, SPAWN_RING_RADIUS, 265),
            ringPoint(225, SPAWN_RING_RADIUS, 244),
            ringPoint(-45, SPAWN_RING_RADIUS, 236),
        ],
        items: [
            { id: 'dandelion_sky_rocket_west', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -110, y: 230.5, z: -38, weight: 1.2 },
            { id: 'dandelion_sky_rocket_east', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 128, y: 218, z: 58, weight: 1.2 },
            { id: 'dandelion_sky_shield', type: 'item_shield', pickupType: 'SHIELD', x: -150, y: 137, z: 0, weight: 1 },
            { id: 'dandelion_sky_speed', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 36, z: -150, weight: 1 },
            { id: 'dandelion_sky_health', type: 'item_health', pickupType: 'HEALTH', x: 0, y: 40, z: 150, weight: 1 },
            // One pickup a short dive inward from every start; the player's had nothing within ten
            // seconds of flight before. The two upper rockets above already serve two starts.
            { id: 'dandelion_sky_rocket_north', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 39, y: 212, z: -112, weight: 1.2 },
            { id: 'dandelion_sky_start_south', type: 'item_health', pickupType: 'HEALTH', x: 39, y: 235, z: 110, weight: 1 },
            { id: 'dandelion_sky_start_east', type: 'item_shield', pickupType: 'SHIELD', x: 149, y: 230, z: 0, weight: 1 },
            { id: 'dandelion_sky_start_southwest', type: 'item_battery', pickupType: 'SPEED_UP', x: -39, y: 223, z: 78, weight: 1 },
            { id: 'dandelion_sky_start_northwest', type: 'item_shield', pickupType: 'SHIELD', x: -39, y: 229, z: -78, weight: 1 },
            { id: 'dandelion_sky_start_northeast', type: 'item_battery', pickupType: 'SPEED_UP', x: 117, y: 221, z: -78, weight: 1 },
            // The middle band under the crown, between the start angles.
            { id: 'dandelion_sky_mid_speed', type: 'item_battery', pickupType: 'SPEED_UP', x: 85, y: 170, z: -111, weight: 1 },
            { id: 'dandelion_sky_mid_shield', type: 'item_shield', pickupType: 'SHIELD', x: 150, y: 180, z: 46, weight: 1 },
            { id: 'dandelion_sky_mid_rocket', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -7, y: 175, z: 111, weight: 1.2 },
            { id: 'dandelion_sky_mid_health', type: 'item_health', pickupType: 'HEALTH', x: -72, y: 185, z: -46, weight: 1 },
            // The corners were the widest empty ground on the map.
            { id: 'dandelion_sky_corner_ne', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 165, y: 85, z: -165, weight: 1.2 },
            { id: 'dandelion_sky_corner_se', type: 'item_shield', pickupType: 'SHIELD', x: 165, y: 85, z: 165, weight: 1 },
            { id: 'dandelion_sky_corner_sw', type: 'item_battery', pickupType: 'SPEED_UP', x: -165, y: 85, z: 165, weight: 1 },
            { id: 'dandelion_sky_corner_nw', type: 'item_health', pickupType: 'HEALTH', x: -165, y: 85, z: -165, weight: 1 },
        ],
        singlePlayerScenario: {
            enabled: true,
            id: 'dandelion_sky_hunt',
            modePath: 'fight',
            gameMode: 'HUNT',
            minBots: 4,
            botRoles: ['guard', 'flanker', 'pursuer', 'interceptor'],
        },
    },
};
