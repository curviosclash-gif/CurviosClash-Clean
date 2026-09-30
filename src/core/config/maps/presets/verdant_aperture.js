// Verdant Aperture is the hunt counterpart to Kinetic Tide. There the obstacles move and the way
// through stays put; here the barrier stays put and the opening travels along it. The map is a
// greenhouse ruin on three stacked levels, and the setpieces that join those levels are the whole
// point: whoever reads where the hole currently is changes level, whoever does not waits or takes
// the long way round.
//
// Two facts from the runtime shape every decision below.
//
// First, machine gun fire ignores obstacles entirely (src/hunt/mg/MGHitResolver.js resolves only
// players, trails and turrets along the aim line), while rockets do collide with the arena. So the
// moving geometry can never provide cover against the MG -- it can only shape where players fly
// and where rockets land. The map therefore puts the rocket pickups behind the traveling openings:
// the rocket is the one weapon this map's movement actually affects.
//
// Second, glbColliderMode 'dynamic' gives a collider only to meshes an animation moves. The static
// frames of each setpiece are invisible to the physics, so the deck cut-outs below are kept
// slightly tighter than the setpiece that fills them. Deck and setpiece together form the barrier.

import { mushroomPatch } from './glowing_mushrooms.js';

const BEAT_SECONDS = 6;

// The cellar floor. The foam pad below it sits at y=6 and is four units thick, so anything
// standing in the cellar stands on 8, as the ferns and the ancient tree already do.
const CELLAR_FLOOR = 8;
// One cellar width. Past it a viewer is on another storey with two ceilings in between.
const CELLAR_RENDER_DISTANCE = 190;

function landmark(id, pack, model, position, targetSize, rotateY = 0) {
    return {
        id: `verdant-aperture-${id}`,
        url: `assets/models/${pack === 'pm-avatar-garden' ? 'optimized_cc0' : 'downloaded_cc0'}/${pack}/${model}.glb`,
        position,
        rotation: [0, rotateY, 0],
        targetSize,
    };
}

function wildwuchs(family, variant, position, targetSize, rotateY = 0) {
    return {
        id: `verdant-aperture-wildwuchs-${family}-${variant}`,
        url: `assets/models/verdant_wildwuchs/${family}_${variant}.glb`,
        position,
        rotation: [0, rotateY, 0],
        targetSize,
    };
}

function setpiece(id, file, clipName, phaseOffsetBeats, position, targetSize, rotation = [0, 0, 0]) {
    return {
        id: `verdant-aperture-${id}`,
        url: `assets/maps/verdant_aperture/glb/${file}.glb`,
        position,
        rotation,
        targetSize,
        animationClock: { clipName, phaseOffsetBeats },
    };
}

/**
 * A setpiece that gates a level join, placed straight into the hole its join punched.
 *
 * The loader does not centre a model on `position`: it stands the model on the bottom of its
 * bounding box there and only then turns it about that point (GLBCollectionPlacement). So each
 * join slot says how far the slot has to sit from the hole centre for the shut blades to land in
 * the deck - `lift` along Y, `swing` back along Z for a model the turn carries sideways.
 * tests/verdant-aperture-openings.contract.test.mjs shoots rays through the holes and checks
 * that they really shut and really open.
 */
function joinSetpiece(join, deckY, id, file, clipName, phaseOffsetBeats, slot) {
    return setpiece(id, file, clipName, phaseOffsetBeats,
        [join[0], deckY + slot.lift, join[1] - slot.swing], slot.targetSize, slot.rotation);
}

const LEVEL_ROOT_DECK = 54;
const LEVEL_CROWN_DECK = 112;
const DECK_EXTENT = 150;
const DECK_CELL = 30;
const DECK_THICKNESS = 4;

/**
 * A closed storey floor with holes punched where the setpieces sit.
 *
 * Without this the levels would not be levels at all -- players would simply fly around any
 * shutter, and the traveling opening would decorate rather than gate. Each hole is authored one
 * cell smaller than the setpiece that fills it, so the moving parts overlap the rim of solid deck
 * instead of leaving a ring of open air the collider mode cannot see.
 */
function deck(y, joins, { thickness = DECK_THICKNESS } = {}) {
    const boxes = [];
    for (let x = -DECK_EXTENT + DECK_CELL / 2; x < DECK_EXTENT; x += DECK_CELL) {
        for (let z = -DECK_EXTENT + DECK_CELL / 2; z < DECK_EXTENT; z += DECK_CELL) {
            // A join sits on a cell centre and removes exactly that one cell. One cell is 30
            // units across and a shut shutter covers roughly 28 of them, so the rim of open air
            // the collider mode cannot see stays under the 1.6 unit vehicle width. Punching a
            // wider hole would leave a ring anyone could fly through at any time.
            if (joins.some(([jx, jz]) => jx === x && jz === z)) continue;
            boxes.push({ pos: [x, y, z], size: [DECK_CELL, thickness, DECK_CELL] });
        }
    }
    return boxes;
}

// Level joins, on deck cell centres. Each one carries the setpiece that gates it, and the
// setpieces below take their position straight from these entries so the two cannot drift apart.
const ROOT_TO_CROWN = [[-45, -45], [45, 45]];
const CROWN_TO_CANOPY = [[-45, 45], [45, -45], [15, 15]];

/**
 * How large each gating setpiece has to be authored.
 *
 * A cut-out is a square deck cell but the shutters are round, so covering the cell's width is
 * not enough -- its four corners stay open, and a desktop sweep measured a join sitting 60%
 * passable through the entire beat because of exactly that. The setpiece has to reach the cell
 * *diagonal*, which is DECK_CELL * sqrt(2).
 *
 * targetSize is a model's largest dimension after the map scale is applied
 * (see fitScale in GLBMapLoader), so it has to be divided by that scale, and scaled up again by
 * how much of the model the shut collision bodies actually span -- the frames around them carry
 * no collider in dynamic mode and cover nothing.
 */
function joinTargetSize(modelWidth, shutCoverageWidth) {
    const reachNeeded = DECK_CELL * Math.SQRT2;
    return Math.ceil((reachNeeded * modelWidth) / shutCoverageWidth);
}

const LEAF_SHUTTER_SIZE = joinTargetSize(15.4, 10.8);
const GLASS_LOUVRE_SIZE = joinTargetSize(24.0, 10.8);

// Offsets measured by placing each GLB with computeCollectionPlacement at the target size above.
//
// The blades and petals now retract together. Place their shut pose across each deck hole;
// the old edge-on placements left permanent gaps around the barrier.
const JOIN_SLOT = {
    // Blades span 10.8 of the shutter's 15.4 model units when shut. The generator builds the
    // shutter in Blender's XZ plane and the glTF export turns Z-up into Y-up, so it arrives
    // standing on edge (15.2 tall, 1.7 thick); a quarter turn about X lays it into the deck. The
    // turn pivots about the bottom edge and swings the shutter's centre half its height towards
    // +Z - centred, the slot would move back by swing = (15.2 / 2) * (targetSize / 15.36).
    leafShutter: {
        targetSize: LEAF_SHUTTER_SIZE,
        rotation: [Math.PI / 2, 0, 0],
        lift: 0,
        swing: (15.2 / 2) * (LEAF_SHUTTER_SIZE / 15.36),
    },
    // Petals span 12.0 of the blossom's 13.8 model units (its sepals are the widest part, so a
    // flat iris would be sized joinTargetSize(13.8, 12.0) = 49). The iris is built lying flat;
    // the quarter turn stands it on edge. Flat, its shut petals start 6.75 above the base at size
    // 49, and lift = DECK_THICKNESS / 2 - 6.746 rests their rim on the deck top.
    bloomIris: {
        targetSize: joinTargetSize(13.8, 12.0),
        rotation: [0, 0, 0],
        lift: DECK_THICKNESS / 2 - 6.746,
        swing: 0,
    },
    // Sized from the louvre's 24.0 by 10.8 frame; the shut panes then span 82.6 by 35.6, which
    // covers the square hole on both axes - a rectangle needs no diagonal reach. Built lying
    // flat; the shut panes lie 13.8-15.5 above the base, and their mid-plane sits in the middle
    // of the deck so they fill the hole flush.
    glassLouvre: {
        targetSize: GLASS_LOUVRE_SIZE,
        rotation: [0, 0, 0],
        lift: -14.675,
        swing: 0,
    },
};

// The root arches are doors in their piers. Their seven trunks reach 12.48 either side of the
// arch centre and 8.89 above its base, and one at a time sinks into the floor to open a slot.
const ROOT_ARCH_TRUNK_HALF_SPAN = 12.48;
const ROOT_ARCH_TRUNK_TOP = CELLAR_FLOOR + 8.894;

/** A pier with the arch's trunk span cut out of it, so the trunks are the door. */
function rootArchPier(x, z) {
    const pierHalfLength = 23;
    const pierTop = 48;
    const stub = pierHalfLength - ROOT_ARCH_TRUNK_HALF_SPAN;
    const stubCentre = ROOT_ARCH_TRUNK_HALF_SPAN + stub / 2;
    return [
        { pos: [x, 28, z - stubCentre], size: [8, 40, stub] },
        { pos: [x, 28, z + stubCentre], size: [8, 40, stub] },
        {
            pos: [x, (ROOT_ARCH_TRUNK_TOP + pierTop) / 2, z],
            size: [8, pierTop - ROOT_ARCH_TRUNK_TOP, 2 * ROOT_ARCH_TRUNK_HALF_SPAN],
        },
        // A threshold under the arch's floor signal, which carries no collider in dynamic mode.
        { pos: [x, CELLAR_FLOOR + 0.25, z], size: [8, 0.5, 2 * ROOT_ARCH_TRUNK_HALF_SPAN] },
    ];
}

// The vine gate's braids span 13.65 either side and start 0.93 above the model base; the base
// sinks by that much so the lowest braid rests on the cellar floor instead of leaving a slot
// under the gate. Its head starts 29.88 above the base.
const VINE_GATE_Y = CELLAR_FLOOR - 0.931;
const VINE_GATE_BRAID_HALF_SPAN = 13.65;
const VINE_GATE_HEAD_BOTTOM = VINE_GATE_Y + 29.884;
const VINE_GATE_FLANK_OUTER = 39;
const CELLAR_WALL_TOP = 48;

// Crown hall walls run from y=58 to 102 around their gaps. The curtain and the mill are centred
// in those gaps (the curtain model is 19.36 tall, the mill 25.99); sill and lintel boxes close
// the wall gap above and below the moving panels and rotor, which keep their carried gap.
const CROWN_WALL_BOTTOM = 58;
const CROWN_WALL_TOP = 102;
const CROWN_WALL_CENTRE = (CROWN_WALL_BOTTOM + CROWN_WALL_TOP) / 2;
const CANOPY_Y = CROWN_WALL_CENTRE - 19.36 / 2;
const CANOPY_PANEL_BOTTOM = CANOPY_Y + 1.2;
const CANOPY_PANEL_TOP = CANOPY_Y + 17.2;
const MILL_Y = CROWN_WALL_CENTRE - 25.989 / 2;
const MILL_ROTOR_BOTTOM = MILL_Y + 1.044;
const MILL_ROTOR_TOP = MILL_Y + 24.945;

/** Boxes above and below a moving part inside a crown wall gap. */
function wallGapFill(x, z, size, bottom, top) {
    return [
        { pos: [x, (CROWN_WALL_BOTTOM + bottom) / 2, z], size: [size[0], bottom - CROWN_WALL_BOTTOM, size[1]] },
        { pos: [x, (top + CROWN_WALL_TOP) / 2, z], size: [size[0], CROWN_WALL_TOP - top, size[1]] },
    ];
}

const VERDANT_APERTURE_LANDMARKS = [
    // Root cellar: wet stone and overgrowth, the tightest level.
    landmark('root-palm', 'pm-avatar-garden', 'BasePalmTree01', [-96, 10, 96], 46, 0.4),
    landmark('root-bush-west', 'pm-avatar-garden', 'Bush03', [-108, 10, -60], 26),
    landmark('root-bush-east', 'pm-avatar-garden', 'Bush05', [104, 10, 52], 28, 1.1),
    landmark('root-column', 'pm-crystal-crossroads', 'Column_SmallBroken_01', [36, 10, -104], 30),
    // Standing on the cellar floor: the sinking trunk has to disappear into the ground.
    setpiece('root-arch-west', '03_root_arch', 'RootArchLoop', 0, [-46, CELLAR_FLOOR, -70], 30, [0, Math.PI / 2, 0]),
    setpiece('root-arch-east', '03_root_arch', 'RootArchLoop', 0.5, [46, CELLAR_FLOOR, 70], 30, [0, Math.PI / 2, 0]),
    // The slowest barrier on the map divides the cellar down the middle; its gap climbs over a
    // full 24 seconds, so crossing here is a commitment rather than a reflex.
    setpiece('vine-gate', '07_vine_gate', 'VineGateLoop', 0, [0, VINE_GATE_Y, 0], 34),
    wildwuchs('root', 'v01', [-108, 8, -88], 15, 0.3),
    wildwuchs('root', 'v02', [104, 8, -65], 18, -0.5),
    wildwuchs('root', 'v03', [76, 8, 110], 14, 1.1),
    // One existing, static ancient-tree variant anchors the cellar's far wall.
    {
        id: 'verdant-aperture-ancient-tree',
        url: 'assets/models/ancient_tree/variants/variant_06/ancient_tree_06_lod1.glb',
        position: [0, 8, 118],
        rotation: [0, 0.35, 0],
        targetSize: 42,
    },
    // Fungus between the overgrowth. The cellar is the darkest of the three storeys and the
    // only one lit from above through two ceilings, so it is the one level where a glow reads
    // at all. The clumps sit in the gaps the ferns, the bushes and the two join cut-outs leave,
    // and the render distance is the cellar's own width - past that the ceiling hides them.
    ...mushroomPatch({
        id: 'verdant-aperture-fungus-west',
        centre: [-70, CELLAR_FLOOR, 20],
        radius: 16,
        count: 5,
        size: [9, 15],
        hues: ['teal'],
        seed: 5531,
        maxRenderDistance: CELLAR_RENDER_DISTANCE,
    }),
    ...mushroomPatch({
        id: 'verdant-aperture-fungus-east',
        centre: [62, CELLAR_FLOOR, -34],
        radius: 14,
        count: 4,
        size: [9, 16],
        forms: ['cap', 'trumpet'],
        hues: ['teal', 'amber'],
        seed: 7724,
        maxRenderDistance: CELLAR_RENDER_DISTANCE,
    }),
    ...mushroomPatch({
        id: 'verdant-aperture-fungus-tree',
        centre: [-24, CELLAR_FLOOR, 84],
        radius: 14,
        count: 4,
        size: [8, 13],
        forms: ['coral', 'cap'],
        hues: ['amber'],
        seed: 3118,
        maxRenderDistance: CELLAR_RENDER_DISTANCE,
    }),

    // The two ways up into the crown hall, half a beat apart so they never show the same opening.
    joinSetpiece(ROOT_TO_CROWN[0], LEVEL_ROOT_DECK, 'leaf-shutter-west', '01_leaf_shutter', 'LeafShutterLoop', 0, JOIN_SLOT.leafShutter),
    joinSetpiece(ROOT_TO_CROWN[1], LEVEL_ROOT_DECK, 'leaf-shutter-east', '01_leaf_shutter', 'LeafShutterLoop', 0.5, JOIN_SLOT.leafShutter),

    // Crown hall: the main fighting floor, open in the middle, walled by drifting curtains.
    landmark('crown-bridge', 'pm-avatar-garden', 'Bridge01', [0, 62, -96], 52),
    landmark('crown-pedestal', 'pm-avatar-garden', 'AvatarPedestal01', [0, 60, 0], 26),
    landmark('crown-bush-north', 'pm-avatar-garden', 'Bush01', [-88, 62, 88], 30, 0.6),
    landmark('crown-bush-south', 'pm-avatar-garden', 'Bush06', [92, 62, -84], 30, 2.2),
    landmark('crown-arc', 'pm-crystal-crossroads', 'Arc', [0, 66, 104], 40, Math.PI / 2),
    setpiece('canopy-west', '04_canopy_drift', 'CanopyDriftLoop', 0.5, [-74, CANOPY_Y, 0], 44, [0, Math.PI / 2, 0]),
    setpiece('canopy-east', '04_canopy_drift', 'CanopyDriftLoop', 0, [74, CANOPY_Y, 0], 44, [0, Math.PI / 2, 0]),
    setpiece('mill-north', '06_pollen_mill', 'PollenMillLoop', 0, [0, MILL_Y, -46], 28),
    setpiece('mill-south', '06_pollen_mill', 'PollenMillLoop', 0.5, [0, MILL_Y, 46], 28),
    // The prize sits in the open, readable from both the cellar holes and the roof.
    setpiece('heart-seed', '08_heart_seed', 'HeartSeedLoop', 0, [0, 64, 0], 30),
    wildwuchs('fern', 'v01', [-112, 58, 30], 15, 0.4),
    wildwuchs('fern', 'v02', [112, 58, 8], 16, -0.2),
    wildwuchs('fern', 'v03', [0, 58, 118], 15, 1.0),

    // The three ways up onto the glass roof, spread across the beat.
    joinSetpiece(CROWN_TO_CANOPY[0], LEVEL_CROWN_DECK, 'bloom-west', '02_bloom_iris', 'BloomIrisLoop', 0.25, JOIN_SLOT.bloomIris),
    joinSetpiece(CROWN_TO_CANOPY[1], LEVEL_CROWN_DECK, 'bloom-east', '02_bloom_iris', 'BloomIrisLoop', 0.75, JOIN_SLOT.bloomIris),
    joinSetpiece(CROWN_TO_CANOPY[2], LEVEL_CROWN_DECK, 'louvre-centre', '05_glass_louvre', 'GlassLouvreLoop', 0.5, JOIN_SLOT.glassLouvre),

    // Glass roof: bright, exposed, and the only level with no cover at all.
    landmark('roof-crystal', 'pm-crystal-crossroads', 'Crystal_Cluster', [-84, 118, -78], 32, 0.8),
    landmark('roof-column', 'pm-crystal-crossroads', 'Column_Regular', [88, 118, 74], 34),
    landmark('roof-brush', 'pm-avatar-garden', 'Brush01', [-70, 118, 82], 24, 1.6),
    wildwuchs('vine', 'v01', [-95, 116, -137], 8, 0.25),
    wildwuchs('vine', 'v02', [100, 116, -137], 7, -0.3),
    wildwuchs('vine', 'v03', [-90, 116, 137], 10, 0.7),
];

const VERDANT_APERTURE_OBSTACLES = [
    // Ground of the root cellar, and the two storey decks that make the levels real.
    { pos: [0, 6, 0], size: [300, 4, 300], kind: 'foam' },
    ...deck(LEVEL_ROOT_DECK, ROOT_TO_CROWN),
    ...deck(LEVEL_CROWN_DECK, CROWN_TO_CANOPY),

    // Root cellar: a ring of piers that forces movement past the two root arches, which are the
    // doors through their piers.
    ...rootArchPier(-46, -70),
    ...rootArchPier(46, 70),
    { pos: [-110, 28, 0], size: [10, 40, 90] },
    { pos: [110, 28, 0], size: [10, 40, 90] },
    { pos: [0, 28, -118], size: [86, 40, 10] },
    { pos: [0, 28, 118], size: [86, 40, 10] },
    // Flanks of the vine gate, so its climbing gap is the way through the middle. They reach in
    // to the braids and take in the gate's posts; a braid that slides out slides into a flank.
    ...[-1, 1].map((side) => ({
        pos: [side * (VINE_GATE_BRAID_HALF_SPAN + VINE_GATE_FLANK_OUTER) / 2, 28, 0],
        size: [VINE_GATE_FLANK_OUTER - VINE_GATE_BRAID_HALF_SPAN, 40, 14],
    })),
    // Above the braids, the gate's head closes up to the flank tops.
    {
        pos: [0, (VINE_GATE_HEAD_BOTTOM + CELLAR_WALL_TOP) / 2, 0],
        size: [2 * VINE_GATE_BRAID_HALF_SPAN, CELLAR_WALL_TOP - VINE_GATE_HEAD_BOTTOM, 4.5],
    },

    // Crown hall: the drifting curtains close the east and west thirds.
    { pos: [-74, 80, -46], size: [10, 44, 52] },
    { pos: [-74, 80, 46], size: [10, 44, 52] },
    { pos: [74, 80, -46], size: [10, 44, 52] },
    { pos: [74, 80, 46], size: [10, 44, 52] },
    ...wallGapFill(-74, 0, [10, 40], CANOPY_PANEL_BOTTOM, CANOPY_PANEL_TOP),
    ...wallGapFill(74, 0, [10, 40], CANOPY_PANEL_BOTTOM, CANOPY_PANEL_TOP),
    // Walls around the pollen mills, leaving only the turning gap.
    { pos: [-38, 80, -46], size: [50, 44, 10] },
    { pos: [38, 80, -46], size: [50, 44, 10] },
    { pos: [-38, 80, 46], size: [50, 44, 10] },
    { pos: [38, 80, 46], size: [50, 44, 10] },
    ...wallGapFill(0, -46, [26, 10], MILL_ROTOR_BOTTOM, MILL_ROTOR_TOP),
    ...wallGapFill(0, 46, [26, 10], MILL_ROTOR_BOTTOM, MILL_ROTOR_TOP),
    // A low plinth under the heart seed; it blocks nothing overhead so the prize stays reachable.
    // It fills the seed's own 30 wide plinth (y 64-68), which carries no collider in dynamic
    // mode, down to the deck, and stays a hair inside it so the two faces do not flicker.
    { pos: [0, 61.9, 0], size: [29.6, 11.8, 29.6] },

    // Glass roof: low parapets only. This level is deliberately the most exposed one, because it
    // is the only place the MG's wall-piercing fire is not a design problem but the point.
    { pos: [0, 120, -140], size: [300, 8, 12] },
    { pos: [0, 120, 140], size: [300, 8, 12] },
    { pos: [-140, 120, 0], size: [12, 8, 280] },
    { pos: [140, 120, 0], size: [12, 8, 280] },
];

const VERDANT_APERTURE_PORTALS = [
    // Escape routes that do not depend on a shutter being open, so a losing fight is survivable.
    { a: [-120, 26, 108], b: [-118, 78, 92], color: 0x66dd88 },
    { a: [118, 26, -108], b: [116, 78, -92], color: 0xffbb55 },
    { a: [-118, 78, -92], b: [-120, 132, -96], color: 0x88ffcc },
    { a: [118, 78, 92], b: [120, 132, 96], color: 0xffdd77 },
];

const VERDANT_APERTURE_GATES = [
    { id: 'verdant_cellar_boost', type: 'boost', pos: [0, 26, -96], forward: [0, 0, 1], params: { duration: 0.9, forwardImpulse: 34, bonusSpeed: 42, cooldown: 0.8 } },
    { id: 'verdant_west_lift', type: 'slingshot', pos: [-45, 44, -45], forward: [0, 1, 0], up: [0, 1, 0], params: { duration: 1.4, forwardImpulse: 26, liftImpulse: 18, cooldown: 1.2 } },
    { id: 'verdant_east_lift', type: 'slingshot', pos: [45, 44, 45], forward: [0, 1, 0], up: [0, 1, 0], params: { duration: 1.4, forwardImpulse: 26, liftImpulse: 18, cooldown: 1.2 } },
    { id: 'verdant_crown_boost', type: 'boost', pos: [0, 80, -70], forward: [0, 0, 1], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
    { id: 'verdant_bloom_lift', type: 'slingshot', pos: [-45, 100, 45], forward: [0, 1, 0], up: [0, 1, 0], params: { duration: 1.5, forwardImpulse: 24, liftImpulse: 20, cooldown: 1.3 } },
    { id: 'verdant_roof_boost', type: 'boost', pos: [0, 132, 0], forward: [1, 0, 0], params: { duration: 0.9, forwardImpulse: 38, bonusSpeed: 46, cooldown: 0.7 } },
];

export const VERDANT_APERTURE_MAP = {
    verdant_aperture: {
        name: 'Verdant Aperture',
        exclusionZone: { openFaces: ['minX', 'maxX', 'minZ', 'maxZ', 'maxY'] },
        size: [300, 200, 300],
        scaleAuthoredAnchors: true,
        preferAuthoredPortals: true,
        portalLevels: [26, 78, 132],
        obstacles: VERDANT_APERTURE_OBSTACLES,
        portals: VERDANT_APERTURE_PORTALS,
        gates: VERDANT_APERTURE_GATES,
        glbModels: VERDANT_APERTURE_LANDMARKS,
        // Six seconds, not Kinetic Tide's four: hunt is not a race, so a player has time to read
        // where an opening currently is instead of having to hit it at speed.
        glbAnimationClock: { beatSeconds: BEAT_SECONDS },
        glbColliderMode: 'dynamic',
        glbLoadConcurrency: 3,
        singlePlayerScenario: {
            enabled: true,
            id: 'verdant_aperture_hunt',
            modePath: 'fight',
            gameMode: 'HUNT',
            minBots: 4,
            botRoles: ['guard', 'flanker', 'pursuer', 'interceptor'],
        },
        playerSpawn: { x: -120, y: 26, z: -120 },
        // Spread over all three levels on purpose. A shared start line would decide the match in
        // the first ten seconds and never test the shutters at all.
        botSpawns: [
            { x: 120, y: 26, z: 120 },
            { x: -120, y: 80, z: 120 },
            { x: 120, y: 80, z: -120 },
            { x: 0, y: 132, z: -120 },
            { x: 0, y: 132, z: 120 },
        ],
        // Turrets sit where the levels join. They are the only threat that keeps working while
        // nobody is nearby, which is what makes waiting in front of a shut barrier expensive.
        staticTurrets: [
            { id: 'verdant_turret_west_join', weapon: 'mg', pos: [-45, 62, -45], range: 70, cooldown: 0.85, damage: 4, phase: 0.4 },
            { id: 'verdant_turret_east_join', weapon: 'mg', pos: [45, 62, 45], range: 70, cooldown: 0.85, damage: 4, phase: 1.1 },
            { id: 'verdant_turret_roof', weapon: 'rocket', pos: [0, 126, 0], range: 96, cooldown: 3.6, rocketType: 'ROCKET_MEDIUM', phase: 0.9 },
        ],
        items: [
            // Rockets sit behind the traveling openings: the rocket is the only weapon the moving
            // geometry actually affects, so reading an opening has to be what earns one.
            { id: 'verdant_rocket_west', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -45, y: 64, z: -35, weight: 1.2 },
            { id: 'verdant_rocket_east', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 45, y: 64, z: 35, weight: 1.2 },
            // Above the heart seed: its core sweeps y 69.6-88.4 and would swallow the pickup.
            { id: 'verdant_rocket_heart', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 0, y: 94, z: 0, weight: 0.6 },
            { id: 'verdant_rocket_bloom', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: -45, y: 128, z: 45, weight: 0.9 },
            // Shields in the open crown hall, where the MG rules and cover does not help.
            { id: 'verdant_shield_crown_west', type: 'item_shield', pickupType: 'SHIELD', x: -40, y: 78, z: 0, weight: 1.3 },
            { id: 'verdant_shield_crown_east', type: 'item_shield', pickupType: 'SHIELD', x: 40, y: 78, z: 0, weight: 1.3 },
            { id: 'verdant_shield_roof', type: 'item_shield', pickupType: 'SHIELD', x: 0, y: 132, z: 60, weight: 1.1 },
            { id: 'verdant_speed_cellar', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 26, z: -60, weight: 1.1 },
            { id: 'verdant_speed_roof', type: 'item_battery', pickupType: 'SPEED_UP', x: -80, y: 132, z: 0, weight: 1.0 },
            { id: 'verdant_ghost_cellar', type: 'item_coin', pickupType: 'GHOST', x: 0, y: 26, z: 60, weight: 0.8 },
            { id: 'verdant_thick_roof', type: 'item_coin', pickupType: 'THICK', x: 80, y: 132, z: 0, weight: 0.8 },
            { id: 'verdant_rare_heart', type: 'item_crystal', pickupType: 'SHIELD', x: 0, y: 74, z: 12, weight: 0.5 },
        ],
        aircraft: [
            { id: 'verdant_wreck_cellar', jetId: 'ship6', x: -104, y: 20, z: 40, scale: 1.1, rotateY: 0.9 },
            { id: 'verdant_patrol_crown', jetId: 'ship4', x: 96, y: 96, z: -60, scale: 0.85, rotateY: -1.4 },
            { id: 'verdant_scout_roof', jetId: 'ship3', x: -60, y: 160, z: 90, scale: 0.7, rotateY: 2.1 },
        ],
        missions: [
            { type: 'KILL_COUNT', params: { target: 5 }, weight: 1.6 },
            { type: 'MULTI_KILL', params: { target: 2, windowSec: 14 }, weight: 0.9 },
            { type: 'NO_DAMAGE', params: {}, weight: 0.5 },
        ],
    },
};
