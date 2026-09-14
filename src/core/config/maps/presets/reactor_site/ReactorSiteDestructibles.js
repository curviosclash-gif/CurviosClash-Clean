// What a match may shoot apart on the reactor site, and which baked collapse each break plays.
//
// Break plan (the answers to the questions of the destructible-map skill, phase 0)
// ------------------------------------------------------------------------------------------------
// Structures, five of them, each one segment:
//   cooling_tower_w, cooling_tower_e   `leg_mid`   the two hyperboloid shells. Shot at the base
//                                                  they lose their near flank and keel over onto
//                                                  their own side - the anchor's heading, west or
//                                                  east, away from the plant. They do not seal.
//   vent_stack                         `summit`    the discharge chimney. It stands on the axis
//                                                  of its own slot and has no side of its own, so
//                                                  it topples along the shot, shearing a third of
//                                                  the way up. Does not seal.
//   turbine_hall                       `leg_mid`   the hall's shell: the roof pancakes, the four
//                                                  walls go over outwards to their own sides. The
//                                                  slot is never turned (yawFromEvent false), so
//                                                  the kind's fall rule is moot; leg_mid is the
//                                                  non-sealing kind that describes a load-bearing
//                                                  structure. Does not seal.
//   reactor_dome                       `leg_lower` the containment. Its breach is the finale: the
//                                                  mushroom cloud, and the seal - after it nothing
//                                                  else on the site can be shot apart.
// Pieces, twelve: shell and debris per tower, lower and upper of the stack, the hall's roof, two
// long walls and two gables, and the reactor's ruin. Every piece exists exactly once, so every
// scene lists only its own.
// Order: every structure breaks independently and in any order; the reactor ends it. No scene
// carries a piece of another, so no scene ever has to hide what an earlier one dropped.
// Field: half of 310 authored units, from the tower's measured reach (ReactorSiteStructure.js).
// Modes: HUNT only, the decision the Eiffel siege took - an arcade run is scored on progress,
// and a plant that can be removed from the route would change what that run is worth.
// Decided by the user: the plant, the mushroom cloud on the reactor, the buildings breaking too.
// Assumed: which structure seals (the reactor), the hit points, the fall directions.
//
// Compass convention: north is +Z (the switchyard), east +X. The towers stand on the X axis, so
// a tower's anchor heading is due west or due east and its wreck lands outside the plant. The
// stack stands east of the hall; a shot from the west sends it away from everything.
//
// All four topples are baked falling towards world +X (Blender +X), which is heading
// atan2(1, 0) = pi/2. Each scene states that as `bakedHeading` and the runtime turns the slot by
// the difference between the event heading and it. The hall and the cloud do not turn at all.
//
// `gameModes: ['HUNT']` is read against the strategy's `modeType`; in Classic and Arcade the very
// same map is flown as intact concrete.

import {
    GROUND,
    up,
    TOWER_X,
    HALL_Z,
    STACK_X,
    STACK_Z,
} from './ReactorSiteStructure.js';

// A tower costs the most ammunition after the reactor; the stack is the cheap trophy; the hall is
// big but thin-walled.
const HP = Object.freeze({ tower: 500, stack: 250, hall: 400, reactor: 900 });

/** World heading the four topple clips were baked falling towards: +X, read as atan2(x, z). */
const BAKED_HEADING = Math.atan2(1, 0);

/** Every piece of the map, in the order the scenes drop them. */
export const REACTOR_SITE_PIECES = Object.freeze([
    'tower_w_shell', 'tower_w_debris',
    'tower_e_shell', 'tower_e_debris',
    'stack_lower', 'stack_upper',
    'hall_roof', 'hall_wall_n', 'hall_wall_s', 'hall_gable_w', 'hall_gable_e',
    'reactor',
]);

export const REACTOR_SITE_DESTRUCTIBLES = Object.freeze({
    gameModes: Object.freeze(['HUNT']),
    segments: Object.freeze([
        {
            id: 'cooling_tower_w',
            label: 'Kühlturm West',
            kind: 'leg_mid',
            hp: HP.tower,
            // Both towers export the very same mesh names; the anchor tells them apart.
            meshPrefixes: ['cooling_tower'],
            anchor: [-TOWER_X, GROUND, 0],
            piece: 'tower_w_shell',
        },
        {
            id: 'cooling_tower_e',
            label: 'Kühlturm Ost',
            kind: 'leg_mid',
            hp: HP.tower,
            meshPrefixes: ['cooling_tower'],
            anchor: [TOWER_X, GROUND, 0],
            piece: 'tower_e_shell',
        },
        {
            id: 'vent_stack',
            label: 'Kamin',
            kind: 'summit',
            hp: HP.stack,
            meshPrefixes: ['vent_stack'],
            anchor: [STACK_X, GROUND, STACK_Z],
            piece: 'stack_lower',
        },
        {
            id: 'turbine_hall',
            label: 'Turbinenhalle',
            kind: 'leg_mid',
            hp: HP.hall,
            meshPrefixes: ['turbine_hall'],
            anchor: [0, GROUND, HALL_Z],
            piece: 'hall_roof',
        },
        {
            id: 'reactor_dome',
            label: 'Reaktor',
            kind: 'leg_lower',
            hp: HP.reactor,
            meshPrefixes: ['reactor_block'],
            anchor: [0, up(33), 0],
            piece: 'reactor',
        },
    ]),
    pieces: REACTOR_SITE_PIECES,
    // Every scene answers exactly one segment, by id: two segments share the kind `leg_mid` and
    // two towers share one file, so a trigger by kind could not tell them apart.
    breakScenes: Object.freeze([
        {
            id: 'topple_tower_w',
            trigger: { segmentId: 'cooling_tower_w' },
            modelId: 'reactor-topple-tower-west',
            bakedHeading: BAKED_HEADING,
            pieces: ['tower_w_shell', 'tower_w_debris'],
            hideModelIds: ['reactor-cooling-tower-west'],
        },
        {
            id: 'topple_tower_e',
            trigger: { segmentId: 'cooling_tower_e' },
            modelId: 'reactor-topple-tower-east',
            bakedHeading: BAKED_HEADING,
            pieces: ['tower_e_shell', 'tower_e_debris'],
            hideModelIds: ['reactor-cooling-tower-east'],
        },
        {
            id: 'topple_stack',
            trigger: { segmentId: 'vent_stack' },
            modelId: 'reactor-topple-stack',
            bakedHeading: BAKED_HEADING,
            pieces: ['stack_lower', 'stack_upper'],
            hideModelIds: ['reactor-vent-stack'],
        },
        {
            id: 'collapse_hall',
            trigger: { segmentId: 'turbine_hall' },
            modelId: 'reactor-collapse-hall',
            // Every wall falls to its own side; the slot stays as it stands.
            yawFromEvent: false,
            pieces: ['hall_roof', 'hall_wall_n', 'hall_wall_s', 'hall_gable_w', 'hall_gable_e'],
            hideModelIds: ['reactor-turbine-hall'],
        },
        {
            id: 'mushroom_cloud',
            trigger: { segmentId: 'reactor_dome' },
            modelId: 'reactor-mushroom-cloud',
            // A cloud has no direction. The heading the event records is not applied.
            yawFromEvent: false,
            pieces: ['reactor'],
            hideModelIds: ['reactor-block'],
        },
    ]),
});
