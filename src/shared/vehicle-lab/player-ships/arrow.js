// Part-built replacement for the game vehicle "arrow". The old model stays as tracing aid in the Vehicle Lab.
// Traced from ArrowMesh (src/entities/arrow-mesh.js): tapered octagonal shaft, cone arrowhead, four large
// swept tail fins in a pinwheel (each fin is offset 0.375 from the axis and spans 2.5 outward, which makes
// the model 5 x 5 wide/high) and two small white engines with cyan cores and orange flames.
// Each fin is a flat parallelogram plate (front edge 1.75 wide, swept back by 0.75 over 1.25 depth).
// A box covers its middle; each swept edge is a strip box turned along the edge plus a filler box, all
// 0.125 thick and overlapping inside the plate, so the fin reads as one even plate from every side.
// Rectangles cannot reach into the 59-degree corners, so the root and outer tip are clipped by ~0.2.
// The utility part (not in the old model) is an equipment sleeve around the middle of the shaft:
// octagonal and tapered like the shaft, light grey with a dark band like the engines. It encloses
// the shaft at every size (80-125 %) and keeps clear of the arrowhead and the fins.
const FIN_THICKNESS = 0.125;
const FIN_SWEEP = -30.96;

function fin(name, pos, angle, extra = {}) {
    const plate = (suffix, size, childPos, rot) => ({
        name: `${name} ${suffix}`, geo: 'box', size: [size[0], FIN_THICKNESS, size[1]], pos: childPos, rot, material: 'primary',
    });
    return {
        name, geo: 'box', size: [1.0, FIN_THICKNESS, 1.25], pos, rot: [0, 0, angle], material: 'primary', ...extra,
        children: [
            plate('Wurzelkante', [0.33, 1.26], [0.683, 0, 0], [0, FIN_SWEEP, 0]),
            plate('Wurzelfüllung', [0.365, 0.609], [0.6825, 0, -0.3205], [0, 0, 0]),
            plate('Außenkante', [0.33, 1.26], [-0.683, 0, 0], [0, FIN_SWEEP, 0]),
            plate('Außenfüllung', [0.365, 0.609], [-0.6825, 0, 0.3205], [0, 0, 0]),
        ],
    };
}

function engine(side) {
    const s = side === 'left' ? -1 : 1;
    const q = side === 'left' ? 'Linkes' : 'Rechtes';
    const p = side === 'left' ? 'Linke' : 'Rechte';
    const r = side === 'left' ? 'Linker' : 'Rechter';
    return {
        name: `${q} Triebwerk`, geo: 'cylinder', size: [0.25, 0.2, 0.8], pos: [s * 0.45, 0, 3.2], rot: [90, 0, 0], material: 'secondary', color: 0xc8ccd2, role: `engine_${side}`,
        // Children live in the rotated cylinder frame: local +y points to world +z (rear).
        children: [
            { name: `${p} Schubdüse`, geo: 'pylon', size: [0.15, 0.2, 0.25], pos: [0, 0.4, 0], material: 'secondary', color: 0x111111 },
            { name: `${r} Triebwerkskern`, geo: 'sphere', size: [0.1], pos: [0, 0.3, 0], material: 'glow', color: 0x00ffff },
            { name: `${p} Triebwerksflamme`, geo: 'flame', size: [0.15, 0.01, 0.5], pos: [0, 0.55, 0], rot: [-90, 0, 0], color: 0xff4400 },
        ],
    };
}

export default {
    id: 'arrow',
    label: 'Pfeil',
    primaryColor: 0x60a5fa,
    baseVehicleId: 'arrow',
    baseMeshMode: 'reference',
    baseTransform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
    parts: [
        { name: 'Pfeilschaft', geo: 'pylon', size: [0.1, 0.25, 4], pos: [0, 0, 1], rot: [90, 0, 0], material: 'primary', role: 'core' },
        { name: 'Pfeilspitze', geo: 'cone', size: [0.4, 1.2], pos: [0, 0, -1.6], rot: [-90, 0, 0], material: 'primary', role: 'nose' },
        // Pylon turned like the shaft: local +y points to the rear, so the thinner end sits behind.
        { name: 'Ausrüstungsmanschette', geo: 'pylon', size: [0.3, 0.34, 1.3], pos: [0, 0, 0.55], rot: [90, 0, 0], material: 'secondary', color: 0xc8ccd2, role: 'utility', children: [
            { name: 'Manschettenband', geo: 'pylon', size: [0.335, 0.335, 0.16], material: 'secondary', color: 0x111111 },
        ] },
        fin('Linke Heckfinne', [-1.25, 0.3125, 3.125], 0, { role: 'wing_left' }),
        fin('Rechte Heckfinne', [1.25, -0.3125, 3.125], 180, { role: 'wing_right' }),
        fin('Untere Heckfinne', [-0.3125, -1.25, 3.125], 90),
        fin('Obere Heckfinne', [0.3125, 1.25, 3.125], -90),
        engine('left'),
        engine('right'),
    ],
};
