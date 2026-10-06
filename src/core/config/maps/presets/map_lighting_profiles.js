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

// Smoky forge: brass-amber haze, warm key from a low furnace glow, teal signal light stays visible.
export const FORGE_AMBER_LIGHTING = normalizeMapLighting({
    key: { direction: [30, 38, -20], color: 0xffc27a, intensity: 1.5 },
    fill: { direction: [-26, 22, 18], color: 0x3a90a8, intensity: 0.45 },
    rim: { direction: [-34, 14, -42], color: 0xffa050, intensity: 0.6 },
    hemisphere: { skyColor: 0xb89868, groundColor: 0x3a2a1c },
    fog: {
        color: 0x84603c, colorHigh: 0x5a4640, colorLow: 0x4a3220,
        near: 150, far: 500, height: 6, heightFalloff: 0.03, turbulence: 0.2, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x4a3a40, horizonColor: 0xb8803f, nadirColor: 0x2a1e14 },
    starsVisible: false,
    exposureOffset: -0.02,
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

// Forest daylight: dappled warm sun, green bounce, a low layer of ground mist.
export const FOREST_DAY_LIGHTING = normalizeMapLighting({
    key: { direction: [26, 46, 20], color: 0xfff0c0, intensity: 1.5 },
    fill: { direction: [-24, 22, -16], color: 0x9ccf88, intensity: 0.6 },
    rim: { direction: [-30, 16, -40], color: 0xd8f0a0, intensity: 0.35 },
    hemisphere: { skyColor: 0xb8dca0, groundColor: 0x3a5a28 },
    fog: {
        color: 0xb4d0a0, colorHigh: 0xa8cca8, colorLow: 0x7a9c68,
        near: 80, far: 230, height: 4, heightFalloff: 0.06, turbulence: 0.15, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x3b86c4, horizonColor: 0xcde6c0, nadirColor: 0x405a30 },
    starsVisible: false,
    exposureOffset: 0.02,
});

// Torch-lit hall at dusk: warm key from low, violet shadow, dark ceiling of sky.
export const HALL_TORCHLIGHT_LIGHTING = normalizeMapLighting({
    key: { direction: [30, 24, -26], color: 0xffcf9a, intensity: 1.3 },
    fill: { direction: [-26, 20, 20], color: 0x6a5a9a, intensity: 0.45 },
    rim: { direction: [-34, 14, -40], color: 0xff8a40, intensity: 0.6 },
    hemisphere: { skyColor: 0x3a3048, groundColor: 0x1c1410 },
    fog: {
        color: 0x3a2a2c, colorHigh: 0x1c1620, colorLow: 0x241814,
        near: 90, far: 230, height: 4, heightFalloff: 0.05, turbulence: 0.12, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x0c0a14, horizonColor: 0x4a3022, nadirColor: 0x080605 },
    starsVisible: false,
    exposureOffset: -0.04,
});

// Plain clear day: neutral white sun, pale blue shadows, light grey haze. The calm reference mood.
export const CLEAR_DAY_LIGHTING = normalizeMapLighting({
    key: { direction: [28, 52, 24], color: 0xffffff, intensity: 1.6 },
    fill: { direction: [-24, 24, -18], color: 0xc8d8ff, intensity: 0.75 },
    rim: { direction: [-30, 18, -42], color: 0xe8f4ff, intensity: 0.4 },
    hemisphere: { skyColor: 0xe0ecff, groundColor: 0x8a94a0 },
    fog: {
        color: 0xdae4ee, colorHigh: 0xc8dcf0, colorLow: 0xa8b2bc,
        near: 100, far: 240, height: 3, heightFalloff: 0.08, turbulence: 0.08, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x5f93c8, horizonColor: 0xdfe9f2, nadirColor: 0x9aa4ae },
    starsVisible: false,
    exposureOffset: 0.02,
});

// Battlefield sunset: red-orange sun low over the field, violet smoke haze, cool shadows.
export const BATTLEFIELD_SUNSET_LIGHTING = normalizeMapLighting({
    key: { direction: [50, 22, -30], color: 0xff9a50, intensity: 1.5 },
    fill: { direction: [-30, 22, 20], color: 0x6a7aa8, intensity: 0.5 },
    rim: { direction: [-36, 12, -40], color: 0xff5a30, intensity: 0.5 },
    hemisphere: { skyColor: 0xd89a70, groundColor: 0x4a3a32 },
    fog: {
        color: 0xc08868, colorHigh: 0x8a6a80, colorLow: 0x6a4a3c,
        near: 90, far: 240, height: 4, heightFalloff: 0.05, turbulence: 0.22, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x3a3a68, horizonColor: 0xf0a060, nadirColor: 0x40302a },
    starsVisible: false,
    exposureOffset: 0,
});

// Floodlit pit at night: one hard white light from straight above, red edge light, black sky.
export const FLOODLIT_PIT_LIGHTING = normalizeMapLighting({
    key: { direction: [5, 70, 5], color: 0xe8f0ff, intensity: 1.7 },
    fill: { direction: [-24, 20, -16], color: 0x404a60, intensity: 0.35 },
    rim: { direction: [-34, 12, -42], color: 0xff4030, intensity: 0.6 },
    hemisphere: { skyColor: 0x303848, groundColor: 0x1a1a20 },
    fog: {
        color: 0x222a38, colorHigh: 0x141a26, colorLow: 0x181c24,
        near: 100, far: 250, height: 3, heightFalloff: 0.07, turbulence: 0.1, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x04060c, horizonColor: 0x28344a, nadirColor: 0x050608 },
    starsVisible: true,
    exposureOffset: -0.06,
});

// Reactor core: cold white key, orange glow from below the horizon, teal-green haze.
export const REACTOR_GLOW_LIGHTING = normalizeMapLighting({
    key: { direction: [24, 46, -18], color: 0xdff8ff, intensity: 1.2 },
    fill: { direction: [-22, 6, 22], color: 0xff7a28, intensity: 0.7 },
    rim: { direction: [-34, 16, -42], color: 0x40ffb0, intensity: 0.8 },
    hemisphere: { skyColor: 0x1a3a40, groundColor: 0x402010 },
    fog: {
        color: 0x14403c, colorHigh: 0x0c2a30, colorLow: 0x2a1c10,
        near: 80, far: 220, height: 4, heightFalloff: 0.05, turbulence: 0.2, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x041418, horizonColor: 0x1f6a60, nadirColor: 0x2a1006 },
    starsVisible: false,
    exposureOffset: -0.05,
});

// Lighthouse dusk: low warm sun against a deep blue sky, rose haze over the sea.
export const TWILIGHT_BEACON_LIGHTING = normalizeMapLighting({
    key: { direction: [-30, 28, 40], color: 0xffc89a, intensity: 1.5 },
    fill: { direction: [30, 24, -20], color: 0x6a8ad8, intensity: 0.6 },
    rim: { direction: [-20, 16, -44], color: 0xffb870, intensity: 0.5 },
    hemisphere: { skyColor: 0xa8b8e8, groundColor: 0x5a4a58 },
    fog: {
        color: 0xc4a0a8, colorHigh: 0x8a8ac0, colorLow: 0x6a5a68,
        near: 80, far: 240, height: 10, heightFalloff: 0.03, turbulence: 0.12, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x24316e, horizonColor: 0xf0a878, nadirColor: 0x3a2a46 },
    starsVisible: false,
    exposureOffset: 0,
});

// Psychedelic portal hall: violet fog, magenta fill and cyan edge light, stars.
export const PORTAL_PSYCHEDELIC_LIGHTING = normalizeMapLighting({
    key: { direction: [26, 50, 24], color: 0xf0e0ff, intensity: 1.3 },
    fill: { direction: [-26, 22, -18], color: 0xc040ff, intensity: 0.7 },
    rim: { direction: [-34, 14, -42], color: 0x30f0ff, intensity: 0.8 },
    hemisphere: { skyColor: 0x6a3a9a, groundColor: 0x20103a },
    fog: {
        color: 0x5a2a88, colorHigh: 0x3a1666, colorLow: 0x2a1048,
        near: 80, far: 230, height: 4, heightFalloff: 0.05, turbulence: 0.2, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x1a0838, horizonColor: 0xa03ad0, nadirColor: 0x10051f },
    starsVisible: true,
    exposureOffset: 0,
});

// Golden hour over a track: bright warm sun from the side, clear blue sky, honey haze.
export const GOLDEN_HOUR_LIGHTING = normalizeMapLighting({
    key: { direction: [40, 30, -20], color: 0xffd6a0, intensity: 1.6 },
    fill: { direction: [-28, 22, 18], color: 0x9ab8e8, intensity: 0.55 },
    rim: { direction: [-34, 14, -42], color: 0xffc890, intensity: 0.45 },
    hemisphere: { skyColor: 0xbcd0e8, groundColor: 0x6a6258 },
    fog: {
        color: 0xe4c8a4, colorHigh: 0xc8c8d8, colorLow: 0x94846c,
        near: 100, far: 260, height: 3, heightFalloff: 0.07, turbulence: 0.08, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x3a6aa8, horizonColor: 0xf4c890, nadirColor: 0x6a5a48 },
    starsVisible: false,
    exposureOffset: 0.03,
});

// Sunny garden maze: bright sun, green bounce light, light green haze behind the hedges.
export const HEDGE_MAZE_SUN_LIGHTING = normalizeMapLighting({
    key: { direction: [28, 56, 22], color: 0xfff4d0, intensity: 1.6 },
    fill: { direction: [-24, 24, -18], color: 0x9cd890, intensity: 0.6 },
    rim: { direction: [-30, 18, -42], color: 0xfff0b0, intensity: 0.35 },
    hemisphere: { skyColor: 0xcfe8ff, groundColor: 0x5a7a3a },
    fog: {
        color: 0xd0e2c8, colorHigh: 0xc0dcd8, colorLow: 0x8cac78,
        near: 110, far: 250, height: 3, heightFalloff: 0.08, turbulence: 0.08, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x3f90d8, horizonColor: 0xd6ecd8, nadirColor: 0x546a3a },
    starsVisible: false,
    exposureOffset: 0.03,
});

// Overgrown ruin in the afternoon haze: warm key, green shadows, dusty gold distance.
export const RUIN_HAZE_LIGHTING = normalizeMapLighting({
    key: { direction: [30, 44, 20], color: 0xffe0a8, intensity: 1.55 },
    fill: { direction: [-26, 22, -18], color: 0x9ac890, intensity: 0.55 },
    rim: { direction: [-30, 16, -42], color: 0xffd890, intensity: 0.4 },
    hemisphere: { skyColor: 0xe0d8b0, groundColor: 0x5a4a30 },
    fog: {
        color: 0xdccc9c, colorHigh: 0xc8c8a8, colorLow: 0x8a7a54,
        near: 150, far: 350, height: 4, heightFalloff: 0.04, turbulence: 0.14, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x4a86b8, horizonColor: 0xe8d4a0, nadirColor: 0x584830 },
    starsVisible: false,
    exposureOffset: 0.03,
});

// Harbour on an overcast morning: cool white key, blue-teal haze, yellow safety light on the edges.
export const HARBOUR_OVERCAST_LIGHTING = normalizeMapLighting({
    key: { direction: [-25, 40, 30], color: 0xe8f0ff, intensity: 1.4 },
    fill: { direction: [28, 22, -20], color: 0x6aa8c8, intensity: 0.6 },
    rim: { direction: [-20, 18, -44], color: 0xffd870, intensity: 0.35 },
    hemisphere: { skyColor: 0xb8d4e0, groundColor: 0x3a5560 },
    fog: {
        color: 0xb2ccd6, colorHigh: 0x9ab8c8, colorLow: 0x5a7884,
        near: 100, far: 310, height: 4, heightFalloff: 0.04, turbulence: 0.14, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x4a7a9a, horizonColor: 0xc4dce4, nadirColor: 0x2a4450 },
    starsVisible: false,
    exposureOffset: 0,
});

// Storm over a rail yard: grey sky, cold dim key, turbulent slate haze, signal yellow stays bright.
export const STORM_OVERCAST_LIGHTING = normalizeMapLighting({
    key: { direction: [24, 44, 20], color: 0xcfd8e0, intensity: 1.1 },
    fill: { direction: [-26, 22, -18], color: 0x607890, intensity: 0.5 },
    rim: { direction: [-30, 14, -42], color: 0xffd040, intensity: 0.3 },
    hemisphere: { skyColor: 0x8090a0, groundColor: 0x2c3238 },
    fog: {
        color: 0x6a7884, colorHigh: 0x4a5662, colorLow: 0x3a4248,
        near: 80, far: 330, height: 4, heightFalloff: 0.04, turbulence: 0.3, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x1c242c, horizonColor: 0x6a7a88, nadirColor: 0x181c20 },
    starsVisible: false,
    exposureOffset: -0.08,
});

// Spice bazaar at dusk: amber low sun, violet shadow, rose-brown haze.
export const BAZAAR_DUSK_LIGHTING = normalizeMapLighting({
    key: { direction: [35, 30, -25], color: 0xffbf80, intensity: 1.5 },
    fill: { direction: [-26, 22, 20], color: 0x8a6ab0, intensity: 0.45 },
    rim: { direction: [-34, 14, -42], color: 0xff8a50, intensity: 0.5 },
    hemisphere: { skyColor: 0xe8b890, groundColor: 0x5a4030 },
    fog: {
        color: 0xcc9474, colorHigh: 0x8a6a80, colorLow: 0x6a4a3a,
        near: 110, far: 300, height: 4, heightFalloff: 0.05, turbulence: 0.14, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x3a2a5a, horizonColor: 0xf0a068, nadirColor: 0x4a3028 },
    starsVisible: false,
    exposureOffset: 0,
});

// Sunrise: low pink-gold sun, warm haze. The time of day Rift Sprint has and Rift (night) does not.
export const SUNRISE_LIGHTING = normalizeMapLighting({
    key: { direction: [45, 25, 10], color: 0xffd0a0, intensity: 1.6 },
    fill: { direction: [-28, 22, -18], color: 0x88a8e0, intensity: 0.6 },
    rim: { direction: [-34, 14, -42], color: 0xffc890, intensity: 0.5 },
    hemisphere: { skyColor: 0xffd8b8, groundColor: 0x6a5a58 },
    fog: {
        color: 0xeac4a4, colorHigh: 0xc8b4c8, colorLow: 0x8a7468,
        near: 170, far: 450, height: 4, heightFalloff: 0.04, turbulence: 0.12, skyBlend: 1,
        clipClosureStart: 0.8,
    },
    skyDome: { zenithColor: 0x3a68b0, horizonColor: 0xffc89a, nadirColor: 0x5a4a50 },
    starsVisible: false,
    exposureOffset: 0.05,
});

// Pyramid (Krone des Sonnengottes): kept verbatim, not normalized, so the runtime resolves it as before.
export const PYRAMID_SUN_LIGHTING = {
    key: { direction: [42, 70, 28], color: 0xffd08a, intensity: 1.95 },
    fill: { direction: [-34, 32, -30], color: 0x8fc7e8, intensity: 0.58 },
    rim: { direction: [0, 40, 48], color: 0xffb85c, intensity: 0.38 },
    hemisphere: { skyColor: 0xf0d49d, groundColor: 0x765234 },
    skyDome: { zenithColor: 0x356d99, horizonColor: 0xd6ad73, nadirColor: 0x6b432a },
    fog: {
        color: 0xd3a56b,
        near: 360,
        far: 560,
        height: 3,
        heightFalloff: 0.04,
        turbulence: 0.05,
        skyBlend: 1,
        colorHigh: 0xc7a476,
        colorLow: 0x8c6844,
        clipClosureStart: 0.8,
    },
    starsVisible: false,
    exposureOffset: 0,
};
