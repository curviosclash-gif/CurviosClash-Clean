export const STORM_LIGHTHOUSE_PLAYER_SPAWN = Object.freeze({ x: 0, y: 18, z: -62 });

export const STORM_LIGHTHOUSE_BOT_SPAWNS = Object.freeze([
    Object.freeze({ x: -52, y: 18, z: -36 }),
    Object.freeze({ x: 52, y: 18, z: -34 }),
    Object.freeze({ x: -54, y: 22, z: 30 }),
    Object.freeze({ x: 54, y: 22, z: 32 }),
    Object.freeze({ x: -28, y: 29, z: 48 }),
    Object.freeze({ x: 25, y: 31, z: 14 }),
]);

// The two low gates keep the outer storm ring flowing in opposite directions. The slingshots
// turn that horizontal speed into two deliberate ways up: the lift-side maintenance route and
// the high gallery approach. All coordinates are authored anchors and therefore follow MAP_SCALE.
export const STORM_LIGHTHOUSE_GATES = Object.freeze([
    Object.freeze({
        id: 'lighthouse_outer_south',
        type: 'boost',
        pos: Object.freeze([-46, 16, -52]),
        forward: Object.freeze([0.98, 0.04, 0.18]),
        params: Object.freeze({ duration: 1, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 }),
    }),
    Object.freeze({
        id: 'lighthouse_outer_north',
        type: 'boost',
        pos: Object.freeze([46, 19, 52]),
        forward: Object.freeze([-0.98, 0.04, -0.18]),
        params: Object.freeze({ duration: 1, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 }),
    }),
    Object.freeze({
        id: 'lighthouse_lift_ascent',
        type: 'slingshot',
        pos: Object.freeze([25, 14, -13]),
        forward: Object.freeze([-0.25, 0.88, 0.4]),
        up: Object.freeze([0, 1, 0]),
        params: Object.freeze({ duration: 1.45, forwardImpulse: 22, liftImpulse: 22, cooldown: 1.1 }),
    }),
    Object.freeze({
        id: 'lighthouse_gallery_cross',
        type: 'slingshot',
        pos: Object.freeze([-24, 20, 19]),
        forward: Object.freeze([0.66, 0.48, -0.58]),
        up: Object.freeze([0, 1, 0]),
        params: Object.freeze({ duration: 1.25, forwardImpulse: 30, liftImpulse: 12, cooldown: 1 }),
    }),
]);

export const STORM_LIGHTHOUSE_ITEMS = Object.freeze([
    Object.freeze({
        id: 'lighthouse_shield_outer_west', type: 'item_shield', pickupType: 'SHIELD',
        x: -57, y: 12, z: -20, weight: 1.2,
    }),
    Object.freeze({
        id: 'lighthouse_speed_outer_east', type: 'item_battery', pickupType: 'SPEED_UP',
        x: 57, y: 13, z: 18, weight: 1.3,
    }),
    Object.freeze({
        id: 'lighthouse_rocket_keeper_house', type: 'item_rocket', pickupType: 'ROCKET_WEAK',
        x: -33, y: 17, z: 26, weight: 0.9,
    }),
    Object.freeze({
        id: 'lighthouse_ghost_inner_ring', type: 'item_coin', pickupType: 'GHOST',
        x: 20, y: 18, z: -20, weight: 0.8,
    }),
    Object.freeze({
        id: 'lighthouse_speed_lift', type: 'item_battery', pickupType: 'SPEED_UP',
        x: 25, y: 23, z: 0, weight: 1.1,
    }),
    Object.freeze({
        id: 'lighthouse_rocket_gallery', type: 'item_rocket', pickupType: 'ROCKET_HEAVY',
        x: -8, y: 24, z: 6, weight: 0.6,
    }),
]);

export const STORM_LIGHTHOUSE_LIGHTS = Object.freeze([
    Object.freeze({
        id: 'lighthouse_lantern', x: 0, y: 21, z: 0,
        color: 0xffcf66, intensity: 3200, distance: 34,
    }),
    Object.freeze({
        id: 'lighthouse_keeper_house', x: -31, y: 8, z: 24,
        color: 0xffb45c, intensity: 1700, distance: 22,
    }),
    Object.freeze({
        id: 'lighthouse_generator', x: 31, y: 7, z: -21,
        color: 0x72dfff, intensity: 1500, distance: 20,
    }),
]);
