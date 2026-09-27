// Part-built replacement for the game vehicle "ship5". The old model stays as tracing aid in the Vehicle Lab.
// Measured from ship5.obj after the game's 4.5-unit normalization: flat wedge hull with a raised
// dorsal deck, swept low wings with wingtip rails and cannons, twin canted tail fins and two
// detached wingtip engines behind the wings.
const FLAME = { geo: 'flame', size: [0.2, 0.01, 1.0], pos: [0, 0, 1.0], color: 0x4488ff, material: 'glow', opacity: 0.6, anim: { type: 'pulse', speed: 6, amount: 0.4 } };

function wing(side) {
    const s = side === 'left' ? -1 : 1;
    const p = side === 'left' ? 'Linke' : 'Rechte';
    const q = side === 'left' ? 'Linker' : 'Rechter';
    const r = side === 'left' ? 'Linkes' : 'Rechtes';
    // Children are placed relative to the wing centre [s * 1.35, -0.272, 0.35].
    return {
        name: `${q} Flügel`, geo: 'box', size: [1.6, 0.055, 0.63], pos: [s * 1.35, -0.272, 0.35], material: 'primary', role: `wing_${side}`,
        children: [
            { name: `${p} Flügelvorderkante`, geo: 'box', size: [1.66, 0.055, 0.4], pos: [s * -0.05, 0, -0.32], rot: [0, s * -14.3, 0], material: 'primary' },
            { name: `${p} Flügelspitzenschiene`, geo: 'box', size: [0.11, 0.117, 1.28], pos: [s * 0.845, -0.009, -0.24], material: 'primary' },
            { name: `${q} Kanonenlauf`, geo: 'pylon', size: [0.024, 0.024, 0.99], pos: [s * 0.845, -0.025, -0.815], rot: [90, 0, 0], material: 'secondary' },
            { name: `${p} Kanonenmündung`, geo: 'pylon', size: [0.05, 0.05, 0.18], pos: [s * 0.845, -0.025, -1.34], rot: [90, 0, 0], material: 'secondary' },
            { name: `${q} Waffenbehälter`, geo: 'box', size: [0.13, 0.1, 0.53], pos: [s * -0.188, -0.09, -0.45], material: 'secondary' },
            { name: `${r} Flügelschild`, geo: 'box', size: [0.06, 0.18, 0.33], pos: [s * 0.106, 0.1, 0.12], material: 'primary' },
        ],
    };
}

function engine(side) {
    const s = side === 'left' ? -1 : 1;
    const q = side === 'left' ? 'Linkes' : 'Rechtes';
    const f = side === 'left' ? 'Linke' : 'Rechte';
    return {
        name: `${q} Flügeltriebwerk`, geo: 'engine', size: [0.28, 0.24, 1.0], pos: [s * 2.125, 0, 1.296], role: `engine_${side}`,
        children: [{ ...FLAME, name: `${f} Triebwerksflamme` }],
    };
}

export default {
    id: 'ship5',
    label: 'Star-Cruiser (Ship 5)',
    primaryColor: 0xa3a3a3,
    baseVehicleId: 'ship5',
    baseMeshMode: 'reference',
    baseTransform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
    parts: [
        { name: 'Rumpf', geo: 'box', size: [0.46, 0.26, 1.5], pos: [0, -0.085, 0.395], material: 'primary', role: 'core' },
        { name: 'Rumpfflanke', geo: 'box', size: [0.06, 0.3, 1.5], pos: [0.28, -0.085, 0.395], rot: [0, 0, 30], material: 'primary', mirror: true },
        { name: 'Bugkeil', geo: 'cylinder', size: [0.24, 0.32, 1.05], pos: [0, -0.255, -0.93], rot: [-90, 0, 0], scale: [1, 1, 0.17], material: 'primary', role: 'nose' },
        { name: 'Bugspitze', geo: 'cone', size: [0.24, 0.2], pos: [0, -0.255, -1.555], rot: [-90, 0, 0], scale: [1, 1, 0.23], material: 'primary' },
        { name: 'Bugrücken', geo: 'box', size: [0.34, 0.14, 1.0], pos: [0.16, -0.16, -0.85], rot: [-8, 0, -22], material: 'primary', mirror: true },
        { name: 'Bugflanke', geo: 'box', size: [0.22, 0.07, 0.52], pos: [0.337, -0.26, -0.533], rot: [0, 29, 0], material: 'primary', mirror: true },
        { name: 'Rumpfwanne', geo: 'box', size: [1.11, 0.09, 1.51], pos: [0, -0.259, 0.389], material: 'primary' },
        { name: 'Rückenaufbau', geo: 'box', size: [0.64, 0.175, 0.76], pos: [0, 0.133, 0.282], material: 'primary', role: 'utility', children: [
            { name: 'Cockpitschräge vorn', geo: 'box', size: [0.64, 0.175, 0.31], pos: [0, -0.045, -0.47], rot: [-34.6, 0, 0], material: 'primary' },
            { name: 'Cockpitschräge hinten', geo: 'box', size: [0.64, 0.175, 0.3], pos: [0, -0.045, 0.49], rot: [36, 0, 0], material: 'primary' },
        ] },
        { name: 'Heckleitwerk', geo: 'box', size: [0.07, 0.27, 0.45], pos: [0.33, 0.35, 0.38], rot: [0, 0, -21], material: 'primary', mirror: true },
        { name: 'Heckdüsenblock', geo: 'box', size: [0.85, 0.3, 0.13], pos: [0, -0.12, 1.18], material: 'secondary' },
        wing('left'),
        wing('right'),
        engine('left'),
        engine('right'),
    ],
};
