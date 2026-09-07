// Shared source of truth for editable Vehicle Lab presets and packaged game vehicles.
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
    },

    {
        id: 'lab_bastion',
        label: 'Lab-Vorlage: Bastion (Schwer)',
        primaryColor: 0xb45309,
        parts: [
            { name: 'Hull', geo: 'box', size: [2.2, 0.9, 4.4], pos: [0, 0, 0], material: 'primary', role: 'core' },
            { name: 'Nose Ram', geo: 'cone', size: [0.95, 1.7], pos: [0, 0, -3.05], rot: [-90, 0, 0], material: 'secondary', role: 'nose' },
            { name: 'Cockpit', geo: 'capsule', size: [0.34, 0.7], pos: [0, 0.52, -1.3], rot: [90, 0, 0], material: 'glass' },
            { name: 'L-Wing', geo: 'box', size: [1.7, 0.45, 2.6], pos: [-1.85, -0.05, 0.4], rot: [0, 0, 10], material: 'primary', role: 'wing_left' },
            { name: 'R-Wing', geo: 'box', size: [1.7, 0.45, 2.6], pos: [1.85, -0.05, 0.4], rot: [0, 0, -10], material: 'primary', role: 'wing_right' },
            { name: 'Dorsal Fin', geo: 'box', size: [0.16, 0.9, 1.4], pos: [0, 0.85, 1.7], material: 'secondary' },
            { name: 'L-Engine', geo: 'engine', size: [0.42, 0.34, 1.0], pos: [-1.3, 0, 2.5], role: 'engine_left' },
            { name: 'R-Engine', geo: 'engine', size: [0.42, 0.34, 1.0], pos: [1.3, 0, 2.5], role: 'engine_right' }
        ]
    },

    {
        id: 'lab_wraith',
        label: 'Lab-Vorlage: Wraith (Abfangjaeger)',
        primaryColor: 0x38bdf8,
        parts: [
            { name: 'Spine', geo: 'cylinder', size: [0.3, 0.44, 5.0], pos: [0, 0, 0.2], rot: [90, 0, 0], material: 'primary', role: 'core' },
            { name: 'Nose Needle', geo: 'cone', size: [0.32, 1.7], pos: [0, 0, -3.15], rot: [-90, 0, 0], material: 'primary', role: 'nose' },
            { name: 'Canopy', geo: 'capsule', size: [0.2, 0.62], pos: [0, 0.26, -1.15], rot: [90, 0, 0], material: 'glass' },
            { name: 'L-Wing', geo: 'box', size: [2.4, 0.07, 1.0], pos: [-1.45, 0, 1.0], rot: [0, -16, 9], material: 'primary', role: 'wing_left' },
            { name: 'R-Wing', geo: 'box', size: [2.4, 0.07, 1.0], pos: [1.45, 0, 1.0], rot: [0, 16, -9], material: 'primary', role: 'wing_right' },
            { name: 'L-Canard', geo: 'box', size: [0.95, 0.06, 0.45], pos: [-0.78, 0, -1.85], rot: [0, 0, -7], material: 'secondary' },
            { name: 'R-Canard', geo: 'box', size: [0.95, 0.06, 0.45], pos: [0.78, 0, -1.85], rot: [0, 0, 7], material: 'secondary' },
            { name: 'L-Tailfin', geo: 'box', size: [0.06, 0.8, 0.65], pos: [-0.34, 0.42, 2.3], rot: [0, 0, 15], material: 'secondary' },
            { name: 'R-Tailfin', geo: 'box', size: [0.06, 0.8, 0.65], pos: [0.34, 0.42, 2.3], rot: [0, 0, -15], material: 'secondary' },
            { name: 'L-Engine', geo: 'engine', size: [0.24, 0.19, 0.8], pos: [-0.52, 0, 2.7], role: 'engine_left' },
            { name: 'R-Engine', geo: 'engine', size: [0.24, 0.19, 0.8], pos: [0.52, 0, 2.7], role: 'engine_right' }
        ]
    },

    {
        id: 'lab_nautilus',
        label: 'Lab-Vorlage: Nautilus (Ringtraeger)',
        primaryColor: 0x22d3ee,
        parts: [
            { name: 'Core', geo: 'sphere', size: [0.82], pos: [0, 0, 0], material: 'glow', emissive: 0x22d3ee, emissiveIntensity: 1.4, role: 'core' },
            { name: 'Shell', geo: 'capsule', size: [0.95, 1.0], pos: [0, 0, 0.1], rot: [90, 0, 0], material: 'glass', opacity: 0.45 },
            { name: 'Nose Spire', geo: 'cone', size: [0.4, 1.5], pos: [0, 0, -1.95], rot: [-90, 0, 0], material: 'primary', role: 'nose' },
            { name: 'Ring Alpha', geo: 'torus', size: [1.75, 0.08], pos: [0, 0, 0], rot: [90, 0, 0], material: 'secondary', anim: { type: 'rotate', axis: 'y', speed: 0.6, amount: 1 } },
            { name: 'Ring Beta', geo: 'torus', size: [2.0, 0.05], pos: [0, 0, 0.2], rot: [70, 0, 0], material: 'secondary', anim: { type: 'rotate', axis: 'y', speed: -0.4, amount: 1 } },
            { name: 'L-Wing', geo: 'box', size: [1.4, 0.08, 1.1], pos: [-1.5, 0, 0.5], rot: [0, 0, 18], material: 'primary', role: 'wing_left' },
            { name: 'R-Wing', geo: 'box', size: [1.4, 0.08, 1.1], pos: [1.5, 0, 0.5], rot: [0, 0, -18], material: 'primary', role: 'wing_right' },
            { name: 'L-Engine', geo: 'engine', size: [0.3, 0.24, 0.7], pos: [-0.95, 0, 1.85], role: 'engine_left' },
            { name: 'R-Engine', geo: 'engine', size: [0.3, 0.24, 0.7], pos: [0.95, 0, 1.85], role: 'engine_right' }
        ]
    },

    {
        id: 'lab_helix_interceptor',
        label: 'Lab-Vorlage: Helix Interceptor',
        primaryColor: 0x2563eb,
        parts: [
            { name: 'Forward Spine', geo: 'capsule', size: [0.42, 1.8], pos: [0, 0, -1.15], rot: [90, 0, 0], material: 'primary', role: 'core' },
            { name: 'Reactor Spine', geo: 'cylinder', size: [0.46, 0.55, 2.2], pos: [0, 0, 0.75], rot: [90, 0, 0], material: 'secondary' },
            { name: 'Needle Nose', geo: 'cone', size: [0.38, 1.5], pos: [0, 0, -3.15], rot: [-90, 0, 0], material: 'primary', role: 'nose' },
            { name: 'Canopy', geo: 'capsule', size: [0.25, 0.72], pos: [0, 0.35, -1.35], rot: [90, 0, 0], material: 'glass', opacity: 0.72 },
            { name: 'Helix Core', geo: 'sphere', size: [0.38], pos: [0, 0.05, 0.55], material: 'glow', emissive: 0x38bdf8, emissiveIntensity: 1.8, anim: { type: 'pulse', speed: 3.2, amount: 0.8 } },
            { name: 'Helix Ring A', geo: 'torus', size: [0.7, 0.1], pos: [0, 0, 0.25], rot: [90, 0, 0], material: 'secondary', anim: { type: 'rotate', axis: 'z', speed: 1.4, amount: 1 } },
            { name: 'Helix Ring B', geo: 'torus', size: [0.82, 0.1], pos: [0, 0, 0.8], rot: [70, 0, 0], material: 'secondary', anim: { type: 'rotate', axis: 'z', speed: -1.1, amount: 1 } },
            { name: 'L-Main Wing', geo: 'box', size: [2.1, 0.12, 1.25], pos: [-1.25, -0.04, 0.35], rot: [0, -14, 10], material: 'primary', role: 'wing_left' },
            { name: 'R-Main Wing', geo: 'box', size: [2.1, 0.12, 1.25], pos: [1.25, -0.04, 0.35], rot: [0, 14, -10], material: 'primary', role: 'wing_right' },
            { name: 'L-Canard', geo: 'box', size: [0.95, 0.1, 0.42], pos: [-0.7, 0, -1.85], rot: [0, -18, -8], material: 'secondary' },
            { name: 'R-Canard', geo: 'box', size: [0.95, 0.1, 0.42], pos: [0.7, 0, -1.85], rot: [0, 18, 8], material: 'secondary' },
            { name: 'L-Ventral Blade', geo: 'box', size: [0.12, 0.65, 0.9], pos: [-0.48, -0.45, 1.25], rot: [8, 0, -12], material: 'secondary' },
            { name: 'R-Ventral Blade', geo: 'box', size: [0.12, 0.65, 0.9], pos: [0.48, -0.45, 1.25], rot: [8, 0, 12], material: 'secondary' },
            { name: 'Dorsal Fin', geo: 'box', size: [0.12, 0.72, 0.95], pos: [0, 0.52, 1.25], rot: [-8, 0, 0], material: 'primary', role: 'utility' },
            { name: 'L-Outer Thruster', geo: 'engine', size: [0.24, 0.2, 0.72], pos: [-1.82, -0.04, 1.2], material: 'secondary' },
            { name: 'R-Outer Thruster', geo: 'engine', size: [0.24, 0.2, 0.72], pos: [1.82, -0.04, 1.2], material: 'secondary' },
            { name: 'L-Main Engine', geo: 'engine', size: [0.34, 0.28, 1.0], pos: [-0.52, 0, 2.1], role: 'engine_left', children: [
                { name: 'L-Ion Flame', geo: 'flame', size: [0.19, 0.1, 0.85], pos: [0, 0, 0.86], color: 0x22d3ee, material: 'glow', anim: { type: 'pulse', speed: 6, amount: 0.6 } }
            ] },
            { name: 'R-Main Engine', geo: 'engine', size: [0.34, 0.28, 1.0], pos: [0.52, 0, 2.1], role: 'engine_right', children: [
                { name: 'R-Ion Flame', geo: 'flame', size: [0.19, 0.1, 0.85], pos: [0, 0, 0.86], color: 0x22d3ee, material: 'glow', anim: { type: 'pulse', speed: 6, amount: 0.6 } }
            ] },
            { name: 'L-Sensor Pylon', geo: 'pylon', size: [0.12, 0.18, 0.8], pos: [-1.05, 0.2, -0.3], rot: [90, 0, 0], material: 'secondary', role: 'utility' },
            { name: 'R-Sensor Pylon', geo: 'pylon', size: [0.12, 0.18, 0.8], pos: [1.05, 0.2, -0.3], rot: [90, 0, 0], material: 'secondary', role: 'utility' },
            { name: 'L-Wing Beacon', geo: 'sphere', size: [0.12], pos: [-2.2, 0.02, 0.15], material: 'glow', emissive: 0x7dd3fc, emissiveIntensity: 1.4 },
            { name: 'R-Wing Beacon', geo: 'sphere', size: [0.12], pos: [2.2, 0.02, 0.15], material: 'glow', emissive: 0x7dd3fc, emissiveIntensity: 1.4 }
        ]
    },

    {
        id: 'lab_eclipse_phantom',
        label: 'Lab-Vorlage: Eclipse Phantom',
        primaryColor: 0x312e81,
        parts: [
            { name: 'Shadow Core', geo: 'capsule', size: [0.62, 2.1], pos: [0, -0.05, -0.2], rot: [90, 0, 0], material: 'primary', role: 'core' },
            { name: 'Blade Nose', geo: 'cone', size: [0.58, 1.45], pos: [0, -0.02, -2.75], rot: [-90, 0, 0], material: 'secondary', role: 'nose' },
            { name: 'Dark Canopy', geo: 'sphere', size: [0.5], pos: [0, 0.32, -1.0], scale: [0.75, 0.48, 1.2], material: 'glass', opacity: 0.48 },
            { name: 'L-Inner Crescent', geo: 'box', size: [1.65, 0.14, 1.85], pos: [-1.05, -0.05, 0.05], rot: [0, -24, 8], material: 'primary', role: 'wing_left' },
            { name: 'R-Inner Crescent', geo: 'box', size: [1.65, 0.14, 1.85], pos: [1.05, -0.05, 0.05], rot: [0, 24, -8], material: 'primary', role: 'wing_right' },
            { name: 'L-Outer Crescent', geo: 'box', size: [1.55, 0.1, 1.35], pos: [-2.15, -0.08, 0.8], rot: [0, -36, 13], material: 'secondary' },
            { name: 'R-Outer Crescent', geo: 'box', size: [1.55, 0.1, 1.35], pos: [2.15, -0.08, 0.8], rot: [0, 36, -13], material: 'secondary' },
            { name: 'L-Forward Fang', geo: 'cone', size: [0.18, 1.1], pos: [-1.62, -0.02, -1.45], rot: [-90, 0, -8], material: 'primary' },
            { name: 'R-Forward Fang', geo: 'cone', size: [0.18, 1.1], pos: [1.62, -0.02, -1.45], rot: [-90, 0, 8], material: 'primary' },
            { name: 'L-Ridge', geo: 'box', size: [0.14, 0.5, 1.65], pos: [-0.72, 0.28, 0.35], rot: [0, -18, -10], material: 'secondary' },
            { name: 'R-Ridge', geo: 'box', size: [0.14, 0.5, 1.65], pos: [0.72, 0.28, 0.35], rot: [0, 18, 10], material: 'secondary' },
            { name: 'Veil Core', geo: 'sphere', size: [0.32], pos: [0, 0, 0.7], material: 'glow', emissive: 0x8b5cf6, emissiveIntensity: 1.2, anim: { type: 'pulse', speed: 1.8, amount: 0.35 } },
            { name: 'Veil Ring', geo: 'torus', size: [0.58, 0.1], pos: [0, 0, 0.7], rot: [90, 0, 0], material: 'secondary', anim: { type: 'rotate', axis: 'z', speed: 0.45, amount: 1 } },
            { name: 'L-Phase Rail', geo: 'pylon', size: [0.1, 0.15, 1.4], pos: [-1.1, -0.16, -0.45], rot: [90, 0, 0], material: 'secondary', role: 'utility' },
            { name: 'R-Phase Rail', geo: 'pylon', size: [0.1, 0.15, 1.4], pos: [1.1, -0.16, -0.45], rot: [90, 0, 0], material: 'secondary', role: 'utility' },
            { name: 'L-Engine Shroud', geo: 'box', size: [0.62, 0.46, 1.35], pos: [-0.72, -0.08, 1.55], rot: [0, -8, 0], material: 'primary' },
            { name: 'R-Engine Shroud', geo: 'box', size: [0.62, 0.46, 1.35], pos: [0.72, -0.08, 1.55], rot: [0, 8, 0], material: 'primary' },
            { name: 'L-Phase Engine', geo: 'engine', size: [0.3, 0.25, 0.82], pos: [-0.72, -0.08, 2.15], role: 'engine_left', children: [
                { name: 'L-Phase Wake', geo: 'flame', size: [0.16, 0.1, 0.72], pos: [0, 0, 0.72], color: 0xa78bfa, material: 'glow', opacity: 0.58 }
            ] },
            { name: 'R-Phase Engine', geo: 'engine', size: [0.3, 0.25, 0.82], pos: [0.72, -0.08, 2.15], role: 'engine_right', children: [
                { name: 'R-Phase Wake', geo: 'flame', size: [0.16, 0.1, 0.72], pos: [0, 0, 0.72], color: 0xa78bfa, material: 'glow', opacity: 0.58 }
            ] },
            { name: 'L-Tip Light', geo: 'sphere', size: [0.11], pos: [-2.72, -0.05, 1.15], material: 'glow', emissive: 0xc4b5fd, emissiveIntensity: 1.6 },
            { name: 'R-Tip Light', geo: 'sphere', size: [0.11], pos: [2.72, -0.05, 1.15], material: 'glow', emissive: 0xc4b5fd, emissiveIntensity: 1.6 },
            { name: 'Ventral Cloak Node', geo: 'forcefield', size: [0.1, 0.1, 1.1], pos: [0, -0.42, 0.25], rot: [90, 0, 0], color: 0x6366f1, material: 'glow', role: 'utility' }
        ]
    },

    {
        id: 'lab_valkyrie_gunship',
        label: 'Lab-Vorlage: Valkyrie Gunship',
        primaryColor: 0xb91c1c,
        parts: [
            { name: 'Armored Core', geo: 'box', size: [1.55, 0.82, 2.8], pos: [0, 0, 0], material: 'primary', role: 'core' },
            { name: 'Forward Armor', geo: 'box', size: [1.3, 0.65, 1.35], pos: [0, -0.02, -1.85], rot: [8, 0, 0], material: 'secondary' },
            { name: 'Ram Nose', geo: 'cone', size: [0.62, 1.15], pos: [0, -0.05, -3.05], rot: [-90, 0, 0], material: 'primary', role: 'nose' },
            { name: 'Command Canopy', geo: 'capsule', size: [0.32, 0.72], pos: [0, 0.58, -1.2], rot: [90, 0, 0], material: 'glass', opacity: 0.7 },
            { name: 'Dorsal Armor', geo: 'box', size: [1.05, 0.4, 1.55], pos: [0, 0.58, 0.55], material: 'secondary' },
            { name: 'L-Heavy Wing', geo: 'box', size: [1.8, 0.32, 1.8], pos: [-1.55, -0.08, 0.3], rot: [0, -9, 8], material: 'primary', role: 'wing_left' },
            { name: 'R-Heavy Wing', geo: 'box', size: [1.8, 0.32, 1.8], pos: [1.55, -0.08, 0.3], rot: [0, 9, -8], material: 'primary', role: 'wing_right' },
            { name: 'L-Wing Plate', geo: 'box', size: [1.35, 0.18, 0.75], pos: [-2.28, 0.08, -0.25], rot: [0, -15, 5], material: 'secondary' },
            { name: 'R-Wing Plate', geo: 'box', size: [1.35, 0.18, 0.75], pos: [2.28, 0.08, -0.25], rot: [0, 15, -5], material: 'secondary' },
            { name: 'L-Cannon Rail', geo: 'pylon', size: [0.16, 0.22, 2.2], pos: [-2.25, -0.05, -0.55], rot: [90, 0, 0], material: 'secondary', role: 'utility' },
            { name: 'R-Cannon Rail', geo: 'pylon', size: [0.16, 0.22, 2.2], pos: [2.25, -0.05, -0.55], rot: [90, 0, 0], material: 'secondary', role: 'utility' },
            { name: 'L-Cannon Muzzle', geo: 'cylinder', size: [0.2, 0.14, 0.42], pos: [-2.25, -0.05, -1.72], rot: [90, 0, 0], material: 'glow', emissive: 0xf97316, emissiveIntensity: 1.3 },
            { name: 'R-Cannon Muzzle', geo: 'cylinder', size: [0.2, 0.14, 0.42], pos: [2.25, -0.05, -1.72], rot: [90, 0, 0], material: 'glow', emissive: 0xf97316, emissiveIntensity: 1.3 },
            { name: 'Dorsal Turret Base', geo: 'cylinder', size: [0.38, 0.46, 0.22], pos: [0, 0.86, -0.15], material: 'secondary' },
            { name: 'Dorsal Turret Barrel', geo: 'pylon', size: [0.12, 0.16, 1.15], pos: [0, 1.02, -0.72], rot: [90, 0, 0], material: 'primary', anim: { type: 'bob', speed: 1.2, amount: 0.12 } },
            { name: 'L-Tail Fin', geo: 'box', size: [0.16, 0.9, 0.9], pos: [-0.62, 0.62, 1.72], rot: [0, 0, 12], material: 'secondary' },
            { name: 'R-Tail Fin', geo: 'box', size: [0.16, 0.9, 0.9], pos: [0.62, 0.62, 1.72], rot: [0, 0, -12], material: 'secondary' },
            { name: 'L-Outer Engine', geo: 'engine', size: [0.34, 0.29, 0.88], pos: [-1.62, -0.18, 1.72], material: 'secondary' },
            { name: 'R-Outer Engine', geo: 'engine', size: [0.34, 0.29, 0.88], pos: [1.62, -0.18, 1.72], material: 'secondary' },
            { name: 'L-Main Engine', geo: 'engine', size: [0.42, 0.36, 1.05], pos: [-0.52, -0.12, 2.0], role: 'engine_left', children: [
                { name: 'L-Drive Flame', geo: 'flame', size: [0.24, 0.1, 0.88], pos: [0, 0, 0.9], color: 0xfb923c, material: 'glow', anim: { type: 'pulse', speed: 5, amount: 0.5 } }
            ] },
            { name: 'R-Main Engine', geo: 'engine', size: [0.42, 0.36, 1.05], pos: [0.52, -0.12, 2.0], role: 'engine_right', children: [
                { name: 'R-Drive Flame', geo: 'flame', size: [0.24, 0.1, 0.88], pos: [0, 0, 0.9], color: 0xfb923c, material: 'glow', anim: { type: 'pulse', speed: 5, amount: 0.5 } }
            ] },
            { name: 'Ventral Armor', geo: 'box', size: [1.1, 0.28, 1.65], pos: [0, -0.55, 0.45], material: 'secondary' },
            { name: 'Reactor Vent', geo: 'torus', size: [0.46, 0.1], pos: [0, -0.72, 0.55], rot: [90, 0, 0], material: 'glow', emissive: 0xef4444, emissiveIntensity: 1.2, anim: { type: 'rotate', axis: 'z', speed: 0.65, amount: 1 } }
        ]
    },

    {
        id: 'lab_atlas_salvager',
        label: 'Lab-Vorlage: Atlas Salvager',
        primaryColor: 0xd97706,
        parts: [
            { name: 'Industrial Core', geo: 'box', size: [1.45, 1.0, 2.65], pos: [0, 0, 0.2], material: 'primary', role: 'core' },
            { name: 'Cabin Block', geo: 'box', size: [1.05, 0.82, 1.15], pos: [-0.28, 0.28, -1.65], material: 'secondary', role: 'nose' },
            { name: 'Cabin Glass', geo: 'box', size: [0.82, 0.42, 0.18], pos: [-0.28, 0.38, -2.25], material: 'glass', opacity: 0.68 },
            { name: 'Cargo Spine', geo: 'box', size: [0.72, 0.55, 2.4], pos: [0.32, 0.05, 1.55], material: 'secondary' },
            { name: 'L-Work Wing', geo: 'box', size: [1.6, 0.22, 1.15], pos: [-1.42, -0.06, 0.25], rot: [0, -6, 8], material: 'primary', role: 'wing_left' },
            { name: 'R-Work Wing', geo: 'box', size: [1.6, 0.22, 1.15], pos: [1.42, -0.06, 0.25], rot: [0, 6, -8], material: 'primary', role: 'wing_right' },
            { name: 'L-Grabber Shoulder', geo: 'sphere', size: [0.32], pos: [-1.7, -0.05, -0.5], material: 'secondary', role: 'utility', children: [
                { name: 'L-Grabber Arm', geo: 'pylon', size: [0.14, 0.18, 1.25], pos: [-0.58, -0.08, -0.42], rot: [90, 0, -24], material: 'primary', children: [
                    { name: 'L-Grabber Claw A', geo: 'cone', size: [0.13, 0.62], pos: [-0.25, 0, -0.65], rot: [-90, 0, -28], material: 'secondary' },
                    { name: 'L-Grabber Claw B', geo: 'cone', size: [0.13, 0.62], pos: [0.25, 0, -0.65], rot: [-90, 0, 28], material: 'secondary' }
                ] }
            ] },
            { name: 'R-Grabber Shoulder', geo: 'sphere', size: [0.32], pos: [1.7, -0.05, -0.5], material: 'secondary', role: 'utility', children: [
                { name: 'R-Grabber Arm', geo: 'pylon', size: [0.14, 0.18, 1.25], pos: [0.58, -0.08, -0.42], rot: [90, 0, 24], material: 'primary', children: [
                    { name: 'R-Grabber Claw A', geo: 'cone', size: [0.13, 0.62], pos: [-0.25, 0, -0.65], rot: [-90, 0, -28], material: 'secondary' },
                    { name: 'R-Grabber Claw B', geo: 'cone', size: [0.13, 0.62], pos: [0.25, 0, -0.65], rot: [-90, 0, 28], material: 'secondary' }
                ] }
            ] },
            { name: 'Sensor Mast', geo: 'pylon', size: [0.12, 0.18, 1.05], pos: [0.35, 0.92, -0.35], material: 'secondary', role: 'utility' },
            { name: 'Sensor Dish', geo: 'torus', size: [0.42, 0.1], pos: [0.35, 1.42, -0.35], rot: [90, 0, 0], material: 'glow', emissive: 0xfbbf24, emissiveIntensity: 1.1, anim: { type: 'rotate', axis: 'z', speed: 0.8, amount: 1 } },
            { name: 'Cargo Hoop A', geo: 'torus', size: [0.72, 0.1], pos: [0.32, 0, 0.95], rot: [90, 0, 0], material: 'secondary' },
            { name: 'Cargo Hoop B', geo: 'torus', size: [0.72, 0.1], pos: [0.32, 0, 1.65], rot: [90, 0, 0], material: 'secondary' },
            { name: 'Cargo Hoop C', geo: 'torus', size: [0.72, 0.1], pos: [0.32, 0, 2.35], rot: [90, 0, 0], material: 'secondary' },
            { name: 'L-Work Light', geo: 'sphere', size: [0.14], pos: [-1.55, 0.18, -0.92], material: 'glow', emissive: 0xfde68a, emissiveIntensity: 2 },
            { name: 'R-Work Light', geo: 'sphere', size: [0.14], pos: [1.55, 0.18, -0.92], material: 'glow', emissive: 0xfde68a, emissiveIntensity: 2 },
            { name: 'L-Aux Engine', geo: 'engine', size: [0.28, 0.24, 0.78], pos: [-1.34, -0.16, 1.45], material: 'secondary' },
            { name: 'R-Aux Engine', geo: 'engine', size: [0.28, 0.24, 0.78], pos: [1.34, -0.16, 1.45], material: 'secondary' },
            { name: 'L-Main Engine', geo: 'engine', size: [0.4, 0.34, 1.0], pos: [-0.55, -0.12, 2.72], role: 'engine_left', children: [
                { name: 'L-Industrial Flame', geo: 'flame', size: [0.22, 0.1, 0.8], pos: [0, 0, 0.84], color: 0x67e8f9, material: 'glow' }
            ] },
            { name: 'R-Main Engine', geo: 'engine', size: [0.4, 0.34, 1.0], pos: [0.55, -0.12, 2.72], role: 'engine_right', children: [
                { name: 'R-Industrial Flame', geo: 'flame', size: [0.22, 0.1, 0.8], pos: [0, 0, 0.84], color: 0x67e8f9, material: 'glow' }
            ] },
            { name: 'Ventral Tractor Node', geo: 'forcefield', size: [0.1, 0.1, 1.0], pos: [0, -0.7, -0.3], rot: [90, 0, 0], color: 0xf59e0b, material: 'glow', anim: { type: 'pulse', speed: 2.2, amount: 0.4 }, role: 'utility' }
        ]
    },

    {
        id: 'lab_aegis_carrier',
        label: 'Lab-Vorlage: Aegis Carrier',
        primaryColor: 0x0f766e,
        parts: [
            { name: 'Carrier Spine', geo: 'box', size: [1.1, 0.72, 3.0], pos: [0, 0.18, 0.1], material: 'primary', role: 'core' },
            { name: 'Command Prow', geo: 'box', size: [1.0, 0.62, 1.3], pos: [0, 0.28, -2.0], rot: [6, 0, 0], material: 'secondary', role: 'nose' },
            { name: 'Bridge Glass', geo: 'box', size: [0.7, 0.24, 0.2], pos: [0, 0.58, -2.68], material: 'glass', opacity: 0.7 },
            { name: 'Prow Tip', geo: 'cone', size: [0.36, 0.9], pos: [0, 0.12, -3.12], rot: [-90, 0, 0], material: 'primary' },
            { name: 'L-Flight Deck', geo: 'box', size: [1.45, 0.22, 2.85], pos: [-1.25, -0.16, 0.05], rot: [0, 0, 3], material: 'primary', role: 'wing_left' },
            { name: 'R-Flight Deck', geo: 'box', size: [1.45, 0.22, 2.85], pos: [1.25, -0.16, 0.05], rot: [0, 0, -3], material: 'primary', role: 'wing_right' },
            { name: 'L-Deck Armor', geo: 'box', size: [1.25, 0.16, 1.1], pos: [-1.28, 0.06, -1.0], material: 'secondary' },
            { name: 'R-Deck Armor', geo: 'box', size: [1.25, 0.16, 1.1], pos: [1.28, 0.06, -1.0], material: 'secondary' },
            { name: 'L-Hangar Field', geo: 'forcefield', size: [0.1, 0.1, 1.45], pos: [-1.28, -0.03, -0.15], rot: [0, 90, 0], color: 0x2dd4bf, material: 'glow', role: 'utility' },
            { name: 'R-Hangar Field', geo: 'forcefield', size: [0.1, 0.1, 1.45], pos: [1.28, -0.03, -0.15], rot: [0, 90, 0], color: 0x2dd4bf, material: 'glow', role: 'utility' },
            { name: 'L-Deck Rail Forward', geo: 'pylon', size: [0.1, 0.14, 1.35], pos: [-2.02, 0.08, -0.92], rot: [90, 0, 0], material: 'secondary' },
            { name: 'R-Deck Rail Forward', geo: 'pylon', size: [0.1, 0.14, 1.35], pos: [2.02, 0.08, -0.92], rot: [90, 0, 0], material: 'secondary' },
            { name: 'L-Deck Rail Aft', geo: 'pylon', size: [0.1, 0.14, 1.35], pos: [-2.02, 0.08, 1.05], rot: [90, 0, 0], material: 'secondary' },
            { name: 'R-Deck Rail Aft', geo: 'pylon', size: [0.1, 0.14, 1.35], pos: [2.02, 0.08, 1.05], rot: [90, 0, 0], material: 'secondary' },
            { name: 'Bridge Tower', geo: 'box', size: [0.48, 0.92, 0.72], pos: [0.42, 0.88, 0.2], material: 'secondary' },
            { name: 'Bridge Crown', geo: 'capsule', size: [0.22, 0.42], pos: [0.42, 1.48, 0.02], rot: [90, 0, 0], material: 'glass' },
            { name: 'Radar Mast', geo: 'pylon', size: [0.1, 0.14, 0.82], pos: [0.42, 1.72, 0.28], material: 'primary' },
            { name: 'Radar Halo', geo: 'torus', size: [0.4, 0.1], pos: [0.42, 2.08, 0.28], rot: [90, 0, 0], material: 'glow', emissive: 0x5eead4, emissiveIntensity: 1.4, anim: { type: 'rotate', axis: 'z', speed: 0.72, amount: 1 } },
            { name: 'L-Outer Engine', geo: 'engine', size: [0.34, 0.3, 0.9], pos: [-1.75, -0.2, 2.0], material: 'secondary' },
            { name: 'R-Outer Engine', geo: 'engine', size: [0.34, 0.3, 0.9], pos: [1.75, -0.2, 2.0], material: 'secondary' },
            { name: 'L-Main Engine', geo: 'engine', size: [0.44, 0.38, 1.15], pos: [-0.55, 0.05, 2.15], role: 'engine_left', children: [
                { name: 'L-Carrier Flame', geo: 'flame', size: [0.25, 0.1, 0.92], pos: [0, 0, 0.98], color: 0x2dd4bf, material: 'glow', anim: { type: 'pulse', speed: 4.5, amount: 0.45 } }
            ] },
            { name: 'R-Main Engine', geo: 'engine', size: [0.44, 0.38, 1.15], pos: [0.55, 0.05, 2.15], role: 'engine_right', children: [
                { name: 'R-Carrier Flame', geo: 'flame', size: [0.25, 0.1, 0.92], pos: [0, 0, 0.98], color: 0x2dd4bf, material: 'glow', anim: { type: 'pulse', speed: 4.5, amount: 0.45 } }
            ] },
            { name: 'L-Rear Stabilizer', geo: 'box', size: [0.85, 0.12, 0.72], pos: [-1.08, 0.42, 2.12], rot: [0, 0, 16], material: 'secondary' },
            { name: 'R-Rear Stabilizer', geo: 'box', size: [0.85, 0.12, 0.72], pos: [1.08, 0.42, 2.12], rot: [0, 0, -16], material: 'secondary' },
            { name: 'Ventral Shield Projector', geo: 'sphere', size: [0.28], pos: [0, -0.62, 0.35], material: 'glow', emissive: 0x14b8a6, emissiveIntensity: 1.2, anim: { type: 'pulse', speed: 2, amount: 0.3 }, role: 'utility' }
        ]
    },

    {
        id: 'lab_leviathan_dreadnought',
        label: 'Lab-Vorlage: Leviathan Dreadnought',
        primaryColor: 0x374151,
        parts: [
            { name: 'Central Citadel', geo: 'box', size: [1.7, 1.05, 2.8], pos: [0, 0, 0.15], material: 'primary', role: 'core' },
            { name: 'Forward Hull', geo: 'box', size: [1.5, 0.88, 2.2], pos: [0, -0.02, -1.95], rot: [4, 0, 0], material: 'secondary' },
            { name: 'Aft Hull', geo: 'box', size: [1.6, 0.92, 2.2], pos: [0, 0.02, 2.2], material: 'primary' },
            { name: 'Siege Ram', geo: 'cone', size: [0.75, 1.3], pos: [0, -0.08, -3.55], rot: [-90, 0, 0], material: 'secondary', role: 'nose' },
            { name: 'Ram Collar', geo: 'torus', size: [0.78, 0.14], pos: [0, -0.08, -3.0], rot: [90, 0, 0], material: 'primary' },
            { name: 'L-Armor Shoulder', geo: 'box', size: [1.45, 0.55, 2.2], pos: [-1.48, 0.02, -0.15], rot: [0, -8, 6], material: 'primary', role: 'wing_left' },
            { name: 'R-Armor Shoulder', geo: 'box', size: [1.45, 0.55, 2.2], pos: [1.48, 0.02, -0.15], rot: [0, 8, -6], material: 'primary', role: 'wing_right' },
            { name: 'L-Aft Armor', geo: 'box', size: [1.25, 0.48, 1.8], pos: [-1.38, -0.02, 2.15], rot: [0, 6, 5], material: 'secondary' },
            { name: 'R-Aft Armor', geo: 'box', size: [1.25, 0.48, 1.8], pos: [1.38, -0.02, 2.15], rot: [0, -6, -5], material: 'secondary' },
            { name: 'Dorsal Bastion', geo: 'box', size: [1.05, 0.72, 1.5], pos: [0, 0.9, 0.2], material: 'secondary' },
            { name: 'Command Bridge', geo: 'box', size: [0.72, 0.5, 0.85], pos: [0, 1.48, -0.2], material: 'primary' },
            { name: 'Bridge Glass', geo: 'box', size: [0.56, 0.2, 0.14], pos: [0, 1.55, -0.66], material: 'glass', opacity: 0.65 },
            { name: 'Dorsal Reactor', geo: 'sphere', size: [0.38], pos: [0, 1.15, 1.2], material: 'glow', emissive: 0xef4444, emissiveIntensity: 1.6, anim: { type: 'pulse', speed: 2.4, amount: 0.55 } },
            { name: 'Reactor Ring A', geo: 'torus', size: [0.62, 0.1], pos: [0, 1.15, 1.2], rot: [90, 0, 0], material: 'secondary', anim: { type: 'rotate', axis: 'z', speed: 0.5, amount: 1 } },
            { name: 'Reactor Ring B', geo: 'torus', size: [0.74, 0.1], pos: [0, 1.15, 1.2], rot: [55, 0, 0], material: 'secondary', anim: { type: 'rotate', axis: 'y', speed: -0.35, amount: 1 } },
            { name: 'L-Siege Rail', geo: 'pylon', size: [0.18, 0.24, 2.7], pos: [-1.85, 0.34, -1.25], rot: [90, 0, 0], material: 'secondary', role: 'utility' },
            { name: 'R-Siege Rail', geo: 'pylon', size: [0.18, 0.24, 2.7], pos: [1.85, 0.34, -1.25], rot: [90, 0, 0], material: 'secondary', role: 'utility' },
            { name: 'L-Siege Muzzle', geo: 'cylinder', size: [0.26, 0.18, 0.48], pos: [-1.85, 0.34, -2.4], rot: [90, 0, 0], material: 'glow', emissive: 0xf87171, emissiveIntensity: 1.5 },
            { name: 'R-Siege Muzzle', geo: 'cylinder', size: [0.26, 0.18, 0.48], pos: [1.85, 0.34, -2.4], rot: [90, 0, 0], material: 'glow', emissive: 0xf87171, emissiveIntensity: 1.5 },
            { name: 'L-Broadside A', geo: 'pylon', size: [0.14, 0.2, 0.9], pos: [-2.18, 0.12, -0.3], rot: [0, 0, 90], material: 'secondary' },
            { name: 'R-Broadside A', geo: 'pylon', size: [0.14, 0.2, 0.9], pos: [2.18, 0.12, -0.3], rot: [0, 0, 90], material: 'secondary' },
            { name: 'L-Broadside B', geo: 'pylon', size: [0.14, 0.2, 0.9], pos: [-2.12, 0.12, 0.85], rot: [0, 0, 90], material: 'secondary' },
            { name: 'R-Broadside B', geo: 'pylon', size: [0.14, 0.2, 0.9], pos: [2.12, 0.12, 0.85], rot: [0, 0, 90], material: 'secondary' },
            { name: 'L-Broadside C', geo: 'pylon', size: [0.14, 0.2, 0.9], pos: [-1.98, 0.12, 1.9], rot: [0, 0, 90], material: 'secondary' },
            { name: 'R-Broadside C', geo: 'pylon', size: [0.14, 0.2, 0.9], pos: [1.98, 0.12, 1.9], rot: [0, 0, 90], material: 'secondary' },
            { name: 'L-Outer Engine', geo: 'engine', size: [0.38, 0.32, 0.95], pos: [-1.55, -0.18, 3.0], material: 'secondary' },
            { name: 'R-Outer Engine', geo: 'engine', size: [0.38, 0.32, 0.95], pos: [1.55, -0.18, 3.0], material: 'secondary' },
            { name: 'L-Main Engine', geo: 'engine', size: [0.5, 0.42, 1.25], pos: [-0.55, -0.08, 3.1], role: 'engine_left', children: [
                { name: 'L-Leviathan Flame', geo: 'flame', size: [0.28, 0.1, 1.05], pos: [0, 0, 1.05], color: 0xef4444, material: 'glow', anim: { type: 'pulse', speed: 4, amount: 0.55 } }
            ] },
            { name: 'R-Main Engine', geo: 'engine', size: [0.5, 0.42, 1.25], pos: [0.55, -0.08, 3.1], role: 'engine_right', children: [
                { name: 'R-Leviathan Flame', geo: 'flame', size: [0.28, 0.1, 1.05], pos: [0, 0, 1.05], color: 0xef4444, material: 'glow', anim: { type: 'pulse', speed: 4, amount: 0.55 } }
            ] },
            { name: 'L-Ventral Fin', geo: 'box', size: [0.14, 0.82, 1.1], pos: [-0.58, -0.82, 2.4], rot: [0, 0, -10], material: 'secondary' },
            { name: 'R-Ventral Fin', geo: 'box', size: [0.14, 0.82, 1.1], pos: [0.58, -0.82, 2.4], rot: [0, 0, 10], material: 'secondary' },
            { name: 'Ventral Shield Spine', geo: 'forcefield', size: [0.12, 0.12, 2.4], pos: [0, -0.72, 0.2], rot: [90, 0, 0], color: 0xdc2626, material: 'glow', role: 'utility' }
        ]
    }

];
