// One Eiffel-tower-height landmark. The GLB is authored at ~19 m and targetSize scales its
// longest dimension to 330 m here; other maps can reuse the same file at any targetSize.
export const DANDELION_SKY_MAP = {
    dandelion_sky: {
        name: 'Pusteblumen-Himmel',
        size: [700, 390, 700],
        exclusionZone: { openFaces: ['minX', 'maxX', 'minZ', 'maxZ', 'maxY'] },
        scaleAuthoredAnchors: true,
        preferAuthoredPortals: true,
        portalLevels: [32, 150, 255],
        glbColliderMode: 'scene',
        glbModels: [{
            id: 'dandelion-sky-flower',
            url: 'assets/models/giant_dandelion/giant_dandelion_shootable.glb',
            position: [0, 0, 0],
            targetSize: 330,
        }],
        // Lower and upper flight lanes keep both the whole silhouette and individual pappus
        // seeds accessible without making the flower itself a traffic-blocking level wall.
        portals: [
            { a: [-90, 34, -90], b: [-105, 252, -100], color: 0xc8f5d9 },
            { a: [95, 34, 90], b: [110, 252, 95], color: 0xf9f1c8 },
        ],
        gates: [
            { id: 'dandelion_sky_updraft_west', type: 'slingshot', pos: [-100, 145, -100], forward: [0.2, 1, 0.2], up: [0, 1, 0], params: { duration: 1.8, forwardImpulse: 22, liftImpulse: 38, cooldown: 1.5 } },
            { id: 'dandelion_sky_updraft_east', type: 'slingshot', pos: [105, 145, 95], forward: [-0.2, 1, -0.2], up: [0, 1, 0], params: { duration: 1.8, forwardImpulse: 22, liftImpulse: 38, cooldown: 1.5 } },
        ],
        playerSpawn: { x: 0, y: 252, z: -125 },
        botSpawns: [
            { x: -120, y: 254, z: -25 },
            { x: 118, y: 252, z: 28 },
            { x: -42, y: 268, z: 120 },
            { x: 55, y: 282, z: -115 },
        ],
        items: [
            { id: 'dandelion_sky_rocket_west', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -92, y: 256, z: -32, weight: 1.2 },
            { id: 'dandelion_sky_rocket_east', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 90, y: 256, z: 30, weight: 1.2 },
            { id: 'dandelion_sky_shield', type: 'item_shield', pickupType: 'SHIELD', x: 0, y: 276, z: 110, weight: 1 },
            { id: 'dandelion_sky_speed', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 245, z: -112, weight: 1 },
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
