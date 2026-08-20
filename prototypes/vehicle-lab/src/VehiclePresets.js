export const VEHICLE_PRESETS = [
    {
        id: 'lab_jet_fighter',
        label: 'Lab-Vorlage: Jet-Fighter',
        primaryColor: 0x60a5fa,
        parts: [
            { name: 'Fuselage', geo: 'cylinder', size: [0.5, 0.7, 5], pos: [0, 0, -0.4], rot: [90, 0, 0], material: 'primary', role: 'core' },
            { name: 'Nose Cone', geo: 'cone', size: [0.5, 1.6], pos: [0, 0, -3.7], rot: [-90, 0, 0], material: 'primary', role: 'nose' },
            { name: 'Cockpit', geo: 'capsule', size: [0.28, 0.8], pos: [0, 0.36, -0.8], rot: [90, 0, 0], material: 'glass' },
            { name: 'L-Wing', geo: 'box', size: [2.4, 0.08, 1.2], pos: [-1.4, 0, 0.8], rot: [0, 0, 0], material: 'primary', role: 'wing_left' },
            { name: 'R-Wing', geo: 'box', size: [2.4, 0.08, 1.2], pos: [1.4, 0, 0.8], rot: [0, 0, 0], material: 'primary', role: 'wing_right' },
            { name: 'Tail Fin', geo: 'box', size: [0.08, 1.2, 0.8], pos: [0, 0.6, 1.6], rot: [0, 0, 0], material: 'primary' },
            { name: 'L-Engine', geo: 'engine', size: [0.2, 0.17, 0.7], pos: [-2.4, 0.1, 0.8], role: 'engine_left' },
            { name: 'R-Engine', geo: 'engine', size: [0.2, 0.17, 0.7], pos: [2.4, 0.1, 0.8], role: 'engine_right' }
        ]
    },
    {
        id: 'lab_spaceship',
        label: 'Lab-Vorlage: Raumschiff',
        primaryColor: 0xcccccc,
        parts: [
            { name: 'Saucer', geo: 'cylinder', size: [1.0, 1.2, 0.25], pos: [0, 0, 0], material: 'primary', role: 'core' },
            { name: 'Rim', geo: 'torus', size: [1.2, 0.08], pos: [0, 0, 0], rot: [90, 0, 0], material: 'secondary' },
            { name: 'Bottom', geo: 'sphere', size: [1.2], pos: [0, -0.2, 0], material: 'secondary' },
            { name: 'L-Stabilizer', geo: 'box', size: [0.9, 0.06, 0.5], pos: [-1.15, -0.05, 0.15], rot: [0, 0, 8], material: 'primary', role: 'wing_left' },
            { name: 'R-Stabilizer', geo: 'box', size: [0.9, 0.06, 0.5], pos: [1.15, -0.05, 0.15], rot: [0, 0, -8], material: 'primary', role: 'wing_right' },
            { name: 'Cockpit', geo: 'sphere', size: [0.62], pos: [0, 0.25, -0.5], material: 'glass', role: 'nose' },
            { name: 'L-Engine', geo: 'engine', size: [0.14, 0.12, 0.35], pos: [-1.35, 0, 0.4], role: 'engine_left' },
            { name: 'R-Engine', geo: 'engine', size: [0.14, 0.12, 0.35], pos: [1.35, 0, 0.4], role: 'engine_right' }
        ]
    },

    {
        id: 'lab_manta',
        label: 'Lab-Vorlage: Manta',
        primaryColor: 0x7e22ce,
        parts: [
            { name: 'Body', geo: 'capsule', size: [1.2, 3], pos: [0, 0, 0], rot: [90, 0, 0], material: 'primary', role: 'core' },
            { name: 'L-Wing', geo: 'box', size: [2.2, 0.1, 1.2], pos: [-1.4, -0.1, -0.6], rot: [0, 0, 15], material: 'primary', role: 'wing_left' },
            { name: 'R-Wing', geo: 'box', size: [2.2, 0.1, 1.2], pos: [1.4, -0.1, -0.6], rot: [0, 0, -15], material: 'primary', role: 'wing_right' },
            { name: 'Nose Tip', geo: 'cone', size: [0.55, 1.1], pos: [0, 0, -2.05], rot: [-90, 0, 0], material: 'primary', role: 'nose' },
            { name: 'Tail', geo: 'cylinder', size: [0.05, 0.15, 1.2], pos: [0, 0, 1.8], rot: [90, 0, 0], material: 'secondary' },
            { name: 'L-Engine', geo: 'engine', size: [0.1, 0.08, 0.25], pos: [-2.5, -0.2, -0.6], role: 'engine_left' },
            { name: 'R-Engine', geo: 'engine', size: [0.1, 0.08, 0.25], pos: [2.5, -0.2, -0.6], role: 'engine_right' }
        ]
    },

    {
        id: 'lab_drone',
        label: 'Lab-Vorlage: Kampfdrohne',
        primaryColor: 0x10b981,
        parts: [
            { name: 'Core', geo: 'box', size: [1.6, 0.8, 2.4], material: 'primary', role: 'core' },
            { name: 'Top', geo: 'box', size: [1.2, 0.3, 2.0], pos: [0, 0.55, 0], material: 'secondary', role: 'nose' },
            { name: 'Arm-BL', geo: 'box', size: [3.2, 0.2, 0.4], pos: [0, 0.1, 0], rot: [0, 45, 0], material: 'primary', role: 'wing_left' },
            { name: 'Arm-BR', geo: 'box', size: [3.2, 0.2, 0.4], pos: [0, 0.1, 0], rot: [0, -45, 0], material: 'primary', role: 'wing_right' },
            { name: 'L-Engine', geo: 'engine', size: [0.28, 0.28, 0.5], pos: [-1.6, 0.1, 1.5], role: 'engine_left' },
            { name: 'R-Engine', geo: 'engine', size: [0.28, 0.28, 0.5], pos: [1.6, 0.1, 1.5], role: 'engine_right' }
        ]
    },

    {
        id: 'lab_orb',
        label: 'Lab-Vorlage: Energie-Orb',
        primaryColor: 0xec4899,
        parts: [
            { name: 'Core', geo: 'sphere', size: [1.0], material: 'glow', role: 'core' },
            { name: 'Ring-1', geo: 'torus', size: [2.0, 0.04], rot: [0, 0, 0], material: 'secondary', role: 'wing_left' },
            { name: 'Ring-2', geo: 'torus', size: [2.0, 0.04], rot: [90, 0, 0], material: 'secondary', role: 'wing_right' },
            { name: 'Ring-3', geo: 'torus', size: [2.4, 0.03], rot: [0, 45, 0], material: 'secondary', role: 'nose' },
            { name: 'L-Engine', geo: 'engine', size: [0.25, 0.2, 0.5], pos: [-2.2, 0, 0], rot: [0, -90, 0], role: 'engine_left' },
            { name: 'R-Engine', geo: 'engine', size: [0.25, 0.2, 0.5], pos: [2.2, 0, 0], rot: [0, 90, 0], role: 'engine_right' }
        ]
    },

    {
        id: 'lab_arrow',
        label: 'Lab-Vorlage: Pfeil',
        primaryColor: 0xeab308,
        parts: [
            { name: 'Shaft', geo: 'cylinder', size: [0.1, 0.25, 4], pos: [0, 0, 1.0], rot: [90, 0, 0], material: 'primary', role: 'core' },
            { name: 'Head', geo: 'cone', size: [0.4, 1.2], pos: [0, 0, -1.6], rot: [-90, 0, 0], material: 'primary', role: 'nose' },
            { name: 'Fin-1', geo: 'box', size: [0.1, 1.5, 0.8], pos: [0, 0.4, 2.5], material: 'primary' },
            { name: 'Fin-2', geo: 'box', size: [0.1, 1.5, 0.8], pos: [0, -0.4, 2.5], material: 'primary' },
            { name: 'Fin-3', geo: 'box', size: [1.5, 0.1, 0.8], pos: [0.4, 0, 2.5], material: 'primary', role: 'wing_left' },
            { name: 'Fin-4', geo: 'box', size: [1.5, 0.1, 0.8], pos: [-0.4, 0, 2.5], material: 'primary', role: 'wing_right' },
            { name: 'L-Engine', geo: 'engine', size: [0.18, 0.14, 0.5], pos: [-0.45, 0, 3.2], role: 'engine_left' },
            { name: 'R-Engine', geo: 'engine', size: [0.18, 0.14, 0.5], pos: [0.45, 0, 3.2], role: 'engine_right' }
        ]
    }

];
