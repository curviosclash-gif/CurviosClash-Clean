import {
    FOREST_GROUND,
    FOREST_HALF_SIZE,
    isInsideClearing,
    isTreeFreeSite,
} from './GiantForestStructure.js';

// The forest itself: the ten generated ancient-tree variants, planted on a staggered grid, each
// one placed twice.
//
// Twice, because a tree is two files. The drawn one is the 23k triangle LOD2 crown, and it is
// flyable (`collision: false`) - colliding against a crown would mean colliding against every
// leaf. The solid one is the 196 triangle body exported beside it, seven cylinders for the base,
// the trunk and the five main branches, placed invisibly (`collisionOnly: true`) in the same
// spot. That is what makes the canopy a storey: the branches carry a ship.
//
// Both files must be placed at the *same* scale and end up in the *same* place, and that is not
// automatic. The loader fits a model by its own bounding box - it centres it on X/Z and stands it
// on min Y - and the crown's box is not the body's box: the crown reaches out into its leaves and
// dips below zero with its roots, the body stops at the trunk and starts at the ground. Placing
// both with `targetSize` would scale them differently; placing both at the same `scale` still
// leaves them offset by the difference between the two boxes' origins.
//
// TREE_ALIGNMENT is that difference, per variant, in model units: the body's (centreX, minY,
// centreZ) minus the crown's. Multiplied by the scale it is how far the body has to move to sit
// inside its crown. tests/giant-forest-trees.contract.test.mjs reads both GLBs and recomputes
// every row, so regenerating the variants cannot silently leave the collision standing beside
// the tree it belongs to.
const TREE_ALIGNMENT = Object.freeze([
    Object.freeze([-0.942, 0.965, -0.547]),
    Object.freeze([-0.435, 0.931, 0.363]),
    Object.freeze([-1.628, 0.987, -1.070]),
    Object.freeze([-0.923, 0.944, 0.645]),
    Object.freeze([-0.759, 0.952, 0.563]),
    Object.freeze([-0.934, 0.975, -0.671]),
    Object.freeze([-0.082, 1.010, -0.057]),
    Object.freeze([-0.389, 0.908, 0.525]),
    Object.freeze([-0.337, 0.919, 0.589]),
    Object.freeze([-0.833, 0.996, -0.777]),
]);

/**
 * One factor for both files of a tree, rather than a target height: `targetSize` would normalize
 * each file against its own box and scale the two apart. At 3.8 the variants stand between 75 and
 * 97 units tall, which is the height variation the generator put into them.
 */
export const TREE_SCALE = 3.8;

/**
 * Beyond this a crown is not drawn at all. It has to sit outside the map's fog range, or trees
 * would wink out inside the visible distance; the fog is what hides the edge of the forest.
 */
const TREE_RENDER_DISTANCE = 320;

/**
 * Grid pitch. A crown is about 80 wide at this scale, so at 70 the crowns overlap into a closed
 * roof while the trunks - roughly 17 across - leave a 53 unit gap to fly through.
 */
const TREE_PITCH = 70;

const VARIANT_COUNT = TREE_ALIGNMENT.length;

function variantId(variant) {
    return String(variant + 1).padStart(2, '0');
}

function variantUrl(variant, suffix) {
    const id = variantId(variant);
    return `assets/models/ancient_tree/variants/variant_${id}/ancient_tree_${id}_${suffix}.glb`;
}

/**
 * A deterministic 0..1 from an integer. No Math.random anywhere in a map: two clients build the
 * same forest from the same preset, and a round restart has to plant it in the same places.
 */
function scatter(seed) {
    const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return value - Math.floor(value);
}

/**
 * The drawn crown and the invisible body of one tree.
 *
 * The alignment offset is stated in model space and the slot is turned, so the offset has to be
 * turned with it - it is baked into the slot position, which rotation does not touch. Y is
 * unaffected by a turn about Y.
 */
function tree(variant, id, x, z, rotationY) {
    const [alignX, alignY, alignZ] = TREE_ALIGNMENT[variant];
    const cos = Math.cos(rotationY);
    const sin = Math.sin(rotationY);
    const offsetX = (alignX * cos + alignZ * sin) * TREE_SCALE;
    const offsetZ = (-alignX * sin + alignZ * cos) * TREE_SCALE;
    const rotation = Object.freeze([0, rotationY, 0]);
    return [
        Object.freeze({
            id: `giant-forest-crown-${id}`,
            url: variantUrl(variant, 'lod2'),
            position: Object.freeze([x, FOREST_GROUND, z]),
            rotation,
            scale: TREE_SCALE,
            maxRenderDistance: TREE_RENDER_DISTANCE,
            collision: false,
        }),
        Object.freeze({
            id: `giant-forest-trunk-${id}`,
            url: variantUrl(variant, 'collision'),
            position: Object.freeze([
                x + offsetX,
                FOREST_GROUND + alignY * TREE_SCALE,
                z + offsetZ,
            ]),
            rotation,
            scale: TREE_SCALE,
            collisionOnly: true,
        }),
    ];
}

/**
 * The grid. Odd rows are offset by half a pitch, so no two trunks line up into a corridor, and
 * every trunk is nudged by a deterministic fraction of the pitch so the grid never reads as one.
 * Trees inside a clearing are skipped, trees whose crown would hang over the rim as well.
 */
function buildForest() {
    const models = [];
    const reach = FOREST_HALF_SIZE - TREE_PITCH * 0.55;
    let planted = 0;
    for (let row = 0; ; row += 1) {
        const z = -reach + row * TREE_PITCH;
        if (z > reach) break;
        const rowOffset = (row % 2) * TREE_PITCH * 0.5;
        for (let column = 0; ; column += 1) {
            const x = -reach + rowOffset + column * TREE_PITCH;
            if (x > reach) break;
            const seed = row * 31 + column * 7;
            const jitterX = (scatter(seed) - 0.5) * TREE_PITCH * 0.34;
            const jitterZ = (scatter(seed + 101) - 0.5) * TREE_PITCH * 0.34;
            const treeX = x + jitterX;
            const treeZ = z + jitterZ;
            if (isTreeFreeSite(treeX, treeZ)) continue;
            const variant = (row * 3 + column * 7) % VARIANT_COUNT;
            const rotationY = scatter(seed + 7) * Math.PI * 2;
            models.push(...tree(
                variant,
                `${String(row).padStart(2, '0')}-${String(column).padStart(2, '0')}`,
                treeX,
                treeZ,
                rotationY,
            ));
            planted += 1;
        }
    }
    if (planted === 0) throw new Error('giant forest planted no trees');
    return models;
}

/** Ferns, roots and vines from the shared undergrowth pack. Decoration only, never solid. */
function undergrowth(family, variant, id, x, z, targetSize, rotationY) {
    return Object.freeze({
        id: `giant-forest-${family}-${id}`,
        url: `assets/models/verdant_wildwuchs/${family}_${variant}.glb`,
        position: Object.freeze([x, FOREST_GROUND, z]),
        rotation: Object.freeze([0, rotationY, 0]),
        targetSize,
        maxRenderDistance: 220,
        collision: false,
    });
}

function buildUndergrowth() {
    const families = ['fern', 'root', 'vine'];
    const models = [];
    for (let index = 0; index < 27; index += 1) {
        const angle = scatter(index * 13 + 3) * Math.PI * 2;
        const radius = 120 + scatter(index * 17 + 9) * 170;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (isInsideClearing(x, z, -20)) continue;
        const family = families[index % families.length];
        const variant = `v0${(index % 3) + 1}`;
        models.push(undergrowth(
            family,
            variant,
            String(index).padStart(2, '0'),
            x,
            z,
            18 + scatter(index * 29) * 14,
            scatter(index * 37) * Math.PI * 2,
        ));
    }
    return models;
}

export const GIANT_FOREST_TREES = Object.freeze(buildForest());
export const GIANT_FOREST_UNDERGROWTH = Object.freeze(buildUndergrowth());
export const GIANT_FOREST_TREE_ALIGNMENT = TREE_ALIGNMENT;
