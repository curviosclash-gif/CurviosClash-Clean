// Notre-Dame is modelled in Blender at true metres, in one shared coordinate system: X runs west
// to east, Y across the building, Z upward from the church floor. The map places those parts back
// together, so the two things this file has to get right are the scale factor and where each
// part's own bounding box sits.
//
// The loader recentres every GLB on its own bounding box and drops its lower edge onto the given
// Y (see placeCollectionScene in src/entities/GLBMapLoader.js), which is why each entry states
// the part's centre along the building and the height of its underside. Using `scale` rather than
// `targetSize` is deliberate: targetSize normalises each file to a size of its own and would pull
// the seven parts to seven different scales, tearing the building apart.

// Authored units per real metre. Chosen so the spire tip lands just under the 150 unit map
// ceiling: 96 m * 1.4 = 134.4, plus the 8 units the island sits at, is 142.4.
const METRE = 1.4;
// Height of the church floor in authored units. The island and its quays hang below it.
const GROUND = 8;

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
const WEST_FACADE = stone('west-facade', '01_west_facade', -59.78, 0);
WEST_FACADE.animationClock = Object.freeze({
    mode: 'loop',
    beatSeconds: 6,
    clipName: 'NotreDameMotion',
});

const NOTRE_DAME_FABRIC = [
    stone('parvis', '07_parvis_island', -22.0, -1.8),
    WEST_FACADE,
    stone('nave', '02_nave', -24.75, -0.8),
    stone('transept', '03_transept', 12.25, -0.8),
    stone('choir-apse', '04_choir_apse', 41.4, -0.8),
    stone('buttresses', '05_buttresses', 5.15, 0),
    stone('roof-fleche', '06_roof_fleche', 4.5, 14.06),
];

export const NOTRE_DAME_TREE_MODELS = buildTreeModels();
export const NOTRE_DAME_MODELS = [
    ...NOTRE_DAME_FABRIC,
    ...NOTRE_DAME_TREE_MODELS,
];
export const NOTRE_DAME_METRE = METRE;
export const NOTRE_DAME_GROUND = GROUND;
