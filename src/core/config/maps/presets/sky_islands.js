// ============================================================
// Sky Islands – Schwebende Inseln in der Luft
// Kein Boden, alles offene Luft, Praezisions-Spruenge
// Foam-Rettungsfelder als einziger Schutz
// ============================================================

export const SKY_ISLANDS_MAP = {
    sky_islands: {
        name: 'Sky Islands',
        size: [200, 110, 200],
        preferAuthoredPortals: true,
        portalLevels: [20, 40, 60, 80],
        obstacles: [
            // =============================================
            // INSEL 1: Startinsel (gross, sicher)
            // =============================================
            { pos: [-70, 30, 0], size: [22, 5, 22], kind: 'foam' },
            { pos: [-70, 25, -8], size: [4, 10, 4] },
            { pos: [-70, 25, 8], size: [4, 10, 4] },

            // =============================================
            // INSEL 2: Sprungbrett (schmal)
            // =============================================
            { pos: [-40, 35, -15], size: [10, 3, 8] },

            // =============================================
            // INSEL 3: Trampolin-Insel
            // =============================================
            { pos: [-15, 42, -25], size: [14, 4, 14], kind: 'foam' },
            { pos: [-15, 38, -25], size: [6, 8, 6] },

            // =============================================
            // INSEL 4: Turm-Insel (vertikal)
            // =============================================
            { pos: [10, 40, -10], size: [8, 30, 8] },
            { pos: [10, 56, -10], size: [14, 3, 14] },

            // =============================================
            // INSEL 5: Bruecken-Insel (mit schmaler Verbindung)
            // =============================================
            { pos: [30, 58, 10], size: [12, 3, 12] },
            { pos: [42, 59, 10], size: [12, 2, 4] },
            { pos: [54, 60, 10], size: [10, 3, 10] },

            // =============================================
            // INSEL 6: Praezisions-Archipel (4 Mini-Inseln)
            // =============================================
            { pos: [60, 62, -10], size: [5, 2, 5] },
            { pos: [68, 64, -18], size: [5, 2, 5] },
            { pos: [74, 66, -8], size: [5, 2, 5] },
            { pos: [80, 68, 0], size: [5, 2, 5] },

            // =============================================
            // INSEL 7: Grosse Sammelinsel
            // =============================================
            { pos: [70, 70, 20], size: [18, 4, 18] },
            { pos: [70, 66, 20], size: [6, 8, 6] },

            // =============================================
            // INSEL 8: Zielinsel (Himmelstempel)
            // =============================================
            { pos: [50, 80, 50], size: [20, 5, 20], kind: 'foam' },
            { pos: [50, 75, 50], size: [8, 10, 8] },
            { pos: [44, 83, 44], size: [3, 10, 3] },
            { pos: [56, 83, 56], size: [3, 10, 3] },
            { pos: [44, 83, 56], size: [3, 10, 3] },
            { pos: [56, 83, 44], size: [3, 10, 3] },

            // =============================================
            // RETTUNGSFELDER (Foam, weit unten)
            // =============================================
            { pos: [-20, 15, -15], size: [40, 4, 40], kind: 'foam' },
            { pos: [50, 15, 10], size: [50, 4, 40], kind: 'foam' },
            { pos: [50, 15, 50], size: [30, 4, 30], kind: 'foam' },

            // Deko-Wolken (Foam)
            { pos: [-80, 60, 50], size: [10, 3, 6], kind: 'foam' },
            { pos: [0, 75, -50], size: [8, 3, 5], kind: 'foam' },
            { pos: [85, 55, -30], size: [6, 3, 8], kind: 'foam' },
        ],
        portals: [
            // Rettungsfeld → zurueck zur letzten grossen Insel
            { a: [-20, 18, -15], b: [-15, 44, -25], color: 0x88ccff },
            { a: [50, 18, 10], b: [70, 73, 20], color: 0x88ccff },
            // Shortcut Insel 3 → Insel 7 (riskant)
            { a: [-15, 45, -18], b: [70, 73, 14], color: 0xff8800 },
        ],
        gates: [
            {
                id: 'si_sling_start',
                type: 'slingshot',
                pos: [-65, 34, 0],
                forward: [1, 0.3, -0.5],
                up: [0, 1, 0],
                params: { duration: 1.6, forwardImpulse: 32, liftImpulse: 14, cooldown: 1.4 },
            },
            {
                id: 'si_sling_turm',
                type: 'slingshot',
                pos: [10, 58, -10],
                forward: [1, 0.2, 1],
                up: [0, 1, 0],
                params: { duration: 1.4, forwardImpulse: 28, liftImpulse: 10, cooldown: 1.2 },
            },
            {
                id: 'si_sling_sammel',
                type: 'slingshot',
                pos: [70, 73, 20],
                forward: [-0.5, 0.4, 1],
                up: [0, 1, 0],
                params: { duration: 2.0, forwardImpulse: 24, liftImpulse: 16, cooldown: 1.6 },
            },
        ],
        playerSpawn: { x: -78, y: 34, z: 0 },
        botSpawns: [
            { x: -62, y: 34, z: 0 },
            { x: -70, y: 34, z: -8 },
            { x: -70, y: 34, z: 8 },
        ],
        items: [
            { id: 'si_speed_1', type: 'item_battery', pickupType: 'SPEED_UP', x: -40, y: 38, z: -15, weight: 1.4 },
            { id: 'si_shield_tramp', type: 'item_shield', pickupType: 'SHIELD', x: -15, y: 46, z: -25, weight: 1.2 },
            { id: 'si_ghost_bridge', type: 'item_coin', pickupType: 'GHOST', x: 42, y: 62, z: 10, weight: 1.0 },
            { id: 'si_speed_prec', type: 'item_battery', pickupType: 'SPEED_UP', x: 68, y: 66, z: -18, weight: 0.8 },
            { id: 'si_rocket_sammel', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 70, y: 73, z: 20, weight: 1.1 },
            { id: 'si_thick_ziel', type: 'item_coin', pickupType: 'THICK', x: 50, y: 84, z: 50, weight: 0.7 },
        ],
        aircraft: [
            { id: 'si_air_1', jetId: 'ship4', x: 0, y: 90, z: 0, scale: 1.5, rotateY: 0.5 },
            { id: 'si_air_2', jetId: 'ship8', x: -50, y: 50, z: -40, scale: 1.0, rotateY: -1.0 },
        ],
        parcours: {
            enabled: true,
            routeId: 'sky_islands_v1',
            rules: {
                ordered: true,
                resetOnDeath: true,
                resetToLastValid: false,
                maxSegmentTimeMs: 22000,
                cooldownMs: 450,
                wrongOrderCooldownMs: 650,
                errorIndicatorMs: 1400,
                allowLaneAliases: false,
                winnerByParcoursComplete: true,
                animateCheckpoints: true,
            },
            checkpoints: [
                { id: 'CP01', type: 'entry',     pos: [-70, 35, 0],     radius: 7.0, forward: [1, 0, -1] },
                { id: 'CP02', type: 'gate',      pos: [-40, 38, -15],   radius: 5.5, forward: [1, 0.3, -0.5] },
                { id: 'CP03', type: 'gate',      pos: [-15, 47, -25],   radius: 5.5, forward: [1, 0.3, 0] },
                { id: 'CP04', type: 'gate',      pos: [10, 59, -10],    radius: 5.5, forward: [1, 0, 1] },
                { id: 'CP05', type: 'gate',      pos: [30, 62, 10],     radius: 5.5, forward: [1, 0, 0] },
                { id: 'CP06', type: 'precision', pos: [80, 71, 0],      radius: 4.0, forward: [0, 0, 1] },
                { id: 'CP07', type: 'gate',      pos: [70, 75, 20],     radius: 5.5, forward: [-1, 0.3, 1] },
                { id: 'CP08', type: 'finish_pre', pos: [50, 84, 42],    radius: 5.5, forward: [0, 0, 1] },
            ],
            finish: { id: 'FINISH', type: 'finish', pos: [50, 87, 50], radius: 7.0, forward: [0, 0, 1] },
        },
    },
};
