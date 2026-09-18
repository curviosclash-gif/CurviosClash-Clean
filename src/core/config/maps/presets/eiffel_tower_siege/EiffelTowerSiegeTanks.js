// Two tanks patrol the esplanade around the tower (S5.10, the first map with map units).
//
// The square runs 95 authored units out from the tower axis: well clear of the 37.5 unit leg
// square, 45 units inside the secret room's entry portal at x = -140 and 60 units inside the field
// edge at 155. It lies on the ground at y = 8 (the top of the siege ground slab). Both tanks drive
// the same circuit in the same direction, starting on opposite corners, so one of them is always
// on the far side of the tower.
//
// The map scales its authored anchors (scaleAuthoredAnchors), so every spatial value here is in
// authored units and grows by the map scale (3): speed 4 is 12 world units per second - the tank
// start value - and the ranges 20/30 are the start values 60/90. Hit points and loot are not
// spatial and use the defaults.

const GROUND = 8;
const RING = 95;

const NE = Object.freeze([RING, GROUND, RING]);
const SE = Object.freeze([RING, GROUND, -RING]);
const SW = Object.freeze([-RING, GROUND, -RING]);
const NW = Object.freeze([-RING, GROUND, RING]);

const TANK = Object.freeze({
    kind: 'tank',
    loop: true,
    speed: 4,
    hitboxRadius: 3.5,
    weapons: Object.freeze({
        mg: Object.freeze({ damage: 3, cooldown: 0.3, range: 20 }),
        rocket: Object.freeze({ rocketType: 'ROCKET_MEDIUM', cooldown: 5, range: 30 }),
    }),
    allowedModes: Object.freeze(['HUNT', 'ARCADE']),
});

export const EIFFEL_SIEGE_TANK_RING = RING;

export const EIFFEL_SIEGE_TANKS = Object.freeze([
    Object.freeze({ ...TANK, id: 'eiffel_siege_tank_north', path: Object.freeze([NE, SE, SW, NW]) }),
    Object.freeze({ ...TANK, id: 'eiffel_siege_tank_south', path: Object.freeze([SW, NW, NE, SE]) }),
]);
