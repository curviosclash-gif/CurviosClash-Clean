import { normalizeMapLighting } from '../../../../shared/contracts/MapLightingContract.js';

export const STANDARD_WORLD_LIGHTING = normalizeMapLighting({
    key: { direction: [24, 40, 18], color: 0xffe6c9, intensity: 1.6 },
    fill: { direction: [-24, 24, -18], color: 0xb2d6ed, intensity: 0.72 },
    hemisphere: { skyColor: 0xcce2ef, groundColor: 0x657383 },
    fog: { near: 85, far: 200, height: 3, heightFalloff: 0.08 },
});

export const WIND_CATHEDRAL_WORLD_LIGHTING = normalizeMapLighting({
    key: { direction: [-28, 45, 22], color: 0xffebce, intensity: 1.7 },
    fill: { direction: [28, 28, -25], color: 0xc1e4f3, intensity: 0.8 },
    rim: { direction: [0, 32, 40], color: 0xe7faff, intensity: 0.6 },
    hemisphere: { skyColor: 0xdbe9ee, groundColor: 0x71838b },
    skyDome: { zenithColor: 0x325977, horizonColor: 0x8eb5c8, nadirColor: 0x547985 },
    fog: { near: 110, far: 200, height: 2, heightFalloff: 0.15, turbulence: 0.08 },
    starsVisible: false,
});

export const WIND_CATHEDRAL_WORLD_LIGHTS = [
    { id: 'wind_aisle', x: -32, y: 37, z: 8, color: 0xffebc5, intensity: 2800, distance: 85 },
    { id: 'wind_middle', x: 30, y: 62, z: -18, color: 0x91ffdf, intensity: 1900, distance: 58 },
    { id: 'wind_descent', x: -34, y: 76, z: 0, color: 0xc7afff, intensity: 1800, distance: 55 },
    { id: 'wind_crown', x: 25, y: 90, z: 6, color: 0xc3edff, intensity: 3600, distance: 75 },
];

function classicWorld(key, floorY, lighting) {
    return {
        glbModels: [{ id: `${key}-world`, url: `assets/maps/${key}/glb/01_world.glb`,
            position: [0, floorY, 0], scale: 1 }],
        glbColliderMode: 'dynamic',
        glbAuthoredObstaclesCollisionOnly: true,
        lighting: normalizeMapLighting(lighting),
    };
}

export const CLASSIC_WORLD_APPEARANCE = {
    maze: classicWorld('maze', -.12, {
        key: { color: 0xffe5c4, intensity: 1.65 },
        fill: { color: 0xb4d9ed, intensity: .75 },
        fog: { near: 100, far: 200, height: 2, heightFalloff: .1 },
    }),
    // These authored foundations extend below ground; the GLB placement follows them.
    complex: classicWorld('complex', -2.5, {
        key: { color: 0xe0f2ff, intensity: 1.75 },
        fill: { color: 0x9ab6f5, intensity: .8 },
        fog: { near: 100, far: 200, height: 2, heightFalloff: .1 },
    }),
    pyramid: classicWorld('pyramid', -.12, {
        key: { color: 0xffd697, intensity: 1.9 },
        fill: { color: 0xbcd5ef, intensity: .65 },
        hemisphere: { skyColor: 0xf2dfb6, groundColor: 0x846b49 },
        skyDome: { zenithColor: 0x4d789a, horizonColor: 0xccbd9a, nadirColor: 0x6b5740 },
        fog: { near: 110, far: 200, height: 1, heightFalloff: .15 },
        starsVisible: false,
    }),
    vertical_maze: classicWorld('vertical_maze', -.12, {
        key: { color: 0xffe1bd, intensity: 1.75 },
        fill: { color: 0xacd5ef, intensity: .8 },
        fog: { near: 110, far: 200, height: 2, heightFalloff: .15 },
    }),
    trench: classicWorld('trench', -.12, {
        key: { color: 0xffe3b8, intensity: 1.8 },
        fill: { color: 0xa3cbef, intensity: .8 },
        fog: { near: 110, far: 200, height: 2, heightFalloff: .12 },
    }),
};
