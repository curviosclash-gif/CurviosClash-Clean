// The parcours route through Notre-Dame.
//
// The building supplies the course; nothing here is an arbitrary waypoint. A run comes up the
// river, passes the site hoarding, crosses the square, and then faces the first real choice: go
// straight through the central portal at ground level, or take the scaffold up and thread the
// west rose. Both land in the nave. Inside, the choice is height -- the timber attic above the
// vault, or the dark aisle beside it. They meet at the crossing under the spire. The choir offers
// the last pair, the high vessel or the ambulatory round the chapels, and both come out at the
// apse. The return leg runs outside, threading the flying buttresses, and finishes at the spire
// section waiting on its lifting gantry east of the building.
//
// Coordinates are authored units with the church floor at y = 8, matching NotreDameStructure.

import {
    GROUND,
    AISLE_RUN,
    NAVE_VAULT,
    ROOF_RIDGE,
    CROSSING_CENTRE,
} from './NotreDameStructure.js';

const NOTRE_DAME_CHECKPOINTS = [
    { id: 'CP01', type: 'entry', pos: [-196, GROUND + 14, 0], radius: 7.2, forward: [1, 0, 0] },
    // The hoarding: its gap travels, so this is where a player first has to read the site rather
    // than simply aim at it.
    { id: 'CP02', type: 'hoarding', pos: [-150, GROUND + 16, 0], radius: 6.4, forward: [1, 0, 0] },
    { id: 'CP03', type: 'parvis', pos: [-112, GROUND + 12, 0], radius: 6.4, forward: [1, 0.05, 0] },
    {
        id: 'CP04',
        type: 'branch_entry',
        pos: [-99, GROUND + 14, 0],
        radius: 6.0,
        forward: [1, 0.1, 0],
        nextIds: ['CP05_ROSE', 'CP05_PORTAL'],
    },
    // High line: up the turning scaffold and through the west rose.
    {
        id: 'CP05_ROSE',
        type: 'rose_high',
        pos: [-83, GROUND + 37, 0],
        radius: 4.6,
        forward: [1, -0.15, 0],
        nextIds: ['CP06'],
    },
    // Low line: straight in through the central portal.
    {
        id: 'CP05_PORTAL',
        type: 'portal_low',
        pos: [-83, GROUND + 9, 0],
        radius: 4.4,
        forward: [1, 0.05, 0],
        nextIds: ['CP06'],
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
    },
    // The aisle: tighter, darker, and it passes the gantry sweeping the nave beside it. The ring
    // sits on the flight line through the aisle, not up against its ceiling.
    {
        id: 'CP08_AISLE',
        type: 'aisle_low',
        pos: [-16, AISLE_RUN, -19.6],
        radius: 4.2,
        forward: [1, 0.05, 0.2],
        nextIds: ['CP09'],
    },
    { id: 'CP09', type: 'crossing', pos: [CROSSING_CENTRE, GROUND + 30, 0], radius: 6.6, forward: [1, 0, 0] },
    {
        id: 'CP10',
        type: 'branch_entry',
        pos: [32, GROUND + 30, 0],
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
        nextIds: ['CP12'],
    },
    {
        id: 'CP11_AMBULATORY',
        type: 'ambulatory_low',
        pos: [52, AISLE_RUN, -19.6],
        radius: 4.2,
        forward: [1, 0.1, 0.3],
        nextIds: ['CP12'],
    },
    // Both choir branches meet inside the apse and leave east through the opening in its end
    // wall, so the ring stands in the vessel and faces the way out rather than up into the roof.
    { id: 'CP12', type: 'apse_merge', pos: [79, GROUND + 23, 0], radius: 6.0, forward: [1, 0.1, 0] },
    // The return leg runs outside, between the buttress piers. It picks up the north side at the
    // first gap east of the transept -- the arm itself carries no piers to thread.
    { id: 'CP13', type: 'buttress_run', pos: [41, GROUND + 33, 36], radius: 5.4, forward: [-0.95, 0, -0.3] },
    // Over the roof and away east. The ring faces the average of the two legs meeting here: a
    // player arrives climbing from the north buttresses and leaves descending to the east, so a
    // ring aimed at either one alone would sit edge-on to the other.
    { id: 'CP14', type: 'roof_crest', pos: [CROSSING_CENTRE, ROOF_RIDGE + 12, -52], radius: 5.6, forward: [0.85, 0.12, -0.51] },
];

const NOTRE_DAME_FINISH = {
    id: 'FINISH',
    type: 'finish',
    pos: [130, GROUND + 34, 0],
    radius: 7.2,
    forward: [1, 0.2, 0],
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

export { NOTRE_DAME_CHECKPOINTS, NOTRE_DAME_FINISH, NOTRE_DAME_PARCOURS_RULES };
