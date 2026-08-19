// Collision, boosts and pickups for both Notre-Dame maps.
//
// The map runs with glbColliderMode 'dynamic', which means the loader only gives colliders to
// meshes an animation moves. Everything the building blocks is therefore authored here. That is
// not a workaround: the generator joins by material, so each of the seven building files holds
// only a handful of meshes, and a mesh collider is one axis-aligned box per mesh -- switching the
// loader to 'mesh' would not seal the arches, it would turn half the cathedral into one block.
//
// The interior is built from slabs, not from bored blocks. A bore is a cylinder and the inside of
// a gothic vessel is a tall rectangle: any cylinder wide enough to fly at the vault leaves the
// floor of the church solid, and any cylinder low enough to reach the floor seals the vault. So
// the vessel is walled instead -- the island is its floor, two clerestory walls its sides, the
// vault its ceiling -- and the flyable space is whatever the walls leave. Bores are kept only
// where the building really is a hole in a wall: the west portals, the roses, the transept doors.
//
// Coordinates are authored units with the church floor at y = 8; multiply by the map scale of 3
// for world units. One real metre is 1.4 authored units, matching the generator.

const GROUND = 8;

// Along the building, west to east. These follow the Blender constants exactly: the facade is
// 9 m deep, the nave ten 6 m bays, the crossing 14 m, the choir five bays, the apse 14.5 m.
const WEST_FRONT = -89.25;
const NAVE_START = -76.65;
const NAVE_END = 7.35;
const CROSSING_END = 26.95;
const CHOIR_END = 68.95;
// Where the hemicycle springs from, and how far east the last chapel reaches.
const APSE_FACE = 86.5;
const EAST_END = 89.25;
const BAY = 8.4;                      // 6 m, the bay the whole building is set out on

const NAVE_CENTRE = (NAVE_START + NAVE_END) / 2;
const CROSSING_CENTRE = (NAVE_END + CROSSING_END) / 2;
const CHOIR_CENTRE = (CROSSING_END + CHOIR_END) / 2;

// Heights above the map floor, each one measured off the generator.
const AISLE_VAULT = GROUND + 14;      // 10 m, underside of the aisle ceiling
const AISLE_RUN = GROUND + 8;         // 5.7 m, the line the aisle branch is actually flown on
const ARCADE_TOP = GROUND + 21;       // 15 m, above this the vessel closes off the aisles
const AISLE_ROOF = GROUND + 23.1;     // 16.5 m, the lean-to roof over the aisles
const NAVE_VAULT = GROUND + 46.2;     // 33 m, the vault crown
const VAULT_TOP = NAVE_VAULT + 2.8;   // top of the vault shell, and the floor of the attic
const ATTIC_TOP = GROUND + 60;        // 42.9 m, underside of the roof over the attic
const ROOF_RIDGE = GROUND + 63;       // 45 m
const TOWER_TOP = GROUND + 96.6;      // 69 m
const SPIRE_TIP = GROUND + 134.4;     // 96 m, the cockerel

// Across the building. The central vessel is 12.5 m clear between the arcade piers; collision
// keeps a little more than that so a ship is not pinched by a wall face it cannot see.
const VESSEL_HALF = 9.9;              // 7.1 m, inner face of the clerestory wall
const CLERESTORY_HALF = 13.9;         // 9.9 m, outer face of the same wall
const AISLE_HALF = 26.5;              // 18.9 m, inner face of the outer aisle wall
const AISLE_WALL = 29.5;              // 21.1 m, outer face of it
const TRANSEPT_HALF = 32.4;           // 23.1 m, inner face of the transept gable
const TRANSEPT_WALL = 35.4;           // 25.3 m, outer face -- the widest point of the building

const ARM_LENGTH = CROSSING_END - NAVE_END;

/**
 * The central vessel over one length of the building: its two clerestory walls, the vault that
 * closes it at 33 m, and the roof that closes the attic above that. It runs unbroken from the
 * nave to the apse, because the vessel does.
 *
 * @param {number} centreX centre of the length along the building
 * @param {number} lengthX how far it runs
 */
function vesselCore(centreX, lengthX) {
    const core = [
        {
            pos: [centreX, (NAVE_VAULT + VAULT_TOP) / 2, 0],
            size: [lengthX, VAULT_TOP - NAVE_VAULT, VESSEL_HALF * 2],
        },
        {
            pos: [centreX, (ATTIC_TOP + ROOF_RIDGE + 1) / 2, 0],
            size: [lengthX, ROOF_RIDGE + 1 - ATTIC_TOP, CLERESTORY_HALF * 2],
        },
    ];
    for (const side of [-1, 1]) {
        // Clerestory wall. It carries on past the vault so the attic has walls of its own.
        core.push({
            pos: [centreX, (ARCADE_TOP + ROOF_RIDGE) / 2, side * (VESSEL_HALF + CLERESTORY_HALF) / 2],
            size: [lengthX, ROOF_RIDGE - ARCADE_TOP, CLERESTORY_HALF - VESSEL_HALF],
        });
    }
    return core;
}

/**
 * The aisle either side of the vessel over one length: its outer wall and its ceiling. Kept
 * separate from the vessel because the aisle narrows around the apse while the vessel does not.
 *
 * Below the arcade the vessel and the aisles are deliberately left open to each other, because
 * that is what the arcade arches do in the building: at head height a gothic church is one hall,
 * and only higher up does the clerestory wall separate the vessel from the aisle roof.
 *
 * @param {number} centreX centre of the length along the building
 * @param {number} lengthX how far it runs
 * @param {number} innerFace how far out the inner face of the outer wall stands
 */
function aisleRing(centreX, lengthX, innerFace) {
    const outerFace = innerFace + AISLE_WALL - AISLE_HALF;
    const ring = [];
    for (const side of [-1, 1]) {
        ring.push(
            // Outer wall of the aisle, from the floor up to its lean-to roof.
            {
                pos: [centreX, (GROUND + AISLE_ROOF) / 2, side * (innerFace + outerFace) / 2],
                size: [lengthX, AISLE_ROOF - GROUND, outerFace - innerFace],
            },
            // Aisle ceiling. Without it the aisle is not a corridor but an open shelf.
            {
                pos: [centreX, (AISLE_VAULT + AISLE_ROOF) / 2, side * (VESSEL_HALF + outerFace) / 2],
                size: [lengthX, AISLE_ROOF - AISLE_VAULT, outerFace - VESSEL_HALF],
            },
        );
    }
    return ring;
}

/**
 * One row of flying buttresses. The bay spacing is not a level-design choice: the generator sets
 * every pier out on the same 6 m bay as the building, so collision has to use the same rule or a
 * player threads gaps where piers stand and hits stone where the gaps are.
 *
 * @param {number} startX west end of the row
 * @param {number} bays how many piers
 * @param {number} pierCentre how far out the pier line stands
 */
function buttressRow(startX, bays, pierCentre) {
    const row = [];
    for (let bay = 0; bay < bays; bay += 1) {
        const x = startX + BAY * (bay + 0.5);
        for (const side of [-1, 1]) {
            row.push(
                // The pier: 3 m along the building, 3.8 m across, standing 18 m to its head.
                { pos: [x, GROUND + 12.6, side * pierCentre], size: [4.2, 25.2, 5.32] },
                // The lower flyer, springing off the pier head and landing on the clerestory.
                {
                    shape: 'tube',
                    kind: 'hard',
                    start: [x, GROUND + 25.76, side * pierCentre],
                    end: [x, GROUND + 32.9, side * 12.74],
                    radius: 1.6,
                },
            );
        }
    }
    return row;
}

/**
 * One arm of the transept, from the crossing out to its gable. The arm carries flanks only where
 * it projects past the aisles, exactly as the building does -- inside that line the aisle runs
 * straight into the arm and the two are one space.
 *
 * @param {number} side -1 for south, +1 for north
 */
function transeptArm(side) {
    const gableZ = side * (TRANSEPT_HALF + TRANSEPT_WALL) / 2;
    const gableThickness = TRANSEPT_WALL - TRANSEPT_HALF;
    return [
        // The doorway, on the same terms as the west portals: a bore that starts a little above
        // the paving rather than a hole cut down to the floor.
        {
            pos: [CROSSING_CENTRE, GROUND + 9, gableZ],
            size: [ARM_LENGTH, 18, gableThickness],
            tunnel: { radius: 5.6, axis: 'z' },
        },
        // The rose at 25 m, 13.1 m across in the model. The opening keeps the same share of the
        // window as the west rose does, so both roses fly the same way.
        {
            pos: [CROSSING_CENTRE, GROUND + 35, gableZ],
            size: [ARM_LENGTH, 34, gableThickness],
            tunnel: { radius: 8.4, axis: 'z' },
        },
        // The gable over the rose, stepped back like the one in the model.
        {
            pos: [CROSSING_CENTRE, GROUND + 54.7, gableZ],
            size: [13.7, 5.4, gableThickness],
        },
        // The two flanks, only along the strip that stands clear of the aisles.
        {
            pos: [NAVE_END - 1.5, (GROUND + NAVE_VAULT) / 2, side * (AISLE_HALF + TRANSEPT_WALL) / 2],
            size: [3, NAVE_VAULT - GROUND, TRANSEPT_WALL - AISLE_HALF],
        },
        {
            pos: [CROSSING_END + 1.5, (GROUND + NAVE_VAULT) / 2, side * (AISLE_HALF + TRANSEPT_WALL) / 2],
            size: [3, NAVE_VAULT - GROUND, TRANSEPT_WALL - AISLE_HALF],
        },
        // The arm vault. It stops short of the crossing so the crossing stays the open shaft the
        // route branches in.
        {
            pos: [CROSSING_CENTRE, (NAVE_VAULT + ATTIC_TOP) / 2, side * (VESSEL_HALF + TRANSEPT_WALL) / 2],
            size: [ARM_LENGTH, ATTIC_TOP - NAVE_VAULT, TRANSEPT_WALL - VESSEL_HALF],
        },
    ];
}

const NOTRE_DAME_OBSTACLES = [
    // --- The island it all stands on -------------------------------------------------------
    { pos: [-31, 4, 0], size: [364, 8, 200], kind: 'foam' },
    { pos: [-31, 1, 96], size: [364, 3, 60], kind: 'foam' },
    { pos: [-31, 1, -96], size: [364, 3, 60], kind: 'foam' },

    // --- West front ------------------------------------------------------------------------
    // The two towers are solid. Between them the portals are the only way in at ground level.
    { pos: [-83, GROUND + 48, -20.3], size: [13, 96, 20] },
    { pos: [-83, GROUND + 48, 20.3], size: [13, 96, 20] },
    // Wall band above the portals, pierced by the rose. The rose itself is left open: flying
    // through it is the reward for taking the scaffold route up the facade.
    { pos: [-83, GROUND + 24, 0], size: [13, 12, 22] },
    { pos: [-83, GROUND + 50, 0], size: [13, 20, 22] },
    { pos: [-83, GROUND + 37, 0], size: [13, 14, 40], tunnel: { radius: 6.2, axis: 'x' } },
    // The three portals, as one bore each. The central block reaches out to the tower faces at
    // 10.3 so no open strip is left between it and the towers.
    { pos: [-83, GROUND + 9, 0], size: [13, 18, 20.6], tunnel: { radius: 5.6, axis: 'x' } },
    { pos: [-83, GROUND + 8, -18.9], size: [13, 16, 11], tunnel: { radius: 4.2, axis: 'x' } },
    { pos: [-83, GROUND + 8, 18.9], size: [13, 16, 11], tunnel: { radius: 4.2, axis: 'x' } },

    // --- Nave, choir and apse ------------------------------------------------------------------
    // The vessel runs unbroken from the west front to the hemicycle; only the aisle around it
    // changes width.
    ...vesselCore(NAVE_CENTRE, NAVE_END - NAVE_START),
    ...vesselCore((CROSSING_END + APSE_FACE) / 2, APSE_FACE - CROSSING_END),
    ...aisleRing(NAVE_CENTRE, NAVE_END - NAVE_START, AISLE_HALF),
    ...aisleRing(CHOIR_CENTRE, CHOIR_END - CROSSING_END, AISLE_HALF),

    // The apse is an ellipse in plan -- 13.9 m along the building, 19.4 m across, measured to the
    // outer face of the radiating chapels. Collision steps that curve in three, each step set a
    // little inside the ellipse. Erring inward is deliberate: at the east end a player may get
    // marginally closer to the stone than they should, but never hits a wall that is not drawn.
    ...aisleRing((CHOIR_END + 76) / 2, 76 - CHOIR_END, 25.3),
    ...aisleRing(79, 6, 20.1),
    ...aisleRing(84.25, 4.5, 11.7),

    // The east end. Its bore is the opening the route leaves the building through on its way to
    // the buttress return leg.
    {
        pos: [(APSE_FACE + EAST_END) / 2, (GROUND + NAVE_VAULT) / 2, 0],
        size: [EAST_END - APSE_FACE, NAVE_VAULT - GROUND, CLERESTORY_HALF * 2],
        tunnel: { radius: 9, axis: 'x' },
    },
    {
        pos: [(APSE_FACE + EAST_END) / 2, (NAVE_VAULT + ROOF_RIDGE) / 2, 0],
        size: [EAST_END - APSE_FACE, ROOF_RIDGE - NAVE_VAULT, CLERESTORY_HALF * 2],
    },

    // --- Crossing and transept ---------------------------------------------------------------
    ...transeptArm(-1),
    ...transeptArm(1),
    // The crossing is open from the floor to the roof: it is where the route branches, and it is
    // what a player drops back down through when they come east out of the attic.
    {
        pos: [CROSSING_CENTRE, (ATTIC_TOP + ROOF_RIDGE + 1) / 2, 0],
        size: [ARM_LENGTH, ROOF_RIDGE + 1 - ATTIC_TOP, TRANSEPT_WALL * 2],
    },

    // --- The spire ---------------------------------------------------------------------------
    // Fifty metres of the tallest thing on the map, stepped down in five stages so the collision
    // follows the taper of the octagonal shaft instead of standing as one column.
    { pos: [CROSSING_CENTRE, 75.2, 0], size: [14, 8.4, 14] },
    { pos: [CROSSING_CENTRE, 88.5, 0], size: [10.1, 18.2, 10.1] },
    { pos: [CROSSING_CENTRE, 106.7, 0], size: [6.7, 18.2, 6.7] },
    { pos: [CROSSING_CENTRE, 124.9, 0], size: [3.4, 18.2, 3.4] },
    { pos: [CROSSING_CENTRE, SPIRE_TIP - 4.2, 0], size: [2.2, 8.4, 2.2] },

    // --- Flying buttresses -------------------------------------------------------------------
    // The gaps between the piers are the outdoor route, so the piers have to stand on the bays
    // they are drawn on. The nave row keeps 3 m clear of the aisle wall, the choir row 4 m --
    // the choir flyers are the long ones, and they start further out.
    ...buttressRow(NAVE_START, 10, 32.2),
    ...buttressRow(CROSSING_END, 5, 33.6),

    // --- Landing platforms for the route -----------------------------------------------------
    // Each one stands inside something a player can see: the first two on the island, the third
    // inside the turning rose scaffold, the last two on the quay and the spire hoist. There is
    // deliberately none over the roof at the crest -- nothing is drawn there, so nothing collides
    // there; the ring at that point is flown through like every other ring on the route.
    { pos: [-150, GROUND + 12, 0], size: [22, 3, 26] },
    { pos: [-112, GROUND + 6, 0], size: [26, 3, 30] },
    { pos: [-93.6, GROUND + 44, 0], size: [16, 3, 20] },
    { pos: [110, GROUND + 8, 0], size: [24, 3, 26] },
    { pos: [130, GROUND + 30, 0], size: [22, 4, 24] },
];

// Portals shortcut the long way round: up the facade, across the roof, and back down the nave.
const NOTRE_DAME_PORTALS = [
    { a: [-93.6, GROUND + 46, 0], b: [-83, GROUND + 92, 0], color: 0x77aaff },
    { a: [CROSSING_CENTRE, ROOF_RIDGE + 12, -52], b: [CROSSING_CENTRE, GROUND + 30, 0], color: 0xffaa33 },
    { a: [79, GROUND + 52, 0], b: [-40, NAVE_VAULT + 8, 0], color: 0xaa66ff },
    { a: [110, GROUND + 12, 0], b: [-150, GROUND + 16, 0], color: 0x44ffbb },
];

const NOTRE_DAME_GATES = [
    { id: 'nd_river_boost', type: 'boost', pos: [-190, GROUND + 14, 0], forward: [1, 0, 0], params: { duration: 1.2, forwardImpulse: 40, bonusSpeed: 48, cooldown: 0.9 } },
    { id: 'nd_parvis_boost', type: 'boost', pos: [-118, GROUND + 10, 0], forward: [1, 0.05, 0], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
    { id: 'nd_facade_sling', type: 'slingshot', pos: [-96, GROUND + 14, 0], forward: [0.2, 0.95, 0], up: [0, 1, 0], params: { duration: 1.6, forwardImpulse: 28, liftImpulse: 18, cooldown: 1.2 } },
    { id: 'nd_nave_boost', type: 'boost', pos: [-70, GROUND + 20, 0], forward: [1, 0, 0], params: { duration: 1.1, forwardImpulse: 38, bonusSpeed: 46, cooldown: 0.8 } },
    { id: 'nd_attic_sling', type: 'slingshot', pos: [-20, NAVE_VAULT + 8, 0], forward: [0.9, 0.3, 0], up: [0, 1, 0], params: { duration: 1.4, forwardImpulse: 32, liftImpulse: 12, cooldown: 1.0 } },
    { id: 'nd_ambulatory_boost', type: 'boost', pos: [30, AISLE_RUN, -19.6], forward: [1, 0, 0.1], params: { duration: 0.9, forwardImpulse: 34, bonusSpeed: 42, cooldown: 0.7 } },
    { id: 'nd_apse_sling', type: 'slingshot', pos: [72, GROUND + 30, 0], forward: [0.6, 0.6, 0], up: [0, 1, 0], params: { duration: 1.5, forwardImpulse: 30, liftImpulse: 14, cooldown: 1.1 } },
    { id: 'nd_buttress_boost', type: 'boost', pos: [40, GROUND + 33, 36], forward: [-0.95, 0, -0.2], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 45, cooldown: 0.8 } },
    { id: 'nd_return_boost', type: 'boost', pos: [-30, GROUND + 33, 36], forward: [-0.9, 0.1, -0.3], params: { duration: 0.9, forwardImpulse: 34, bonusSpeed: 43, cooldown: 0.7 } },
    { id: 'nd_spire_boost', type: 'boost', pos: [112, GROUND + 14, 0], forward: [0.8, 0.55, 0], params: { duration: 1.1, forwardImpulse: 35, bonusSpeed: 44, cooldown: 0.8 } },
];

const NOTRE_DAME_ITEMS = [
    { id: 'nd_speed_river', type: 'item_battery', pickupType: 'SPEED_UP', x: -170, y: GROUND + 14, z: 0, weight: 1.3 },
    { id: 'nd_shield_parvis', type: 'item_shield', pickupType: 'SHIELD', x: -112, y: GROUND + 11, z: 0, weight: 1.1 },
    { id: 'nd_rare_rose', type: 'item_crystal', pickupType: 'SHIELD', x: -86, y: GROUND + 37, z: 0, weight: 0.5 },
    { id: 'nd_speed_nave', type: 'item_battery', pickupType: 'SPEED_UP', x: -50, y: GROUND + 28, z: 0, weight: 1.2 },
    { id: 'nd_ghost_aisle', type: 'item_coin', pickupType: 'GHOST', x: -50, y: AISLE_RUN, z: -19.6, weight: 0.8 },
    { id: 'nd_thick_attic', type: 'item_coin', pickupType: 'THICK', x: -20, y: NAVE_VAULT + 8, z: 0, weight: 0.8 },
    { id: 'nd_rocket_crossing', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: CROSSING_CENTRE, y: GROUND + 30, z: 0, weight: 0.9 },
    { id: 'nd_shield_ambulatory', type: 'item_shield', pickupType: 'SHIELD', x: 40, y: AISLE_RUN, z: 19.6, weight: 1.0 },
    { id: 'nd_speed_choir', type: 'item_battery', pickupType: 'SPEED_UP', x: 48, y: GROUND + 28, z: 0, weight: 1.1 },
    // Between the piers at 48 and 62, not against the transept gable it used to sit inside.
    { id: 'nd_rocket_buttress', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 55, y: GROUND + 33, z: 36, weight: 0.7 },
    { id: 'nd_ghost_tower', type: 'item_coin', pickupType: 'GHOST', x: -83, y: GROUND + 92, z: 0, weight: 0.7 },
    { id: 'nd_shield_spire', type: 'item_shield', pickupType: 'SHIELD', x: 130, y: GROUND + 34, z: 0, weight: 1.0 },
];

const NOTRE_DAME_AIRCRAFT = [
    { id: 'nd_river_barge', jetId: 'ship8', x: -170, y: GROUND + 40, z: 70, scale: 1.1, rotateY: 0.3 },
    { id: 'nd_site_patrol', jetId: 'ship4', x: 30, y: GROUND + 74, z: -80, scale: 0.9, rotateY: -1.1 },
    { id: 'nd_tower_watch', jetId: 'ship6', x: -100, y: GROUND + 110, z: 40, scale: 0.95, rotateY: 2.2 },
    { id: 'nd_apse_scout', jetId: 'ship3', x: 120, y: GROUND + 88, z: -50, scale: 0.75, rotateY: -0.7 },
];

export {
    GROUND,
    WEST_FRONT,
    NAVE_START,
    NAVE_END,
    CROSSING_CENTRE,
    CHOIR_CENTRE,
    CHOIR_END,
    APSE_FACE,
    EAST_END,
    AISLE_VAULT,
    AISLE_RUN,
    NAVE_VAULT,
    VAULT_TOP,
    ATTIC_TOP,
    ROOF_RIDGE,
    TOWER_TOP,
    SPIRE_TIP,
    NOTRE_DAME_OBSTACLES,
    NOTRE_DAME_PORTALS,
    NOTRE_DAME_GATES,
    NOTRE_DAME_ITEMS,
    NOTRE_DAME_AIRCRAFT,
};
