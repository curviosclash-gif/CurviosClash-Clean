// ============================================
// Clockwork Canyon - Sandsturm und Felsnischen
// Vier ueberdachte Nischen an den Canyon-Randwaenden (je eine pro Seite)
// dienen im Sandsturm als Unterstand; die Randwand ist ihre Rueckwand.
// ============================================

// Each nook: a rock roof (y 12-15) reaching 13 units out of a rim wall segment, and two side walls.
export const CLOCKWORK_CANYON_SHELTER_OBSTACLES = [
    // --- Ost-Nische (Randwand x = 68, z 25..45) ---
    { pos: [61.5, 13.5, 35], size: [13, 3, 20], kind: 'hard' },
    { pos: [62, 6, 25.75], size: [10, 12, 1.5], kind: 'hard' },
    { pos: [62, 6, 44.25], size: [10, 12, 1.5], kind: 'hard' },
    // --- West-Nische (Randwand x = -68, z -45..-25) ---
    { pos: [-61.5, 13.5, -35], size: [13, 3, 20], kind: 'hard' },
    { pos: [-62, 6, -25.75], size: [10, 12, 1.5], kind: 'hard' },
    { pos: [-62, 6, -44.25], size: [10, 12, 1.5], kind: 'hard' },
    // --- Sued-Nische (Randwand z = 68, x 25..45) ---
    { pos: [35, 13.5, 61.5], size: [20, 3, 13], kind: 'hard' },
    { pos: [25.75, 6, 62], size: [1.5, 12, 10], kind: 'hard' },
    { pos: [44.25, 6, 62], size: [1.5, 12, 10], kind: 'hard' },
    // --- Nord-Nische (Randwand z = -68, x -45..-25) ---
    { pos: [-35, 13.5, -61.5], size: [20, 3, 13], kind: 'hard' },
    { pos: [-25.75, 6, -62], size: [1.5, 12, 10], kind: 'hard' },
    { pos: [-44.25, 6, -62], size: [1.5, 12, 10], kind: 'hard' },
];

// Same rhythm as the pyramid storm: 20 s swell, 30 s peak, 20 s ease-off.
export const CLOCKWORK_CANYON_SANDSTORM = {
    enabled: true,
    initialDelaySeconds: [45, 90],
    repeatDelaySeconds: [90, 150],
    warningSeconds: 20,
    activeSeconds: 70,
    ingressSeconds: 20,
    egressSeconds: 20,
    outdoorNear: 1.6,
    outdoorFar: 8,
    shelterNear: 18,
    shelterFar: 85,
    proximityCueRange: 18,
    shelterVolumes: [
        { id: 'east-rock-nook', min: [56.5, 0.5, 27], max: [64.5, 11.5, 43] },
        { id: 'west-rock-nook', min: [-64.5, 0.5, -43], max: [-56.5, 11.5, -27] },
        { id: 'south-rock-nook', min: [27, 0.5, 56.5], max: [43, 11.5, 64.5] },
        { id: 'north-rock-nook', min: [-43, 0.5, -64.5], max: [-27, 11.5, -56.5] },
    ],
};

export const CLOCKWORK_CANYON_AUDIO_PROFILE = {
    id: 'sandstorm',
    warningSeconds: CLOCKWORK_CANYON_SANDSTORM.warningSeconds,
    activeSeconds: CLOCKWORK_CANYON_SANDSTORM.activeSeconds,
    ingressSeconds: CLOCKWORK_CANYON_SANDSTORM.ingressSeconds,
    shelterVolumes: CLOCKWORK_CANYON_SANDSTORM.shelterVolumes,
};
