// Notre-Dame is modelled in Blender at true metres, in one shared coordinate system: X runs west
// to east, Y across the building, Z upward from the church floor. The map places those parts back
// together, so the two things this file has to get right are the scale factor and where each
// part's own bounding box sits.
//
// The loader recentres every GLB on its own bounding box and drops its lower edge onto the given
// Y (see placeCollectionScene in src/entities/GLBMapLoader.js), which is why each entry states
// the part's centre along the building and the height of its underside. Using `scale` rather than
// `targetSize` is deliberate: targetSize normalises each file to a size of its own and would pull
// the fifteen parts to fifteen different scales, tearing the building apart.

// Authored units per real metre. Chosen so the spire tip lands just under the 150 unit map
// ceiling: 96 m * 1.4 = 134.4, plus the 8 units the island sits at, is 142.4.
const METRE = 1.4;
// Height of the church floor in authored units. The island and its quays hang below it.
const GROUND = 8;

const BEAT_SECONDS = 6;
const TREE_TARGET_SIZE = 14.28;
const TREE_RENDER_DISTANCE = 210;
const TREE_ROW_START_METRES = -131.75;
const EAST_GARDEN_CENTRE_METRES = 85.75;

/**
 * A static piece of the building.
 * @param {string} id
 * @param {string} file basename under assets/maps/notre_dame/glb
 * @param {number} centreMetres where the part's bounding box centres along the building axis
 * @param {number} baseMetres height of the part's underside above the church floor
 */
function stone(id, file, centreMetres, baseMetres) {
    return {
        id: `notre-dame-${id}`,
        url: `assets/maps/notre_dame/glb/${file}.glb`,
        position: [centreMetres * METRE, GROUND + baseMetres * METRE, 0],
        rotation: [0, 0, 0],
        scale: METRE,
    };
}

/**
 * A moving piece of the reconstruction site. Unlike the building these are placed where they read
 * best as obstacles, and each states how far it runs ahead of the shared beat.
 */
function site(id, file, clipName, phaseOffsetBeats, position) {
    return {
        id: `notre-dame-${id}`,
        url: `assets/maps/notre_dame/glb/${file}.glb`,
        position,
        rotation: [0, 0, 0],
        scale: METRE,
        animationClock: { clipName, phaseOffsetBeats },
    };
}

/**
 * A decorative ancient-tree LOD at a position authored in the cathedral's Blender metres.
 * Blender's positive Y becomes the map's negative Z during glTF export, matching the shared
 * coordinate conversion used by the cathedral parts.
 */
function tree(variant, id, xMetres, yMetres, rotationIndex) {
    const padded = String(variant).padStart(2, '0');
    return Object.freeze({
        id: `notre-dame-tree-${id}`,
        url: `assets/models/ancient_tree/variants/variant_${padded}/ancient_tree_${padded}_lod2.glb`,
        position: Object.freeze([xMetres * METRE, GROUND, -yMetres * METRE]),
        rotation: Object.freeze([0, (rotationIndex * Math.PI * 0.37) % (Math.PI * 2), 0]),
        targetSize: TREE_TARGET_SIZE,
        maxRenderDistance: TREE_RENDER_DISTANCE,
        collision: false,
    });
}

function buildTreeModels() {
    const models = [];
    let placementIndex = 0;
    for (const side of [-1, 1]) {
        const sideName = side < 0 ? 'south-bank' : 'north-bank';
        for (let index = 0; index < 12; index += 1) {
            const variant = (placementIndex % 10) + 1;
            models.push(tree(
                variant,
                `${sideName}-${String(index + 1).padStart(2, '0')}`,
                TREE_ROW_START_METRES + index * 11,
                side * 42,
                placementIndex + 1,
            ));
            placementIndex += 1;
        }
    }

    for (let index = 0; index < 8; index += 1) {
        const angle = index * (Math.PI * 2 / 8);
        const variant = (placementIndex % 10) + 1;
        models.push(tree(
            variant,
            `east-garden-${String(index + 1).padStart(2, '0')}`,
            EAST_GARDEN_CENTRE_METRES + 15 * Math.cos(angle),
            20 * Math.sin(angle),
            placementIndex + 1,
        ));
        placementIndex += 1;
    }
    return Object.freeze(models);
}

// The building itself. Every entry is a measurement, not a placement choice: the numbers come
// straight out of the generator's own bounding box report.
const NOTRE_DAME_FABRIC = [
    stone('parvis', '07_parvis_island', -22.0, -1.8),
    stone('west-facade', '01_west_facade', -59.31, 0),
    stone('nave', '02_nave', -24.75, -0.8),
    stone('transept', '03_transept', 12.25, -0.8),
    stone('choir-apse', '04_choir_apse', 41.76, -0.8),
    stone('buttresses', '05_buttresses', 5.15, 0),
    stone('roof-fleche', '06_roof_fleche', 4.5, 14.06),
];

// The site. Offsets are the level design: the crane and the rose scaffold are the two pieces
// whose gap travels, so they start a third of a beat apart and never present the same opening at
// the same moment; the sheeting in the approach runs on zero so a player meets it predictably on
// their first pass.
const NOTRE_DAME_SITE = [
    // Approach from the river: the hoarding is the first thing flown through, and it teaches the
    // rule the whole site runs on -- the way through is always open somewhere, just not here yet.
    site('hoarding', '14_tarpaulin_wall', 'TarpaulinWallLoop', 0, [-150, GROUND, 0]),
    // The rose scaffold turns in front of the west window, so the way onto the facade travels
    // around the rose once per two beats.
    site('rose-scaffold', '17_rose_ring', 'RoseRingLoop', 1 / 3, [-93.6, 32.2, 0]),
    // The hoist that served the west front.
    site('scaffold-lift', '11_scaffold_lift', 'ScaffoldLiftLoop', 0.5, [-40, GROUND, 45]),
    // Inside the nave: the gantry sweeps the central vessel from end to end, the one moving
    // obstacle a player meets while flying the interior.
    site('vault-gantry', '15_vault_gantry', 'VaultGantryLoop', 0, [-35, GROUND, 0]),
    // The bells, high in the south tower.
    site('bells', '16_bell_swing', 'BellSwingLoop', 2 / 3, [-83, 78, -20.3]),
    // Blocks swinging over the south yard.
    site('stone-hoist', '12_stone_hoist', 'StoneHoistLoop', 0.25, [-10, GROUND, -55]),
    // The tower crane south of the crossing. Its mast sits 15.3 units west of the part's centre,
    // so the position below puts the mast on the crossing axis with the jib clear of the transept.
    site('tower-crane', '10_tower_crane', 'TowerCraneLoop', 2 / 3, [32.3, GROUND, -90]),
    // The spire section on its lifting gantry, east of the apse: the goal of the route and the
    // one piece meant to be looked at rather than flown past.
    site('fleche-hoist', '13_fleche_hoist', 'FlecheHoistLoop', 0, [130, GROUND, 0]),
];

export const NOTRE_DAME_TREE_MODELS = buildTreeModels();
export const NOTRE_DAME_MODELS = [
    ...NOTRE_DAME_FABRIC,
    ...NOTRE_DAME_SITE,
    ...NOTRE_DAME_TREE_MODELS,
];
export const NOTRE_DAME_BEAT_SECONDS = BEAT_SECONDS;
export const NOTRE_DAME_METRE = METRE;
export const NOTRE_DAME_GROUND = GROUND;
