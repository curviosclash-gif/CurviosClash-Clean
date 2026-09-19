const ROOT = 'assets/maps/burg_falkenwacht/props';

function prop(family, variant, position, rotation, targetSize) {
    const stem = `falkenwacht-${family}-v${String(variant).padStart(2, '0')}`;
    return {
        id: stem,
        url: `${ROOT}/falkenwacht-${family}/${stem}/runtime.glb`,
        position,
        rotation,
        targetSize,
    };
}

// Curated from the complete 50-asset library. Every exported mesh ends in _nocol,
// so these props enrich both modes without adding gameplay collision.
export const FALKENWACHT_PROP_MODELS = [
    // Stable, smithy and outer courtyard fuel stores.
    prop('woodpile', 1, [-116, 12, 55], [0, 0.15, 0], 7),
    prop('woodpile', 5, [123, 12, 69], [0, -0.65, 0], 7),
    prop('woodpile', 7, [-124, 12, 82], [0, 0.1, 0], 8),

    // Water points at the two courts and a stable trough.
    prop('stone-well', 1, [25, 12, 56], [0, 0, 0], 8),
    prop('stone-well', 6, [-28, 18, -52], [0, 0.25, 0], 10),
    prop('stone-well', 10, [-116, 12, 34], [0, -0.3, 0], 8),

    // Ready equipment beside the smithy, gatehouse and palas interior.
    prop('weapon-rack', 1, [96, 12, 78], [0, -0.25, 0], 6),
    prop('weapon-rack', 4, [118, 18, -60], [0, 1.45, 0], 6),
    prop('weapon-rack', 5, [-48, 12, 101], [0, 0.5, 0], 6),

    // Wall-mounted heraldry with shapes distinct from the animated banners.
    prop('wall-shield', 1, [20, 35, -4], [0, 0, 0], 5),
    prop('wall-shield', 3, [-42, 34, -57], [0, 0, 0], 5),
    prop('wall-shield', 7, [75, 34, -31], [0, 0, 0], 5),
    prop('wall-shield', 10, [0, 48, 127], [0, 0, 0], 6),

    // Climbing growth follows masonry faces and leaves openings clear.
    prop('wall-ivy', 1, [45, 12, 117], [0, 0, 0], 14),
    prop('wall-ivy', 4, [-141.8, 18, 65], [0, Math.PI / 2, 0], 14),
    prop('wall-ivy', 6, [30, 18, -4], [0, 0, 0], 13),
];
