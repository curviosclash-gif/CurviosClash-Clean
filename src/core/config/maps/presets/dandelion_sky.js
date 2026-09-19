// One landmark at one-and-a-half Eiffel towers. The GLB is authored at ~19 m and targetSize
// scales its longest dimension to 495 m here; other maps can reuse the same file at any size.
export const DANDELION_SKY_MAP = {
    dandelion_sky: {
        name: 'Pusteblumen-Himmel',
        // The horizontal play space is intentionally tighter than the original 700 m square.
        // Its height still clears the enlarged flower and the flight lanes around its crown.
        size: [520, 560, 520],
        exclusionZone: { openFaces: ['minX', 'maxX', 'minZ', 'maxZ', 'maxY'] },
        scaleAuthoredAnchors: true,
        preferAuthoredPortals: true,
        portalLevels: [48, 225, 383],
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
                height: 18,
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
        glbModels: [{
            id: 'dandelion-sky-flower',
            url: 'assets/models/giant_dandelion/giant_dandelion_shootable.glb',
            position: [0, 0, 0],
            targetSize: 495,
        }],
        // Lower and upper flight lanes keep both the whole silhouette and individual pappus
        // seeds accessible without making the flower itself a traffic-blocking level wall.
        portals: [
            { a: [-135, 51, -135], b: [-158, 378, -150], color: 0xc8f5d9 },
            { a: [143, 51, 135], b: [165, 378, 143], color: 0xf9f1c8 },
        ],
        gates: [
            { id: 'dandelion_sky_updraft_west', type: 'slingshot', pos: [-150, 218, -150], forward: [0.2, 1, 0.2], up: [0, 1, 0], params: { duration: 1.8, forwardImpulse: 33, liftImpulse: 57, cooldown: 1.5 } },
            { id: 'dandelion_sky_updraft_east', type: 'slingshot', pos: [158, 218, 143], forward: [-0.2, 1, -0.2], up: [0, 1, 0], params: { duration: 1.8, forwardImpulse: 33, liftImpulse: 57, cooldown: 1.5 } },
        ],
        playerSpawn: { x: 0, y: 378, z: -188 },
        botSpawns: [
            { x: -180, y: 381, z: -38 },
            { x: 177, y: 378, z: 42 },
            { x: -63, y: 402, z: 180 },
            { x: 83, y: 423, z: -173 },
        ],
        items: [
            { id: 'dandelion_sky_rocket_west', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -138, y: 384, z: -48, weight: 1.2 },
            { id: 'dandelion_sky_rocket_east', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 135, y: 384, z: 45, weight: 1.2 },
            { id: 'dandelion_sky_shield', type: 'item_shield', pickupType: 'SHIELD', x: 0, y: 414, z: 165, weight: 1 },
            { id: 'dandelion_sky_speed', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 368, z: -168, weight: 1 },
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
