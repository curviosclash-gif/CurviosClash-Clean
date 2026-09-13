// The 2019 fire is not flown like the restoration site. The fast line climbs through the opened
// roof and the crossing breach; the longer line stays low in the north aisle and transept. Each
// choice persists for two checkpoints before the routes meet, so it changes more than one turn.

import {
    AISLE_RUN,
    GROUND,
    NAVE_VAULT,
} from '../notre_dame/NotreDameStructure.js';
import { NOTRE_DAME_PARCOURS_RULES } from '../notre_dame/NotreDameRoute.js';

export const NOTRE_DAME_FIRE_CHECKPOINTS = Object.freeze([
    { id: 'FCP01', type: 'entry', pos: [-196, GROUND + 14, 0], radius: 7.2, forward: [1, 0, 0] },
    { id: 'FCP02', type: 'smoke_approach', pos: [-156, GROUND + 19, 8], radius: 6.4, forward: [1, 0.05, -0.08] },
    { id: 'FCP03', type: 'parvis', pos: [-112, GROUND + 13, 0], radius: 6.4, forward: [1, 0.05, 0] },
    {
        id: 'FCP04',
        type: 'branch_entry',
        pos: [-96, GROUND + 18, 0],
        radius: 6,
        forward: [1, 0.12, 0],
        nextIds: ['FCP05_ROOF', 'FCP05_AISLE'],
    },
    {
        id: 'FCP05_ROOF',
        type: 'roof_breach_fast',
        pos: [-72, NAVE_VAULT + 7, 0],
        radius: 5,
        forward: [1, 0.16, 0],
        nextIds: ['FCP06_ROOF'],
        params: { label: 'Dachöffnung schnell', height: 'high', risk: 'fire', color: 0xff6b2c },
    },
    {
        id: 'FCP05_AISLE',
        type: 'aisle_safe',
        pos: [-72, AISLE_RUN, -19.6],
        radius: 4.4,
        forward: [1, 0.03, 0.1],
        nextIds: ['FCP06_AISLE'],
        params: { label: 'Seitenschiff sicher', height: 'low', risk: 'safe', color: 0x55b8ff },
    },
    {
        id: 'FCP06_ROOF',
        type: 'burning_attic',
        pos: [-28, NAVE_VAULT + 12, 3],
        radius: 4.8,
        forward: [1, -0.08, 0],
        nextIds: ['FCP07'],
        params: { label: 'Brennender Dachstuhl', height: 'high', risk: 'fire', color: 0xff9a38 },
    },
    {
        id: 'FCP06_AISLE',
        type: 'north_aisle',
        pos: [-28, AISLE_RUN, -19.6],
        radius: 4.2,
        forward: [1, 0.04, 0.12],
        nextIds: ['FCP07'],
        params: { label: 'Nördliches Seitenschiff', height: 'low', risk: 'safe', color: 0x55b8ff },
    },
    { id: 'FCP07', type: 'crossing_merge', pos: [17, GROUND + 30, 0], radius: 6.6, forward: [1, 0, 0] },
    {
        id: 'FCP08',
        type: 'branch_entry',
        pos: [29, GROUND + 31, 0],
        radius: 6,
        forward: [1, 0, 0],
        nextIds: ['FCP09_BREACH', 'FCP09_TRANSEPT'],
    },
    {
        id: 'FCP09_BREACH',
        type: 'choir_breach_fast',
        pos: [43, GROUND + 48, -5],
        radius: 4.8,
        forward: [1, -0.08, 0.08],
        nextIds: ['FCP10_BREACH'],
        params: { label: 'Glutöffnung schnell', height: 'high', risk: 'fire', color: 0xff6b2c },
    },
    {
        id: 'FCP09_TRANSEPT',
        type: 'transept_safe',
        pos: [29, GROUND + 25, 25],
        radius: 4.6,
        forward: [0.65, 0, 0.76],
        nextIds: ['FCP10_TRANSEPT'],
        params: { label: 'Querhaus sicher', height: 'low', risk: 'safe', color: 0x55b8ff },
    },
    {
        id: 'FCP10_BREACH',
        type: 'choir_high',
        pos: [62, GROUND + 40, 0],
        radius: 4.8,
        forward: [1, -0.1, 0],
        nextIds: ['FCP11'],
        params: { label: 'Chor hoch', height: 'high', risk: 'fire', color: 0xff9a38 },
    },
    {
        id: 'FCP10_TRANSEPT',
        type: 'ambulatory_safe',
        pos: [59, AISLE_RUN, 18],
        radius: 4.4,
        forward: [0.58, -0.75, 0.12],
        nextIds: ['FCP11'],
        params: { label: 'Umgang sicher', height: 'low', risk: 'safe', color: 0x55b8ff },
    },
    { id: 'FCP11', type: 'apse_merge', pos: [82, GROUND + 23, 0], radius: 6, forward: [1, 0.08, 0] },
    { id: 'FCP12', type: 'east_exit', pos: [96, GROUND + 27, 15], radius: 5.6, forward: [0.72, 0.08, 0.7] },
    { id: 'FCP13', type: 'riverside_escape', pos: [113, GROUND + 33, 43], radius: 5.8, forward: [0.65, 0.08, 0.76] },
    { id: 'FCP14', type: 'evacuation_lane', pos: [132, GROUND + 38, 65], radius: 6.2, forward: [0.78, 0.04, 0.62] },
]);

export const NOTRE_DAME_FIRE_FINISH = Object.freeze({
    id: 'FIRE_EVACUATION',
    type: 'finish',
    pos: [158, GROUND + 40, 82],
    radius: 7.2,
    forward: [0.8, 0.03, 0.6],
    params: { label: 'Evakuierung Ostkai' },
});

export const NOTRE_DAME_FIRE_PARCOURS_RULES = Object.freeze({
    ...NOTRE_DAME_PARCOURS_RULES,
    maxSegmentTimeMs: 34000,
});
