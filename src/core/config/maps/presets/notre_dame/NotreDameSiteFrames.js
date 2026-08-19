// What stands still on the reconstruction site.
//
// The map runs in glbColliderMode 'dynamic', so the loader collides a mesh only while an animation
// moves it. On the site that split the machines in half: the jib swings and blocks, the mast that
// carries it does not; the cages ride and block, the lift they ride on does not. Fifty-four metres
// of crane mast, four hoist towers and two hoarding posts were drawn and not there.
//
// Authoring them here rather than reaching for glbColliderMode 'mesh' is the same decision the
// cathedral shell rests on. A mesh collider is one axis-aligned box per mesh; on these files that
// would wrap every lamp and guy rope in a block, and it would still miss nothing that a box set by
// hand does not already cover. These parts do not move, so a box is exact.
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
    return { id: `nd-site-${id}`, pos, size };
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
    frame('crane-mast', [17.0, GROUND + 37.8, -90.0], [4.6, 75.6, 4.6]),

    // --- Stone hoist over the south yard ------------------------------------------------------
    // The two towers. The blocks hanging between them collide already; the beam they hang from is
    // held back for the reason given at the foot of this file.
    frame('stone-hoist-west-tower', [-28.8, GROUND + 15.0, -55.0], [2.9, 30.0, 2.9]),
    frame('stone-hoist-east-tower', [8.8, GROUND + 15.0, -55.0], [2.9, 30.0, 2.9]),

    // --- Scaffold lift on the west front ------------------------------------------------------
    // The mast and the six decks. A deck reads as a floor a player can put a ship down on, which
    // is exactly why flying through one is worse than flying through a rope.
    frame('scaffold-mast', [-40.0, GROUND + 23.8, 47.8], [3.8, 47.6, 3.8]),
    ...[13.6, 21.2, 28.7, 36.3, 43.8, 51.4].map((y, level) => (
        frame(`scaffold-deck-${level}`, [-40.0, y, 41.6], [7.3, 0.4, 7.3])
    )),

    // --- Vault gantry inside the nave ---------------------------------------------------------
    // Four legs under the deck that sweeps the central vessel. The deck collides; the legs stand
    // in the one part of the interior a player flies at speed.
    ...[[-68.6, 6.4], [-68.6, -6.4], [-63.0, 6.4], [-63.0, -6.4]].map(([x, z], leg) => (
        frame(`gantry-leg-${leg}`, [x, GROUND + 8.7, z], [1.0, 17.4, 1.0])
    )),

    // --- Hoarding on the river approach -------------------------------------------------------
    // The two posts and the head rail the sheets hang from. The sheets themselves travel and
    // collide; the frame holding them is the first thing on the map a player meets.
    frame('hoarding-west-post', [-171.8, GROUND + 12.6, 0.0], [1.4, 25.2, 2.0]),
    frame('hoarding-east-post', [-128.2, GROUND + 12.6, 0.0], [1.4, 25.2, 2.0]),

    // The rose scaffold's two stands are left out as well. The east one stands 2 units from the
    // centre of CP05_ROSE, which asks for 4.6 of air: the scaffold is drawn hard against the west
    // window because that is what a scaffold does, and the ring is aimed through that window. One
    // of the two has to move before the stand can collide, and that is a route decision.

    // --- Fleche hoist east of the apse --------------------------------------------------------
    // Four gantry towers around the spire section. The section collides as it rises; the cage of
    // towers around it is what a player actually has to fly between.
    ...[[120.9, 9.1], [120.9, -9.1], [139.1, 9.1], [139.1, -9.1]].map(([x, z], tower) => (
        frame(`fleche-tower-${tower}`, [x, GROUND + 21.0, z], [2.4, 42.0, 2.4])
    )),
];

// Held back, though all three are drawn: the crane counter-jib and apex, the stone hoist beam, and
// the hoarding head rail. They fail the suite's check that collision stands inside some model the
// map loads -- not because they do not, but because that check derives a model's extent from raw
// mesh bounds, and on these rigged files a mesh states its corners relative to the rig empty that
// carries it rather than to the scene. A crane jib parked 12 m west of its own pivot reads as 12 m
// west of the crane. Until that check resolves the node transforms, a box there is a claim nothing
// can verify, and this file would rather under-collide than assert what it cannot show.
