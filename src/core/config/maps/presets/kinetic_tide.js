// Kinetic Tide runs on one four second beat. Every moving setpiece loops on a whole
// multiple of it and states how far it runs ahead, so the obstacles form a rhythm a player
// can learn instead of a set of independent surprises. The offsets below are the level
// design: three gates a third of a beat apart become a chain, and the two lift decks of one
// four beat loop run two beats apart, so they take turns.

const BEAT_SECONDS = 4;

// Box obstacle from its two corners, in authored units.
function span(min, max) {
    return {
        pos: min.map((value, axis) => (value + max[axis]) / 2),
        size: min.map((value, axis) => max[axis] - value),
    };
}

// The four sides of a horizontal hoop of the piston tunnel, each over the arc within about
// thirty degrees of its axis, so the boxes stay inside the hoop and leave the corners open.
function hoopSides(minY, maxY) {
    const [cx, cz, outer, inner, half] = [-104, 26, 12.2, 10, 6.3];
    return [
        span([cx + inner, minY, cz - half], [cx + outer, maxY, cz + half]),
        span([cx - outer, minY, cz - half], [cx - inner, maxY, cz + half]),
        span([cx - half, minY, cz + inner], [cx + half, maxY, cz + outer]),
        span([cx - half, minY, cz - outer], [cx + half, maxY, cz - inner]),
    ];
}

// Posts (with their hydraulic housings) and lintel (with its signal) of one breath gate
// standing on baseY; the leaves slide into the posts, the opening stays free.
function gateFrame(x, baseY) {
    return [
        span([x - 2.1, baseY, 9.6], [x + 1.7, baseY + 14.1, 13]),
        span([x - 2.1, baseY, -13], [x + 1.7, baseY + 14.1, -9.6]),
        span([x - 2.1, baseY + 12.9, -12.4], [x + 2, baseY + 15.3, 12.4]),
    ];
}

function landmark(id, pack, model, position, targetSize, rotateY = 0) {
    return {
        id: `kinetic-tide-${id}`,
        url: `assets/models/downloaded_cc0/${pack}/${model}.glb`,
        position,
        rotation: [0, rotateY, 0],
        targetSize,
    };
}

function setpiece(id, file, clipName, phaseOffsetBeats, position, targetSize, rotateY = 0) {
    return {
        id: `kinetic-tide-${id}`,
        url: `assets/maps/kinetic_tide/glb/${file}.glb`,
        position,
        rotation: [0, rotateY, 0],
        targetSize,
        animationClock: { clipName, phaseOffsetBeats },
    };
}

function cladding(id, family, variant, position, targetSize, rotateY = 0) {
    const paddedVariant = String(variant).padStart(2, '0');
    const familyId = `kinetic-tide-${family}`;
    const assetId = `${familyId}-v${paddedVariant}`;
    return {
        id: `kinetic-tide-cladding-${id}`,
        url: `assets/maps/kinetic_tide/props/${familyId}/${assetId}/runtime.glb`,
        position,
        rotation: [0, rotateY, 0],
        targetSize,
    };
}

const KINETIC_TIDE_LANDMARKS = [
    // Sector 1: the lock approach teaches the beat with three gates a third apart.
    landmark('dock-station', 'pm-aero-system', 'Aero_Station_01_Art', [-208, 0, -44], 44, 0.4),
    landmark('dock-hex', 'pm-aero-system', 'Aero_Ground_Hexagons_01_Art', [-186, 6, 34], 30),
    // The offsets run backwards along the flight direction on purpose. Twenty authored
    // units at map scale 3 is 60 world units, and at the base speed of 45 units per second
    // that is exactly a third of a beat. A gate one third *behind* its predecessor
    // therefore shows the same opening the moment the player reaches it, so the wave
    // travels with them and one good entry timing carries through all three. Offsetting
    // them forwards instead would shut the second gate in the player's face.
    setpiece('gate-one', '01_breath_gate', 'BreathGateLoop', 0, [-196, 10, 0], 26, Math.PI / 2),
    setpiece('gate-two', '01_breath_gate', 'BreathGateLoop', 2 / 3, [-176, 11, 0], 26, Math.PI / 2),
    setpiece('gate-three', '01_breath_gate', 'BreathGateLoop', 1 / 3, [-156, 12, 0], 26, Math.PI / 2),
    landmark('dock-door', 'pm-aero-system', 'Aero_Door_01', [-146, 10, 0], 22, Math.PI / 2),

    // Sector 2: the safe lane runs wide below, the fast lane threads the piston tunnel.
    landmark('furnace-column-low', 'pm-chromatic-chaos', 'Column_Vapor_02', [-120, 4, -44], 34),
    landmark('furnace-column-high', 'pm-chromatic-chaos', 'Column_Vapor_03', [-120, 4, 40], 34),
    setpiece('piston-tunnel', '02_piston_tunnel', 'PistonTunnelLoop', 0.5, [-104, 28, 26], 30, Math.PI / 2),
    landmark('furnace-ramp', 'pm-chromatic-chaos', 'Building_Vapor_Ramp_01', [-92, 22, -30], 26, -0.5),

    // Sector 3: a corkscrew climb that ends in the iris.
    landmark('lens-arch', 'pm-crystal-crossroads', 'Arc', [-44, 44, 6], 30, Math.PI / 2),
    setpiece('iris-shutter', '03_iris_shutter', 'IrisShutterLoop', 0, [-14, 42, -10], 32, Math.PI / 2),
    landmark('lens-crystals', 'pm-crystal-crossroads', 'Crystal_Cluster', [4, 52, 24], 24, 0.7),

    // Sector 4: the carousel decides which orbit is open.
    setpiece('carousel', '04_carousel_ring', 'CarouselRingLoop', 0.25, [50, 74, 0], 36, Math.PI / 2),
    landmark('orbit-ring-inner', 'pm-aero-system', 'Aero_Station_PinkRing_Art', [50, 70, -30], 24, Math.PI / 2),
    landmark('orbit-ring-outer', 'pm-aero-system', 'Aero_Station_YellowRing_Art', [52, 80, 34], 26, Math.PI / 2),
    landmark('orbit-platform', 'pm-aero-system', 'Aero_Station_Mini_Platform_Art', [88, 76, 0], 26),

    // Sector 5: pendulums, then a pair of lifts that alternate between two exits.
    setpiece('pendulums', '05_pendulum_field', 'PendulumFieldLoop', 0, [128, 84, 22], 34),
    landmark('hall-dome', 'pm-abm', 'Dome02_Art', [148, 74, 4], 40, -0.6),
    setpiece('lift-rings', '06_lift_rings', 'LiftRingsLoop', 0, [172, 88, 44], 38),
    landmark('lift-island', 'pm-aero-system', 'Floating_Island_01_Art', [196, 92, 66], 34, 0.5),
    landmark('tech-ramp', 'pm-chromatic-chaos', 'Building_Vapor_Ramp_02', [188, 82, 76], 24, 2.2),

    // Sector 6: the tide wall sweeps the return leg, the heart closes the loop.
    setpiece('tide-wall', '07_tide_wall', 'TideWallLoop', 0, [92, 96, 98], 44, Math.PI / 2),
    landmark('descent-island', 'pm-aero-system', 'Floating_Island_01_Art', [34, 82, 72], 32, -0.8),
    landmark('descent-column', 'pm-crystal-crossroads', 'Column_Regular', [-2, 62, 34], 26),
    setpiece('reactor-heart', '08_reactor_heart', 'ReactorHeartLoop', 0, [0, 40, 0], 46),
    landmark('finish-ring', 'pm-aero-system', 'Aero_Station_Ring_Art', [0, 62, 0], 26, Math.PI / 2),

    // Static decorative mechanism cladding. Every runtime mesh is authored with _nocol and
    // lives in its own non-animated slot, so these explain motion without inheriting it or
    // narrowing a gameplay opening.
    cladding('breath-gate-frame', 'machine-frame', 1, [-176, 8.5, 0], 30, Math.PI / 2),
    cladding('breath-gate-beacon', 'warning-beacon', 1, [-176, 9, -16], 5.5, Math.PI / 2),

    cladding('piston-tunnel-frame', 'machine-frame', 4, [-104, 26, 26], 36, Math.PI / 2),
    cladding('piston-tunnel-flange', 'bearing-flange', 2, [-104, 28, 26], 34, Math.PI / 2),
    cladding('piston-tunnel-panel', 'maintenance-panel', 3, [-104, 28, 41], 7, Math.PI / 2),

    cladding('iris-shutter-flange', 'bearing-flange', 4, [-14, 40, -10], 38, Math.PI / 2),
    cladding('iris-shutter-beacon', 'warning-beacon', 3, [-14, 55, -23], 5.5, Math.PI / 2),

    cladding('carousel-ring-flange', 'bearing-flange', 6, [50, 72, 0], 42, Math.PI / 2),

    cladding('pendulum-field-frame', 'machine-frame', 5, [128, 82, 22], 40),
    cladding('pendulum-field-beacon', 'warning-beacon', 7, [116, 83, 11], 5.5),

    cladding('lift-rings-flange', 'bearing-flange', 8, [172, 87, 44], 44),
    cladding('lift-rings-panel', 'maintenance-panel', 6, [161, 88, 56], 7, -Math.PI / 4),

    cladding('tide-wall-frame', 'machine-frame', 9, [92, 94, 98], 52, Math.PI / 2),
    cladding('tide-wall-beacon', 'warning-beacon', 10, [92, 95, 81], 6, Math.PI / 2),

    cladding('reactor-heart-flange', 'bearing-flange', 10, [0, 39, 0], 54),
    cladding('reactor-heart-panel', 'maintenance-panel', 10, [12, 40, -8], 7, -Math.PI / 3),
];

const KINETIC_TIDE_AUTHORED_OBSTACLES = [
    // Sector 1: launch deck and the lock chain.
    { pos: [-210, 10, 0], size: [34, 3, 48] },
    { pos: [-186, 11, 0], size: [22, 3, 34] },
    { pos: [-166, 12, 0], size: [22, 3, 30] },
    { pos: [-150, 13, 0], size: [18, 3, 26] },

    // Sector 2: wide low lane, tight high lane, foam floor under both.
    { pos: [-136, 16, 0], size: [18, 3, 34] },
    { pos: [-120, 18, -22], size: [22, 3, 18] },
    { pos: [-104, 12, -30], size: [20, 3, 16] },
    { pos: [-86, 26, -22], size: [16, 3, 14] },
    { shape: 'tube', kind: 'hard', start: [-130, 18, 12], end: [-110, 30, 24], radius: 4.4 },
    { pos: [-104, 32, 26], size: [16, 3, 12] },
    { pos: [-88, 36, 14], size: [14, 3, 12] },
    { pos: [-70, 31, 0], size: [16.5, 4, 18] },
    { pos: [-112, 6, 0], size: [72, 3, 76], kind: 'foam' },
    { pos: [-120, 22, -48], size: [6, 44, 6] },
    { pos: [-120, 22, 46], size: [6, 44, 6] },

    // Sector 3: corkscrew through the iris.
    { shape: 'tube', kind: 'hard', start: [-62, 40, 0], end: [-44, 46, 12], radius: 4.8 },
    { pos: [-42, 46, 14], size: [16, 3, 14] },
    { pos: [-28, 50, 4], size: [14, 3, 12] },
    { pos: [-14, 54, -10], size: [16, 3, 14] },
    { pos: [-14, 62, -10], size: [26, 22, 26], tunnel: { radius: 5.6, axis: 'x' } },
    { pos: [2, 52.3, -4], size: [14, 3, 12] },
    { pos: [16, 57, 0], size: [18, 4, 18] },
    { pos: [-24, 26, 0], size: [96, 4, 76], kind: 'foam' },

    // Sector 4: two complete orbits around the carousel.
    { pos: [30, 68, -14], size: [16, 3, 14] },
    { pos: [50, 70, -30], size: [18, 3, 16] },
    { pos: [70, 74, -20], size: [15, 3, 13] },
    { shape: 'tube', kind: 'hard', start: [28, 67, -12], end: [68, 74, -18], radius: 4.2 },
    { pos: [32, 74, 18], size: [14, 3, 12] },
    { pos: [52, 78, 32], size: [14, 3, 13] },
    { pos: [72, 80, 20], size: [13, 3, 12] },
    { shape: 'tube', kind: 'hard', start: [30, 72, 16], end: [70, 80, 18], radius: 3.4 },
    { pos: [88, 71, 0], size: [20, 4, 22] },
    { pos: [52, 42, 0], size: [88, 4, 86], kind: 'foam' },

    // Sector 5: pendulum hall and the lift pair.
    { pos: [108, 82, 10], size: [18, 3, 18] },
    { pos: [128, 84, 22], size: [22, 3, 20] },
    { pos: [148, 88, 32], size: [18, 3, 16] },
    { pos: [166, 85.2, 40], size: [20, 4, 20] },
    { shape: 'tube', kind: 'hard', start: [106, 81, 8], end: [146, 88, 30], radius: 4.6 },
    { pos: [190, 100, 58], size: [18, 4, 17] },
    { pos: [186, 86, 74], size: [12, 3, 11] },
    { pos: [176, 96, 86], size: [12, 3, 11] },
    { shape: 'tube', kind: 'hard', start: [188, 88, 72], end: [174, 98, 88], radius: 3.3 },
    { pos: [170, 99.2, 96], size: [12, 4, 11] },
    { shape: 'tube', kind: 'hard', start: [192, 102, 60], end: [172, 106, 94], radius: 5.0 },
    { pos: [150, 48, 40], size: [104, 4, 92], kind: 'foam' },

    // Sector 6: the return leg past the tide wall and down to the heart.
    { pos: [128, 104, 98], size: [20, 3, 18] },
    { pos: [96, 93.4, 98], size: [22, 4, 20] },
    { pos: [64, 94, 88], size: [16, 3, 15] },
    { pos: [30, 79.8, 70], size: [18, 4, 17] },
    { pos: [4, 78, 48], size: [15, 3, 14] },
    { pos: [-6, 64.2, 30], size: [16, 4, 15] },
    { pos: [-4, 66, 12], size: [14, 3, 13] },
    { pos: [0, 51.8, 0], size: [24, 4, 22] },
    { shape: 'tube', kind: 'hard', start: [126, 104, 98], end: [98, 100, 98], radius: 4.8 },
    { shape: 'tube', kind: 'hard', start: [62, 93, 86], end: [32, 86, 72], radius: 4.2 },
    { shape: 'tube', kind: 'hard', start: [28, 84, 66], end: [-4, 71, 32], radius: 3.8 },
    { pos: [0, 26, 0], size: [20, 52, 20] },
];

// In 'dynamic' collider mode only the moving meshes of a setpiece collide. These boxes give
// its fixed frame the collision the player sees, measured from the placed GLB parts. They are
// collision only: the GLB already draws the part.
const KINETIC_TIDE_FRAME_COLLIDERS = [
    ...gateFrame(-196, 10),
    ...gateFrame(-176, 11),
    ...gateFrame(-156, 12),

    // Piston tunnel: hoops, corner rails, pulse markers and the sleeves the pistons run in.
    ...hoopSides(30.8, 32.3),
    ...hoopSides(37.2, 38.7),
    ...hoopSides(43.7, 45.2),
    ...hoopSides(50.2, 51.7),
    ...[[-94.1, 35.9], [-114.9, 35.9], [-94.1, 15.1], [-114.9, 15.1]]
        .map(([x, z]) => span([x, 28, z], [x + 1, 54.5, z + 1])),
    ...[28.3, 34.5, 40.8, 47, 53.3].map((y) => span([-92.5, y, 24.6], [-91.9, y + 0.5, 27.4])),
    span([-107.1, 35, 11], [-100.9, 41, 15.5]),
    span([-119, 35, 22.9], [-114.5, 41, 29.1]),
    span([-107.1, 35, 36.5], [-100.9, 41, 41]),
    span([-93.5, 35, 22.9], [-89, 41, 29.1]),

    // Carousel hub and its two supports.
    span([48.7, 88.6, -2.9], [52.5, 94.5, 2.9]),
    span([47.5, 74, 16.4], [51.4, 109.1, 18]),
    span([47.5, 74, -18], [51.4, 109.1, -16.4]),

    // Pendulum rail with its phase lamps, and the two arch legs.
    span([111, 99.4, 20.6], [145, 101.2, 23.6]),
    span([111, 84, 20.5], [112.7, 100.7, 23.5]),
    span([143.3, 84, 20.5], [145, 100.7, 23.5]),

    // Lift column with its steps, and the two deck guides.
    span([169.8, 88, 41.7], [174.2, 121.6, 46.5]),
    span([160.7, 89, 42], [161.5, 120.5, 42.8]),
    span([182.5, 89, 42], [183.3, 120.5, 42.8]),

    // Tide wall: four pillars (with the drive drums) and the arch with its meters.
    ...[113.9, 106.5, 84.1, 76.7].map((z) => span([78.5, 96, z], [83.2, 112.9, z + 5.5])),
    span([78.2, 112.8, 76], [83.8, 114.7, 120]),

    // Reactor plinth and the six crown pylons with their tips.
    span([-18.9, 46.7, -18.9], [18.9, 51.4, 18.9]),
    span([16.2, 49.3, -1.8], [19.7, 66.6, 1.8]),
    span([-19.7, 49.3, -1.8], [-16.2, 66.6, 1.8]),
    ...[[6.9, -17.4], [-11.1, -17.4], [-11.1, 13.7], [6.9, 13.7]]
        .map(([x, z]) => span([x, 49.3, z], [x + 4.2, 66.6, z + 3.7])),
];

// The authored boxes keep their visuals; the frame colliders stay invisible
// (glbAuthoredObstaclesCollisionOnly). Without the GLB every box shows again.
const KINETIC_TIDE_OBSTACLES = [
    ...KINETIC_TIDE_AUTHORED_OBSTACLES.map((obstacle) => ({ ...obstacle, renderWithGlb: true })),
    ...KINETIC_TIDE_FRAME_COLLIDERS,
];

const KINETIC_TIDE_PORTALS = [
    { a: [-128, 19, 14], b: [-102, 34, 26], color: 0x22ccdd },
    { a: [50, 72, -30], b: [52, 80, 34], color: 0xff8811 },
    { a: [190, 102, 58], b: [170, 108, 96], color: 0xaa66ff },
    // Just past the end of the tide panels' stroke, beside the descent tunnel mouth.
    { a: [52, 96, 88], b: [-6, 72, 30], color: 0x44ffbb },
];

const KINETIC_TIDE_GATES = [
    { id: 'tide_launch_boost', type: 'boost', pos: [-204, 14, 0], forward: [1, 0, 0], params: { duration: 1.2, forwardImpulse: 42, bonusSpeed: 50, cooldown: 0.9 } },
    { id: 'tide_lock_boost', type: 'boost', pos: [-166, 15, 0], forward: [1, 0.05, 0], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 45, cooldown: 0.8 } },
    { id: 'tide_furnace_sling', type: 'slingshot', pos: [-134, 19, 10], forward: [0.7, 0.55, 0.45], up: [0, 1, 0], params: { duration: 1.5, forwardImpulse: 31, liftImpulse: 13, cooldown: 1.2 } },
    { id: 'tide_lens_boost', type: 'boost', pos: [-42, 49, 14], forward: [0.8, 0.25, -0.55], params: { duration: 1.0, forwardImpulse: 37, bonusSpeed: 46, cooldown: 0.8 } },
    { id: 'tide_orbit_inner', type: 'boost', pos: [30, 71, -14], forward: [0.75, 0.1, -0.65], params: { duration: 0.9, forwardImpulse: 35, bonusSpeed: 44, cooldown: 0.7 } },
    { id: 'tide_orbit_outer', type: 'slingshot', pos: [32, 77, 18], forward: [0.7, 0.3, 0.65], up: [0, 1, 0], params: { duration: 1.4, forwardImpulse: 32, liftImpulse: 11, cooldown: 1.0 } },
    { id: 'tide_pendulum_boost', type: 'boost', pos: [108, 85, 10], forward: [0.85, 0.15, 0.5], params: { duration: 0.9, forwardImpulse: 38, bonusSpeed: 47, cooldown: 0.8 } },
    { id: 'tide_lift_sling', type: 'slingshot', pos: [158, 94, 30], forward: [0.6, 0.4, 0.7], up: [0, 1, 0], params: { duration: 1.6, forwardImpulse: 33, liftImpulse: 14, cooldown: 1.1 } },
    { id: 'tide_return_boost', type: 'boost', pos: [128, 107, 98], forward: [-0.98, -0.1, 0.05], params: { duration: 0.9, forwardImpulse: 36, bonusSpeed: 45, cooldown: 0.7 } },
    { id: 'tide_descent_boost', type: 'boost', pos: [30, 89, 70], forward: [-0.7, -0.3, -0.6], params: { duration: 0.8, forwardImpulse: 34, bonusSpeed: 42, cooldown: 0.7 } },
];

const KINETIC_TIDE_CHECKPOINTS = [
    { id: 'CP01', type: 'entry', pos: [-214, 14, 0], radius: 7.0, forward: [1, 0, 0] },
    { id: 'CP02', type: 'gate_chain', pos: [-156, 16, 0], radius: 6.2, forward: [1, 0.05, 0] },
    { id: 'CP03', type: 'branch_entry', pos: [-140, 18, 0], radius: 6.0, forward: [1, 0.05, 0], nextIds: ['CP04_SAFE', 'CP04_FAST'] },
    { id: 'CP04_SAFE', type: 'safe_blue', pos: [-104, 20, -30], radius: 5.5, forward: [0.8, 0.05, -0.6], nextIds: ['CP05'] },
    { id: 'CP04_FAST', type: 'fast_orange', pos: [-104, 34, 26], radius: 4.5, forward: [0.75, 0.3, 0.55], nextIds: ['CP05'] },
    { id: 'CP05', type: 'furnace_merge', pos: [-70, 40, 0], radius: 6.0, forward: [1, 0.2, 0] },
    { id: 'CP06', type: 'iris', pos: [-14, 58, -10], radius: 5.6, forward: [0.9, 0.3, -0.2] },
    // Beyond the crown pylon and the petal stroke, so neither reaches into the ring.
    { id: 'CP07', type: 'branch_entry', pos: [24, 68, 0], radius: 6.0, forward: [0.9, 0.2, 0.3], nextIds: ['CP08_INNER', 'CP08_OUTER'] },
    { id: 'CP08_INNER', type: 'orbit_inner', pos: [50, 72, -30], radius: 4.6, forward: [0.7, 0.1, -0.7], nextIds: ['CP09'] },
    { id: 'CP08_OUTER', type: 'orbit_outer', pos: [52, 80, 34], radius: 5.4, forward: [0.7, 0.2, 0.65], nextIds: ['CP09'] },
    { id: 'CP09', type: 'orbit_merge', pos: [88, 80, 0], radius: 6.0, forward: [0.85, 0.15, 0.5] },
    { id: 'CP10', type: 'pendulum_hall', pos: [128, 86, 22], radius: 5.6, forward: [0.85, 0.1, 0.5] },
    // In front of the lift deck's shaft: the lowered deck used to fill the ring.
    { id: 'CP11', type: 'branch_entry', pos: [158, 93, 30], radius: 5.8, forward: [0.85, 0.15, 0.45], nextIds: ['CP12_LIFT', 'CP12_TECH'] },
    { id: 'CP12_LIFT', type: 'lift_high', pos: [190, 104, 58], radius: 5.2, forward: [0.7, 0.25, 0.65], nextIds: ['CP13'] },
    { id: 'CP12_TECH', type: 'technical_low', pos: [186, 88, 74], radius: 4.4, forward: [0.5, -0.15, 0.85], nextIds: ['CP13'] },
    { id: 'CP13', type: 'crown_merge', pos: [170, 108, 96], radius: 5.8, forward: [-0.55, 0.1, 0.8] },
    { id: 'CP14', type: 'tide_wall', pos: [96, 102, 98], radius: 5.6, forward: [-0.98, -0.1, 0.05] },
    { id: 'CP15', type: 'descent', pos: [30, 88, 70], radius: 5.2, forward: [-0.85, -0.2, -0.4] },
    { id: 'CP16', type: 'heart_approach', pos: [-6, 72, 30], radius: 4.8, forward: [-0.6, -0.3, -0.7] },
];

export const KINETIC_TIDE_MAP = {
    kinetic_tide: {
        name: 'Kinetic Tide',
        size: [460, 150, 320],
        scaleAuthoredAnchors: true,
        preferAuthoredPortals: true,
        portalLevels: [16, 40, 66, 92, 108],
        obstacles: KINETIC_TIDE_OBSTACLES,
        portals: KINETIC_TIDE_PORTALS,
        gates: KINETIC_TIDE_GATES,
        glbModels: KINETIC_TIDE_LANDMARKS,
        // One beat for the whole map; each setpiece states its own offset against it.
        glbAnimationClock: { beatSeconds: BEAT_SECONDS },
        // The moving setpieces collide through their animated mesh colliders; the static
        // CC0 dressing and the fixed setpiece frames stay on box obstacles.
        glbColliderMode: 'dynamic',
        glbAuthoredObstaclesCollisionOnly: true,
        glbLoadConcurrency: 3,
        playerSpawn: { x: -222, y: 14, z: 0 },
        botSpawns: [
            { x: -222, y: 14, z: -13 },
            { x: -222, y: 14, z: 13 },
            { x: -210, y: 14, z: -20 },
            { x: -210, y: 14, z: 20 },
        ],
        items: [
            { id: 'tide_speed_launch', type: 'item_battery', pickupType: 'SPEED_UP', x: -186, y: 15, z: 0, weight: 1.3 },
            { id: 'tide_shield_lock', type: 'item_shield', pickupType: 'SHIELD', x: -150, y: 17, z: 0, weight: 1.1 },
            { id: 'tide_shield_safe', type: 'item_shield', pickupType: 'SHIELD', x: -104, y: 24, z: -30, weight: 1.2 },
            { id: 'tide_ghost_fast', type: 'item_coin', pickupType: 'GHOST', x: -104, y: 38, z: 26, weight: 0.8 },
            { id: 'tide_speed_lens', type: 'item_battery', pickupType: 'SPEED_UP', x: -28, y: 54, z: 4, weight: 1.1 },
            // In the gap between two reactor petals on the way from the iris to CP07.
            { id: 'tide_rare_lens', type: 'item_crystal', pickupType: 'SHIELD', x: 11, y: 66, z: -7, weight: 0.6 },
            { id: 'tide_rocket_inner', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 50, y: 74, z: -30, weight: 0.9 },
            { id: 'tide_thick_outer', type: 'item_coin', pickupType: 'THICK', x: 52, y: 82, z: 32, weight: 0.8 },
            { id: 'tide_speed_pendulum', type: 'item_battery', pickupType: 'SPEED_UP', x: 128, y: 88, z: 22, weight: 1.2 },
            { id: 'tide_shield_lift', type: 'item_shield', pickupType: 'SHIELD', x: 190, y: 104, z: 58, weight: 1.0 },
            { id: 'tide_ghost_tech', type: 'item_coin', pickupType: 'GHOST', x: 186, y: 90, z: 74, weight: 0.8 },
            { id: 'tide_rocket_descent', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 30, y: 90, z: 70, weight: 0.7 },
        ],
        aircraft: [
            { id: 'tide_dock_freighter', jetId: 'ship8', x: -170, y: 40, z: 58, scale: 1.2, rotateY: 0.4 },
            { id: 'tide_orbit_patrol', jetId: 'ship4', x: 68, y: 100, z: -62, scale: 0.9, rotateY: -1.2 },
            { id: 'tide_hall_guard', jetId: 'ship6', x: 178, y: 118, z: 20, scale: 1.0, rotateY: 2.4 },
            { id: 'tide_return_scout', jetId: 'ship3', x: 44, y: 122, z: 108, scale: 0.75, rotateY: -0.6 },
        ],
        missions: [
            { type: 'TIME_TRIAL', params: { target: 285 }, weight: 1.8 },
            { type: 'NO_DAMAGE', params: {}, weight: 0.7 },
            { type: 'ITEM_CHAIN', params: { target: 6 }, weight: 0.8 },
        ],
        parcours: {
            enabled: true,
            routeId: 'kinetic_tide_v1',
            rules: {
                ordered: true,
                bidirectionalCheckpoints: false,
                resetOnDeath: false,
                resetToLastValid: true,
                respawnOnDeath: true,
                lastCheckpointRespawns: 3,
                respawnDelaySeconds: 3,
                maxSegmentTimeMs: 30000,
                cooldownMs: 450,
                wrongOrderCooldownMs: 650,
                wrongOrderPenaltyMs: 2400,
                errorIndicatorMs: 1400,
                allowLaneAliases: true,
                winnerByParcoursComplete: true,
                animateCheckpoints: true,
                showGhost: true,
            },
            checkpoints: KINETIC_TIDE_CHECKPOINTS,
            // Above the reactor core: the core is wider than the ring and fully collides.
        finish: { id: 'FINISH', type: 'finish', pos: [0, 74, 9], radius: 7.2, forward: [0.2, -0.3, -0.9] },
        },
    },
};
