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

export const NOTRE_DAME_FIRE_MODELS = [...SURVIVING, ...NOTRE_DAME_FIRE_DAMAGE];
export const NOTRE_DAME_FIRE_REPLACED_MODEL_IDS = REPLACED_MODEL_IDS;
