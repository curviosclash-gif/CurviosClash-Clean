// Part-built replacement for the game vehicle "ship1". The old model stays as tracing aid in the Vehicle Lab.
// Measured from ship1.obj after the game's 4.5-unit normalization: boxy hull with a raised dorsal
// ridge, a long flat blade nose, a thin delta plate (nose chines, swept wings, rear tail prongs),
// two gun pods beside the hull, a pentagonal exhaust block and two detached wingtip engines.
const FLAME = { geo: 'flame', size: [0.2, 0.01, 1.0], pos: [0, 0, 1.0], color: 0x4488ff, material: 'glow', opacity: 0.6, anim: { type: 'pulse', speed: 6, amount: 0.4 } };

function wing(side) {
    const s = side === 'left' ? -1 : 1;
    const p = side === 'left' ? 'Linke' : 'Rechte';
    const q = side === 'left' ? 'Linker' : 'Rechter';
    const r = side === 'left' ? 'Linkes' : 'Rechtes';
    // Children are placed relative to the wing root panel centre [s * 0.43, -0.0375, 0.135].
    return {
        name: `${q} Flügel`, geo: 'box', size: [0.38, 0.075, 1.27], pos: [s * 0.43, -0.0375, 0.135], material: 'primary', role: `wing_${side}`,
        children: [
            { name: `${p} Flügelvorderkante`, geo: 'box', size: [0.5, 0.075, 1.274], pos: [s * 0.2885, 0, 0.044], rot: [0, s * 29.5, 0], material: 'primary' },
            { name: `${p} Bugleiste`, geo: 'box', size: [0.25, 0.075, 1.754], pos: [s * -0.1215, 0, -1.463], rot: [0, s * 12.6, 0], material: 'primary' },
            { name: `${p} Heckklinge`, geo: 'cone', size: [0.38, 1.63], pos: [s * 0.2875, 0, 1.3545], rot: [90, 0, s * 10.9], scale: [1, 1, 0.16], material: 'primary' },
            { name: `${r} Kanonengehäuse`, geo: 'pylon', size: [0.11, 0.11, 0.265], pos: [s * 0.09, 0.1675, 0.028], rot: [90, 0, 0], scale: [1.1, 1, 0.6], material: 'secondary' },
            { name: `${q} Kanonenlauf`, geo: 'pylon', size: [0.028, 0.028, 0.21], pos: [s * 0.102, 0.1935, -0.208], rot: [90, 0, 0], material: 'secondary' },
        ],
    };
}

function engine(side) {
    const s = side === 'left' ? -1 : 1;
    const q = side === 'left' ? 'Linkes' : 'Rechtes';
    const f = side === 'left' ? 'Linke' : 'Rechte';
    return {
        name: `${q} Flügeltriebwerk`, geo: 'engine', size: [0.28, 0.24, 1.0], pos: [s * 1.225, 0, 2.025], role: `engine_${side}`,
        children: [{ ...FLAME, name: `${f} Triebwerksflamme` }],
    };
}

export default {
    id: 'ship1',
    label: 'Interceptor (Ship 1)',
    primaryColor: 0xa3a3a3,
    baseVehicleId: 'ship1',
    baseMeshMode: 'reference',
    baseTransform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
    parts: [
        { name: 'Rumpf', geo: 'box', size: [0.478, 0.376, 1.326], pos: [0, -0.038, 0.164], material: 'primary', role: 'core' },
        { name: 'Rumpfflanke oben', geo: 'box', size: [0.411, 0.1, 1.27], pos: [0.412, 0.028, 0.137], rot: [0, 0, -21.4], material: 'primary', mirror: true },
        { name: 'Rumpfflanke unten', geo: 'box', size: [0.411, 0.1, 1.27], pos: [0.412, -0.104, 0.137], rot: [0, 0, 21.5], material: 'primary', mirror: true },
        { name: 'Rückenkamm', geo: 'box', size: [0.28, 0.095, 1.016], pos: [0, 0.1975, 0.319], material: 'primary', role: 'utility', children: [
            { name: 'Kammflanke', geo: 'box', size: [0.137, 0.03, 1.016], pos: [0.185, -0.005, 0], rot: [0, 0, -43.8], material: 'primary', mirror: true },
            { name: 'Kammschräge vorn', geo: 'box', size: [0.28, 0.03, 0.324], pos: [0, -0.005, -0.663], rot: [-17, 0, 0], material: 'primary' },
        ] },
        { name: 'Bugklinge', geo: 'box', size: [0.478, 0.075, 1.72], pos: [0, -0.0375, -1.355], material: 'primary', role: 'nose', children: [
            { name: 'Bugkeil oben', geo: 'box', size: [0.478, 0.08, 1.72], pos: [0, 0.0725, 0], rot: [-5, 0, 0], material: 'primary' },
            { name: 'Bugkeil unten', geo: 'box', size: [0.478, 0.08, 1.72], pos: [0, -0.0725, 0], rot: [5, 0, 0], material: 'primary' },
            { name: 'Bugkern', geo: 'box', size: [0.478, 0.22, 0.8], pos: [0, 0, 0.455], material: 'primary' },
        ] },
        { name: 'Heckdüsenblock', geo: 'box', size: [0.746, 0.194, 0.132], pos: [0, -0.072, 0.845], material: 'secondary', children: [
            { name: 'Heckdüsendach', geo: 'box', size: [0.385, 0.05, 0.132], pos: [0.1865, 0.122, 0], rot: [0, 0, -14.7], material: 'secondary', mirror: true },
            { name: 'Düsenöffnung', geo: 'box', size: [0.588, 0.063, 0.02], pos: [0, 0.02, 0.067], material: 'secondary', color: 0x2a2a2a },
        ] },
        wing('left'),
        wing('right'),
        engine('left'),
        engine('right'),
    ],
};
