// Authored ground height shared by the Eiffel structure and route contracts. Kept local here to
// avoid a circular dependency: EiffelTowerModels owns the final model collection that imports us.
const GROUND = 8;

const FAMILY_SIZE = Object.freeze({
    lamp: 3.2,
    bench: 1.7,
    urn: 1.2,
    information: 2.3,
});

function prop(family, variant, suffix, position, rotationY = 0) {
    const familyId = `eiffel-historic-${family}`;
    const variantId = `${familyId}-v${String(variant).padStart(2, '0')}`;
    return Object.freeze({
        id: `${variantId}-${suffix}`,
        url: `assets/maps/eiffel_tower/props/${familyId}/${variantId}/runtime.glb`,
        position: Object.freeze(position),
        rotation: Object.freeze([0, rotationY, 0]),
        targetSize: FAMILY_SIZE[family],
        maxRenderDistance: 180,
        collision: false,
    });
}

function tree(variant, suffix, position, targetSize = 10.8) {
    const padded = String(variant).padStart(2, '0');
    return Object.freeze({
        id: `eiffel-tree-${suffix}`,
        url: `assets/models/ancient_tree/variants/variant_${padded}/ancient_tree_${padded}_lod2.glb`,
        position: Object.freeze(position),
        rotation: Object.freeze([0, (variant * Math.PI * 0.37) % (Math.PI * 2), 0]),
        targetSize,
        maxRenderDistance: 200,
        collision: false,
    });
}

function dandelion(suffix, position, rotationY = 0) {
    return Object.freeze({
        id: `eiffel-dandelion-${suffix}`,
        url: 'assets/models/giant_dandelion/giant_dandelion_lod2.glb',
        position: Object.freeze(position),
        rotation: Object.freeze([0, rotationY, 0]),
        targetSize: 2.6,
        maxRenderDistance: 180,
        collision: false,
    });
}

const NORMAL_PROPS = Object.freeze([
    prop('lamp', 1, 'west-south', [-82, GROUND, -18]),
    prop('lamp', 4, 'west-north', [-82, GROUND, 18], Math.PI),
    prop('lamp', 5, 'south-east', [18, GROUND, -82], Math.PI / 2),
    prop('lamp', 10, 'north-west', [-18, GROUND, 82], -Math.PI / 2),
    prop('bench', 1, 'west-overlook', [-82, GROUND, -42], Math.PI / 2),
    prop('bench', 3, 'east-overlook', [82, GROUND, 42], -Math.PI / 2),
    prop('bench', 7, 'south-rest', [42, GROUND, -82], 0),
    prop('bench', 9, 'north-rest', [-42, GROUND, 82], Math.PI),
    prop('urn', 1, 'west-entry-south', [-62, GROUND, -18]),
    prop('urn', 4, 'west-entry-north', [-62, GROUND, 18]),
    prop('urn', 5, 'east-entry-south', [62, GROUND, -18]),
    prop('urn', 10, 'east-entry-north', [62, GROUND, 18]),
    prop('information', 1, 'west-junction', [-72, GROUND, 32], Math.PI / 2),
    prop('information', 2, 'west-route', [-72, GROUND, -32], Math.PI / 2),
    prop('information', 3, 'north-view', [32, GROUND, 72], Math.PI),
    prop('information', 7, 'south-view', [-32, GROUND, -72], 0),
]);

const NORMAL_TREES = Object.freeze([
    tree(1, 'north-west', [-52, GROUND, 65]),
    tree(4, 'north-inner-west', [-18, GROUND, 65]),
    tree(7, 'north-inner-east', [18, GROUND, 65]),
    tree(10, 'north-east', [52, GROUND, 65]),
    tree(2, 'south-west', [-52, GROUND, -65]),
    tree(5, 'south-inner-west', [-18, GROUND, -65]),
    tree(8, 'south-inner-east', [18, GROUND, -65]),
    tree(3, 'south-east', [52, GROUND, -65]),
    tree(6, 'east-north', [65, GROUND, 42]),
    tree(9, 'east-south', [65, GROUND, -42]),
    tree(1, 'west-north', [-65, GROUND, 42]),
    tree(4, 'west-south', [-65, GROUND, -42]),
]);

export const EIFFEL_TOWER_HISTORIC_MODELS = Object.freeze([
    ...NORMAL_PROPS,
    ...NORMAL_TREES,
    dandelion('north-east-garden', [84, GROUND, 74], Math.PI * 0.35),
    dandelion('south-west-garden', [-84, GROUND, -74], -Math.PI * 0.35),
]);

const SIEGE_PROPS = Object.freeze([
    prop('lamp', 2, 'siege-west-south', [-122, GROUND, -30]),
    prop('lamp', 6, 'siege-west-north', [-122, GROUND, 30], Math.PI),
    prop('lamp', 8, 'siege-east-south', [122, GROUND, -30]),
    prop('lamp', 9, 'siege-east-north', [122, GROUND, 30], Math.PI),
    prop('bench', 2, 'siege-north-west', [-58, GROUND, 122], Math.PI),
    prop('bench', 4, 'siege-north-east', [58, GROUND, 122], Math.PI),
    prop('bench', 6, 'siege-south-west', [-58, GROUND, -122]),
    prop('bench', 10, 'siege-south-east', [58, GROUND, -122]),
    prop('urn', 2, 'siege-west-entry-south', [-122, GROUND, -52]),
    prop('urn', 3, 'siege-west-entry-north', [-122, GROUND, 52]),
    prop('urn', 7, 'siege-east-entry-south', [122, GROUND, -52]),
    prop('urn', 9, 'siege-east-entry-north', [122, GROUND, 52]),
    prop('information', 4, 'siege-north-junction', [30, GROUND, 122], Math.PI),
    prop('information', 5, 'siege-south-junction', [-30, GROUND, -122]),
    prop('information', 8, 'siege-east-view', [122, GROUND, 72], -Math.PI / 2),
    prop('information', 10, 'siege-west-view', [-122, GROUND, -72], Math.PI / 2),
]);

const SIEGE_TREES = Object.freeze([
    tree(2, 'siege-north-west', [-76, GROUND, 120], 12),
    tree(5, 'siege-north-inner-west', [-26, GROUND, 120], 12),
    tree(8, 'siege-north-inner-east', [26, GROUND, 120], 12),
    tree(1, 'siege-north-east', [76, GROUND, 120], 12),
    tree(3, 'siege-south-west', [-76, GROUND, -120], 12),
    tree(6, 'siege-south-inner-west', [-26, GROUND, -120], 12),
    tree(9, 'siege-south-inner-east', [26, GROUND, -120], 12),
    tree(4, 'siege-south-east', [76, GROUND, -120], 12),
    tree(7, 'siege-east-north', [120, GROUND, 72], 12),
    tree(10, 'siege-east-south', [120, GROUND, -72], 12),
    tree(2, 'siege-west-north', [-120, GROUND, 72], 12),
    tree(5, 'siege-west-south', [-120, GROUND, -72], 12),
]);

export const EIFFEL_TOWER_SIEGE_HISTORIC_MODELS = Object.freeze([
    ...SIEGE_PROPS,
    ...SIEGE_TREES,
    dandelion('siege-north-east-garden', [134, GROUND, 106], Math.PI * 0.35),
    dandelion('siege-south-west-garden', [-134, GROUND, -106], -Math.PI * 0.35),
]);

export const EIFFEL_TOWER_HISTORIC_FAMILY_COUNTS = Object.freeze({
    lamp: 10,
    bench: 10,
    urn: 10,
    information: 10,
});
