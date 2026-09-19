import { GROUND, METRE } from './ReactorSiteStructure.js';

const ROOT = 'assets/maps/reactor_site/props';

/**
 * Place a bottom-centred prop authored in the same metres and axes as the reactor pack.
 * Blender Y points south, hence the sign change into map Z.
 */
function prop(family, variant, xMetres, yMetres, baseMetres = 0, yaw = 0) {
    const stem = `reactor-${family}-v${String(variant).padStart(2, '0')}`;
    return {
        id: stem,
        url: `${ROOT}/reactor-${family}/${stem}/runtime.glb`,
        position: [xMetres * METRE, GROUND + baseMetres * METRE, -yMetres * METRE],
        rotation: [0, yaw, 0],
        scale: METRE,
    };
}

// Curated from the complete 40-asset library. Every exported mesh ends in _nocol: the props
// make service zones readable without changing flight paths or becoming debris during a collapse.
export const REACTOR_SITE_PROP_MODELS = Object.freeze([
    // Pipe racks mark the two remote hall approaches, outer machinery lanes and north supply run.
    prop('pipe-support', 1, -160, 160, 0, 0.05),
    prop('pipe-support', 3, 160, 173, 0, -0.12),
    prop('pipe-support', 5, -197, -93, 0, Math.PI / 2),
    prop('pipe-support', 8, 197, -93, 0, Math.PI / 2),
    prop('pipe-support', 10, 40, -187, 0, 0),

    // Cable routes follow the permanent north blast walls and bridge switchyard transitions.
    prop('cable-tray', 1, -130, -143, 0, 0.08),
    prop('cable-tray', 3, -67, -167, 0, -0.04),
    prop('cable-tray', 5, -30, -175, 0, 0),
    prop('cable-tray', 7, 67, -167, 0, 0.04),
    prop('cable-tray', 9, 130, -143, 0, -0.08),

    // Maintenance lights pick out outer access points and the north landmark without point lights.
    prop('maintenance-light', 1, -175, 125, 0, 0.12),
    prop('maintenance-light', 3, 175, 158, 0, -0.14),
    prop('maintenance-light', 5, -208, -83, 0, Math.PI / 2),
    prop('maintenance-light', 7, 208, -75, 0, -Math.PI / 2),
    prop('maintenance-light', 9, 50, -203, 0, 0.10),

    // Numbered distribution points line the permanent switchyard maintenance road.
    prop('control-box', 1, -100, -153, 0, 0.02),
    prop('control-box', 4, -50, -162, 0, -0.03),
    prop('control-box', 6, 0, -153, 0, 0),
    prop('control-box', 8, 50, -162, 0, 0.03),
    prop('control-box', 10, 100, -153, 0, -0.02),
]);
