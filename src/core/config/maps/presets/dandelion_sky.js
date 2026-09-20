import {
    DANDELION_SKY_ROOT_CHAMBER,
    DANDELION_SKY_ROOT_CHAMBER_MODELS,
    DANDELION_SKY_ROOT_CHAMBER_OBSTACLES,
    DANDELION_SKY_ROOT_CHAMBER_TURRETS,
} from './dandelion_sky/DandelionSkySecretRoom.js';

// The GLB is authored at ~11 m and targetSize preserves its oversized seed crown here;
// other maps can reuse the same file at any size.
export const DANDELION_SKY_MAP = {
    dandelion_sky: {
        name: 'Pusteblumen-Himmel',
        // The horizontal play space is intentionally tighter than the previous 520 m square.
        // The open upper face leaves room for the oversized crown above the compact flight box.
        size: [420, 400, 420],
        exclusionZone: { openFaces: ['minX', 'maxX', 'minZ', 'maxZ', 'maxY'] },
        scaleAuthoredAnchors: true,
        preferAuthoredPortals: true,
        portalLevels: [29, 135, 230],
        // Five times the standard automatic range (55/190), so the full landmark remains
        // readable across the compact map. An explicit local view-distance choice still wins.
        lighting: {
            key: { direction: [30, 50, 30], color: 0xfff4e8, intensity: 1.35 },
            fill: { direction: [-20, 30, -10], color: 0x4f86d9, intensity: 0.32 },
            rim: { direction: [-35, 18, -45], color: 0x39d9ff, intensity: 0.62 },
            hemisphere: { skyColor: 0x9bc8ff, groundColor: 0x334466 },
            fog: {
                color: 0x0b1020,
                near: 275,
                far: 950,
                height: 9,
                heightFalloff: 0.014,
                turbulence: 0.12,
                skyBlend: 1,
                colorHigh: 0x0b1020,
                colorLow: 0x0b1020,
                clipClosureStart: 0.8,
            },
            skyDome: { zenithColor: 0x02050f, horizonColor: 0x17355a, nadirColor: 0x070914 },
            starsVisible: true,
            exposureOffset: 0,
        },
        glbColliderMode: 'scene',
        glbModels: [
            {
                id: 'dandelion-sky-flower',
                url: 'assets/models/giant_dandelion/giant_dandelion_shootable.glb',
                position: [0, 0, 0],
                targetSize: 368,
            },
            // The root chamber lights itself. Its models live with the rest of the chamber, not
            // here, so the room stays one thing to read and to move.
            ...DANDELION_SKY_ROOT_CHAMBER_MODELS,
        ],
        obstacles: DANDELION_SKY_ROOT_CHAMBER_OBSTACLES,
        secretRooms: [DANDELION_SKY_ROOT_CHAMBER],
        staticTurrets: DANDELION_SKY_ROOT_CHAMBER_TURRETS,
        // Lower and upper flight lanes keep both the whole silhouette and individual pappus
        // seeds accessible without making the flower itself a traffic-blocking level wall.
        portals: [
            { a: [-108, 30.5, -108], b: [-126, 227, -120], color: 0xc8f5d9 },
            { a: [114, 30.5, 108], b: [132, 227, 114], color: 0xf9f1c8 },
        ],
        gates: [
            { id: 'dandelion_sky_updraft_west', type: 'slingshot', pos: [-120, 131, -120], forward: [0.2, 1, 0.2], up: [0, 1, 0], params: { duration: 1.8, forwardImpulse: 40, liftImpulse: 34, cooldown: 1.5 } },
            { id: 'dandelion_sky_updraft_east', type: 'slingshot', pos: [126, 131, 114], forward: [-0.2, 1, -0.2], up: [0, 1, 0], params: { duration: 1.8, forwardImpulse: 40, liftImpulse: 34, cooldown: 1.5 } },
            { id: 'dandelion_sky_orbit_north', type: 'boost', pos: [0, 135, -155], forward: [1, 0, 0], params: { duration: 0.9, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
            { id: 'dandelion_sky_orbit_south', type: 'boost', pos: [0, 135, 155], forward: [-1, 0, 0], params: { duration: 0.9, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
        ],
        playerSpawn: { x: 0, y: 227, z: -150 },
        botSpawns: [
            { x: -144, y: 228.5, z: -30 },
            { x: 142, y: 227, z: 34 },
            { x: -50, y: 241, z: 144 },
            { x: 66, y: 254, z: -138 },
        ],
        items: [
            { id: 'dandelion_sky_rocket_west', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -110, y: 230.5, z: -38, weight: 1.2 },
            { id: 'dandelion_sky_rocket_east', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 128, y: 218, z: 58, weight: 1.2 },
            { id: 'dandelion_sky_shield', type: 'item_shield', pickupType: 'SHIELD', x: -150, y: 137, z: 0, weight: 1 },
            { id: 'dandelion_sky_speed', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 36, z: -150, weight: 1 },
            { id: 'dandelion_sky_health', type: 'item_health', pickupType: 'HEALTH', x: 0, y: 40, z: 150, weight: 1 },
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
