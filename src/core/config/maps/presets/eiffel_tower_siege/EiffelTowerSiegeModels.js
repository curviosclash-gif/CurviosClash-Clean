// The models of the siege map: the same Eiffel Tower as ../eiffel_tower, standing on a wider
// esplanade, plus the four baked collapses it can be shot into.
//
// Two kinds of entry live here. The intact structure and the machines are reused unchanged from
// the route map -- one shared scale factor, every part recentred on the tower axis and dropped
// onto its measured underside -- with a single swap: the 250 m Champ-de-Mars becomes a 480 m one,
// because a tower that topples reaches 114.5 authored units from its axis and would otherwise land
// next to the ground it is supposed to fall onto.
//
// The four break scenes are the other kind. Each one holds the whole tower above one break line,
// baked falling in a single clip, and is placed at exactly the underside of the intact part it
// replaces: the loader drops a model onto that height by its own bounding box, so a scene that
// measured differently would jump at the moment it is triggered. They start invisible
// (`hiddenUntilTriggered`) and their clock plays once instead of looping -- a collapse must never
// restart, and until it is triggered the standing tower is what the player sees.

import {
    EIFFEL_TOWER_MODELS,
    EIFFEL_TOWER_METRE,
    EIFFEL_TOWER_GROUND,
} from '../eiffel_tower/EiffelTowerModels.js';

const METRE = EIFFEL_TOWER_METRE;
const GROUND = EIFFEL_TOWER_GROUND;

/** Model id of the esplanade the route map places, and the wide one that replaces it here. */
export const EIFFEL_SIEGE_NARROW_ESPLANADE_ID = 'eiffel-champ-de-mars';
export const EIFFEL_SIEGE_ESPLANADE_ID = 'eiffel-champ-de-mars-wide';
export const EIFFEL_SIEGE_ESPLANADE_URL = 'assets/maps/eiffel_tower_siege/glb/01_champ_de_mars_wide.glb';

/**
 * A part of this map's own pack. Centred on the tower axis like every static part, so the only
 * placement number is how high its own underside sits above the esplanade.
 *
 * @param {string} id
 * @param {string} file basename under assets/maps/eiffel_tower_siege/glb
 * @param {number} baseMetres height of the part's underside above the esplanade
 */
function siegePart(id, file, baseMetres) {
    return {
        id: `eiffel-${id}`,
        url: `assets/maps/eiffel_tower_siege/glb/${file}.glb`,
        position: [0, GROUND + baseMetres * METRE, 0],
        rotation: [0, 0, 0],
        scale: METRE,
    };
}

// 480 m of Champ-de-Mars instead of 250. Same underside as the narrow one, so the tower keeps
// standing on exactly the height it was measured against.
const WIDE_ESPLANADE = siegePart('champ-de-mars-wide', '01_champ_de_mars_wide', -1.5);

/**
 * One baked collapse. The clip is authored as a single fall from the standing tower, so it plays
 * once from the match time of the break and then holds its last frame.
 *
 * @param {string} id
 * @param {string} file basename under assets/maps/eiffel_tower_siege/glb
 * @param {string} clipName the single clip inside that file
 * @param {number} baseMetres underside of the intact part this scene is swapped for
 */
function breakScene(id, file, clipName, baseMetres) {
    return {
        ...siegePart(id, file, baseMetres),
        hiddenUntilTriggered: true,
        animationClock: { mode: 'once', clipName },
    };
}

/** Scene model id -> the clip name inside its GLB. The map addresses clips by name. */
export const EIFFEL_SIEGE_SCENE_CLIPS = Object.freeze({
    'eiffel-topple-lower': 'ToppleLowerOnce',
    'eiffel-topple-mid': 'ToppleMidOnce',
    'eiffel-topple-shaft': 'ToppleShaftOnce',
    'eiffel-topple-summit': 'ToppleSummitOnce',
});

/** Scene model id -> the underside of the intact part it replaces, in tower metres. */
export const EIFFEL_SIEGE_SCENE_BASE_METRES = Object.freeze({
    'eiffel-topple-lower': -0.66,    // the same underside as 02_legs_lower
    'eiffel-topple-mid': 59.63,      // 05_legs_mid
    'eiffel-topple-shaft': 117.65,   // 07_shaft
    'eiffel-topple-summit': 276.1,   // 08_summit
});

const EIFFEL_SIEGE_SCENES = [
    breakScene('topple-lower', '20_topple_lower', 'ToppleLowerOnce', -0.66),
    breakScene('topple-mid', '21_topple_mid', 'ToppleMidOnce', 59.63),
    breakScene('topple-shaft', '22_topple_shaft', 'ToppleShaftOnce', 117.65),
    breakScene('topple-summit', '23_topple_summit', 'ToppleSummitOnce', 276.1),
];

// The intact tower, with the one swapped part, followed by the collapses it can be shot into.
export const EIFFEL_TOWER_SIEGE_MODELS = [
    ...EIFFEL_TOWER_MODELS.map((model) => (
        model.id === EIFFEL_SIEGE_NARROW_ESPLANADE_ID ? WIDE_ESPLANADE : model
    )),
    ...EIFFEL_SIEGE_SCENES,
];
