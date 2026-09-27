// Part-built replacement for the game vehicle "ship9". The old model stays as tracing aid in the Vehicle Lab.
// Measured from ship9.obj after the game's 4.5-unit normalization: a short octagonal hull with a raised
// cockpit hump and wedge nose, one flat wing plate per side that runs forward into a long prong
// (fork silhouette) and back into a swept delta tip, two guns under the wing roots and two detached
// engines far behind the wingtips.
const FLAME = { geo: 'flame', size: [0.2, 0.01, 1.0], pos: [0, 0, 1.0], color: 0x4488ff, material: 'glow', opacity: 0.6, anim: { type: 'pulse', speed: 6, amount: 0.4 } };

// Wing root centre for the right side; the left side mirrors every x value and y rotation.
const WING_ROOT = [1.05, -0.05, 0.45];

function wing(side) {
    const s = side === 'left' ? -1 : 1;
    const p = side === 'left' ? 'Linke' : 'Rechte';
    const q = side === 'left' ? 'Linker' : 'Rechter';
    const r = side === 'left' ? 'Linkes' : 'Rechtes';
    // Children take absolute right-side coordinates and are converted to offsets from the wing root.
    const at = (x, y, z) => [+(s * (x - WING_ROOT[0])).toFixed(3), +(y - WING_ROOT[1]).toFixed(3), +(z - WING_ROOT[2]).toFixed(3)];
    return {
        name: `${q} Flügel`, geo: 'box', size: [0.6, 0.14, 0.9], pos: [s * WING_ROOT[0], WING_ROOT[1], WING_ROOT[2]], material: 'primary', role: `wing_${side}`,
        children: [
            // Prong: its outer edge is the single straight leading edge from the fork tip to the wingtip.
            { name: `${p} Flügelzinke`, geo: 'box', size: [0.55, 0.12, 3.73], pos: at(1.349, -0.05, -1.206), rot: [0, s * 14.45, 0], material: 'primary' },
            // Main plate: its rear edge is the swept trailing edge from the wingtip back to the hull.
            { name: `${r} Flügelblatt`, geo: 'box', size: [1.407, 0.12, 1.2], pos: at(1.155, -0.05, 0.51), rot: [0, s * 39.3, 0], material: 'primary' },
            // Root fill: its front edge is the notch between prong and hull.
            { name: `${p} Flügelwurzel`, geo: 'box', size: [1.0, 0.12, 0.45], pos: at(0.909, -0.05, -0.218), rot: [0, s * 33.4, 0], material: 'primary' },
            { name: `${r} Kanonenrohr`, geo: 'pylon', size: [0.058, 0.058, 0.7], pos: at(0.535, -0.28, -0.22), rot: [90, 0, 0], material: 'secondary' },
            { name: `${p} Kanonenhalterung`, geo: 'box', size: [0.07, 0.12, 0.12], pos: at(0.535, -0.19, 0.08), material: 'secondary' },
        ],
    };
}

function engine(side) {
    const s = side === 'left' ? -1 : 1;
    const q = side === 'left' ? 'Linkes' : 'Rechtes';
    const f = side === 'left' ? 'Linke' : 'Rechte';
    return {
        name: `${q} Flügeltriebwerk`, geo: 'engine', size: [0.28, 0.24, 1.0], pos: [s * 1.969, 0, 2.025], role: `engine_${side}`,
        children: [{ ...FLAME, name: `${f} Triebwerksflamme` }],
    };
}

export default {
    id: 'ship9',
    label: 'Recon (Ship 9)',
    primaryColor: 0xa3a3a3,
    baseVehicleId: 'ship9',
    baseMeshMode: 'reference',
    baseTransform: { pos: [0, 0, 0], rot: [0, 0, 0], scale: [1, 1, 1] },
    parts: [
        { name: 'Rumpf', geo: 'box', size: [0.74, 0.295, 1.844], pos: [0, -0.055, 0.36], material: 'primary', role: 'core' },
        { name: 'Rumpfseite', geo: 'box', size: [0.376, 0.295, 0.738], pos: [0.557, -0.055, 0.635], material: 'primary', mirror: true },
        { name: 'Rumpfschräge vorn', geo: 'box', size: [0.3, 0.295, 0.91], pos: [0.42, -0.055, -0.086], rot: [0, 24.4, 0], material: 'primary', mirror: true },
        { name: 'Rumpfschräge hinten', geo: 'box', size: [0.47, 0.295, 0.2], pos: [0.498, -0.055, 1.063], rot: [0, 36.5, 0], material: 'primary', mirror: true },
        // Cockpit hump: an octagonal frustum (flat top, sloped flanks, corner facets and rear slope in one mesh)
        // plus a solid wedge in front that carries the long, shallow slope down into the nose.
        { name: 'Cockpitaufbau', geo: 'pylon', size: [0.399, 0.736, 0.41], pos: [0, 0.298, 0.635], rot: [0, 22.5, 0], material: 'primary', role: 'utility' },
        { name: 'Cockpitschräge vorn', geo: 'box', size: [0.56, 0.34, 0.924], pos: [0, 0.12, -0.073], rot: [-26.3, 0, 0], material: 'primary' },
        { name: 'Kielplatte', geo: 'box', size: [0.74, 0.14, 0.74], pos: [0, -0.271, 0.635], material: 'primary' },
        { name: 'Kielschräge', geo: 'box', size: [0.401, 0.1, 0.74], pos: [0.54, -0.225, 0.635], rot: [0, 0, 20.3], material: 'primary', mirror: true },
        // Nose: flat base block, a sloped top plate that continues the cockpit's front slope, and a flat tip.
        { name: 'Bug', geo: 'box', size: [0.74, 0.148, 0.407], pos: [0, -0.128, -0.766], material: 'primary', role: 'nose', children: [
            { name: 'Bugschräge', geo: 'box', size: [0.74, 0.15, 0.433], pos: [0, 0.077, 0.026], rot: [-20, 0, 0], material: 'primary' },
            { name: 'Bugspitze', geo: 'cone', size: [0.369, 0.223], pos: [0, 0, -0.314], rot: [-90, 0, 0], scale: [1, 1, 0.2], material: 'primary' },
        ] },
        wing('left'),
        wing('right'),
        engine('left'),
        engine('right'),
    ],
};
