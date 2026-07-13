// ============================================================
// Frozen Helix – Eisspirale von oben nach unten
// Start auf Bergspitze (y=95), Ziel am Boden (y=5)
// Spiralfoermiger Abstieg mit Foam-Eisflaechen
// ============================================================

export const FROZEN_HELIX_MAP = {
    frozen_helix: {
        name: 'Frozen Helix',
        size: [180, 110, 180],
        preferAuthoredPortals: true,
        portalLevels: [10, 30, 50, 70, 90],
        obstacles: [
            // =============================================
            // Zentrale Eissaeule (Spirale windet sich darum)
            // =============================================
            { pos: [0, 50, 0], size: [12, 100, 12] },

            // =============================================
            // PHASE 1: Gipfelstart (y ≈ 90–95)
            // =============================================
            { pos: [0, 93, 30], size: [16, 4, 16], kind: 'foam' },
            { pos: [20, 91, 20], size: [10, 3, 10] },

            // =============================================
            // PHASE 2: Obere Spirale (y ≈ 70–90)
            // =============================================
            // Spiralplattformen (im Uhrzeigersinn abwaerts)
            { pos: [35, 86, 0], size: [14, 3, 10], kind: 'foam' },
            { pos: [25, 82, -25], size: [12, 3, 10] },
            { pos: [0, 78, -35], size: [10, 3, 14], kind: 'foam' },
            { pos: [-25, 74, -20], size: [12, 3, 10] },
            { pos: [-35, 70, 0], size: [14, 3, 10], kind: 'foam' },

            // Tube-Abschnitt (Eisrutsche)
            { shape: 'tube', kind: 'hard', start: [-35, 70, 0], end: [-20, 62, 30], radius: 4.5 },

            // =============================================
            // PHASE 3: Mittlere Zone – Engstellen (y ≈ 45–65)
            // =============================================
            { pos: [-20, 61, 30], size: [10, 3, 10] },

            // Stalaktiten-Engstelle
            { pos: [-10, 62, 20], size: [3, 14, 3] },
            { pos: [-10, 62, 40], size: [3, 14, 3] },

            { pos: [0, 57, 35], size: [12, 3, 10], kind: 'foam' },
            { pos: [25, 53, 25], size: [10, 3, 12] },

            // Wand mit Tunnel
            { pos: [30, 50, 0], size: [8, 20, 40], tunnel: { radius: 5.0, axis: 'z' } },

            { pos: [25, 49, -20], size: [12, 3, 10], kind: 'foam' },
            { pos: [10, 45, -30], size: [10, 3, 12] },

            // =============================================
            // PHASE 4: Split-Zone (y ≈ 30–45)
            // =============================================
            { pos: [-10, 42, -25], size: [10, 3, 10] },

            // SPLIT A: Innenroute (eng an Saeule, schnell)
            { shape: 'tube', kind: 'hard', start: [-10, 42, -25], end: [8, 28, 10], radius: 3.2 },

            // SPLIT B: Aussenroute (breit, Umweg)
            { pos: [-30, 38, -15], size: [10, 3, 10], kind: 'foam' },
            { pos: [-35, 34, 5], size: [12, 3, 10], kind: 'foam' },
            { pos: [-25, 30, 20], size: [10, 3, 10], kind: 'foam' },

            // Sammelplattform
            { pos: [0, 27, 15], size: [14, 3, 14] },

            // =============================================
            // PHASE 5: Finale Rutsche (y ≈ 5–27)
            // =============================================
            // Steile Tube zum Boden
            { shape: 'tube', kind: 'hard', start: [0, 27, 15], end: [20, 10, 35], radius: 5.0 },

            // Bremsplattformen
            { pos: [20, 9, 35], size: [10, 3, 10], kind: 'foam' },
            { pos: [30, 6, 25], size: [8, 3, 8] },

            // Zielplattform am Boden
            { pos: [35, 4, 10], size: [16, 4, 16], kind: 'foam' },

            // =============================================
            // DEKO: Eiskristall-Formationen
            // =============================================
            { pos: [60, 30, 60], size: [4, 60, 4] },
            { pos: [-60, 30, -60], size: [4, 60, 4] },
            { pos: [60, 30, -60], size: [4, 60, 4] },
            { pos: [-60, 30, 60], size: [4, 60, 4] },
            { pos: [40, 70, -40], size: [3, 8, 3], kind: 'foam' },
            { pos: [-40, 50, 40], size: [3, 10, 3], kind: 'foam' },
        ],
        portals: [
            { a: [25, 50, -20], b: [-25, 32, 20], color: 0x88ddff },
            { a: [20, 12, 35], b: [0, 95, 30], color: 0x4488ff },
        ],
        gates: [
            {
                id: 'fh_sling_start',
                type: 'slingshot',
                pos: [20, 93, 20],
                forward: [1, -0.5, -1],
                up: [0, 1, 0],
                params: { duration: 1.6, forwardImpulse: 35, liftImpulse: -10, cooldown: 1.4 },
            },
            {
                id: 'fh_boost_spiral',
                type: 'boost',
                pos: [-35, 72, 0],
                forward: [0.5, -0.3, 1],
                params: { duration: 1.4, forwardImpulse: 45, bonusSpeed: 55, cooldown: 1.0 },
            },
            {
                id: 'fh_sling_mid',
                type: 'slingshot',
                pos: [25, 55, 25],
                forward: [0, -0.6, -1],
                up: [0, 1, 0],
                params: { duration: 1.8, forwardImpulse: 28, liftImpulse: -12, cooldown: 1.2 },
            },
            {
                id: 'fh_boost_finale',
                type: 'boost',
                pos: [0, 29, 15],
                forward: [1, -0.8, 1],
                params: { duration: 1.2, forwardImpulse: 50, bonusSpeed: 62, cooldown: 0.8 },
            },
        ],
        playerSpawn: { x: -8, y: 96, z: 38 },
        botSpawns: [
            { x: 8, y: 96, z: 38 },
            { x: -8, y: 96, z: 28 },
            { x: 8, y: 96, z: 28 },
        ],
        items: [
            { id: 'fh_speed_top', type: 'item_battery', pickupType: 'SPEED_UP', x: 35, y: 88, z: 0, weight: 1.5 },
            { id: 'fh_shield_spiral', type: 'item_shield', pickupType: 'SHIELD', x: -25, y: 76, z: -20, weight: 1.2 },
            { id: 'fh_ghost_eng', type: 'item_coin', pickupType: 'GHOST', x: 0, y: 59, z: 35, weight: 1.0 },
            { id: 'fh_speed_split', type: 'item_battery', pickupType: 'SPEED_UP', x: -30, y: 40, z: -15, weight: 1.3 },
            { id: 'fh_rocket_fin', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 20, y: 12, z: 35, weight: 0.9 },
        ],
        aircraft: [
            { id: 'fh_air_1', jetId: 'ship2', x: 50, y: 80, z: -30, scale: 1.1, rotateY: 0.8 },
            { id: 'fh_air_2', jetId: 'ship9', x: -40, y: 40, z: 45, scale: 1.3, rotateY: -1.5 },
        ],
        parcours: {
            enabled: true,
            routeId: 'frozen_helix_v1',
            rules: {
                ordered: true,
                resetOnDeath: true,
                resetToLastValid: false,
                maxSegmentTimeMs: 18000,
                cooldownMs: 450,
                wrongOrderCooldownMs: 650,
                errorIndicatorMs: 1400,
                allowLaneAliases: true,
                winnerByParcoursComplete: true,
                animateCheckpoints: true,
            },
            checkpoints: [
                { id: 'CP01', type: 'entry',     pos: [-2, 96, 36],     radius: 7.0, forward: [1, -0.3, -1] },
                { id: 'CP02', type: 'gate',      pos: [35, 89, 0],      radius: 5.5, forward: [0, -0.3, -1] },
                { id: 'CP03', type: 'gate',      pos: [-35, 73, 0],     radius: 5.5, forward: [0, -0.3, 1] },
                { id: 'CP04', type: 'gate',      pos: [-20, 64, 30],    radius: 5.5, forward: [1, -0.3, 0] },
                { id: 'CP05', type: 'tunnel',    pos: [30, 50, 0],      radius: 5.0, forward: [0, 0, -1] },
                { id: 'CP06', type: 'gate',      pos: [-10, 45, -25],   radius: 5.5, forward: [-1, -0.3, 0] },
                { id: 'CP07', type: 'split',     pos: [8, 30, 10],      radius: 5.0, forward: [0, -1, 0] },
                { id: 'CP07_R', type: 'split',   aliasOf: 'CP07', pos: [-25, 33, 20], radius: 5.5, forward: [1, -0.3, 0] },
                { id: 'CP08', type: 'gate',      pos: [0, 30, 15],      radius: 5.5, forward: [1, -0.5, 1] },
                { id: 'CP09', type: 'gate',      pos: [20, 12, 35],     radius: 5.5, forward: [1, 0, -1] },
                { id: 'CP10', type: 'finish_pre', pos: [30, 9, 25],     radius: 5.0, forward: [1, 0, -1] },
            ],
            finish: { id: 'FINISH', type: 'finish', pos: [35, 8, 10], radius: 7.0, forward: [0, 0, -1] },
        },
    },
};
