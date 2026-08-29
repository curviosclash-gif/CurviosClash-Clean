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
//
// The key is a fifth of what the restoration map carries, and that is the correction the fire
// forced. Those values are a late afternoon, and they were survivable there because the roof kept
// them out of the nave. With the roof burnt away the same key lit the interior like a hall, and no
// amount of dimming the fire's own point lights changed it -- measured, that turned out to be
// where the brightness was coming from all along. What is left here is the last of the daylight
// behind a smoke ceiling; the building is meant to be lit by what is burning inside it.
export const NOTRE_DAME_FIRE_LIGHTING = {
    key: { direction: [-60, 40, 15], color: 0xffcf9a, intensity: 0.3 },
    fill: { direction: [30, 25, -20], color: 0x6f8cae, intensity: 0.14 },
    rim: { direction: [-35, 18, -45], color: 0x7fd0ff, intensity: 0.26 },
    // Colour is the only ambient dial a map has -- the rig fixes the intensity. Kept dark and
    // desaturated so the interior is lit by its own light rather than by the sky.
    hemisphere: { skyColor: 0x2a3038, groundColor: 0x1a1512 },
    fog: { ...FIRE_FOG_COLOURS, near: 90, far: 200, height: 7.3, turbulence: 0.2 },
    skyDome: { ...FIRE_SKY_DOME },
    // Nothing about this sky is a clear night, and stars over a smoke column read as a mistake.
    starsVisible: false,
    exposureOffset: 0.1,
};

// The arena is fought inside and around the building rather than approached from one end, so the
// key swings round to the east and the fog layer sits higher and calmer.
// Pulled down in the same proportion and for the same reason as the route profile: both maps fly
// the same roofless building, and a bright key reaches straight into it.
export const NOTRE_DAME_FIRE_ARENA_LIGHTING = {
    key: { direction: [45, 55, -35], color: 0xb8cfe4, intensity: 0.32 },
    fill: { direction: [-40, 24, 30], color: 0xffc98c, intensity: 0.14 },
    rim: { direction: [10, 28, 55], color: 0x7fdcff, intensity: 0.3 },
    hemisphere: { skyColor: 0x272d34, groundColor: 0x161719 },
    fog: { ...FIRE_FOG_COLOURS, near: 78, far: 190, height: 10, turbulence: 0.16 },
    skyDome: { ...FIRE_SKY_DOME },
    starsVisible: false,
    exposureOffset: 0.04,
};

// Where the building is lit from. These are no longer lamps at head height -- they sit at the
// three vault breaches, along the open roof, and on the debris cone, so the light comes from the
// fire that is actually drawn there. A map gets eight point lights in total (see
// MAP_LIGHT_SOURCE_LIMIT), so these replace the restoration map's six interior lamps rather than
// joining them.
//
// The ranges look far too long for what is lighting them and are meant to: AuthoredMapLightRig
// scales `distance` by the map factor of three, so 70 becomes 210 world units. They are still the
// only thing lighting the ground beyond the building, and shortening them turns the downward view
// into the flat dark plate that notre-dame-atmosphere.desktop.spec.js exists to prevent.
//
// None of these cast shadows, which is the point: the fire has to reach the outside through the
// portals, the roses and the open roof, and a shadow-casting light would stop at the first wall.
// A note on the intensities, because they were measured rather than chosen. The first pass simply
// moved the restoration map's lamp values onto the fire positions and turned the nave into an
// evenly lit hall -- a burning cathedral read as a well-lit one. Losing the roof is part of why:
// without it there is nothing left overhead to keep the upper walls dark. So these sit well below
// the lamps they replace, and the contrast is meant to come from the flames being bright against
// stone that is not.
export const NOTRE_DAME_FIRE_LIGHTS = [
    // The crossing, where the spire came through. The largest breach and the brightest light,
    // sitting below the opening so it throws up through the hole and down into the nave at once.
    { id: 'ndf_crossing_breach', x: 17, y: GROUND + 42, z: 0, color: 0xff9c3c, intensity: 4200, distance: 70 },
    // The north transept arm.
    { id: 'ndf_transept_breach', x: 17, y: GROUND + 44, z: -21, color: 0xff7a28, intensity: 2400, distance: 52 },
    // The nave's north aisle bay, low enough to be met at eye level from inside the aisle.
    { id: 'ndf_aisle_breach', x: 3, y: GROUND + 12, z: -18, color: 0xff8534, intensity: 1500, distance: 36 },
    // The burning roof, west and east of the crossing. These are what is seen from the river, so
    // they keep the long range even though they are dimmer than the lamps that used to be here.
    { id: 'ndf_attic_west', x: -56, y: GROUND + 49, z: 0, color: 0xffb45a, intensity: 3400, distance: 70 },
    { id: 'ndf_attic_east', x: 49, y: GROUND + 49, z: 0, color: 0xffb45a, intensity: 3400, distance: 70 },
    // The debris cone on the crossing floor: deep red, the only light down there.
    { id: 'ndf_debris_glow', x: 17, y: GROUND + 4, z: 0, color: 0xff4a12, intensity: 1700, distance: 38 },
    // Reflected off the west front, so the facade and its portals are not a black cut-out when
    // the map is approached from the west, which is the direction the route flies in on.
    { id: 'ndf_west_front', x: -72, y: GROUND + 26, z: 0, color: 0xff8c3a, intensity: 4000, distance: 70 },
    // The apse end, so the building does not simply stop in the dark behind the choir.
    { id: 'ndf_apse', x: 72, y: GROUND + 14, z: 0, color: 0xff6a1c, intensity: 2200, distance: 50 },
];
