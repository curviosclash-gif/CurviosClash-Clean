const ring = Object.freeze(Array.from({ length: 12 }, (_, index) => {
    const angle = index * Math.PI / 6;
    return Object.freeze([24 * Math.cos(angle), 0.25, 24 * Math.sin(angle)]);
}));

const spawn = (angle) => Object.freeze({ x: 42 * Math.cos(angle), y: 2, z: 42 * Math.sin(angle) });

export const HYDRA_TEMPLE_MAP = Object.freeze({
    hydra_temple: Object.freeze({
        name: 'Hydra-Tempelring',
        size: Object.freeze([100, 35, 100]),
        scaleAuthoredAnchors: true,
        glbModels: Object.freeze([Object.freeze({
            id: 'hydra-temple-world', url: 'assets/maps/hydra_temple/glb/hydra_temple.glb',
            position: [0, 0, 0],
        })]),
        glbColliderMode: 'scene',
        obstacles: Object.freeze([]),
        portals: Object.freeze([]),
        playerSpawn: spawn(0),
        botSpawns: Object.freeze([spawn(Math.PI / 2), spawn(Math.PI), spawn(3 * Math.PI / 2)]),
        mapUnits: Object.freeze([Object.freeze({
            id: 'hydra_v3', kind: 'creature', species: 'hydra_v3',
            path: ring, loop: true, speed: 4, maxHp: 600,
            hitboxRadius: 5.5, respawnSeconds: 0,
            allowedModes: Object.freeze(['HUNT', 'ARCADE']),
            weapons: Object.freeze({ mg: false, rocket: false }),
            loot: Object.freeze({ ROCKET_HEAVY: 1 }),
        })]),
        lighting: Object.freeze({
            key: { direction: [20, 45, 15], color: 0xffc989, intensity: 1.15 },
            fill: { direction: [-28, 24, -20], color: 0x6d9eaa, intensity: 0.5 },
            rim: { direction: [0, 24, -30], color: 0xff773f, intensity: 0.62 },
            hemisphere: { skyColor: 0x8f8f93, groundColor: 0x17191c },
            fog: {
                color: 0x2a292c, near: 70, far: 190,
                height: 18, heightFalloff: 0.014, turbulence: 0.12, skyBlend: 1,
                colorHigh: 0x0b1020, colorLow: 0x0b1020, clipClosureStart: 0.8,
            },
            skyDome: { zenithColor: 0x19242e, horizonColor: 0x695a50, nadirColor: 0x15171b },
            starsVisible: false,
            exposureOffset: 0,
        }),
        singlePlayerScenario: Object.freeze({
            enabled: true, id: 'hydra_temple', modePath: 'fight',
            gameMode: 'HUNT', minBots: 3, botCount: 3,
        }),
    }),
});
