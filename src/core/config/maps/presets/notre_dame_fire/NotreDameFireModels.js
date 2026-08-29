// The burnt cathedral, assembled from the parts the fire changed plus the ones it did not.
//
// Three parts are swapped for burnt versions and one is new; everything else -- the west front,
// the choir and apse, the buttresses, the island and all eight moving site pieces -- is carried
// over as the very same object from the intact map. That is the point of filtering the list
// instead of writing a second one: a part that did not burn cannot drift, because there is only
// one of it.
//
// The placement numbers below are the bounding-box report the generator prints for each export,
// not estimates. The loader recentres every GLB on its own box and drops its lower edge onto the
// given Y, so a part states where its box centres along the building and how high its underside
// sits. Two of the burnt parts report a slightly different centre than their intact counterparts,
// because breach teeth and fallen rubble shift the box a little; the roof reports a far lower box
// because the spire is no longer in it.

import {
    NOTRE_DAME_MODELS,
    NOTRE_DAME_METRE,
    NOTRE_DAME_GROUND,
} from '../notre_dame/NotreDameModels.js';

const METRE = NOTRE_DAME_METRE;
const GROUND = NOTRE_DAME_GROUND;

// What the fire replaced. Everything else in the intact list survives unchanged.
const REPLACED_MODEL_IDS = new Set([
    'notre-dame-nave',
    'notre-dame-transept',
    'notre-dame-roof-fleche',
]);

const SURVIVING = NOTRE_DAME_MODELS.filter((model) => !REPLACED_MODEL_IDS.has(model.id));

/**
 * A burnt part, placed the same way the intact parts are.
 * @param {string} id
 * @param {string} file basename under assets/maps/notre_dame_fire/glb
 * @param {number} centreMetres where the part's bounding box centres along the building axis
 * @param {number} baseMetres height of the part's underside above the church floor
 */
function burnt(id, file, centreMetres, baseMetres) {
    return {
        id: `notre-dame-fire-${id}`,
        url: `assets/maps/notre_dame_fire/glb/${file}.glb`,
        position: [centreMetres * METRE, GROUND + baseMetres * METRE, 0],
        rotation: [0, 0, 0],
        scale: METRE,
    };
}

/**
 * A burning piece. Same placement rule as the static parts, plus its clip and where it runs
 * against the shared six second beat the whole site keeps.
 *
 * @param {string} id
 * @param {string} file basename under assets/maps/notre_dame_fire/glb
 * @param {string} clipName
 * @param {number} phaseOffsetBeats
 * @param {number} centreMetres where the part's bounding box centres along the building
 * @param {number} baseMetres height of the part's underside above the church floor
 * @param {number} centreAcrossMetres where it centres across the building
 */
function fire(id, file, clipName, phaseOffsetBeats, centreMetres, baseMetres, centreAcrossMetres) {
    return {
        id: `notre-dame-fire-${id}`,
        url: `assets/maps/notre_dame_fire/glb/${file}.glb`,
        position: [centreMetres * METRE, GROUND + baseMetres * METRE, centreAcrossMetres * METRE],
        rotation: [0, 0, 0],
        scale: METRE,
        animationClock: { clipName, phaseOffsetBeats },
    };
}

const NOTRE_DAME_FIRE_DAMAGE = [
    // The nave, with the north aisle vault down in the bay beside the crossing.
    burnt('nave', '02_nave_burnt', -24.68, -0.8),
    // The transept, open at the crossing where the spire fell through and at the north arm.
    burnt('transept', '03_transept_burnt', 12.25, -0.8),
    // What is left of the roof. Its box is 21.5 m tall where the intact part was 82.1, which is
    // the spire and the whole lead covering no longer being there.
    burnt('roof', '06_roof_burnt', 3.79, 14.06),
    // The spire itself, on the crossing floor. Solid, unlike the vault it came through.
    burnt('fleche-debris', '20_fleche_debris', 12.25, -0.23),
];

// The fire. None of it collides and none of it casts a shadow; it is what the map looks like.
// The three run against each other rather than together: the breaches on the beat, the roof a
// third behind it so the line of fire along the building never pulses as one block, and the ember
// column on its own two-beat loop so nothing about the rise reads as periodic.
const NOTRE_DAME_FIRE_FLAMES = [
    fire('breaches', '30_fire_breaches', 'FireBreachesLoop', 0, 9.52, 8.2, -7.23),
    fire('attic', '31_fire_attic', 'FireAtticLoop', 1 / 3, 2.49, 31.91, 0.03),
    fire('embers', '32_ember_column', 'EmberColumnLoop', 0, 11.12, 32.95, 1.32),
];

export const NOTRE_DAME_FIRE_MODELS = [
    ...SURVIVING,
    ...NOTRE_DAME_FIRE_DAMAGE,
    ...NOTRE_DAME_FIRE_FLAMES,
];
export const NOTRE_DAME_FIRE_REPLACED_MODEL_IDS = REPLACED_MODEL_IDS;
