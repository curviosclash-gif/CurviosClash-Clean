// The models of the reactor site: five standing parts and the five collapses they can be shot
// into.
//
// Every part is modelled in one shared site coordinate system and exported centred on its own
// bounding box, so the loader's recentring is undone by stating where each file's centre lands
// and how high its underside sits (see placeCollectionScene in src/entities/GLBMapLoader.js).
// One shared scale factor, never `targetSize`: targetSize normalises each file to a size of its
// own and would pull the plant to ten different scales.
//
// The break scenes are the other kind of entry. Each one holds a structure from its break line
// on, baked coming down in a single clip, and is placed at exactly the centre and underside of
// the intact part it replaces: a scene that measured differently would jump at the moment it is
// triggered. They start invisible (`hiddenUntilTriggered`) and their clock plays once instead of
// looping - a collapse must never restart, and until it is triggered the standing plant is what
// the player sees. The mushroom cloud is a break scene like the others; what differs is that it
// rises instead of falling and that nothing in it collides.

import { GROUND, METRE, TOWER_X, HALL_Z, STACK_X, STACK_Z } from './ReactorSiteStructure.js';

export const REACTOR_SITE_METRE = METRE;
export const REACTOR_SITE_GROUND = GROUND;

/**
 * A part of the pack at a given map position.
 *
 * @param {string} id
 * @param {string} file basename under assets/maps/reactor_site/glb
 * @param {number} baseMetres height of the part's underside above the apron, as the generator reports it
 * @param {number} x map x of the file's own centre
 * @param {number} z map z of the file's own centre
 */
function part(id, file, baseMetres, x = 0, z = 0) {
    return {
        id: `reactor-${id}`,
        url: `assets/maps/reactor_site/glb/${file}.glb`,
        position: [x, GROUND + baseMetres * METRE, z],
        rotation: [0, 0, 0],
        scale: METRE,
    };
}

/**
 * One baked collapse. The clip is authored as a single event from the standing structure, so it
 * plays once from the match time of the break and then holds its last frame.
 *
 * @param {string} id
 * @param {string} file basename under assets/maps/reactor_site/glb
 * @param {string} clipName the single clip inside that file
 * @param {number} baseMetres underside of the intact part this scene is swapped for
 * @param {number} x
 * @param {number} z
 */
function breakScene(id, file, clipName, baseMetres, x = 0, z = 0) {
    return {
        ...part(id, file, baseMetres, x, z),
        hiddenUntilTriggered: true,
        animationClock: { mode: 'once', clipName },
    };
}

/** Undersides the generator reported (`base_y`), in metres above the apron. */
export const REACTOR_PART_BASE_METRES = Object.freeze({
    'reactor-site': -1.6,             // the grass slab, 1.4 m thick under the apron's -0.2
    'reactor-turbine-hall': 0.0,
    'reactor-block': 0.0,
    'reactor-cooling-tower-west': -0.36,  // the splayed inlet columns overhang their feet
    'reactor-cooling-tower-east': -0.36,
    'reactor-vent-stack': 0.0,
});

/** Scene model id -> the clip name inside its GLB. The map addresses clips by name. */
export const REACTOR_SCENE_CLIPS = Object.freeze({
    'reactor-topple-tower-west': 'ToppleTowerWestOnce',
    'reactor-topple-tower-east': 'ToppleTowerEastOnce',
    'reactor-topple-stack': 'ToppleStackOnce',
    'reactor-collapse-hall': 'CollapseHallOnce',
    'reactor-mushroom-cloud': 'MushroomCloudOnce',
});

/** Scene model id -> the underside of the intact part it replaces, in metres. */
export const REACTOR_SCENE_BASE_METRES = Object.freeze({
    'reactor-topple-tower-west': -0.36,   // the same underside as 04_cooling_tower
    'reactor-topple-tower-east': -0.36,
    'reactor-topple-stack': 0.0,          // 05_vent_stack
    'reactor-collapse-hall': 0.0,         // 02_turbine_hall
    'reactor-mushroom-cloud': 0.0,        // 03_reactor_block: the ruin's floor is the block's own
});

/** Scene model id -> the intact model whose slot it takes over. */
export const REACTOR_SCENE_INTACT_MODEL = Object.freeze({
    'reactor-topple-tower-west': 'reactor-cooling-tower-west',
    'reactor-topple-tower-east': 'reactor-cooling-tower-east',
    'reactor-topple-stack': 'reactor-vent-stack',
    'reactor-collapse-hall': 'reactor-turbine-hall',
    'reactor-mushroom-cloud': 'reactor-block',
});

const REACTOR_SITE_PARTS = [
    part('site', '01_site', REACTOR_PART_BASE_METRES['reactor-site']),
    part('turbine-hall', '02_turbine_hall', 0.0, 0, HALL_Z),
    part('block', '03_reactor_block', 0.0),
    // The same file twice: the anchor of the destructible segment tells the two towers apart.
    part('cooling-tower-west', '04_cooling_tower', -0.36, -TOWER_X, 0),
    part('cooling-tower-east', '04_cooling_tower', -0.36, TOWER_X, 0),
    part('vent-stack', '05_vent_stack', 0.0, STACK_X, STACK_Z),
];

const REACTOR_SITE_SCENES = [
    breakScene('topple-tower-west', '20_topple_tower_west', 'ToppleTowerWestOnce', -0.36, -TOWER_X, 0),
    breakScene('topple-tower-east', '21_topple_tower_east', 'ToppleTowerEastOnce', -0.36, TOWER_X, 0),
    breakScene('topple-stack', '22_topple_stack', 'ToppleStackOnce', 0.0, STACK_X, STACK_Z),
    breakScene('collapse-hall', '23_collapse_hall', 'CollapseHallOnce', 0.0, 0, HALL_Z),
    ...Array.from({ length: 4 }, (_, index) => breakScene(
        index === 0 ? 'mushroom-cloud' : `mushroom-cloud-${index + 1}`,
        `torus_cloud_${index + 1}`, 'MushroomCloudOnce', 0.0,
    )),
];

export const REACTOR_SITE_MODELS = [...REACTOR_SITE_PARTS, ...REACTOR_SITE_SCENES];
