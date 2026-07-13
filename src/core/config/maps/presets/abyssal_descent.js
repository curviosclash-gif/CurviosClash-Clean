// ============================================================
// Abyssal Descent – Vertikaler Abstieg durch Hindernisringe
// Schmaler Schacht, Ringe durchfliegen, 60s Zeitlimit
// ============================================================

export const ABYSSAL_DESCENT_MAP = {
    abyssal_descent: {
        name: 'Abyssal Descent',
        size: [80, 200, 80],
        preferAuthoredPortals: true,
        portalLevels: [20, 60, 100, 140, 180],
        obstacles: [
            // =============================================
            // Startplattform (Oben, y ≈ 185)
            // =============================================
            { pos: [0, 185, 0], size: [20, 4, 20], kind: 'foam' },

            // =============================================
            // RING 1 (y ≈ 170) – Einfach, grosses Loch
            // =============================================
            { pos: [0, 170, 0], size: [35, 6, 35], tunnel: { radius: 8.0, axis: 'y' } },

            // =============================================
            // RING 2 (y ≈ 150) – X-Achse Tunnel
            // =============================================
            { pos: [0, 150, 0], size: [35, 8, 20], tunnel: { radius: 6.0, axis: 'x' } },
            // Seitliche Blocker
            { pos: [-20, 150, -12], size: [6, 8, 6] },
            { pos: [20, 150, 12], size: [6, 8, 6] },

            // Foam-Bremser
            { pos: [0, 143, 0], size: [10, 3, 10], kind: 'foam' },

            // =============================================
            // RING 3 (y ≈ 130) – Z-Achse Tunnel (Rotation!)
            // =============================================
            { pos: [0, 130, 0], size: [20, 8, 35], tunnel: { radius: 6.0, axis: 'z' } },
            { pos: [12, 130, -20], size: [6, 8, 6] },
            { pos: [-12, 130, 20], size: [6, 8, 6] },

            // =============================================
            // RING 4 (y ≈ 110) – Doppel-Tunnel (Split)
            // =============================================
            { pos: [-10, 110, 0], size: [14, 8, 30], tunnel: { radius: 4.5, axis: 'z' } },
            { pos: [10, 110, 0], size: [14, 8, 30], tunnel: { radius: 4.5, axis: 'z' } },
            // Mittlere Trennwand
            { pos: [0, 110, 0], size: [3, 8, 30] },

            // Foam-Auffang
            { pos: [0, 103, 0], size: [14, 3, 14], kind: 'foam' },

            // =============================================
            // RING 5 (y ≈ 90) – Kleines Loch (Praezision)
            // =============================================
            { pos: [0, 90, 0], size: [35, 8, 35], tunnel: { radius: 4.0, axis: 'y' } },
            // Hindernisse um das Loch
            { pos: [5, 86, 5], size: [3, 4, 3] },
            { pos: [-5, 86, -5], size: [3, 4, 3] },

            // =============================================
            // RING 6 (y ≈ 70) – Schraeger Tube
            // =============================================
            { shape: 'tube', kind: 'hard', start: [10, 78, 0], end: [-10, 62, 0], radius: 5.5 },
            // Seitliche Waende
            { pos: [20, 70, 0], size: [6, 20, 30] },
            { pos: [-20, 70, 0], size: [6, 20, 30] },

            // =============================================
            // RING 7 (y ≈ 50) – X-Tunnel + Blocker
            // =============================================
            { pos: [0, 50, 0], size: [35, 8, 20], tunnel: { radius: 5.0, axis: 'x' } },
            { pos: [0, 50, 14], size: [10, 8, 6] },
            { pos: [0, 50, -14], size: [10, 8, 6] },

            // Foam-Zone
            { pos: [0, 43, 0], size: [12, 3, 12], kind: 'foam' },

            // =============================================
            // RING 8 (y ≈ 30) – Engster Ring
            // =============================================
            { pos: [0, 30, 0], size: [35, 10, 35], tunnel: { radius: 3.5, axis: 'y' } },

            // =============================================
            // Zielplattform (Unten, y ≈ 10)
            // =============================================
            { pos: [0, 10, 0], size: [24, 4, 24], kind: 'foam' },
            // Stuetzsaeulen
            { pos: [-14, 6, -14], size: [3, 12, 3] },
            { pos: [14, 6, -14], size: [3, 12, 3] },
            { pos: [-14, 6, 14], size: [3, 12, 3] },
            { pos: [14, 6, 14], size: [3, 12, 3] },

            // Schacht-Waende (aussen)
            { pos: [-35, 100, -35], size: [4, 200, 4] },
            { pos: [35, 100, -35], size: [4, 200, 4] },
            { pos: [-35, 100, 35], size: [4, 200, 4] },
            { pos: [35, 100, 35], size: [4, 200, 4] },
        ],
        portals: [
            // Rettung: Boden → Start
            { a: [0, 13, 10], b: [0, 188, 0], color: 0x4488ff },
        ],
        gates: [
            {
                id: 'ad_boost_start',
                type: 'boost',
                pos: [0, 183, 0],
                forward: [0, -1, 0],
                params: { duration: 1.0, forwardImpulse: 35, bonusSpeed: 45, cooldown: 1.0 },
            },
            {
                id: 'ad_boost_mid',
                type: 'boost',
                pos: [0, 105, 0],
                forward: [0, -1, 0],
                params: { duration: 0.8, forwardImpulse: 40, bonusSpeed: 50, cooldown: 0.8 },
            },
            {
                id: 'ad_boost_deep',
                type: 'boost',
                pos: [0, 45, 0],
                forward: [0, -1, 0],
                params: { duration: 0.6, forwardImpulse: 50, bonusSpeed: 60, cooldown: 0.6 },
            },
        ],
        playerSpawn: { x: -8, y: 190, z: 0 },
        botSpawns: [
            { x: 8, y: 190, z: 0 },
            { x: 0, y: 190, z: -8 },
            { x: 0, y: 190, z: 8 },
        ],
        items: [
            { id: 'ad_speed_1', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 160, z: 0, weight: 1.4 },
            { id: 'ad_shield_2', type: 'item_shield', pickupType: 'SHIELD', x: 0, y: 120, z: 0, weight: 1.2 },
            { id: 'ad_ghost_3', type: 'item_coin', pickupType: 'GHOST', x: 0, y: 80, z: 0, weight: 1.0 },
            { id: 'ad_speed_4', type: 'item_battery', pickupType: 'SPEED_UP', x: 0, y: 40, z: 0, weight: 1.5 },
        ],
        aircraft: [
            { id: 'ad_air_1', jetId: 'ship1', x: 0, y: 100, z: 0, scale: 0.6, rotateY: 0 },
        ],
        parcours: {
            enabled: true,
            routeId: 'abyssal_descent_v1',
            rules: {
                ordered: true,
                resetOnDeath: true,
                resetToLastValid: false,
                maxSegmentTimeMs: 12000,
                cooldownMs: 350,
                wrongOrderCooldownMs: 500,
                errorIndicatorMs: 1000,
                allowLaneAliases: true,
                winnerByParcoursComplete: true,
                animateCheckpoints: true,
            },
            checkpoints: [
                { id: 'CP01', type: 'entry',     pos: [0, 189, 0],      radius: 7.0, forward: [0, -1, 0] },
                { id: 'CP02', type: 'tunnel',    pos: [0, 170, 0],      radius: 5.5, forward: [0, -1, 0] },
                { id: 'CP03', type: 'gate',      pos: [0, 155, 0],      radius: 5.5, forward: [0, -1, 0] },
                { id: 'CP04', type: 'gate',      pos: [0, 135, 0],      radius: 5.5, forward: [0, -1, 0] },
                { id: 'CP05', type: 'split',     pos: [-10, 115, 0],    radius: 5.0, forward: [0, -1, 0] },
                { id: 'CP05_R', type: 'split',   aliasOf: 'CP05', pos: [10, 115, 0], radius: 5.0, forward: [0, -1, 0] },
                { id: 'CP06', type: 'precision', pos: [0, 95, 0],       radius: 4.0, forward: [0, -1, 0] },
                { id: 'CP07', type: 'gate',      pos: [0, 75, 0],       radius: 5.0, forward: [0, -1, 0] },
                { id: 'CP08', type: 'tunnel',    pos: [0, 50, 0],       radius: 5.0, forward: [0, -1, 0] },
                { id: 'CP09', type: 'precision', pos: [0, 35, 0],       radius: 3.5, forward: [0, -1, 0] },
                { id: 'CP10', type: 'finish_pre', pos: [0, 18, 0],      radius: 5.5, forward: [0, -1, 0] },
            ],
            finish: { id: 'FINISH', type: 'finish', pos: [0, 14, 0], radius: 7.0, forward: [0, -1, 0] },
        },
    },
};
