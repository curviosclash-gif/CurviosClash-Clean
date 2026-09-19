import { EIFFEL_TOWER_HISTORIC_MODELS } from './EiffelTowerHistoricProps.js';

// The Eiffel Tower is modelled in Blender at true metres, in one shared coordinate system: X and
// Y are the two ground axes of the esplanade, Z is height above it. The map places those parts
// back on top of each other, so the two things this file has to get right are the scale factor
// and where each part's own bounding box sits.
//
// The loader recentres every GLB on its own bounding box and drops its lower edge onto the given
// Y (see placeCollectionScene in src/entities/GLBMapLoader.js). The tower is symmetric about its
// axis, so every static part recentres to X = 0, Z = 0 by itself and only the height matters --
// which is why the static entries below are a single number each. Using `scale` rather than
// `targetSize` is deliberate: targetSize normalises each file to a size of its own and would pull
// the twelve parts to twelve different scales, taking the tower apart.

// Authored units per real metre. Chosen so the antenna tip lands just under the 220 unit map
// ceiling: 330 m * 0.6 is 198, plus the 8 units the esplanade sits at, is 206.
const METRE = 0.6;
// Height of the esplanade in authored units.
const GROUND = 8;

const BEAT_SECONDS = 4;

/**
 * A static part of the tower. Every one of them is centred on the tower axis, so the only
 * placement number is how high its own underside sits.
 *
 * @param {string} id
 * @param {string} file basename under assets/maps/eiffel_tower/glb
 * @param {number} baseMetres height of the part's underside above the esplanade
 */
function iron(id, file, baseMetres) {
    return {
        id: `eiffel-${id}`,
        url: `assets/maps/eiffel_tower/glb/${file}.glb`,
        position: [0, GROUND + baseMetres * METRE, 0],
        rotation: [0, 0, 0],
        scale: METRE,
    };
}

/**
 * A moving part. These are placed where they read best as obstacles rather than by measurement,
 * and each states how far it runs ahead of the shared beat.
 *
 * @param {string} id
 * @param {string} file basename under assets/maps/eiffel_tower/glb
 * @param {string} clipName the single animation clip inside that file
 * @param {number} phaseOffsetBeats how far ahead of the shared beat this piece runs
 * @param {number[]} positionMetres where the file's own centre lands, in tower metres
 * @param {number} rotationY yaw applied to the recentred file, in radians
 */
function machine(id, file, clipName, phaseOffsetBeats, positionMetres, rotationY = 0) {
    const [x, y, z] = positionMetres;
    return {
        id: `eiffel-${id}`,
        url: `assets/maps/eiffel_tower/glb/${file}.glb`,
        position: [x * METRE, GROUND + y * METRE, z * METRE],
        rotation: [0, rotationY, 0],
        scale: METRE,
        animationClock: { clipName, phaseOffsetBeats },
    };
}

// The structure itself. Every height is a measurement, not a placement choice: the numbers come
// straight out of the generator's own bounding box report.
const EIFFEL_STRUCTURE = [
    iron('champ-de-mars', '01_champ_de_mars', -1.5),
    iron('legs-lower', '02_legs_lower', -0.66),
    iron('arches', '03_arches', 17.6),
    iron('first-floor', '04_first_floor', 52.38),
    iron('legs-mid', '05_legs_mid', 59.63),
    iron('second-floor', '06_second_floor', 111.54),
    iron('shaft', '07_shaft', 117.65),
    iron('summit', '08_summit', 276.1),
];

// The two inclined leg lifts. The file is modelled in one leg's own frame -- the track climbs
// along +Y as it rises -- so a yaw of a quarter turn puts it on the north-east leg and a yaw of
// five eighths of a turn puts the second one on the opposite leg. The file recentres on its own
// box, which sits 20.58 m up the track, so the position is the leg foot pulled back by that much
// along the same diagonal: 62.5 - 20.58 / sqrt(2) = 47.95.
const ELEVATOR_ANCHOR = 47.95;
const QUARTER_TURN = Math.PI / 4;

// The moving parts. The offsets are the level design: the iris under the tower and the north-east
// lift are what a run meets first, so they start half a beat apart and never present the same
// opening at the same moment. The beacon runs on zero, so a player crossing the summit meets its
// sweep at the same point of the loop on every attempt.
const EIFFEL_MACHINES = [
    // The way up through the middle of the tower, and the first thing a run has to read rather
    // than simply aim at.
    machine('illumination-iris', '12_illumination_ring', 'IlluminationRingLoop', 0.5, [0, 19.2, 0]),
    // The two leg lifts, on opposite legs so the tower never looks half-abandoned.
    machine('lift-north-east', '09_leg_elevator', 'LegElevatorLoop', 0,
        [ELEVATOR_ANCHOR, -0.15, ELEVATOR_ANCHOR], QUARTER_TURN),
    machine('lift-south-west', '09_leg_elevator', 'LegElevatorLoop', 2 / 3,
        [-ELEVATOR_ANCHOR, -0.15, -ELEVATOR_ANCHOR], QUARTER_TURN + Math.PI),
    // The summit lift, inside the upper shaft. The shaft is the map's shortcut, and this is the
    // reason taking it costs something.
    machine('summit-lift', '10_shaft_lift', 'ShaftLiftLoop', 1 / 3, [0, 118.6, 0]),
    // The beacon on the mast, sweeping the airspace the finish sits in.
    machine('beacon', '11_beacon', 'BeaconLoop', 0, [0, 285.9, 0]),
];

export const EIFFEL_TOWER_BASE_MODELS = [
    ...EIFFEL_STRUCTURE,
    ...EIFFEL_MACHINES,
];
export const EIFFEL_TOWER_MODELS = [
    ...EIFFEL_TOWER_BASE_MODELS,
    ...EIFFEL_TOWER_HISTORIC_MODELS,
];
export const EIFFEL_TOWER_BEAT_SECONDS = BEAT_SECONDS;
export const EIFFEL_TOWER_METRE = METRE;
export const EIFFEL_TOWER_GROUND = GROUND;
