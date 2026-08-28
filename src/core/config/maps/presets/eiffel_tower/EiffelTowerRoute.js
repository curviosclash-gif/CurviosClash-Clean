// The parcours route up the Eiffel Tower.
//
// Notre-Dame is flown along a building; this one is flown up one, and that is the whole point of
// having both. A run comes in low over the Champ-de-Mars, passes between the two western piers,
// and then meets the illumination iris under the middle of the tower -- the gate that teaches the
// map's rule, because the way up is always open somewhere and never where it just was. Above it
// comes the first real choice: straight up the open middle of the first gallery, or out and
// through the lattice of a leg with a lift car running in it. Both come out over the first floor.
// The second choice is the same one at height: the inside of the upper shaft, sharing the channel
// with the summit lift, or the long way round the outside of the second gallery. From there the
// route spirals up the shaft, crosses the beacon sweep at the top platform, and finishes at the
// antenna.
//
// Coordinates are authored units with the esplanade at y = 8, matching EiffelTowerStructure.

import {
    up,
    FIRST_DECK,
    SECOND_DECK,
    TOP_DECK,
    SECOND_OUTER,
} from './EiffelTowerStructure.js';

const EIFFEL_TOWER_CHECKPOINTS = [
    { id: 'CP01', type: 'entry', pos: [-72, up(20.0), 0], radius: 7.0, forward: [1, 0, 0] },
    // Between the two western piers. The gap is 60 units wide, so this ring is about aiming, not
    // about threading -- it is the last easy one.
    { id: 'CP02', type: 'piers', pos: [-37, up(18.0), 0], radius: 6.4, forward: [1, 0.08, 0] },
    // The iris. A run arrives level and leaves climbing, so the ring faces the average of the two.
    { id: 'CP03', type: 'iris', pos: [0, up(20.0), 0], radius: 5.8, forward: [0.5, 0.87, 0] },
    {
        id: 'CP04',
        type: 'branch_entry',
        pos: [0, up(38.0), 0],
        radius: 6.0,
        forward: [0, 1, 0],
        nextIds: ['CP05_CORE', 'CP05_LEG'],
    },
    // Inner line: straight up through the open middle of the first gallery. Fast, and completely
    // exposed to anyone already above.
    {
        id: 'CP05_CORE',
        type: 'core_inner',
        pos: [0, up(59.0), 0],
        radius: 5.0,
        forward: [0, 1, 0],
        nextIds: ['CP06'],
        params: { label: 'Kern innen', height: 'high', color: 0xffbf45 },
    },
    // Outer line: out past the north-east leg and up its outside, alongside the lift car climbing
    // it. Longer than the inner line, but it is open air rather than a shaft someone can sit above.
    // The ring is tilted outward, not straight up: a run arrives climbing away from the axis and
    // leaves turning back over the gallery, and a ring aimed at either leg alone stands edge-on to
    // the other.
    {
        id: 'CP05_LEG',
        type: 'leg_outer',
        pos: [26, up(56.7), 26],
        radius: 4.6,
        forward: [0.25, 0.94, 0.25],
        nextIds: ['CP06'],
        params: { label: 'Pfeiler außen', height: 'low', color: 0x4da6ff },
    },
    { id: 'CP06', type: 'first_merge', pos: [0, FIRST_DECK + 10, 0], radius: 6.4, forward: [0, 1, 0] },
    {
        id: 'CP07',
        type: 'branch_entry',
        pos: [0, up(92.0), 0],
        radius: 6.0,
        forward: [0, 1, 0],
        nextIds: ['CP08_SHAFT', 'CP08_GALLERY'],
    },
    // The shortcut: up the inside of the shaft, through the opening in the second gallery, with
    // the summit lift running in the same channel.
    {
        id: 'CP08_SHAFT',
        type: 'shaft_inner',
        pos: [0, SECOND_DECK + 1.2, 0],
        radius: 4.2,
        forward: [0, 1, 0],
        nextIds: ['CP09'],
        params: { label: 'Schacht innen', height: 'high', color: 0xffbf45 },
    },
    // The long way: out under the second gallery and back up its outside.
    {
        id: 'CP08_GALLERY',
        type: 'gallery_outer',
        pos: [SECOND_OUTER + 3.5, SECOND_DECK - 2, -SECOND_OUTER - 3.5],
        radius: 4.6,
        // Same rule as the leg lane: the ring bisects the arrival and the turn back to the axis.
        forward: [0.2, 0.96, -0.2],
        nextIds: ['CP09'],
        params: { label: 'Galerie außen', height: 'low', color: 0x4da6ff },
    },
    { id: 'CP09', type: 'second_merge', pos: [0, SECOND_DECK + 12, 0], radius: 6.0, forward: [0, 1, 0] },
    // Four rings up the outside of the shaft. They step a quarter turn each, so the climb is a
    // spiral around the iron rather than a straight line beside it.
    { id: 'CP10', type: 'spiral', pos: [12, up(160.0), 0], radius: 5.0, forward: [0, 0.94, -0.34] },
    { id: 'CP11', type: 'spiral', pos: [0, up(190.0), -11], radius: 4.8, forward: [-0.34, 0.94, 0] },
    { id: 'CP12', type: 'spiral', pos: [-10, up(220.0), 0], radius: 4.6, forward: [0, 0.94, 0.34] },
    { id: 'CP13', type: 'spiral', pos: [0, up(250.0), 9], radius: 4.4, forward: [0.34, 0.94, 0] },
    // The top platform, inside the beacon sweep.
    { id: 'CP14', type: 'summit', pos: [0, TOP_DECK + 4, 8], radius: 5.4, forward: [0, 0.95, -0.3] },
];

const EIFFEL_TOWER_FINISH = {
    id: 'FINISH',
    type: 'finish',
    pos: [0, up(316.0), 0],
    radius: 7.0,
    forward: [0, 1, 0],
};

const EIFFEL_TOWER_PARCOURS_RULES = {
    ordered: true,
    bidirectionalCheckpoints: false,
    resetOnDeath: false,
    resetToLastValid: true,
    respawnOnDeath: true,
    lastCheckpointRespawns: 3,
    respawnDelaySeconds: 3,
    maxSegmentTimeMs: 30000,
    cooldownMs: 450,
    wrongOrderCooldownMs: 650,
    wrongOrderPenaltyMs: 2400,
    errorIndicatorMs: 1400,
    allowLaneAliases: true,
    winnerByParcoursComplete: true,
    animateCheckpoints: true,
    showGhost: true,
};

export { EIFFEL_TOWER_CHECKPOINTS, EIFFEL_TOWER_FINISH, EIFFEL_TOWER_PARCOURS_RULES };
