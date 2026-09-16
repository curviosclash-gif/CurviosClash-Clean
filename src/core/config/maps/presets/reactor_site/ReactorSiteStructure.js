// Layout, collision fallback, boosts and pickups of the reactor site.
//
// The plant is modelled in Blender at true metres: X and Y the ground axes, Z height above the
// apron. The map is that model at 0.6 authored units per metre, the esplanade at y = 8, exactly
// as the Eiffel Tower is placed - so a map coordinate is a Blender coordinate times 0.6, with
// the map's Z axis being Blender -Y (north is +Z here, and north is where the switchyard is).
//
// The running map takes its collision straight off the GLB triangles (glbColliderMode 'scene');
// the boxes and beams below are the load-failure fallback, a coarse plant that keeps a match
// playable if a GLB never arrives. None of them is drawn while the GLBs are loaded
// (glbAuthoredObstaclesCollisionOnly), so none of them can be left floating once a structure
// has come down.

const GROUND = 8;
const METRE = 0.6;

/** Authored height for a real height above the apron. */
function up(metres) {
    return GROUND + metres * METRE;
}

/** Authored length for a real length. */
function across(metres) {
    return metres * METRE;
}

/** Map Z for a Blender Y coordinate: the model's Y axis points south on the map. */
function south(metres) {
    return -metres * METRE;
}

// The one field number everything else follows from: how far the wreck of the furthest collapse
// reaches. The cooling tower keels 115.2 m from its own axis (generate_reactor_site_assets.py
// reports it as `reach`), and its axis stands 105 m out, so the wreck reaches 220.2 m, that is
// 132.1 authored units, from the map centre. The stack (88.4 m from an axis 116.5 m out) and the
// hall (88.4 m from a centre 108 m out) both stay inside that. Half the field is that reach plus
// a 20 unit margin, rounded to 155 - the same field the Eiffel siege plays on.
export const REACTOR_WRECK_REACH = (105 + 115.2) * METRE;
export const REACTOR_HALF_SIZE = 155;
export const REACTOR_MAP_SIZE = [REACTOR_HALF_SIZE * 2, 220, REACTOR_HALF_SIZE * 2];

// Where the structures stand, in Blender metres, as the generator places them.
const TOWER_OFFSET_METRES = 105;
const HALL_CENTRE_METRES = 108;      // south of the reactor
const STACK_METRES = [96, 66];       // east of the hall, [x, y] in Blender
const SWITCHYARD_METRES = -112;      // north of the reactor

export const TOWER_X = across(TOWER_OFFSET_METRES);           // 63
export const HALL_Z = south(HALL_CENTRE_METRES);              // -64.8
export const STACK_X = across(STACK_METRES[0]);               // 57.6
export const STACK_Z = south(STACK_METRES[1]);                // -39.6
export const SWITCHYARD_Z = south(SWITCHYARD_METRES);         // 67.2

export const CONTAINMENT_RADIUS = across(24);                 // 14.4
export const DOME_TOP = up(66);                               // 47.6
export const TOWER_HEIGHT = up(100);                          // 68
export const TOWER_BASE_RADIUS = across(42);                  // 25.2
export const STACK_HEIGHT = up(90);                           // 62
export const HALL_HEIGHT = up(26);                            // 23.6

export const REACTOR_SITE_OBSTACLES = [
    // --- The apron -------------------------------------------------------------------------------
    // The one surface that stays active with the GLBs loaded: a ship that clips the ground should
    // scrape rather than fall through the world while the site mesh is still streaming in. It
    // spans the whole field, because the field is wider than the apron the plant stands on.
    { pos: [0, 4, 0], size: [REACTOR_MAP_SIZE[0], 8, REACTOR_MAP_SIZE[2]], kind: 'foam', compileWithGlb: true },

    // --- The reactor block ------------------------------------------------------------------------
    { pos: [0, up(33), 0], size: [across(50), across(66), across(50)] },
    ...[-1, 1].map((sign) => (
        { pos: [0, up(11), sign * across(46)], size: [across(44), across(22), across(28)] }
    )),

    // --- The two cooling towers, as columns; the hollow inside is lost in the fallback ------------
    ...[-1, 1].map((sign) => ({
        shape: 'beam',
        kind: 'hard',
        start: [sign * TOWER_X, GROUND, 0],
        end: [sign * TOWER_X, TOWER_HEIGHT, 0],
        radius: across(30),
    })),

    // --- The turbine hall and the stack -----------------------------------------------------------
    { pos: [0, up(14), HALL_Z], size: [across(120), across(28), across(40)] },
    {
        shape: 'beam',
        kind: 'hard',
        start: [STACK_X, GROUND, STACK_Z],
        end: [STACK_X, STACK_HEIGHT, STACK_Z],
        radius: across(5),
    },
];

// Boosts through the plant. These routes are tied to site geometry that survives a collapse:
// basin rims, service roads, the containment apron and switchyard. The stable ids are retained
// for replays and authored-map round trips even where the route has moved out of a structure.
export const REACTOR_SITE_GATES = [
    { id: 'rs_tower_west_updraft', type: 'slingshot', pos: [-TOWER_X + across(24), up(10), 0], forward: [0.35, 0.94, 0], up: [0, 1, 0], params: { duration: 1.8, forwardImpulse: 16, liftImpulse: 34, cooldown: 1.2 } },
    { id: 'rs_tower_east_updraft', type: 'slingshot', pos: [TOWER_X - across(24), up(10), 0], forward: [-0.35, 0.94, 0], up: [0, 1, 0], params: { duration: 1.8, forwardImpulse: 16, liftImpulse: 34, cooldown: 1.2 } },
    // Along the permanent service road south of the turbine hall and its falling walls.
    { id: 'rs_hall_run_east', type: 'boost', pos: [-across(72), up(6), HALL_Z - across(30)], forward: [1, 0, 0], params: { duration: 1.2, forwardImpulse: 40, bonusSpeed: 48, cooldown: 0.9 } },
    { id: 'rs_hall_run_west', type: 'boost', pos: [across(72), up(6), HALL_Z - across(30)], forward: [-1, 0, 0], params: { duration: 1.2, forwardImpulse: 40, bonusSpeed: 48, cooldown: 0.9 } },
    // Around the containment, at the height of its ring beam.
    { id: 'rs_dome_orbit_north', type: 'boost', pos: [0, up(40), across(34)], forward: [1, 0, 0.2], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
    { id: 'rs_dome_orbit_south', type: 'boost', pos: [0, up(40), -across(34)], forward: [-1, 0, -0.2], params: { duration: 1.0, forwardImpulse: 36, bonusSpeed: 44, cooldown: 0.8 } },
    // Over the permanent switchyard pylons. The second slingshot used to climb the destructible
    // stack; its stable id remains, but the route now follows the east pylon row.
    { id: 'rs_switchyard_sling', type: 'slingshot', pos: [0, up(12), SWITCHYARD_Z], forward: [0, 0.7, -0.7], up: [0, 1, 0], params: { duration: 1.5, forwardImpulse: 26, liftImpulse: 22, cooldown: 1.1 } },
    { id: 'rs_stack_climb', type: 'slingshot', pos: [across(22), up(18), SWITCHYARD_Z - across(10)], forward: [-0.2, 0.8, -0.6], up: [0, 1, 0], params: { duration: 1.5, forwardImpulse: 20, liftImpulse: 28, cooldown: 1.1 } },
];

export const REACTOR_SITE_ITEMS = [
    // The basins, machinery, steam lines and switchyard live in 01_site.glb and remain after a
    // collapse. Pickups therefore never hang from a tower rim, roof, stack or containment dome
    // that the break scene has removed. Stable ids are kept for replay compatibility.
    { id: 'rs_shield_west_rim', type: 'item_shield', pickupType: 'SHIELD', x: -TOWER_X, y: up(6), z: across(36), weight: 1.0 },
    { id: 'rs_shield_east_rim', type: 'item_shield', pickupType: 'SHIELD', x: TOWER_X, y: up(6), z: -across(36), weight: 1.0 },
    { id: 'rs_speed_west_basin', type: 'item_battery', pickupType: 'SPEED_UP', x: -TOWER_X, y: up(8), z: -across(36), weight: 1.1 },
    { id: 'rs_speed_east_basin', type: 'item_battery', pickupType: 'SPEED_UP', x: TOWER_X, y: up(8), z: across(36), weight: 1.1 },
    { id: 'rs_rocket_dome', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 0, y: up(14), z: south(42), weight: 0.7 },
    { id: 'rs_rocket_hall', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 0, y: up(12), z: HALL_Z, weight: 0.9 },
    { id: 'rs_ghost_switchyard', type: 'item_coin', pickupType: 'GHOST', x: 0, y: up(20), z: SWITCHYARD_Z, weight: 0.8 },
    { id: 'rs_ghost_stack', type: 'item_coin', pickupType: 'GHOST', x: across(44), y: up(26), z: SWITCHYARD_Z - across(10), weight: 0.7 },
    { id: 'rs_thick_hall_roof', type: 'item_coin', pickupType: 'THICK', x: -across(36), y: up(10), z: HALL_Z, weight: 0.8 },
    { id: 'rs_shield_wing_north', type: 'item_shield', pickupType: 'SHIELD', x: 0, y: up(10), z: across(48), weight: 1.0 },
    { id: 'rs_speed_wing_south', type: 'item_battery', pickupType: 'SPEED_UP', x: across(13), y: up(14), z: south(74), weight: 1.1 },
    { id: 'rs_rocket_east_apron', type: 'item_rocket', pickupType: 'ROCKET_MEDIUM', x: across(120), y: up(14), z: -across(100), weight: 0.8 },
];

export { GROUND, METRE, up, across, south };
