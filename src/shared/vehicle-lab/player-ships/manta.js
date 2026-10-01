// Part-built replacement for the game vehicle "manta". The old model stays as tracing aid in the Vehicle Lab.
// Traced from MantaMesh (src/entities/manta-mesh.js), which is drawn about ten times larger than the other
// ships and keeps that size: a 4.5-unit thick teardrop slab with rounded (bevelled) edges, a short pointed
// front at z -12.4 and a long pointed tail at z +21.7, plus two paddle-shaped wings reaching forward and
// out to x ±19.9. The slab is traced as two elliptical discs (flat cylinder + flattened torus as rounded
// rim), converging capsules as pointed front and a rhombus prism as pointed tail; each wing is an
// flattened ellipsoid with a flattened frustum as narrow root. The old model's eyes, cannon, tail fin and tiny engines
// sit inside the slab and wings and are never visible, so only the engines return, larger, at the old
// wing position.
// The utility part (not in the old model) is an equipment hump at the tail base, a flattened ellipsoid
// like the wings. It grows out of the rounded rear rim and rests on the tail wedge; its top stays under
// the slab top (y 2.5) and it ends before the tail tip, so the model box that Classic and Hunt read
// (hitbox, muzzle, weapon mounts) keeps its size. A larger or smaller hull carries it along
// (resolveHullMountedPivot), so the rim never swallows it.
const RIM_SCALE_Y = 1.875; // 1.2 rim radius stretched to the 2.25 half-height of the slab

function wing(side) {
    const s = side === 'left' ? -1 : 1;
    const q = side === 'left' ? 'Linker' : 'Rechter';
    // Flattened ellipsoid for a calm top-view outline: x semi-axis 6.4, z semi-axis 4.4, 0.8 half-thickness.
    return {
        name: `${q} Flügel`, geo: 'sphere', size: [4.4], pos: [s * 13.5, 0, -6.3], scale: [1.4545, 0.18, 1],
        material: 'primary', role: `wing_${side}`,
    };
}

function engine(side) {
    const s = side === 'left' ? -1 : 1;
    const q = side === 'left' ? 'Linkes' : 'Rechtes';
    const f = side === 'left' ? 'Linke' : 'Rechte';
    return {
        name: `${q} Flügeltriebwerk`, geo: 'engine', size: [0.5, 0.45, 2.2], pos: [s * 17.5, -0.2, -2.4], role: `engine_${side}`,
        children: [
            { name: `${f} Triebwerksglut`, geo: 'sphere', size: [0.35], pos: [0, 0, 1.2], material: 'glow', color: 0x00eeff, opacity: 0.8 },
        ],
    };
}

export default {
    id: 'manta',
    label: 'Manta-Gleiter',
    primaryColor: 0x60a5fa,
    baseVehicleId: 'manta',
    baseMeshMode: 'reference',
    baseTransform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
    parts: [
        { name: 'Rumpf', geo: 'cylinder', size: [5.0, 5.0, 4.5], pos: [0, 0.25, 3], scale: [1, 1, 2.42], material: 'primary', role: 'core', children: [
            { name: 'Rumpfkante', geo: 'torus', size: [5.0, 1.2], rot: [90, 0, 0], scale: [1, 1, RIM_SCALE_Y], material: 'primary' },
            // Box turned 45° inside the hull's z stretch (2.42) becomes a rhombus prism: a flat point at z 21.2 growing out of the rounded rim.
            { name: 'Schwanzkeil', geo: 'box', size: [6.36, 2.0, 6.36], pos: [0, 0, 3.0], rot: [0, 45, 0], material: 'primary' },
        ] },
        { name: 'Vorderrumpf', geo: 'cylinder', size: [5.4, 5.4, 4.5], pos: [0, 0.25, 1.5], scale: [1, 1, 2.0], material: 'primary', children: [
            { name: 'Vorderrumpfkante', geo: 'torus', size: [5.4, 1.2], rot: [90, 0, 0], scale: [1, 1, RIM_SCALE_Y], material: 'primary' },
        ] },
        // Rounded front point; its y scale also flattens the two front edge capsules to the slab height.
        { name: 'Bugspitze', geo: 'sphere', size: [1.2], pos: [0, 0.25, -11.17], scale: [1, RIM_SCALE_Y, 1], material: 'primary', role: 'nose', children: [
            { name: 'Rechte Bugkante', geo: 'capsule', size: [1.2, 3.8], pos: [1.3, 0, 1.385], rot: [90, 0, -43.2], material: 'primary' },
            { name: 'Linke Bugkante', geo: 'capsule', size: [1.2, 3.8], pos: [-1.3, 0, 1.385], rot: [90, 0, 43.2], material: 'primary' },
        ] },
        // Narrow wing root widening from the hull (r 1.56 at x 4.6) to r 4.09 at x 11; its edges run tangent into the plate.
        { name: 'Flügelwurzel', geo: 'cylinder', size: [1.56, 4.09, 6.4], pos: [7.8, 0, -6.4], rot: [0, 0, 90], scale: [0.19, 1, 1], material: 'primary', mirror: true },
        // Semi-axes x 2.2, y 0.95, z 3.6: top at y 2.45, rear end at z 20.4 (tail tip 21.14).
        { name: 'Heckmodul', geo: 'sphere', size: [2.0], pos: [0, 1.5, 16.8], scale: [1.1, 0.475, 1.8], material: 'primary', role: 'utility' },
        wing('left'),
        wing('right'),
        engine('left'),
        engine('right'),
    ],
};
