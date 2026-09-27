// Part-built replacement for the game vehicle "drone". The old model stays as tracing aid in the Vehicle Lab.
// Traced from DroneMesh (src/entities/drone-mesh.js): flat box body with dark top cover, two diagonal
// X-arms (split here into four half-arms so each side can be edited), dark end brackets, two boxy rear
// thrusters on the rear brackets, a front camera head and an underslung cannon.
const DARK = 0x111122;
const ARM_REACH = 0.8;
const BRACKET_REACH = 2.263; // distance of the (±1.6, ±1.6) bracket from the body centre along the arm

// Half of one X-arm. sx/sz give the quadrant; the arm points diagonally out of the body centre.
// The bracket child sits at the outer corner (±1.6, ±1.6) and is turned back to world axes.
function arm(name, bracketName, sx, sz, role) {
    const yaw = sx * sz > 0 ? -45 : 45;
    const along = sx;
    return {
        name, geo: 'box', size: [1.6, 0.24, 0.4], pos: [sx * 0.566, 0.1, sz * 0.566], rot: [0, yaw, 0], material: 'primary',
        ...(role ? { role } : {}),
        children: [
            { name: bracketName, geo: 'box', size: [0.5, 0.4, 0.5], pos: [along * (BRACKET_REACH - ARM_REACH), 0, 0], rot: [0, -yaw, 0], material: 'secondary', color: DARK },
        ],
    };
}

function engine(side) {
    const s = side === 'left' ? -1 : 1;
    const q = side === 'left' ? 'Linkes' : 'Rechtes';
    const p = side === 'left' ? 'Linke' : 'Rechte';
    const r = side === 'left' ? 'Linker' : 'Rechter';
    return {
        name: `${q} Schubgehäuse`, geo: 'box', size: [0.4, 0.4, 0.8], pos: [s * 1.6, 0.1, 1.5], material: 'secondary', color: DARK, role: `engine_${side}`,
        children: [
            { name: `${p} Schubdüse`, geo: 'box', size: [0.28, 0.28, 0.2], pos: [0, 0, 0.4], material: 'secondary', color: 0x111111 },
            { name: `${r} Antriebskern`, geo: 'box', size: [0.16, 0.16, 0.16], pos: [0, 0, 0.3], material: 'glow', color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 1.5 },
            { name: `${p} Schubflamme`, geo: 'box', size: [0.3, 0.3, 0.1], pos: [0, 0, 0.5], material: 'glow', color: 0x4488ff, opacity: 0.8, anim: { type: 'pulse', speed: 8, amount: 0.3 } },
        ],
    };
}

export default {
    id: 'drone',
    label: 'Kampfdrohne',
    primaryColor: 0x60a5fa,
    baseVehicleId: 'drone',
    baseMeshMode: 'reference',
    baseTransform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
    parts: [
        { name: 'Rumpf', geo: 'box', size: [1.6, 0.8, 2.4], pos: [0, 0, 0], material: 'primary', role: 'core', children: [
            { name: 'Rückenabdeckung', geo: 'box', size: [1.2, 0.3, 2.0], pos: [0, 0.55, 0], material: 'secondary', color: DARK },
            { name: 'Sensorwanne', geo: 'box', size: [0.8, 0.16, 1.2], pos: [0, -0.48, 0], material: 'secondary', color: 0x001133 },
            { name: 'LED-Leiste vorn', geo: 'box', size: [1.0, 0.08, 0.08], pos: [0, 0.42, -0.8], material: 'glow', color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 1.2 },
            { name: 'LED-Leiste hinten', geo: 'box', size: [1.0, 0.08, 0.08], pos: [0, 0.42, 0.8], material: 'glow', color: 0x00ff88, emissive: 0x00ff88, emissiveIntensity: 1.2 },
        ] },
        { name: 'Kamerakopf', geo: 'box', size: [0.6, 0.4, 0.3], pos: [0, -0.1, -1.4], material: 'secondary', color: 0x000011, role: 'nose', children: [
            { name: 'Kameralinse', geo: 'cylinder', size: [0.14, 0.14, 0.16], pos: [0, 0, -0.16], rot: [90, 0, 0], material: 'glass', color: 0x0011ff, opacity: 0.55 },
            { name: 'Entfernungssensor', geo: 'box', size: [0.2, 0.2, 0.16], pos: [0, 0.3, 0], material: 'glow', color: 0xff0000, emissive: 0xff0000, emissiveIntensity: 1.8 },
        ] },
        { name: 'Geschützhalterung', geo: 'box', size: [0.4, 0.4, 1.6], pos: [0, -0.4, -0.8], material: 'secondary', color: DARK, role: 'utility', children: [
            { name: 'Geschützlauf', geo: 'pylon', size: [0.1, 0.1, 2.0], pos: [0, -0.2, -0.6], rot: [90, 0, 0], material: 'secondary', color: 0x0e0e16 },
        ] },
        arm('Linker Vorderausleger', 'Linke Vorderstrebe', -1, -1, 'wing_left'),
        arm('Rechter Vorderausleger', 'Rechte Vorderstrebe', 1, -1, 'wing_right'),
        arm('Linker Hinterausleger', 'Linke Hinterstrebe', -1, 1),
        arm('Rechter Hinterausleger', 'Rechte Hinterstrebe', 1, 1),
        engine('left'),
        engine('right'),
    ],
};
