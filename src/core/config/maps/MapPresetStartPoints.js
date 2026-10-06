// Start points of the arenas and special maps: one player spawn and nine bot spawns each, enough for a
// round of ten. They sit on a ring around the arena, each at least 14 world units from every box and
// arena wall, 24 from a portal and 40 from each other (tests/map-start-points.contract.test.mjs and
// map-anchor-guard.contract.test.mjs hold them to that).
//
// Units: world units. These maps do not set scaleAuthoredAnchors (it would also scale the fog heights
// of their lighting), so the arena builds the points as written while their obstacles are x MAP_SCALE.
// A map that does set the flag must author its lights in map units, not in these.

const START_POINTS = Object.freeze({
    maze: {
        playerSpawn: { x: -25, y: 25, z: 86 },
        botSpawns: [
            { x: 31, y: 25, z: 32 }, { x: 87, y: 25, z: 22 }, { x: 87, y: 25, z: -22 },
            { x: 31, y: 25, z: -32 }, { x: 25, y: 25, z: -86 }, { x: -31, y: 25, z: -32 },
            { x: -87, y: 25, z: -22 }, { x: -87, y: 25, z: 22 }, { x: -31, y: 25, z: 32 },
        ],
    },
    complex: {
        playerSpawn: { x: 0, y: 25, z: 84 },
        botSpawns: [
            { x: 44, y: 25, z: 56 }, { x: 90, y: 25, z: 33 }, { x: 90, y: 25, z: -33 },
            { x: 47, y: 25, z: -64 }, { x: 0, y: 25, z: -84 }, { x: -44, y: 25, z: -56 },
            { x: -90, y: 25, z: -33 }, { x: -90, y: 25, z: 33 }, { x: -47, y: 25, z: 64 },
        ],
    },
    vertical_maze: {
        playerSpawn: { x: 0, y: 45, z: 90 },
        botSpawns: [
            { x: 50, y: 45, z: 69 }, { x: 81, y: 45, z: 26 }, { x: 81, y: 45, z: -26 },
            { x: 50, y: 45, z: -69 }, { x: 0, y: 45, z: -81 }, { x: -50, y: 45, z: -69 },
            { x: -86, y: 45, z: -28 }, { x: -86, y: 45, z: 28 }, { x: -50, y: 45, z: 69 },
        ],
    },
    trench: {
        playerSpawn: { x: 0, y: 40, z: 187 },
        botSpawns: [
            { x: 23, y: 48, z: 155 }, { x: 39, y: 40, z: 58 }, { x: 39, y: 40, z: -58 },
            { x: 25, y: 40, z: -159 }, { x: 0, y: 40, z: -197 }, { x: -25, y: 40, z: -159 },
            { x: -39, y: 40, z: -58 }, { x: -39, y: 40, z: 58 }, { x: -23, y: 48, z: 155 },
        ],
    },
    foam_forest: {
        playerSpawn: { x: 0, y: 30, z: 56 },
        botSpawns: [
            { x: 57, y: 30, z: 79 }, { x: 96, y: 30, z: 35 }, { x: 96, y: 30, z: -35 },
            { x: 57, y: 30, z: -79 }, { x: 0, y: 30, z: -56 }, { x: -57, y: 30, z: -79 },
            { x: -96, y: 30, z: -35 }, { x: -96, y: 30, z: 35 }, { x: -57, y: 30, z: 79 },
        ],
    },
    crossfire: {
        playerSpawn: { x: -36, y: 40, z: 125 },
        botSpawns: [
            { x: 63, y: 40, z: 87 }, { x: 101, y: 40, z: 37 }, { x: 101, y: 40, z: -37 },
            { x: 63, y: 40, z: -87 }, { x: 36, y: 40, z: -125 }, { x: -63, y: 40, z: -87 },
            { x: -101, y: 40, z: -37 }, { x: -101, y: 40, z: 37 }, { x: -63, y: 40, z: 87 },
        ],
    },
    checkerboard: {
        playerSpawn: { x: 0, y: 60, z: 93 },
        botSpawns: [
            { x: 55, y: 90, z: 75 }, { x: 85, y: 70, z: 24 }, { x: 85, y: 50, z: -24 },
            { x: 55, y: 30, z: -75 }, { x: 0, y: 60, z: -93 }, { x: -55, y: 90, z: -75 },
            { x: -85, y: 70, z: -24 }, { x: -85, y: 50, z: 24 }, { x: -55, y: 30, z: 75 },
        ],
    },
    the_pit: {
        playerSpawn: { x: 0, y: 30, z: 112 },
        botSpawns: [
            { x: 66, y: 30, z: 90 }, { x: 106, y: 30, z: 34 }, { x: 106, y: 30, z: -34 },
            { x: 66, y: 30, z: -90 }, { x: 0, y: 30, z: -112 }, { x: -66, y: 30, z: -90 },
            { x: -106, y: 30, z: -34 }, { x: -106, y: 30, z: 34 }, { x: -66, y: 30, z: 90 },
        ],
    },
    core_fusion: {
        playerSpawn: { x: 0, y: 60, z: 105 },
        botSpawns: [
            { x: 67, y: 60, z: 107 }, { x: 105, y: 60, z: 34 }, { x: 105, y: 60, z: -34 },
            { x: 67, y: 60, z: -107 }, { x: 0, y: 60, z: -105 }, { x: -67, y: 60, z: -107 },
            { x: -105, y: 60, z: -34 }, { x: -105, y: 60, z: 34 }, { x: -67, y: 60, z: 107 },
        ],
    },
    pillar_hall: {
        playerSpawn: { x: 0, y: 30, z: 54 },
        botSpawns: [
            { x: 53, y: 30, z: 73 }, { x: 92, y: 30, z: 37 }, { x: 92, y: 30, z: -37 },
            { x: 53, y: 30, z: -73 }, { x: 0, y: 30, z: -54 }, { x: -53, y: 30, z: -73 },
            { x: -92, y: 30, z: -37 }, { x: -92, y: 30, z: 37 }, { x: -53, y: 30, z: 73 },
        ],
    },
    spiral_tower: {
        playerSpawn: { x: 0, y: 73, z: 72 },
        botSpawns: [
            { x: 49, y: 60, z: 62 }, { x: 68, y: 33, z: 22 }, { x: 68, y: 33, z: -22 },
            { x: 42, y: 60, z: -58 }, { x: 0, y: 60, z: -72 }, { x: -42, y: 60, z: -58 },
            { x: -68, y: 60, z: -22 }, { x: -68, y: 60, z: 22 }, { x: -49, y: 60, z: 62 },
        ],
    },
    portal_madness: {
        playerSpawn: { x: 0, y: 45, z: 93 },
        botSpawns: [
            { x: 55, y: 45, z: 75 }, { x: 88, y: 45, z: 29 }, { x: 88, y: 45, z: -29 },
            { x: 55, y: 45, z: -75 }, { x: 0, y: 45, z: -93 }, { x: -55, y: 45, z: -75 },
            { x: -88, y: 45, z: -29 }, { x: -88, y: 45, z: 29 }, { x: -55, y: 45, z: 75 },
        ],
    },
    the_loop: {
        playerSpawn: { x: 0, y: 30, z: 126 },
        botSpawns: [
            { x: 81, y: 30, z: 120 }, { x: 120, y: 30, z: 39 }, { x: 120, y: 30, z: -39 },
            { x: 81, y: 30, z: -120 }, { x: 0, y: 30, z: -126 }, { x: -81, y: 30, z: -120 },
            { x: -120, y: 30, z: -39 }, { x: -120, y: 30, z: 39 }, { x: -81, y: 30, z: 120 },
        ],
    },
    mega_maze: {
        playerSpawn: { x: 0, y: 30, z: 60 },
        botSpawns: [
            { x: 52, y: 30, z: 66 }, { x: 108, y: 22, z: 27 }, { x: 60, y: 30, z: -2 },
            { x: 52, y: 30, z: -66 }, { x: 4, y: 30, z: -56 }, { x: -65, y: 30, z: -67 },
            { x: -100, y: 22, z: -49 }, { x: -58, y: 30, z: 17 }, { x: -60, y: 30, z: 58 },
        ],
    },
    expert_gauntlet: {
        playerSpawn: { x: 0, y: 60, z: 248 },
        botSpawns: [
            { x: 138, y: 60, z: 220 }, { x: 235, y: 60, z: 76 }, { x: 221, y: 60, z: -80 },
            { x: 138, y: 60, z: -220 }, { x: 0, y: 60, z: -248 }, { x: -167, y: 60, z: -230 },
            { x: -235, y: 60, z: -76 }, { x: -235, y: 60, z: 76 }, { x: -167, y: 60, z: 230 },
        ],
    },
    mega_maze_xl: {
        playerSpawn: { x: 0, y: 30, z: 214 },
        botSpawns: [
            { x: 131, y: 30, z: 181 }, { x: 186, y: 30, z: 60 }, { x: 142, y: 30, z: -46 },
            { x: 115, y: 30, z: -158 }, { x: 0, y: 30, z: -214 }, { x: -109, y: 30, z: -150 },
            { x: -177, y: 30, z: -57 }, { x: -177, y: 30, z: 57 }, { x: -109, y: 30, z: 150 },
        ],
    },
});

export function startPoints(mapKey) {
    const entry = START_POINTS[mapKey];
    if (!entry) throw new Error(`No start points authored for map "${mapKey}"`);
    return { playerSpawn: { ...entry.playerSpawn }, botSpawns: entry.botSpawns.map((spawn) => ({ ...spawn })) };
}
