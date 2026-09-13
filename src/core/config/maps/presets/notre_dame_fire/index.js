// Notre-Dame on the night of 15 April 2019: the roof timbers alight, the spire down through the
// vault, three breaches open into the nave. The same building as ../notre_dame, at the same scale
// and in the same coordinate system -- what differs is its condition and its light.
//
// Burnt fabric replaces the damaged building sections, while the later restoration machines are
// absent. See NotreDameFireModels.js for the deliberately small shared-fabric boundary.
//
// The light is copied rather than shared, on purpose. See NotreDameFireLighting.js.
//
// The authored obstacle set is deliberately still the intact one. Those boxes only ever compile
// when a GLB fails to load, and they are what keeps a match playable in that case -- a fallback
// that still has a roof is a better failure than a cathedral with no upper storey at all. What
// the fire changed is carried by the models, because with glbColliderMode 'scene' the drawn
// surface is the collision.

import { NOTRE_DAME_COMMON } from '../notre_dame/index.js';
import {
    GROUND,
} from '../notre_dame/NotreDameStructure.js';
import {
    NOTRE_DAME_FIRE_CHECKPOINTS,
    NOTRE_DAME_FIRE_FINISH,
    NOTRE_DAME_FIRE_PARCOURS_RULES,
} from './NotreDameFireRoute.js';
import {
    NOTRE_DAME_FIRE_LIGHTING,
    NOTRE_DAME_FIRE_ARENA_LIGHTING,
    NOTRE_DAME_FIRE_LIGHTS,
} from './NotreDameFireLighting.js';
import { NOTRE_DAME_FIRE_MODELS } from './NotreDameFireModels.js';
import { NOTRE_DAME_FIRE_FX } from './NotreDameFireFx.js';
import { NOTRE_DAME_FIRE_HAZARDS } from './NotreDameFireHazards.js';

const NOTRE_DAME_FIRE_ARENA_GATES = Object.freeze([
    { id: 'ndf_parvis_north', type: 'boost', pos: [-112, GROUND + 14, 25], forward: [1, 0.08, -0.2], params: { duration: 1, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
    { id: 'ndf_parvis_south', type: 'boost', pos: [-112, GROUND + 14, -25], forward: [1, 0.08, 0.2], params: { duration: 1, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
    { id: 'ndf_roof_dive', type: 'slingshot', pos: [-48, GROUND + 49, 0], forward: [1, 0.18, 0], up: [0, 1, 0], params: { duration: 1.35, forwardImpulse: 31, liftImpulse: 12, cooldown: 1 } },
    { id: 'ndf_crossing_escape', type: 'slingshot', pos: [17, GROUND + 38, -22], forward: [0, 0.25, 1], up: [0, 1, 0], params: { duration: 1.2, forwardImpulse: 30, liftImpulse: 11, cooldown: 1 } },
    { id: 'ndf_transept_north', type: 'boost', pos: [17, GROUND + 29, 49], forward: [0, 0.04, -1], params: { duration: 1, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
    { id: 'ndf_transept_south', type: 'boost', pos: [17, GROUND + 29, -49], forward: [0, 0.04, 1], params: { duration: 1, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
    { id: 'ndf_apse_exit', type: 'slingshot', pos: [84, GROUND + 25, 0], forward: [0.75, 0.2, 0.66], up: [0, 1, 0], params: { duration: 1.25, forwardImpulse: 31, liftImpulse: 10, cooldown: 1 } },
    { id: 'ndf_buttress_return', type: 'boost', pos: [43, GROUND + 34, 37], forward: [-0.96, 0.03, -0.18], params: { duration: 0.95, forwardImpulse: 35, bonusSpeed: 43, cooldown: 0.75 } },
]);

const NOTRE_DAME_FIRE_ARENA_ITEMS = Object.freeze([
    { id: 'ndf_shield_parvis', type: 'item_shield', pickupType: 'SHIELD', x: -115, y: GROUND + 13, z: 0, weight: 1 },
    { id: 'ndf_speed_roof_west', type: 'item_battery', pickupType: 'SPEED_UP', x: -47, y: GROUND + 55, z: 3, weight: 1.1 },
    { id: 'ndf_ghost_north_aisle', type: 'item_coin', pickupType: 'GHOST', x: -32, y: GROUND + 8, z: -20, weight: 0.9 },
    { id: 'ndf_rocket_crossing_high', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 17, y: GROUND + 50, z: 0, weight: 0.9 },
    { id: 'ndf_shield_crossing_low', type: 'item_shield', pickupType: 'SHIELD', x: 17, y: GROUND + 18, z: 15, weight: 1 },
    { id: 'ndf_speed_transept_north', type: 'item_battery', pickupType: 'SPEED_UP', x: 17, y: GROUND + 28, z: 43, weight: 1.1 },
    { id: 'ndf_speed_transept_south', type: 'item_battery', pickupType: 'SPEED_UP', x: 17, y: GROUND + 28, z: -43, weight: 1.1 },
    { id: 'ndf_ghost_apse', type: 'item_coin', pickupType: 'GHOST', x: 80, y: GROUND + 23, z: 0, weight: 0.8 },
    { id: 'ndf_heavy_buttress', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 52, y: GROUND + 34, z: 37, weight: 0.7 },
    { id: 'ndf_shield_east_quay', type: 'item_shield', pickupType: 'SHIELD', x: 124, y: GROUND + 36, z: 58, weight: 0.9 },
]);

export const NOTRE_DAME_FIRE_AUDIO_PROFILE = Object.freeze({
    id: 'notre_dame_fire',
    // The fire is still in the same cathedral; retaining the measured interior and work-site
    // anchors keeps its fades aligned with the geometry while the mix itself changes completely.
    interiorBounds: NOTRE_DAME_COMMON.audioProfile.interiorBounds,
    constructionCenters: NOTRE_DAME_COMMON.audioProfile.constructionCenters,
    constructionRadius: NOTRE_DAME_COMMON.audioProfile.constructionRadius,
    collapse: Object.freeze({
        position: Object.freeze([4, GROUND + 42, 0]),
        intervalSeconds: 23,
        phaseOffsetSeconds: 11,
        audibleRadius: 170,
    }),
});

const NOTRE_DAME_FIRE_COMMON = {
    ...NOTRE_DAME_COMMON,
    audioProfile: NOTRE_DAME_FIRE_AUDIO_PROFILE,
    fireFx: NOTRE_DAME_FIRE_FX,
    mapHazards: NOTRE_DAME_FIRE_HAZARDS,
    glbModels: NOTRE_DAME_FIRE_MODELS,
    lights: NOTRE_DAME_FIRE_LIGHTS,
};

export const NOTRE_DAME_FIRE_MAPS = {
    notre_dame_fire: {
        ...NOTRE_DAME_FIRE_COMMON,
        name: 'Notre-Dame Brand',
        lighting: NOTRE_DAME_FIRE_LIGHTING,
        // Approached up the river from the west, as on the restoration map. The spawns are
        // repeated rather than shared because the burning building is entered differently once
        // the breaches are open, and this is the line that will move then.
        playerSpawn: { x: -210, y: GROUND + 14, z: 0 },
        botSpawns: [
            { x: -210, y: GROUND + 14, z: -13 },
            { x: -210, y: GROUND + 14, z: 13 },
            { x: -198, y: GROUND + 14, z: -20 },
            { x: -198, y: GROUND + 14, z: 20 },
        ],
        missions: [
            { type: 'TIME_TRIAL', params: { target: 270 }, weight: 1.8 },
            { type: 'NO_DAMAGE', params: {}, weight: 0.7 },
            { type: 'ITEM_CHAIN', params: { target: 6 }, weight: 0.8 },
        ],
        parcours: {
            enabled: true,
            // Its own route identity from the start. The stages are still the restoration map's,
            // but they stop being the same course the moment the vault opens, and a shared id
            // would silently rank runs through two different buildings against each other.
            routeId: 'notre_dame_fire_v1',
            rules: NOTRE_DAME_FIRE_PARCOURS_RULES,
            checkpoints: NOTRE_DAME_FIRE_CHECKPOINTS,
            finish: NOTRE_DAME_FIRE_FINISH,
        },
    },

    notre_dame_fire_arena: {
        ...NOTRE_DAME_FIRE_COMMON,
        name: 'Notre-Dame Brand Arena',
        lighting: NOTRE_DAME_FIRE_ARENA_LIGHTING,
        gates: NOTRE_DAME_FIRE_ARENA_GATES,
        items: NOTRE_DAME_FIRE_ARENA_ITEMS,
        playerSpawn: { x: -112, y: GROUND + 16, z: 0 },
        botSpawns: [
            { x: -112, y: GROUND + 16, z: -28 },
            { x: 17, y: GROUND + 31, z: 53 },
            { x: 17, y: GROUND + 31, z: -53 },
            { x: 82, y: GROUND + 24, z: 0 },
            { x: -42, y: GROUND + 57, z: 3 },
            { x: 52, y: GROUND + 35, z: 38 },
        ],
        missions: [
            { type: 'NO_DAMAGE', params: {}, weight: 1.0 },
            { type: 'ITEM_CHAIN', params: { target: 5 }, weight: 1.2 },
        ],
    },
};
