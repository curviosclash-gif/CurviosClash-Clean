// What stands still on the reconstruction site.
//
// The map uses exact GLB collision, but meshes marked _nocol remain deliberately outside that
// path. The authored frames below supplement the visible static pieces that need collision while
// keeping open lattice cells open; moving rig parts are left to their dynamic mesh colliders.
//
// Thin ropes, lamps and braces stay decorative. Every box here is conservative and sits within a
// visible solid member, so no supplemental collider extends into an open cell.
//
// The coordinates are measured off the GLB files as NotreDameModels places them, in authored
// units -- the same space the cathedral boxes are written in.

const GROUND = 8;

/**
 * A standing part, stated as the box it occupies.
 *
 * @param {string} id what it is, for anyone reading a collision dump
 * @param {number[]} pos centre in authored units
 * @param {number[]} size extent in authored units
 */
function frame(id, pos, size) {
    return { id: `nd-site-${id}`, pos, size, compileWithGlb: true };
}

function latticeFrames(id, pos, legOffset, height) {
    const [x, y, z] = pos;
    const legSize = 0.45;
    return [-1, 1].flatMap((offsetX) => [-1, 1].map((offsetZ) => frame(
        `${id}-leg-${offsetX}-${offsetZ}`,
        [x + offsetX * legOffset, y, z + offsetZ * legOffset],
        [legSize, height, legSize],
    )));
}

export const NOTRE_DAME_SITE_FRAMES = [
    // --- Tower crane, south of the crossing -------------------------------------------------
    // The lattice mast is the tallest standing thing on the site. Its jib already collides as an
    // animated part, which is what made the hole so obvious: the arm blocks, the tower does not.
    // The counter-jib and the apex above it are deliberately left out. Both are thin members at
    // 86 m, well over the route, and both sit outside what the coarse geometry check can vouch
    // for: it derives a model's extent from raw mesh bounds, which on a rigged file like this one
    // are stated relative to the rig rather than the scene. Claiming collision there would mean
    // claiming it on a box nothing can verify.
    ...latticeFrames('crane-mast', [17.0, GROUND + 37.8, -90.0], 2.1, 75.6),
    // The base is round. This square is inscribed in it, so its corners never reach into air.
    frame('crane-base', [17.0, GROUND + 1.4, -90.0], [6.3, 2.8, 6.3]),

    // --- Stone hoist over the south yard ------------------------------------------------------
    // The two towers. The blocks hanging between them collide already; the beam they hang from is
    // held back for the reason given at the foot of this file.
    ...latticeFrames('stone-hoist-west-tower', [-28.8, GROUND + 15.0, -55.0], 1.26, 30.0),
    ...latticeFrames('stone-hoist-east-tower', [8.8, GROUND + 15.0, -55.0], 1.26, 30.0),
    frame('stone-hoist-beam', [-10.0, GROUND + 30.8, -55.0], [39.2, 1.68, 1.96]),

    // --- Scaffold lift on the west front ------------------------------------------------------
    // The mast and the six decks. A deck reads as a floor a player can put a ship down on, which
    // is exactly why flying through one is worse than flying through a rope.
    ...latticeFrames('scaffold-mast', [-40.0, GROUND + 23.8, 47.8], 1.68, 47.6),
    frame('scaffold-foot', [-40.0, GROUND + 0.56, 47.8], [8.4, 1.12, 8.4]),
    ...[13.6, 21.2, 28.7, 36.3, 43.8, 51.4].map((y, level) => (
        frame(`scaffold-deck-${level}`, [-40.0, y, 41.6], [7.3, 0.4, 7.3])
    )),

    // --- Hoarding on the river approach -------------------------------------------------------
    // The two posts and the head rail the sheets hang from. The sheets themselves travel and
    // collide; the frame holding them is the first thing on the map a player meets.
    frame('hoarding-south-post', [-149.9, GROUND + 12.6, -21.84], [1.96, 25.2, 1.4]),
    frame('hoarding-north-post', [-149.9, GROUND + 12.6, 21.84], [1.96, 25.2, 1.4]),
    frame('hoarding-head', [-149.9, GROUND + 25.76, 0.0], [1.68, 1.4, 44.8]),

    // The rose scaffold's two stands are left out as well. The east one stands 2 units from the
    // centre of CP05_ROSE, which asks for 4.6 of air: the scaffold is drawn hard against the west
    // window because that is what a scaffold does, and the ring is aimed through that window. One
    // of the two has to move before the stand can collide, and that is a route decision.

    // --- Fleche hoist east of the apse --------------------------------------------------------
    // Its four lattice towers are intentionally decorative. Even exact leg boxes leave less
    // room than the vehicle's forward/rear and side probes need, so they turn the visibly open
    // cells into invisible walls. The solid cradle and head remain collision landmarks.
    frame('fleche-cradle', [130.0, GROUND + 1.68, 0.0], [14.0, 3.36, 14.0]),
    frame('fleche-head', [130.0, GROUND + 42.56, 0.0], [20.16, 1.4, 20.16]),
];

// The crane apex/counter-jib and the moving vault-gantry legs travel with animated rigs. Their
// mesh names deliberately opt into dynamic GLB collision in the generator; static boxes here
// would remain behind and become invisible obstacles as soon as the rig moves.
