// Notre-Dame on the night of 15 April 2019: the look of the burning cathedral. Since the evolution
// map absorbed the stand-alone fire maps (notre_dame_fire / notre_dame_fire_arena are only hidden
// redirects now, see ../notre_dame/NotreDameEvolution.js), what is left here is the light, the
// particles, the hazards and the audio profile the evolution blends in as the building burns.
// The burnt GLBs under assets/maps/notre_dame_fire are the source of the evolution models and are
// no longer placed by a preset of their own.
//
// The light is copied rather than shared, on purpose. See NotreDameFireLighting.js.

import { NOTRE_DAME_COMMON } from '../notre_dame/index.js';
import { GROUND } from '../notre_dame/NotreDameStructure.js';
import {
    NOTRE_DAME_FIRE_LIGHTING,
    NOTRE_DAME_FIRE_ARENA_LIGHTING,
    NOTRE_DAME_FIRE_LIGHTS,
} from './NotreDameFireLighting.js';
import { NOTRE_DAME_FIRE_FX } from './NotreDameFireFx.js';
import { NOTRE_DAME_FIRE_HAZARDS } from './NotreDameFireHazards.js';

export const NOTRE_DAME_FIRE_AUDIO_PROFILE = Object.freeze({
    id: 'notre_dame_fire',
    // The fire is still in the same cathedral; retaining the measured interior and work-site
    // anchors keeps its fades aligned with the geometry while the mix itself changes completely.
    interiorBounds: NOTRE_DAME_COMMON.audioProfile.interiorBounds,
    collapse: Object.freeze({
        position: Object.freeze([4, GROUND + 42, 0]),
        intervalSeconds: 23,
        phaseOffsetSeconds: 11,
        audibleRadius: 170,
    }),
});

export const NOTRE_DAME_FIRE_LOOK = Object.freeze({
    lighting: NOTRE_DAME_FIRE_LIGHTING,
    arenaLighting: NOTRE_DAME_FIRE_ARENA_LIGHTING,
    lights: NOTRE_DAME_FIRE_LIGHTS,
    fireFx: NOTRE_DAME_FIRE_FX,
    audioProfile: NOTRE_DAME_FIRE_AUDIO_PROFILE,
    mapHazards: NOTRE_DAME_FIRE_HAZARDS,
});
