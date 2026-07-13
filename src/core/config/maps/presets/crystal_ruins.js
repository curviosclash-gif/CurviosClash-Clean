// ============================================
// Crystal Ruins - Wüsten-Arena mit Kristallen
// CC0-inspiriert von pm-crystal-crossroads Assets
// ============================================

export const CRYSTAL_RUINS_MAP = {
    crystal_ruins: {
        name: 'Crystal Ruins',
        size: [140, 60, 140],
        preferAuthoredPortals: true,
        portalLevels: [10, 25, 42],
        obstacles: [
            // --- Boden-Ebene: Zentrale Ruinen-Plattform ---
            { pos: [0, 2, 0], size: [22, 4, 22], kind: 'foam' },

            // --- Kristall-Säulen (4 Hauptkristalle um das Zentrum) ---
            { pos: [30, 12, 30], size: [5, 24, 5] },
            { pos: [-30, 12, -30], size: [5, 24, 5] },
            { pos: [30, 12, -30], size: [5, 24, 5] },
            { pos: [-30, 12, 30], size: [5, 24, 5] },

            // --- Kleine Kristallformationen (Boden) ---
            { pos: [15, 3, 0], size: [3, 6, 3], kind: 'foam' },
            { pos: [-15, 3, 0], size: [3, 6, 3], kind: 'foam' },
            { pos: [0, 3, 15], size: [3, 6, 3], kind: 'foam' },
            { pos: [0, 3, -15], size: [3, 6, 3], kind: 'foam' },

            // --- Ruinen-Mauern mit Durchflug-Tunneln ---
            { pos: [0, 8, -40], size: [50, 16, 5], tunnel: { radius: 5.5, axis: 'z' } },
            { pos: [0, 8, 40], size: [50, 16, 5], tunnel: { radius: 5.5, axis: 'z' } },
            { pos: [40, 8, 0], size: [5, 16, 50], tunnel: { radius: 5.5, axis: 'x' } },
            { pos: [-40, 8, 0], size: [5, 16, 50], tunnel: { radius: 5.5, axis: 'x' } },

            // --- Mittlere Ebene: Schwebende Ruinen-Brücken ---
            { pos: [0, 25, -25], size: [8, 3, 30] },
            { pos: [0, 25, 25], size: [8, 3, 30] },
            { pos: [-25, 25, 0], size: [30, 3, 8] },
            { pos: [25, 25, 0], size: [30, 3, 8] },

            // --- Kristall-Cluster auf den Brücken ---
            { pos: [0, 28, -40], size: [4, 6, 4], kind: 'foam' },
            { pos: [0, 28, 40], size: [4, 6, 4], kind: 'foam' },
            { pos: [-40, 28, 0], size: [4, 6, 4], kind: 'foam' },
            { pos: [40, 28, 0], size: [4, 6, 4], kind: 'foam' },

            // --- Obere Ebene: Kristall-Käfig ---
            { pos: [0, 42, 0], size: [12, 6, 12], tunnel: { radius: 4.0, axis: 'y' } },

            // --- Eck-Türme (Wächter-Kristalle) ---
            { pos: [-55, 20, -55], size: [8, 40, 8] },
            { pos: [55, 20, -55], size: [8, 40, 8] },
            { pos: [-55, 20, 55], size: [8, 40, 8] },
            { pos: [55, 20, 55], size: [8, 40, 8] },

            // --- Verbindungs-Tubes zwischen Eck-Türmen (obere Ebene) ---
            { shape: 'tube', kind: 'hard', start: [-55, 36, -55], end: [55, 36, -55], radius: 3.8 },
            { shape: 'tube', kind: 'hard', start: [-55, 36, 55], end: [55, 36, 55], radius: 3.8 },
            { shape: 'tube', kind: 'hard', start: [-55, 36, -55], end: [-55, 36, 55], radius: 3.8 },
            { shape: 'tube', kind: 'hard', start: [55, 36, -55], end: [55, 36, 55], radius: 3.8 },

            // --- Diagonale Kristall-Rampen ---
            { pos: [20, 14, 20], size: [16, 3, 4], kind: 'foam' },
            { pos: [-20, 14, -20], size: [16, 3, 4], kind: 'foam' },
            { pos: [20, 14, -20], size: [4, 3, 16], kind: 'foam' },
            { pos: [-20, 14, 20], size: [4, 3, 16], kind: 'foam' },

            // --- Plattformen auf Eck-Türmen ---
            { pos: [-55, 41, -55], size: [14, 2, 14] },
            { pos: [55, 41, -55], size: [14, 2, 14] },
            { pos: [-55, 41, 55], size: [14, 2, 14] },
            { pos: [55, 41, 55], size: [14, 2, 14] },

            // --- Schwebende Kristall-Inseln (obere Ebene) ---
            { pos: [0, 50, 30], size: [6, 3, 6], kind: 'foam' },
            { pos: [0, 50, -30], size: [6, 3, 6], kind: 'foam' },
            { pos: [30, 50, 0], size: [6, 3, 6], kind: 'foam' },
            { pos: [-30, 50, 0], size: [6, 3, 6], kind: 'foam' },
        ],
        portals: [
            // Boden ↔ Obere Ebene (Zentral)
            { a: [0, 5, 0], b: [0, 48, 0], color: 0x88ffcc },
            // Diagonale Verbindungen
            { a: [-50, 10, -50], b: [50, 42, 50], color: 0xcc44ff },
            { a: [50, 10, -50], b: [-50, 42, 50], color: 0x44ccff },
            // Brücken-Level Portale
            { a: [-45, 25, 0], b: [45, 25, 0], color: 0xffaa44 },
            { a: [0, 25, -45], b: [0, 25, 45], color: 0xff4488 },
            // Turm-Hopper
            { a: [-55, 42, -55], b: [55, 42, 55], color: 0x44ff88 },
        ],
        gates: [
            // Boost-Gates an den Tunnel-Mauern
            {
                type: 'boost',
                pos: [0, 10, -50],
                forward: [0, 0, 1],
                params: { duration: 1.6, forwardImpulse: 50, bonusSpeed: 65 }
            },
            {
                type: 'boost',
                pos: [0, 10, 50],
                forward: [0, 0, -1],
                params: { duration: 1.6, forwardImpulse: 50, bonusSpeed: 65 }
            },
            {
                type: 'boost',
                pos: [50, 10, 0],
                forward: [-1, 0, 0],
                params: { duration: 1.6, forwardImpulse: 50, bonusSpeed: 65 }
            },
            {
                type: 'boost',
                pos: [-50, 10, 0],
                forward: [1, 0, 0],
                params: { duration: 1.6, forwardImpulse: 50, bonusSpeed: 65 }
            },
            // Slingshot im Zentrum (nach oben)
            {
                type: 'slingshot',
                pos: [0, 26, 0],
                forward: [0, 0, 1],
                up: [0, 1, 0],
                params: { duration: 2.2, forwardImpulse: 20, liftImpulse: 18 }
            },
            // Slingshot auf oberer Ebene
            {
                type: 'slingshot',
                pos: [0, 48, 0],
                forward: [0, 0, -1],
                up: [0, 1, 0],
                params: { duration: 2.0, forwardImpulse: 25, liftImpulse: 12 }
            },
        ],
        playerSpawn: { x: -60, y: 10, z: 0 },
        botSpawns: [
            { x: 60, y: 10, z: 0 },
            { x: 0, y: 10, z: -60 },
            { x: 0, y: 10, z: 60 },
            { x: -55, y: 42, z: -55 },
            { x: 55, y: 42, z: 55 },
            { x: 0, y: 50, z: 0 },
        ],
        items: [
            // Boden-Ebene Items
            { id: 'cr_rocket_center', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 0, y: 5, z: 0, weight: 1.5 },
            { id: 'cr_shield_north', type: 'item_shield', pickupType: 'SHIELD', x: 0, y: 5, z: -25, weight: 1.2 },
            { id: 'cr_speed_south', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 5, z: 25, weight: 1.3 },
            // Brücken-Ebene Items
            { id: 'cr_ghost_bridge', type: 'item_coin', pickupType: 'GHOST', x: -25, y: 27, z: 0, weight: 1.4 },
            { id: 'cr_thick_bridge', type: 'item_coin', pickupType: 'THICK', x: 25, y: 27, z: 0, weight: 1.0 },
            { id: 'cr_shield_bridge', type: 'item_shield', pickupType: 'SHIELD', x: 0, y: 27, z: -25, weight: 1.1 },
            // Obere Ebene Items
            { id: 'cr_rocket_top', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 0, y: 52, z: 0, weight: 0.7 },
            { id: 'cr_speed_tower', type: 'item_battery', pickupType: 'SPEED_UP', x: 55, y: 44, z: 55, weight: 1.6 },
        ],
        aircraft: [
            { id: 'cr_air_1', jetId: 'ship2', x: 0, y: 35, z: -30, scale: 1.2, rotateY: 0.5 },
            { id: 'cr_air_2', jetId: 'ship7', x: 30, y: 45, z: 30, scale: 1.1, rotateY: -1.0 },
            { id: 'cr_air_3', jetId: 'aircraft', x: -40, y: 50, z: 0, scale: 1.3, rotateY: 1.57 },
        ],
        exitPortal: { pos: [0, 52, 0], color: 0x00ff88, activateOnClear: true },
        missions: [
            { type: 'KILL_COUNT', params: { target: 7 }, weight: 1.5 },
            { type: 'SURVIVE_DURATION', params: { target: 55 }, weight: 1 },
            { type: 'TIME_TRIAL', params: { target: 40 }, weight: 1.5 },
            { type: 'REACH_PORTAL', params: {}, weight: 1 },
        ],
    },
};
