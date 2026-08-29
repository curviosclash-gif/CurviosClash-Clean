// The light of the burning cathedral, held here as its own values rather than borrowed from the
// restoration map next door.
//
// The profiles below started as a copy of what src/core/config/maps/presets/notre_dame currently
// carries, because that map is already lit as a fire: a near-black zenith, an ember horizon, and
// fog that is red rather than grey. That is the look this map is built around. The restoration
// map, however, is a building site in the late afternoon and its profile is expected to move back
// towards daylight. Sharing one object would drag this map along with it, which is exactly what
// must not happen -- so the values are duplicated on purpose. The duplication is the feature.
//
// What the individual dials do is documented where they are first reasoned about, in the
// restoration map's preset; only the fire-specific intent is repeated here.

import { GROUND } from '../notre_dame/NotreDameStructure.js';

// Ember horizon under a night sky. The zenith is nearly black and the nadir carries a trace of
// violet, so the dome still has somewhere to go instead of clipping to flat black overhead.
const FIRE_SKY_DOME = { zenithColor: 0x050912, horizonColor: 0x32100a, nadirColor: 0x160b16 };

// Smoke and river mist lit from below by the fire. The high end is the cold smoke ceiling, the low
// end the warmer layer over the water; the sky blend keeps distant masonry inside that palette
// instead of cutting a hard silhouette out of the dome.
const FIRE_FOG_COLOURS = {
    color: 0x3a0a04,
    skyBlend: 0.45,
    colorHigh: 0x1b0c0e,
    colorLow: 0x260e0f,
    clipClosureStart: 0.8,
    heightFalloff: 0.012,
};

// The route is flown from the west, up the river and into the facade, so the key light comes from
// there and the building stands against it.
export const NOTRE_DAME_FIRE_LIGHTING = {
    key: { direction: [-60, 40, 15], color: 0xffe2b8, intensity: 1.45 },
    fill: { direction: [30, 25, -20], color: 0x8fb4e0, intensity: 0.38 },
    rim: { direction: [-35, 18, -45], color: 0x7fd0ff, intensity: 0.5 },
    // Colour is the only ambient dial a map has -- the rig fixes the intensity. Kept dark and
    // desaturated so the interior is lit by its own light rather than by the sky.
    hemisphere: { skyColor: 0x4c5f73, groundColor: 0x2b271f },
    fog: { ...FIRE_FOG_COLOURS, near: 90, far: 200, height: 7.3, turbulence: 0.2 },
    skyDome: { ...FIRE_SKY_DOME },
    // Nothing about this sky is a clear night, and stars over a smoke column read as a mistake.
    starsVisible: false,
    exposureOffset: 0.1,
};

// The arena is fought inside and around the building rather than approached from one end, so the
// key swings round to the east and the fog layer sits higher and calmer.
export const NOTRE_DAME_FIRE_ARENA_LIGHTING = {
    key: { direction: [45, 55, -35], color: 0xcfe8ff, intensity: 1.35 },
    fill: { direction: [-40, 24, 30], color: 0xffc98c, intensity: 0.34 },
    rim: { direction: [10, 28, 55], color: 0x7fdcff, intensity: 0.62 },
    hemisphere: { skyColor: 0x44505d, groundColor: 0x1e1f22 },
    fog: { ...FIRE_FOG_COLOURS, near: 78, far: 190, height: 10, turbulence: 0.16 },
    skyDome: { ...FIRE_SKY_DOME },
    starsVisible: false,
    exposureOffset: 0.04,
};

// Point lights inside the building, running the length of the nave. These are still the
// restoration map's lamps: warm, shadowless, and long-ranged so some of their light reaches the
// outside through the portals, the rose and the clerestory. They are duplicated here for the same
// reason as the profiles above, and they are the piece this map will change first -- the fire is
// lit from the three vault breaches and the open roof, not from lamps at head height.
//
// The ranges look far too long for interior lamps and are meant to: AuthoredMapLightRig scales
// `distance` by the map factor of three. They are currently the only thing lighting the ground
// beyond the building, so shortening them darkens the whole approach rather than just the nave.
export const NOTRE_DAME_FIRE_LIGHTS = [
    { id: 'ndf_west_front', x: -72, y: GROUND + 26, z: 0, color: 0xff8c3a, intensity: 6000, distance: 70 },
    { id: 'ndf_nave_west', x: -60, y: GROUND + 16, z: 0, color: 0xff7a26, intensity: 4000, distance: 55 },
    { id: 'ndf_nave_mid', x: -28, y: GROUND + 16, z: 0, color: 0xff8a34, intensity: 4000, distance: 55 },
    { id: 'ndf_crossing', x: 4, y: GROUND + 22, z: 0, color: 0xffa04a, intensity: 5200, distance: 65 },
    { id: 'ndf_choir', x: 38, y: GROUND + 16, z: 0, color: 0xff7a26, intensity: 4000, distance: 55 },
    { id: 'ndf_apse', x: 72, y: GROUND + 14, z: 0, color: 0xff6a1c, intensity: 3400, distance: 50 },
];
