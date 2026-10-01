export const TOYBOX_TITAN_MAP = Object.freeze({
    toybox_titan: Object.freeze({
        name: 'Riesen-Kinderzimmer',
        size: Object.freeze([120, 40, 120]),
        scaleAuthoredAnchors: true,
        glbModels: Object.freeze([Object.freeze({
            id: 'toybox-titan-world', url: 'assets/maps/toybox_titan/glb/toybox_titan.glb',
            position: [0, 0, 0],
        })]),
        glbColliderMode: 'scene',
        obstacles: Object.freeze([]),
        portals: Object.freeze([]),
        playerSpawn: Object.freeze({ x: 0, y: 3, z: 44 }),
        botSpawns: Object.freeze([
            Object.freeze({ x: 44, y: 3, z: 0 }),
            Object.freeze({ x: 0, y: 3, z: -44 }),
            Object.freeze({ x: -44, y: 3, z: 0 }),
        ]),
        lighting: Object.freeze({
            key: { direction: [20, 45, 15], color: 0xffe2b0, intensity: 1.1 },
            fill: { direction: [-28, 24, -20], color: 0xaad4ea, intensity: 0.55 },
            rim: { direction: [0, 24, -30], color: 0xffc9d6, intensity: 0.35 },
            hemisphere: { skyColor: 0xdfefff, groundColor: 0xcbb89a },
            fog: {
                color: 0xdcecff, near: 90, far: 220,
                height: 18, heightFalloff: 0.014, turbulence: 0.12, skyBlend: 1,
                colorHigh: 0xdcecff, colorLow: 0xdcecff, clipClosureStart: 0.8,
            },
            skyDome: { zenithColor: 0xaed4f5, horizonColor: 0xe8f2ff, nadirColor: 0xd8e8f5 },
            starsVisible: false,
            exposureOffset: 0,
        }),
        singlePlayerScenario: Object.freeze({
            enabled: true, id: 'toybox_titan', modePath: 'fight',
            gameMode: 'HUNT', minBots: 3, botCount: 3,
        }),
    }),
});
