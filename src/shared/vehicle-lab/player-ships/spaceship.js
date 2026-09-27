// Part-built replacement for the game vehicle "spaceship". The old model stays as tracing aid in the Vehicle Lab.
// Traced from SpaceshipMesh (src/entities/spaceship-mesh.js): flat saucer with a dark rim and a dark belly
// dome, glass cockpit dome ahead of centre, two long side stabilizers reaching forward, twin nose
// cannons and two rim engines with orange glow. The belly hemisphere has no primitive of its own, so a
// stack of three frustums and a flattened sphere cap stands in for it.
const DARK = 0x0a0a1a;

function stabilizer(side) {
    const s = side === 'left' ? -1 : 1;
    const q = side === 'left' ? 'Linker' : 'Rechter';
    return { name: `${q} Stabilisator`, geo: 'box', size: [0.8, 0.1, 2.5], pos: [s * 1.4, 0, -1.5], material: 'primary', role: `wing_${side}` };
}

function engine(side) {
    const s = side === 'left' ? -1 : 1;
    const q = side === 'left' ? 'Linkes' : 'Rechtes';
    const f = side === 'left' ? 'Linke' : 'Rechte';
    return {
        name: `${q} Randtriebwerk`, geo: 'engine', size: [0.2, 0.18, 0.5], pos: [s * 1.35, 0, 0.4], role: `engine_${side}`,
        children: [
            { name: `${f} Triebwerksglut`, geo: 'sphere', size: [0.15], pos: [0, 0, 0.35], material: 'glow', color: 0xff6600, opacity: 0.85 },
        ],
    };
}

export default {
    id: 'spaceship',
    label: 'Raumschiff',
    primaryColor: 0x60a5fa,
    baseVehicleId: 'spaceship',
    baseMeshMode: 'reference',
    baseTransform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
    parts: [
        { name: 'Untertassenrumpf', geo: 'cylinder', size: [1.0, 1.2, 0.25], pos: [0, 0, 0], material: 'primary', role: 'core', children: [
            { name: 'Randring', geo: 'torus', size: [1.2, 0.08], rot: [90, 0, 0], material: 'secondary', color: DARK },
            { name: 'Bauchring oben', geo: 'cylinder', size: [1.2, 1.16, 0.3], pos: [0, -0.35, 0], material: 'secondary', color: DARK },
            { name: 'Bauchring Mitte', geo: 'cylinder', size: [1.16, 1.04, 0.3], pos: [0, -0.65, 0], material: 'secondary', color: DARK },
            { name: 'Bauchring unten', geo: 'cylinder', size: [1.04, 0.79, 0.3], pos: [0, -0.95, 0], material: 'secondary', color: DARK },
            { name: 'Bauchkuppel', geo: 'sphere', size: [0.85], pos: [0, -0.95, 0], scale: [1, 0.53, 1], material: 'secondary', color: DARK },
        ] },
        { name: 'Cockpitkuppel', geo: 'sphere', size: [0.625], pos: [0, 0.25, -0.5], material: 'glass', color: 0x88ccff, opacity: 0.62, role: 'nose' },
        { name: 'Bugkanone', geo: 'pylon', size: [0.05, 0.05, 1.25], pos: [0.5, 0, -2], rot: [90, 0, 0], material: 'secondary', color: 0x334466, mirror: true },
        stabilizer('left'),
        stabilizer('right'),
        engine('left'),
        engine('right'),
    ],
};
