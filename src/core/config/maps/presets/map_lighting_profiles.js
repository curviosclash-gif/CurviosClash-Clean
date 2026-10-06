import { normalizeMapLighting, resolveMapLighting } from '../../../../shared/contracts/MapLightingContract.js';

// Named moods for maps that would otherwise get the default night look (dark blue fog, stars).
// Every profile is complete, so a preset that wants another fog range or a tinted rim takes it
// through deriveMapLighting() instead of copying the whole block.
//
// Rules the values follow, so a new mood stays readable:
// - The fog colour sits close to the horizon of the sky dome. With skyBlend 1 the distance fades
//   into the horizon colour, so the two must agree or the far edge reads as a painted wall.
// - Obstacles have to stand out from the distance: bright moods get a mid-bright fog, dark moods
//   a fog lighter than the shadows of the geometry, never pure black.
// - Fog distances are world units (every map is built at MAP_SCALE 3). A course map needs `far`
//   beyond its longest ring leg, an arena map beyond half of its shorter side.

/** @param {object} base @param {object} overrides */
export function deriveMapLighting(base, overrides) {
    return resolveMapLighting(overrides, base);
}

// Late desert afternoon: low warm sun, pale sand haze, blue shadows.
export const DESERT_AFTERNOON_LIGHTING = normalizeMapLighting({
    key: { direction: [38, 42, 22], color: 0xffd7a0, intensity: 1.75 },
    fill: { direction: [-30, 24, -20], color: 0x9cc4e0, intensity: 0.5 },
    rim: { direction: [-30, 16, -42], color: 0xffa860, intensity: 0.45 },
    hemisphere: { skyColor: 0xf2dcae, groundColor: 0x8c6a46 },
    fog: {
        color: 0xdcb982, colorHigh: 0xcfae7c, colorLow: 0x9a7a52,
        near: 130, far: 340, height: 4, heightFalloff: 0.05, turbulence: 0.1, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x3f78ac, horizonColor: 0xe6c48e, nadirColor: 0x7c5a3a },
    starsVisible: false,
    exposureOffset: 0.04,
});

// Bright sky above a cloud sea: sun from the side, white-blue haze, no stars.
export const CLOUD_SEA_LIGHTING = normalizeMapLighting({
    key: { direction: [34, 52, 18], color: 0xfff1d6, intensity: 1.7 },
    fill: { direction: [-28, 18, -22], color: 0x9cc8f0, intensity: 0.7 },
    rim: { direction: [-20, 30, -44], color: 0xffffff, intensity: 0.5 },
    hemisphere: { skyColor: 0xbfe0ff, groundColor: 0xa8b8c8 },
    fog: {
        color: 0xd8e9f8, colorHigh: 0xc4dcf4, colorLow: 0xe4eef6,
        near: 150, far: 520, height: 10, heightFalloff: 0.012, turbulence: 0.15, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x3f86d6, horizonColor: 0xcfe8ff, nadirColor: 0xdfeaf5 },
    starsVisible: false,
    exposureOffset: 0.05,
});

// Deep sea: a little light falls from far above, everything else is teal darkness.
export const DEEP_SEA_LIGHTING = normalizeMapLighting({
    key: { direction: [6, 70, 8], color: 0x6fb8d0, intensity: 0.85 },
    fill: { direction: [-20, -12, 14], color: 0x1f6a86, intensity: 0.5 },
    rim: { direction: [-30, 12, -40], color: 0x35ffc0, intensity: 0.7 },
    hemisphere: { skyColor: 0x1a5a78, groundColor: 0x061820 },
    fog: {
        color: 0x0b3a52, colorHigh: 0x0f5a7a, colorLow: 0x03121c,
        near: 25, far: 170, height: 30, heightFalloff: 0.01, turbulence: 0.22, skyBlend: 1,
        clipClosureStart: 0.75,
    },
    skyDome: { zenithColor: 0x0a5a80, horizonColor: 0x0b3a52, nadirColor: 0x010508 },
    starsVisible: false,
    exposureOffset: -0.1,
});

// Synthwave night over a circuit: violet haze glowing at the horizon so the dark walls show as
// silhouettes, magenta and cyan edge light.
export const NEON_CITY_NIGHT_LIGHTING = normalizeMapLighting({
    key: { direction: [20, 50, -25], color: 0x9bb0ff, intensity: 0.7 },
    fill: { direction: [-28, 18, 20], color: 0xff2fc8, intensity: 0.65 },
    rim: { direction: [-35, 14, -45], color: 0x18e6ff, intensity: 1.0 },
    hemisphere: { skyColor: 0x2a1860, groundColor: 0x0b0620 },
    fog: {
        color: 0x2a1250, colorHigh: 0x1c0c3a, colorLow: 0x12082a,
        near: 70, far: 330, height: 8, heightFalloff: 0.02, turbulence: 0.18, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x07031a, horizonColor: 0x4a1670, nadirColor: 0x03010a },
    starsVisible: false,
    exposureOffset: -0.1,
});

// Sun covered by the moon: a thin copper corona on the horizon, a near-black sky with stars,
// cold dim light on the ground. Meant to read nothing like the brass-and-amber Chrono Forge.
export const ECLIPSE_LIGHTING = normalizeMapLighting({
    key: { direction: [-42, 20, 26], color: 0xffcf8a, intensity: 0.75 },
    fill: { direction: [30, 26, -20], color: 0x2a3a78, intensity: 0.55 },
    rim: { direction: [-40, 14, -30], color: 0xffa040, intensity: 1.1 },
    hemisphere: { skyColor: 0x2a2c5a, groundColor: 0x2a1408 },
    fog: {
        color: 0x4a2a22, colorHigh: 0x1a1230, colorLow: 0x3a1c10,
        near: 150, far: 540, height: 6, heightFalloff: 0.03, turbulence: 0.12, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x03030c, horizonColor: 0x7a3a18, nadirColor: 0x0a0604 },
    starsVisible: true,
    exposureOffset: -0.1,
});

// Coastal morning: low bright sun, teal water haze, cyan edge light on the moving parts.
export const TIDE_MORNING_LIGHTING = normalizeMapLighting({
    key: { direction: [36, 40, 24], color: 0xfff0d8, intensity: 1.6 },
    fill: { direction: [-30, 20, -18], color: 0x4fb4d8, intensity: 0.6 },
    rim: { direction: [-28, 16, -44], color: 0x7ff0ff, intensity: 0.6 },
    hemisphere: { skyColor: 0xa8e0f0, groundColor: 0x2a5a70 },
    fog: {
        color: 0x92cddb, colorHigh: 0x7cbcd6, colorLow: 0x4a8a9c,
        near: 170, far: 560, height: 6, heightFalloff: 0.025, turbulence: 0.2, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x1c6aa8, horizonColor: 0x9ad8e8, nadirColor: 0x1a4458 },
    starsVisible: false,
    exposureOffset: 0.04,
});

// Garden at midday: warm sun, green bounce light, soft sage haze.
export const GARDEN_MIDDAY_LIGHTING = normalizeMapLighting({
    key: { direction: [28, 56, 22], color: 0xfff2c8, intensity: 1.65 },
    fill: { direction: [-26, 24, -18], color: 0xa8d8a0, intensity: 0.6 },
    rim: { direction: [-30, 20, -40], color: 0xffe9b0, intensity: 0.4 },
    hemisphere: { skyColor: 0xc8e8ff, groundColor: 0x4a6a30 },
    fog: {
        color: 0xc8ddc4, colorHigh: 0xbcd8d8, colorLow: 0x8aa870,
        near: 230, far: 640, height: 5, heightFalloff: 0.03, turbulence: 0.12, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x3d8ad0, horizonColor: 0xd0e9d4, nadirColor: 0x45602f },
    starsVisible: false,
    exposureOffset: 0.04,
});

// Planetarium: indigo space with a gold key light and violet edge light, stars in the dome.
export const ORRERY_COSMOS_LIGHTING = normalizeMapLighting({
    key: { direction: [30, 52, -20], color: 0xffe2a8, intensity: 1.35 },
    fill: { direction: [-30, 20, 24], color: 0x5a6ad8, intensity: 0.5 },
    rim: { direction: [-24, 26, -44], color: 0xc8a0ff, intensity: 0.8 },
    hemisphere: { skyColor: 0x2a2a60, groundColor: 0x0e0c20 },
    fog: {
        color: 0x1c1640, colorHigh: 0x120e30, colorLow: 0x0c0a22,
        near: 260, far: 640, height: 12, heightFalloff: 0.012, turbulence: 0.08, skyBlend: 1,
        clipClosureStart: 0.75,
    },
    skyDome: { zenithColor: 0x04041a, horizonColor: 0x3a2a6a, nadirColor: 0x05030f },
    starsVisible: true,
    exposureOffset: -0.04,
});
