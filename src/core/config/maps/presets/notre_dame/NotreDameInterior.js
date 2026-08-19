// The piers inside the cathedral.
//
// NotreDameStructure walls the vessel and leaves it open to the aisles below the arcade, which is
// right: at head height a gothic church is one hall. What that left out is the arcade itself. The
// generator sets forty piers along the nave and choir plus nine around the hemicycle, all drawn in
// stone, none of them collidable -- the interior is the reason this map has an inside, and a
// player flew through every column in it.
//
// The bay spacing here is not a level-design choice. The generator sets every pier out on the same
// 6 m bay as the building, so collision has to use the same rule or a player threads gaps where
// piers stand and hits stone where the openings are. Same reasoning as buttressRow, one storey in.

// Authored units per metre and the height of the church floor, matching NotreDameStructure.
const METRE = 1.4;
const GROUND = 8;

// The generator draws its piers as eight-sided cylinders, where the stated radius is the
// circumcircle. Collision takes the incircle instead (cos 22.5 degrees of it), so the box sits
// inside the drawn stone rather than proud of it -- the same "err inward" rule the apse follows.
const OCTAGON_INSET = Math.cos(Math.PI / 8);

// Straight out of generate_notre_dame_assets.py, converted to authored units.
const BAY = 6.0 * METRE;
const NAVE_FIRST_BAY = -54.75 * METRE;
const NAVE_BAYS = 10;
const CHOIR_FIRST_BAY = 19.25 * METRE;
const CHOIR_BAYS = 5;
const CHOIR_END = 49.25 * METRE;

const ARCADE_LINE = 6.25 * METRE;     // pier line between vessel and inner aisle
const AISLE_LINE = 12.0 * METRE;      // pier line between inner and outer aisle
const ARCADE_HEIGHT = 15.0 * METRE;   // arcade piers run the floor to the arcade top
const AISLE_HEIGHT = 10.0 * METRE;    // aisle piers stop at their own vault

/**
 * One pier, given the way the generator states it: a radius in metres and a height in metres
 * measured up from the church floor.
 *
 * @param {number} x centre along the building, authored units
 * @param {number} z centre across the building, authored units
 * @param {number} radiusMetres circumcircle radius of the drawn octagon
 * @param {number} heightUnits how far it stands, authored units
 */
function pier(x, z, radiusMetres, heightUnits) {
    const width = 2 * radiusMetres * METRE * OCTAGON_INSET;
    return {
        pos: [x, GROUND + heightUnits / 2, z],
        size: [width, heightUnits, width],
    };
}

/**
 * One straight run of arcade: the pier between vessel and aisle, and the aisle pier beyond it,
 * on every bay and both sides.
 *
 * @param {number} firstBayX west end of the run
 * @param {number} bays how many bays
 * @param {number} arcadeRadius radius of the arcade pier in metres
 * @param {number} aisleRadius radius of the aisle pier in metres
 */
function arcadeRun(firstBayX, bays, arcadeRadius, aisleRadius) {
    const run = [];
    for (let bay = 0; bay < bays; bay += 1) {
        const x = firstBayX + BAY * (bay + 0.5);
        for (const side of [-1, 1]) {
            run.push(
                pier(x, side * ARCADE_LINE, arcadeRadius, ARCADE_HEIGHT),
                pier(x, side * AISLE_LINE, aisleRadius, AISLE_HEIGHT),
            );
        }
    }
    return run;
}

/**
 * The nine hemicycle piers that carry the apse, on the generator's own fan of -80 to +80 degrees.
 * They are what makes the east end readable from inside; without them the ambulatory is a smooth
 * bowl a player cannot judge distance in.
 */
function apseHemicycle() {
    const ring = [];
    for (let index = 0; index < 9; index += 1) {
        const angle = (-80 + index * 20) * (Math.PI / 180);
        ring.push(pier(
            CHOIR_END + 6.25 * 1.1 * METRE * Math.cos(angle),
            6.25 * 1.15 * 1.6 * METRE * Math.sin(angle),
            0.9,
            ARCADE_HEIGHT,
        ));
    }
    return ring;
}

// Nave piers are the heavy ones at 1.05 m, the choir stands a little lighter at 1.0 m, and the
// aisle piers behind both are lighter again. The numbers are measurements, not choices.
export const NOTRE_DAME_INTERIOR_PIERS = [
    ...arcadeRun(NAVE_FIRST_BAY, NAVE_BAYS, 1.05, 0.8),
    ...arcadeRun(CHOIR_FIRST_BAY, CHOIR_BAYS, 1.0, 0.75),
    ...apseHemicycle(),
];
