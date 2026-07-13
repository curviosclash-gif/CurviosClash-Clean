// ============================================================
// Magma Maze – Fliegendes Labyrinth mit Sackgassen
// Flaches Layout, Waende mit Tunnels, Portale als Hilfe/Fallen
// resetToLastValid statt resetOnDeath (weniger Frust)
// ============================================================

export const MAGMA_MAZE_MAP = {
    magma_maze: {
        name: 'Magma Maze',
        size: [200, 50, 200],
        preferAuthoredPortals: true,
        portalLevels: [10, 20, 35],
        obstacles: [
            // =============================================
            // BODENSCHICHT (y=5, Lava-Optik)
            // =============================================
            { pos: [0, 3, 0], size: [180, 2, 180], kind: 'foam' },

            // =============================================
            // LABYRINTH-WAENDE (y=15, Hoehe=20)
            // Von Start (NW) zum Ziel (SO)
            // =============================================

            // --- Aeussere Umrandung ---
            { pos: [0, 15, -85], size: [180, 20, 6] },
            { pos: [0, 15, 85], size: [180, 20, 6] },
            { pos: [-88, 15, 0], size: [6, 20, 164] },
            { pos: [88, 15, 0], size: [6, 20, 164] },

            // --- Eingang (NW-Ecke) mit Tunnel ---
            { pos: [-88, 15, -60], size: [6, 20, 10], tunnel: { radius: 4.5, axis: 'z' } },

            // --- Horizontale Waende ---
            { pos: [-45, 15, -55], size: [70, 20, 5], tunnel: { radius: 4.5, axis: 'x' } },
            { pos: [40, 15, -55], size: [50, 20, 5] },

            { pos: [-20, 15, -25], size: [80, 20, 5], tunnel: { radius: 4.5, axis: 'x' } },
            { pos: [55, 15, -25], size: [40, 20, 5] },

            { pos: [-55, 15, 5], size: [50, 20, 5] },
            { pos: [15, 15, 5], size: [90, 20, 5], tunnel: { radius: 4.5, axis: 'x' } },

            { pos: [-30, 15, 35], size: [60, 20, 5], tunnel: { radius: 4.5, axis: 'x' } },
            { pos: [50, 15, 35], size: [50, 20, 5] },

            { pos: [0, 15, 60], size: [100, 20, 5] },
            { pos: [60, 15, 60], size: [30, 20, 5], tunnel: { radius: 4.5, axis: 'x' } },

            // --- Vertikale Waende ---
            { pos: [-55, 15, -40], size: [5, 20, 25] },
            { pos: [-25, 15, -70], size: [5, 20, 25] },
            { pos: [20, 15, -40], size: [5, 20, 25], tunnel: { radius: 4.0, axis: 'z' } },
            { pos: [55, 15, -68], size: [5, 20, 30] },

            { pos: [-55, 15, 20], size: [5, 20, 25] },
            { pos: [-20, 15, 20], size: [5, 20, 25], tunnel: { radius: 4.0, axis: 'z' } },
            { pos: [30, 15, 20], size: [5, 20, 25] },
            { pos: [65, 15, 12], size: [5, 20, 40] },

            { pos: [-45, 15, 50], size: [5, 20, 25] },
            { pos: [25, 15, 48], size: [5, 20, 20] },
            { pos: [55, 15, 50], size: [5, 20, 25] },

            // --- Sackgassen-Belohnungen (Items drin) ---
            // Sackgasse 1 (NO-Ecke)
            { pos: [70, 15, -70], size: [5, 20, 20] },
            // Sackgasse 2 (SW-Bucht)
            { pos: [-70, 15, 50], size: [5, 20, 20] },
            // Sackgasse 3 (Mitte-Sued)
            { pos: [10, 15, 70], size: [20, 20, 5] },

            // --- Foam-Huegel (Orientierungshilfe) ---
            { pos: [-60, 8, -65], size: [6, 6, 6], kind: 'foam' },
            { pos: [0, 8, 0], size: [8, 6, 8], kind: 'foam' },
            { pos: [70, 8, 70], size: [6, 6, 6], kind: 'foam' },
        ],
        portals: [
            // Hilfe-Portal: Mitte → nahe Ziel
            { a: [0, 10, 0], b: [50, 10, 50], color: 0x00ff88 },
            // Fallen-Portal: Sackgasse NO → zurueck zum Start
            { a: [75, 10, -75], b: [-80, 10, -75], color: 0xff4444 },
            // Verbindung: Sued-Mitte → Nord-Korridor
            { a: [0, 10, 55], b: [0, 10, -40], color: 0xffaa00 },
        ],
        gates: [
            {
                id: 'mm_boost_start',
                type: 'boost',
                pos: [-80, 10, -70],
                forward: [1, 0, 0],
                params: { duration: 1.4, forwardImpulse: 42, bonusSpeed: 52, cooldown: 1.0 },
            },
            {
                id: 'mm_boost_mid',
                type: 'boost',
                pos: [0, 10, 0],
                forward: [1, 0, 1],
                params: { duration: 1.2, forwardImpulse: 38, bonusSpeed: 48, cooldown: 1.0 },
            },
            {
                id: 'mm_boost_exit',
                type: 'boost',
                pos: [50, 10, 50],
                forward: [1, 0, 1],
                params: { duration: 1.0, forwardImpulse: 45, bonusSpeed: 55, cooldown: 0.8 },
            },
        ],
        playerSpawn: { x: -80, y: 10, z: -78 },
        botSpawns: [
            { x: -75, y: 10, z: -78 },
            { x: -80, y: 10, z: -72 },
            { x: -70, y: 10, z: -78 },
        ],
        items: [
            // Auf dem Weg
            { id: 'mm_speed_1', type: 'item_battery', pickupType: 'SPEED_UP', x: -45, y: 10, z: -55, weight: 1.5 },
            { id: 'mm_shield_2', type: 'item_shield', pickupType: 'SHIELD', x: -20, y: 10, z: -25, weight: 1.2 },
            { id: 'mm_speed_3', type: 'item_battery', pickupType: 'SPEED_UP', x: 15, y: 10, z: 5, weight: 1.4 },
            // Sackgassen-Belohnungen (Risk/Reward)
            { id: 'mm_rocket_dead1', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 75, y: 10, z: -65, weight: 0.6 },
            { id: 'mm_ghost_dead2', type: 'item_coin', pickupType: 'GHOST', x: -70, y: 10, z: 60, weight: 0.8 },
            { id: 'mm_thick_dead3', type: 'item_coin', pickupType: 'THICK', x: 10, y: 10, z: 75, weight: 0.7 },
            // Nahe Ziel
            { id: 'mm_speed_fin', type: 'item_battery', pickupType: 'SPEED_UP', x: 60, y: 10, z: 60, weight: 1.6 },
        ],
        aircraft: [
            { id: 'mm_air_1', jetId: 'ship6', x: 0, y: 35, z: 0, scale: 1.2, rotateY: 0.7 },
            { id: 'mm_air_2', jetId: 'aircraft', x: -60, y: 38, z: 60, scale: 1.0, rotateY: -1.2 },
        ],
        parcours: {
            enabled: true,
            routeId: 'magma_maze_v1',
            rules: {
                ordered: true,
                resetOnDeath: false,
                resetToLastValid: true,
                maxSegmentTimeMs: 25000,
                cooldownMs: 500,
                wrongOrderCooldownMs: 700,
                errorIndicatorMs: 1500,
                allowLaneAliases: false,
                winnerByParcoursComplete: true,
                animateCheckpoints: true,
            },
            checkpoints: [
                { id: 'CP01', type: 'entry',     pos: [-82, 10, -70],   radius: 7.0, forward: [1, 0, 0] },
                { id: 'CP02', type: 'tunnel',    pos: [-45, 15, -55],   radius: 4.5, forward: [1, 0, 0] },
                { id: 'CP03', type: 'gate',      pos: [-20, 10, -40],   radius: 5.5, forward: [0, 0, 1] },
                { id: 'CP04', type: 'tunnel',    pos: [-20, 15, -25],   radius: 4.5, forward: [1, 0, 0] },
                { id: 'CP05', type: 'gate',      pos: [15, 10, -10],    radius: 5.5, forward: [0, 0, 1] },
                { id: 'CP06', type: 'tunnel',    pos: [15, 15, 5],      radius: 4.5, forward: [1, 0, 0] },
                { id: 'CP07', type: 'gate',      pos: [40, 10, 20],     radius: 5.5, forward: [0, 0, 1] },
                { id: 'CP08', type: 'tunnel',    pos: [-30, 15, 35],    radius: 4.5, forward: [1, 0, 0] },
                { id: 'CP09', type: 'gate',      pos: [40, 10, 50],     radius: 5.5, forward: [1, 0, 0] },
                { id: 'CP10', type: 'tunnel',    pos: [60, 15, 60],     radius: 4.5, forward: [1, 0, 0] },
                { id: 'CP11', type: 'finish_pre', pos: [75, 10, 72],    radius: 5.5, forward: [1, 0, 0] },
            ],
            finish: { id: 'FINISH', type: 'finish', pos: [80, 10, 78], radius: 7.0, forward: [1, 0, 1] },
        },
    },
};
