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
    { id: 'wind_crown', x: 25, y: 90, z: 6, color: 0xc3edff, intensity: 3600, distance: 75 },
];
