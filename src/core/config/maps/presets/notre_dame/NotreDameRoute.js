// The parcours route through Notre-Dame.
//
// The building supplies the course; nothing here is an arbitrary waypoint. A run comes up the
// river, crosses the island square, and then faces the first real choice: go
// straight through the central portal at ground level, or climb and thread the
// west rose. Both land in the nave. Inside, the choice is height -- the timber attic above the
// vault, or the dark aisle beside it. They meet at the crossing under the spire. The choir offers
// the last pair, the high vessel or the ambulatory round the chapels, and both come out at the
// apse. The return route crosses the two open bell chambers before climbing to the spire lantern.
//
// Coordinates are authored units with the church floor at y = 8, matching NotreDameStructure.

import {
    GROUND,
    AISLE_RUN,
    NAVE_VAULT,
    CROSSING_CENTRE,
} from './NotreDameStructure.js';

// The existing east apse bore is centred on the nave axis; guidance keeps both selected lanes
// inside it while the checkpoint graph remains compact.
const APSE_BORE_Y = GROUND + 27;
const APSE_BORE_Z = 4;
const APSE_ROUTE_Z = 4;

const NOTRE_DAME_CHECKPOINTS = [
    { id: 'CP01', type: 'entry', pos: [-196, GROUND + 14, 0], radius: 7.2, forward: [1, 0, 0] },
    // The open island approach leads into the square and the west facade.
    { id: 'CP02', type: 'island_entry', pos: [-150, GROUND + 16, 0], radius: 6.4, forward: [1, 0, 0] },
    { id: 'CP03', type: 'parvis', pos: [-112, GROUND + 12, 0], radius: 6.4, forward: [1, 0.05, 0] },
    {
        id: 'CP04',
        type: 'branch_entry',
        pos: [-99, GROUND + 14, 0],
        radius: 6.0,
        forward: [1, 0.1, 0],
        nextIds: ['CP05_ROSE', 'CP05_PORTAL'],
    },
    // High line: climb beside the facade and through the west rose.
    {
        id: 'CP05_ROSE',
        type: 'rose_high',
        pos: [-83, GROUND + 37, 0],
        radius: 4.6,
        forward: [1, -0.15, 0],
        nextIds: ['CP06'],
        params: { label: 'Rose hoch', height: 'high', color: 0xffbf45 },
    },
    // Low line: straight in through the central portal.
    {
        id: 'CP05_PORTAL',
        type: 'portal_low',
        pos: [-83, GROUND + 9, 0],
        radius: 4.4,
        forward: [1, 0.05, 0],
        nextIds: ['CP06'],
        params: { label: 'Portal niedrig', height: 'low', color: 0x4da6ff },
    },
    { id: 'CP06', type: 'nave_merge', pos: [-62, GROUND + 22, 0], radius: 6.2, forward: [1, 0, 0] },
    {
        id: 'CP07',
        type: 'branch_entry',
        pos: [-44, GROUND + 24, 0],
        radius: 6.0,
        forward: [1, 0.1, 0],
        nextIds: ['CP08_ATTIC', 'CP08_AISLE'],
    },
    // The forest: the timber roof space above the vault, and the reason the map has an attic.
    {
        id: 'CP08_ATTIC',
        type: 'attic_high',
        pos: [-16, NAVE_VAULT + 8, 0],
        radius: 4.8,
        forward: [1, -0.1, 0],
        nextIds: ['CP09'],
        params: { label: 'Dachstuhl hoch', height: 'high', color: 0xffbf45 },
    },
    // The aisle: tighter and darker than the nave. The ring
    // sits on the flight line through the aisle, not up against its ceiling.
    {
        id: 'CP08_AISLE',
        type: 'aisle_low',
        pos: [-16, AISLE_RUN, -19.6],
        radius: 4.2,
        forward: [1, 0.05, 0.2],
        nextIds: ['CP09'],
        params: { label: 'Seitenschiff niedrig', height: 'low', color: 0x4da6ff },
    },
    { id: 'CP09', type: 'crossing', pos: [CROSSING_CENTRE, GROUND + 30, 0], radius: 6.6, forward: [1, 0, 0] },
    {
        id: 'CP10',
        type: 'branch_entry',
        pos: [32, GROUND + 32, 0],
        radius: 6.0,
        forward: [1, 0, 0],
        nextIds: ['CP11_CHOIR', 'CP11_AMBULATORY'],
    },
    {
        id: 'CP11_CHOIR',
        type: 'choir_high',
        pos: [52, GROUND + 30, 0],
        radius: 5.0,
        forward: [1, 0, 0],
        nextIds: ['CP11_APSE_EXIT'],
        params: { label: 'Chor hoch', height: 'high', color: 0xffbf45 },
    },
    {
        id: 'CP11_AMBULATORY',
        type: 'ambulatory_low',
        pos: [52, AISLE_RUN, -19.6],
        radius: 4.2,
        forward: [1, 0.1, 0.3],
        nextIds: ['CP11_APSE_EXIT'],
        params: { label: 'Umgang niedrig', height: 'low', color: 0x4da6ff },
    },
    {
        id: 'CP11_APSE_EXIT',
        type: 'apse_exit',
        pos: [68, GROUND + 26, APSE_ROUTE_Z],
        radius: 4.8,
        forward: [1, 0, 0],
        nextIds: ['CP11_APSE_APPROACH'],
    },
    {
        id: 'CP11_APSE_EXIT_AMBULATORY',
        type: 'apse_exit_ambulatory',
        aliasOf: 'CP11_APSE_EXIT',
        pos: [60, GROUND + 8, 0],
        radius: 4.2,
        forward: [1, 0, 0],
    },
    {
        id: 'CP11_APSE_APPROACH',
        type: 'apse_approach',
        pos: [80, GROUND + 26, APSE_ROUTE_Z],
        radius: 2.4,
        forward: [1, 0, 0],
        nextIds: ['CP12'],
    },
    // CP12's forward plane crosses the existing east bore, whose opening is centred on the nave axis.
    { id: 'CP12', type: 'apse_merge', pos: [86, APSE_BORE_Y, APSE_BORE_Z], radius: 5.4, forward: [1, 0, 0] },
    // Both rings stay in the requested 46-61 m height band and above the hanging bells.
    { id: 'CP13', type: 'south_belfry', pos: [-83, GROUND + 57 * 1.4, 20.3], radius: 3.4, forward: [-0.67, 0.34, -0.62] },
    { id: 'CP14', type: 'north_belfry', pos: [-83, GROUND + 61 * 1.4, -20.3], radius: 3.4, forward: [0.78, 0.22, -0.61] },
];

const NOTRE_DAME_FINISH = {
    id: 'FINISH',
    type: 'finish',
    pos: [CROSSING_CENTRE, GROUND + 72 * 1.4, 0],
    radius: 4.0,
    // The return leg climbs from CP14's bell chamber into the spire lantern, so the finish
    // plane faces east and back toward the north approach instead of straight up.
    forward: [0.967, 0.156, 0.206],
};

const NOTRE_DAME_PARCOURS_RULES = {
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

const NOTRE_DAME_GUIDANCE_PATHS = [
    {
        branchCheckpointId: 'CP11_CHOIR',
        endCheckpointId: 'CP12',
        points: [[52, GROUND + 30, 0], [60, GROUND + 30, 0], [64, GROUND + 28, 2], [68, GROUND + 26, APSE_ROUTE_Z], [72, GROUND + 26, APSE_ROUTE_Z], [76, GROUND + 26, APSE_ROUTE_Z], [80, GROUND + 26, APSE_ROUTE_Z], [82, GROUND + 26, APSE_ROUTE_Z], [84, GROUND + 27, APSE_BORE_Z], [86, GROUND + 27, APSE_BORE_Z], [94, GROUND + 27, APSE_BORE_Z]],
    },
    {
        branchCheckpointId: 'CP11_AMBULATORY',
        endCheckpointId: 'CP12',
        points: [[52, AISLE_RUN, -19.6], [53, 17, -8.6], [54, 18, 2.4], [57, 18, 3], [60, AISLE_RUN, 0], [62, 20, 0], [64, 24, 0], [68, 26, 0], [72, 28, 0], [76, 32, 2], [80, GROUND + 26, APSE_ROUTE_Z], [82, GROUND + 26, APSE_ROUTE_Z], [84, GROUND + 27, APSE_BORE_Z], [86, GROUND + 27, APSE_BORE_Z], [94, GROUND + 27, APSE_BORE_Z]],
    },
];

export { NOTRE_DAME_CHECKPOINTS, NOTRE_DAME_FINISH, NOTRE_DAME_PARCOURS_RULES, NOTRE_DAME_GUIDANCE_PATHS };
