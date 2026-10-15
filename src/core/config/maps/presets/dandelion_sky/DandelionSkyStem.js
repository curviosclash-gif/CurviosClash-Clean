// Authored coordinates for the shootable flower at targetSize 368. The geometry contract
// checks these against the exported mesh, including the full attached seed envelope.
export const DANDELION_STEM_FLIGHT_ROUTE = Object.freeze([
    [4.9254, 43.0049, 28.8993],
    [5.7474, 62.3866, 12.0229],
    [6.9755, 80.7338, 3.3468],
    [7.7407, 99.0809, 4.4314],
    [8.5824, 117.4280, 3.6000],
    [10.2207, 135.7752, 2.2589],
    [13.1478, 154.1223, 2.6820],
    [15.1119, 163.2959, 10.4511],
    [18.5443, 177.0562, 39.2913],
].map((point) => Object.freeze(point)));

const ITEMS = [
    ['ROCKET_MEDIUM', [7.2468, 86.4673, 3.8534]],
    ['REPAIR_DRONE', [7.5695, 94.4941, 4.3298]],
    ['ROCKET_MEDIUM', [7.8709, 102.5210, 4.4174]],
    ['ROCKET_MEDIUM', [8.2112, 110.5479, 4.1037]],
    ['FAN_5', [8.6544, 118.5747, 3.5041]],
    ['ROCKET_MEDIUM', [9.2615, 126.6016, 2.8262]],
    ['SHIELD', [10.0834, 134.6285, 2.3075]],
    ['ROCKET_MEDIUM', [11.1557, 142.6553, 2.1434]],
];

export const DANDELION_STEM_PICKUPS = Object.freeze(ITEMS.map(([pickupType, [x, y, z]], index) => Object.freeze({
    id: `dandelion_stem_item_${index + 1}`, pickupType, x, y, z,
})));

export const DANDELION_STEM_GATES = Object.freeze([3, 4, 5].map((routeIndex, index) => {
    const before = DANDELION_STEM_FLIGHT_ROUTE[routeIndex - 1];
    const after = DANDELION_STEM_FLIGHT_ROUTE[routeIndex + 1];
    return Object.freeze({
        id: `dandelion_stem_updraft_${index + 1}`,
        type: 'slingshot',
        pos: DANDELION_STEM_FLIGHT_ROUTE[routeIndex],
        forward: Object.freeze(after.map((value, axis) => value - before[axis])),
        up: Object.freeze([0, 1, 0]),
        color: 0xa5dba1,
        radius: 2.9,
        params: Object.freeze({ duration: 0.8, forwardImpulse: 8, liftImpulse: 3, cooldown: 1.5 }),
    });
}));
