// ============================================================
// Neon Circuit – Ovale Rennstrecke mit Tunnels
// Kreisfoermige Route, Boosts an Geraden, Kurven mit Leitplanken
// ============================================================

export const NEON_CIRCUIT_MAP = {
    neon_circuit: {
        name: 'Neon Circuit',
        size: [200, 60, 160],
        preferAuthoredPortals: true,
        portalLevels: [12, 25, 40],
        obstacles: [
            // =============================================
            // OVALE STRECKE (Uhrzeigersinn)
            // Start/Ziel: links (x=-80), Nordgerade, Ostkurve,
            // Suedgerade, Westkurve zurueck
            // =============================================

            // --- START/ZIEL-Gerade (Westen, z=0) ---
            { pos: [-80, 10, 0], size: [16, 4, 20], kind: 'foam' },

            // --- NORDGERADE (z = -50) ---
            // Leitplanken
            { pos: [0, 12, -58], size: [140, 4, 3] },
            { pos: [0, 12, -42], size: [140, 4, 3] },
            // Hindernisse auf der Geraden
            { pos: [-30, 10, -50], size: [6, 20, 6] },
            { pos: [10, 10, -50], size: [6, 20, 6] },
            { pos: [50, 10, -50], size: [6, 20, 6] },
            // Tunnel mitten auf der Geraden
            { pos: [0, 14, -50], size: [12, 28, 12], tunnel: { radius: 5.0, axis: 'x' } },

            // --- OSTKURVE (x ≈ 80) ---
            // Kurvenleitplanken (Foam – abprallend)
            { pos: [80, 10, -35], size: [8, 20, 8], kind: 'foam' },
            { pos: [85, 10, -20], size: [8, 20, 8], kind: 'foam' },
            { pos: [88, 10, 0], size: [8, 20, 8], kind: 'foam' },
            { pos: [85, 10, 20], size: [8, 20, 8], kind: 'foam' },
            { pos: [80, 10, 35], size: [8, 20, 8], kind: 'foam' },
            // Tube durch Kurve (Shortcut)
            { shape: 'tube', kind: 'hard', start: [70, 12, -40], end: [70, 12, 40], radius: 3.5 },

            // --- SUEDGERADE (z = 50) ---
            // Leitplanken
            { pos: [0, 12, 42], size: [140, 4, 3] },
            { pos: [0, 12, 58], size: [140, 4, 3] },
            // Schikane (Zickzack-Hindernisse)
            { pos: [-40, 10, 46], size: [8, 20, 4] },
            { pos: [-20, 10, 54], size: [8, 20, 4] },
            { pos: [0, 10, 46], size: [8, 20, 4] },
            { pos: [20, 10, 54], size: [8, 20, 4] },
            { pos: [40, 10, 46], size: [8, 20, 4] },

            // --- WESTKURVE (x ≈ -80) ---
            { pos: [-80, 10, -35], size: [8, 20, 8], kind: 'foam' },
            { pos: [-85, 10, -18], size: [8, 20, 8], kind: 'foam' },
            { pos: [-85, 10, 18], size: [8, 20, 8], kind: 'foam' },
            { pos: [-80, 10, 35], size: [8, 20, 8], kind: 'foam' },

            // --- ABKUERZUNGS-TUNNEL durch die Mitte ---
            { pos: [0, 14, 0], size: [120, 28, 10], tunnel: { radius: 4.0, axis: 'x' } },

            // --- Erhöhte Ebene ueber Start (Deko + Aussicht) ---
            { pos: [-80, 30, 0], size: [20, 3, 30] },

            // Deko-Saeulen
            { pos: [-90, 20, -65], size: [4, 40, 4] },
            { pos: [-90, 20, 65], size: [4, 40, 4] },
            { pos: [90, 20, -65], size: [4, 40, 4] },
            { pos: [90, 20, 65], size: [4, 40, 4] },
        ],
        portals: [
            // Nordgerade ↔ Suedgerade (riskant)
            { a: [0, 14, -50], b: [0, 14, 50], color: 0x00ff88 },
            // Ostkurve → Westkurve (Warp)
            { a: [80, 12, 0], b: [-80, 12, 0], color: 0xff44ff },
        ],
        gates: [
            // Boost auf Nordgeraden
            {
                id: 'nc_boost_north',
                type: 'boost',
                pos: [-50, 12, -50],
                forward: [1, 0, 0],
                params: { duration: 1.6, forwardImpulse: 52, bonusSpeed: 65, cooldown: 1.0 },
            },
            // Slingshot in Ostkurve
            {
                id: 'nc_sling_east',
                type: 'slingshot',
                pos: [75, 12, -40],
                forward: [0, 0, 1],
                up: [0, 1, 0],
                params: { duration: 1.4, forwardImpulse: 30, liftImpulse: 6, cooldown: 1.2 },
            },
            // Boost auf Suedgeraden
            {
                id: 'nc_boost_south',
                type: 'boost',
                pos: [50, 12, 50],
                forward: [-1, 0, 0],
                params: { duration: 1.6, forwardImpulse: 52, bonusSpeed: 65, cooldown: 1.0 },
            },
            // Slingshot in Westkurve
            {
                id: 'nc_sling_west',
                type: 'slingshot',
                pos: [-75, 12, 30],
                forward: [0, 0, -1],
                up: [0, 1, 0],
                params: { duration: 1.4, forwardImpulse: 30, liftImpulse: 6, cooldown: 1.2 },
            },
        ],
        playerSpawn: { x: -80, y: 14, z: 8 },
        botSpawns: [
            { x: -80, y: 14, z: -8 },
            { x: -75, y: 14, z: 8 },
            { x: -75, y: 14, z: -8 },
        ],
        items: [
            { id: 'nc_speed_n', type: 'item_battery', pickupType: 'SPEED_UP', x: 30, y: 12, z: -50, weight: 1.5 },
            { id: 'nc_shield_e', type: 'item_shield', pickupType: 'SHIELD', x: 82, y: 12, z: 0, weight: 1.2 },
            { id: 'nc_speed_s', type: 'item_battery', pickupType: 'SPEED_UP', x: -30, y: 12, z: 50, weight: 1.5 },
            { id: 'nc_ghost_w', type: 'item_coin', pickupType: 'GHOST', x: -82, y: 12, z: 0, weight: 1.0 },
            { id: 'nc_rocket_mid', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 0, y: 14, z: 0, weight: 0.8 },
            { id: 'nc_thick_sch', type: 'item_coin', pickupType: 'THICK', x: -10, y: 12, z: 50, weight: 0.9 },
        ],
        aircraft: [
            { id: 'nc_air_1', jetId: 'ship5', x: 0, y: 45, z: 0, scale: 1.5, rotateY: 0 },
            { id: 'nc_air_2', jetId: 'ship3', x: 80, y: 40, z: -50, scale: 1.0, rotateY: 1.2 },
        ],
        parcours: {
            enabled: true,
            routeId: 'neon_circuit_v1',
            rules: {
                ordered: true,
                resetOnDeath: true,
                resetToLastValid: false,
                maxSegmentTimeMs: 16000,
                cooldownMs: 400,
                wrongOrderCooldownMs: 600,
                errorIndicatorMs: 1200,
                allowLaneAliases: false,
                winnerByParcoursComplete: true,
                animateCheckpoints: true,
            },
            checkpoints: [
                { id: 'CP01', type: 'entry',     pos: [-80, 14, -6],    radius: 6.5, forward: [0, 0, -1] },
                { id: 'CP02', type: 'gate',      pos: [-50, 12, -50],   radius: 5.5, forward: [1, 0, 0] },
                { id: 'CP03', type: 'tunnel',    pos: [0, 14, -50],     radius: 5.0, forward: [1, 0, 0] },
                { id: 'CP04', type: 'gate',      pos: [60, 12, -50],    radius: 5.5, forward: [1, 0, 0] },
                { id: 'CP05', type: 'gate',      pos: [78, 12, 0],      radius: 5.5, forward: [0, 0, 1] },
                { id: 'CP06', type: 'gate',      pos: [50, 12, 50],     radius: 5.5, forward: [-1, 0, 0] },
                { id: 'CP07', type: 'gate',      pos: [0, 12, 50],      radius: 5.5, forward: [-1, 0, 0] },
                { id: 'CP08', type: 'gate',      pos: [-50, 12, 50],    radius: 5.5, forward: [-1, 0, 0] },
                { id: 'CP09', type: 'gate',      pos: [-70, 12, 0],     radius: 5.5, forward: [0, 0, -1] },
                { id: 'CP10', type: 'finish_pre', pos: [-70, 14, -20],  radius: 5.5, forward: [0, 0, -1] },
            ],
            finish: { id: 'FINISH', type: 'finish', pos: [-70, 14, -35], radius: 7.0, forward: [0, 0, -1] },
        },
    },
};
