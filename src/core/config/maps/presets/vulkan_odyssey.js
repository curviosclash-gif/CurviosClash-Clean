// ============================================================
// Vulkan Odyssey v2 – Epischer 5-Akt-Parcours
// P1: Lava-Sprint (Tempo, Warm-up)
// P2: Magma-Spirale (Vertikaler Aufstieg)
// P3: Obsidian-Grat (Praezision, schmale Bruecken)
// P4: Krater-Labyrinth (Split-Entscheidung, Tunnels)
// P5: Gipfel-Sprint (Boost-Finale)
// ============================================================

export const VULKAN_ODYSSEY_MAP = {
    vulkan_odyssey: {
        name: 'Vulkan Odyssey',
        size: [320, 110, 200],
        preferAuthoredPortals: true,
        portalLevels: [15, 35, 55, 75, 95],
        obstacles: [
            // =============================================
            // PHASE 1: Lava-Sprint (y ≈ 8–20)
            // Schneller Einstieg, Slalom, Tunnel
            // =============================================

            // Startplattform – breit, Foam fuer sanfte Landung
            { pos: [-145, 8, 0], size: [16, 16, 30], kind: 'foam' },

            // Lava-Saeulen-Slalom (abwechselnd links/rechts)
            { pos: [-120, 10, -12], size: [5, 20, 5] },
            { pos: [-112, 10, 12], size: [5, 20, 5] },
            { pos: [-104, 10, -12], size: [5, 20, 5] },
            { pos: [-96, 10, 12], size: [5, 20, 5] },

            // Hoehlenwand mit grossem Tunnel
            { pos: [-80, 14, 0], size: [10, 28, 50], tunnel: { radius: 6.5, axis: 'x' } },

            // Seitliche Hoehlenwaende (Korridor-Feeling)
            { pos: [-80, 14, -30], size: [10, 28, 8] },
            { pos: [-80, 14, 30], size: [10, 28, 8] },

            // Foam-Abfederungsfeld nach Tunnel
            { pos: [-64, 6, -12], size: [8, 4, 8], kind: 'foam' },
            { pos: [-64, 6, 0], size: [8, 4, 8], kind: 'foam' },
            { pos: [-64, 6, 12], size: [8, 4, 8], kind: 'foam' },

            // Zweite Wand mit zwei schmalen Tunneln
            { pos: [-50, 14, -14], size: [8, 28, 10], tunnel: { radius: 3.5, axis: 'x' } },
            { pos: [-50, 14, 14], size: [8, 28, 10], tunnel: { radius: 3.5, axis: 'x' } },

            // =============================================
            // PHASE 2: Magma-Spirale (y ≈ 15–55)
            // Vertikaler Aufstieg, Slingshot, Bouncer
            // =============================================

            // Rampe / Tube schraeg nach oben
            { shape: 'tube', kind: 'hard', start: [-40, 14, 0], end: [-15, 34, -20], radius: 5.0 },

            // Magma-Kammer – vertikaler Durchstieg
            { pos: [-15, 30, -20], size: [16, 24, 16], tunnel: { radius: 5.5, axis: 'y' } },

            // Seitliche Kammer-Waende (Trichter-Effekt)
            { pos: [-28, 35, -30], size: [6, 16, 10] },
            { pos: [-2, 35, -30], size: [6, 16, 10] },

            // Foam-Bouncer-Treppe (Spirale nach oben)
            { pos: [-10, 38, -8], size: [6, 3, 6], kind: 'foam' },
            { pos: [-2, 42, 2], size: [6, 3, 6], kind: 'foam' },
            { pos: [6, 46, -6], size: [6, 3, 6], kind: 'foam' },
            { pos: [14, 50, 4], size: [6, 3, 6], kind: 'foam' },
            { pos: [22, 54, -4], size: [8, 3, 8], kind: 'foam' },

            // Verbindungs-Tube von Bouncer-Top zur Phase 3
            { shape: 'tube', kind: 'hard', start: [22, 54, -4], end: [40, 56, 0], radius: 4.5 },

            // =============================================
            // PHASE 3: Obsidian-Grat (y ≈ 55–72)
            // Praezision, schmale Bruecken, Mini-Plattformen
            // =============================================

            // Ankunfts-Plattform
            { pos: [44, 55, 0], size: [14, 3, 14] },

            // Schmale Bruecke vorwaerts (nur 4 breit!)
            { pos: [60, 57, 0], size: [18, 2, 4] },

            // Mini-Plattform am Brueckenende
            { pos: [72, 58, 0], size: [8, 3, 8] },

            // Praezisions-Sprungfolge (3 kleine Bloecke, Zickzack)
            { pos: [80, 60, -8], size: [7, 2, 7] },
            { pos: [88, 62, 6], size: [7, 2, 7] },
            { pos: [96, 64, -4], size: [7, 2, 7] },

            // Foam-Auffangfeld darunter (Rettung, aber Zeitverlust)
            { pos: [88, 48, 0], size: [36, 4, 24], kind: 'foam' },

            // Sammelplattform nach Praezision
            { pos: [104, 65, 0], size: [10, 3, 12] },

            // Obsidian-Turm mit Tunnel (Uebergang Phase 4)
            { pos: [114, 60, 0], size: [10, 28, 10], tunnel: { radius: 4.5, axis: 'x' } },

            // =============================================
            // PHASE 4: Krater-Labyrinth (y ≈ 65–90)
            // Split-Entscheidung, Tunnels, Chaos
            // =============================================

            // Krater-Eingangsplattform (nach Turm-Tunnel)
            { pos: [124, 66, 0], size: [10, 3, 20] },

            // Kraterwand links
            { pos: [132, 75, -35], size: [6, 24, 8] },
            // Kraterwand rechts
            { pos: [132, 75, 35], size: [6, 24, 8] },

            // --- SPLIT LINKS: Foam-Trampolin-Kette (sicher, langsam) ---
            { pos: [130, 70, -22], size: [8, 3, 8], kind: 'foam' },
            { pos: [136, 76, -22], size: [8, 3, 8], kind: 'foam' },
            { pos: [142, 82, -22], size: [8, 3, 8], kind: 'foam' },

            // --- SPLIT RECHTS: Enge Tube (schnell, riskant) ---
            { shape: 'tube', kind: 'hard', start: [126, 68, 20], end: [146, 83, 20], radius: 4.0 },

            // Sammelplattform nach Split
            { pos: [150, 84, 0], size: [14, 3, 30] },

            // =============================================
            // PHASE 5: Gipfel-Sprint (y ≈ 84–105)
            // Boost, immer kleinere Plattformen, Finale
            // =============================================

            // Aufstiegsplattform 1 (breit)
            { pos: [160, 88, 0], size: [12, 3, 20] },

            // Aufstiegsplattform 2 (mittel)
            { pos: [168, 92, 0], size: [8, 3, 14] },

            // Aufstiegsplattform 3 (schmal)
            { pos: [174, 96, 0], size: [6, 3, 8] },

            // Ziel-Plattform (Vulkanspitze) – Foam fuer weiche Landung
            { pos: [180, 100, 0], size: [14, 4, 14], kind: 'foam' },

            // =============================================
            // DEKORATIVE ELEMENTE
            // =============================================

            // Lava-Felsen (Arena-Saeulen)
            { pos: [-145, 40, -85], size: [5, 80, 5] },
            { pos: [-145, 40, 85], size: [5, 80, 5] },
            { pos: [155, 40, -85], size: [5, 80, 5] },
            { pos: [155, 40, 85], size: [5, 80, 5] },

            // Haengende Stalaktiten (Hindernis + Rettung)
            { pos: [-100, 48, -35], size: [3, 14, 3], kind: 'foam' },
            { pos: [-60, 42, 25], size: [3, 12, 3], kind: 'foam' },
            { pos: [50, 78, -40], size: [3, 16, 3], kind: 'foam' },
            { pos: [130, 95, 50], size: [3, 18, 3], kind: 'foam' },

            // Stalaktiten entlang der Route (lebende Hindernisse)
            { pos: [-108, 30, 0], size: [3, 10, 3], kind: 'foam' },
            { pos: [60, 72, 0], size: [3, 10, 3], kind: 'foam' },
            { pos: [88, 76, 6], size: [3, 12, 3], kind: 'foam' },
            { pos: [160, 100, -8], size: [3, 10, 3], kind: 'foam' },

            // Geheimer Speedrun-Shortcut P2→P4 (extrem eng!)
            { shape: 'tube', kind: 'hard', start: [-10, 44, -20], end: [114, 60, 0], radius: 3.0 },
        ],
        portals: [
            // Phase 1 → Phase 2 Shortcut (riskant – ueberspringt Slalom)
            { a: [-120, 12, 20], b: [-15, 44, -20], color: 0xff4400 },
            // Phase 3 Auffangfeld → zurueck auf Grat
            { a: [88, 50, 0], b: [72, 60, 0], color: 0x00ccff },
            // P5 Fehlschuss → zurueck zu CP10
            { a: [175, 92, 12], b: [150, 86, 0], color: 0xffaa00 },
            // Notfall: Krater → Start
            { a: [124, 68, 16], b: [-140, 10, 0], color: 0xff0044 },
        ],
        gates: [
            // P1: Einstiegs-Boost (Sprint durch Slalom)
            {
                id: 'vod_boost_start',
                type: 'boost',
                pos: [-140, 10, 0],
                forward: [1, 0, 0],
                params: { duration: 1.8, forwardImpulse: 48, bonusSpeed: 58, cooldown: 1.2 },
            },
            // P2: Slingshot nach oben (Aufstieg)
            {
                id: 'vod_slingshot_rise',
                type: 'slingshot',
                pos: [-40, 14, 0],
                forward: [1, 0.6, -0.4],
                up: [0, 1, 0],
                params: { duration: 2.0, forwardImpulse: 30, liftImpulse: 20, cooldown: 1.6 },
            },
            // P2: Boost durch Magma-Kammer (nach oben)
            {
                id: 'vod_boost_magma',
                type: 'boost',
                pos: [-15, 44, -20],
                forward: [0.5, 0.8, 0.3],
                params: { duration: 1.0, forwardImpulse: 32, bonusSpeed: 40, cooldown: 1.0 },
            },
            // P3: Slingshot auf Obsidian-Grat
            {
                id: 'vod_slingshot_obsidian',
                type: 'slingshot',
                pos: [40, 58, 0],
                forward: [1, 0, 0],
                up: [0, 1, 0],
                params: { duration: 1.4, forwardImpulse: 28, liftImpulse: 8, cooldown: 1.4 },
            },
            // P4: Boost ins Krater-Labyrinth
            {
                id: 'vod_boost_crater',
                type: 'boost',
                pos: [120, 68, 0],
                forward: [1, 0, 0],
                params: { duration: 1.2, forwardImpulse: 40, bonusSpeed: 48, cooldown: 1.0 },
            },
            // P5: Finaler Sprint-Boost
            {
                id: 'vod_boost_finale',
                type: 'boost',
                pos: [156, 90, 0],
                forward: [1, 0.3, 0],
                params: { duration: 0.9, forwardImpulse: 55, bonusSpeed: 68, cooldown: 0.6 },
            },
        ],
        playerSpawn: { x: -157, y: 10, z: 0 },
        botSpawns: [
            { x: -157, y: 10, z: -10 },
            { x: -157, y: 10, z: 10 },
            { x: -157, y: 10, z: -22 },
            { x: -157, y: 10, z: 22 },
        ],
        items: [
            // P1: Lava-Sprint
            { id: 'vod_speed_slalom', type: 'item_battery', pickupType: 'SPEED_UP', x: -108, y: 12, z: 0, weight: 1.5 },
            { id: 'vod_shield_tunnel', type: 'item_shield', pickupType: 'SHIELD', x: -80, y: 14, z: 0, weight: 1.2 },
            // P2: Magma-Spirale
            { id: 'vod_speed_magma', type: 'item_battery', pickupType: 'SPEED_UP', x: -2, y: 44, z: 2, weight: 1.4 },
            { id: 'vod_ghost_climb', type: 'item_coin', pickupType: 'GHOST', x: 14, y: 52, z: 4, weight: 1.0 },
            // P3: Obsidian-Grat (Items auf Praezisions-Bloecken = Risk/Reward)
            { id: 'vod_shield_grat', type: 'item_shield', pickupType: 'SHIELD', x: 60, y: 60, z: 0, weight: 1.3 },
            { id: 'vod_speed_prec1', type: 'item_battery', pickupType: 'SPEED_UP', x: 80, y: 62, z: -8, weight: 0.9 },
            { id: 'vod_ghost_prec2', type: 'item_coin', pickupType: 'GHOST', x: 88, y: 64, z: 6, weight: 1.1 },
            { id: 'vod_speed_prec3', type: 'item_battery', pickupType: 'SPEED_UP', x: 96, y: 66, z: -4, weight: 0.8 },
            // P4: Krater-Labyrinth
            { id: 'vod_rocket_split_l', type: 'item_rocket', pickupType: 'ROCKET_WEAK', x: 136, y: 78, z: -22, weight: 1.1 },
            { id: 'vod_thick_split_r', type: 'item_coin', pickupType: 'THICK', x: 136, y: 76, z: 20, weight: 0.8 },
            // P5: Gipfel-Sprint
            { id: 'vod_rocket_gipfel', type: 'item_rocket', pickupType: 'ROCKET_HEAVY', x: 168, y: 94, z: 0, weight: 0.7 },
            { id: 'vod_speed_finale', type: 'item_battery', pickupType: 'SPEED_UP', x: 174, y: 98, z: 0, weight: 1.8 },
        ],
        aircraft: [
            { id: 'vod_air_1', jetId: 'ship3', x: -70, y: 50, z: -55, scale: 1.2, rotateY: 0.6 },
            { id: 'vod_air_2', jetId: 'ship6', x: 60, y: 75, z: 50, scale: 1.1, rotateY: -1.1 },
            { id: 'vod_air_3', jetId: 'aircraft', x: 150, y: 100, z: -45, scale: 1.4, rotateY: 1.57 },
            { id: 'vod_air_4', jetId: 'ship1', x: 96, y: 78, z: 35, scale: 0.9, rotateY: -0.8 },
            { id: 'vod_air_5', jetId: 'ship7', x: 136, y: 92, z: -40, scale: 1.0, rotateY: 2.1 },
        ],
        parcours: {
            enabled: true,
            routeId: 'vulkan_odyssey_v2',
            rules: {
                ordered: true,
                resetOnDeath: true,
                resetToLastValid: false,
                maxSegmentTimeMs: 20000,
                cooldownMs: 450,
                wrongOrderCooldownMs: 650,
                errorIndicatorMs: 1400,
                allowLaneAliases: true,
                winnerByParcoursComplete: true,
                animateCheckpoints: true,
            },
            checkpoints: [
                // P1: Lava-Sprint
                { id: 'CP01', type: 'entry',     pos: [-155, 10, 0],    radius: 7.0, forward: [1, 0, 0] },
                { id: 'CP02', type: 'tunnel',    pos: [-80, 14, 0],     radius: 5.5, forward: [1, 0, 0] },
                { id: 'CP03', type: 'gate',      pos: [-50, 14, 0],     radius: 5.5, forward: [1, 0, 0] },
                // P2: Magma-Spirale
                { id: 'CP04', type: 'gate',      pos: [-15, 44, -20],   radius: 5.5, forward: [0, 1, 0.5] },
                { id: 'CP05', type: 'gate',      pos: [22, 61, -4],     radius: 5.5, forward: [1, 0, 0] },
                // P3: Obsidian-Grat
                { id: 'CP06', type: 'gate',      pos: [44, 59, 0],      radius: 5.5, forward: [1, 0, 0] },
                { id: 'CP07', type: 'precision', pos: [96, 67, -4],     radius: 4.0, forward: [1, 0, 0] },
                // P4: Krater-Labyrinth
                { id: 'CP08', type: 'tunnel',    pos: [114, 60, 0],     radius: 4.5, forward: [1, 0, 0] },
                { id: 'CP09', type: 'split',     pos: [142, 85, -22],   radius: 5.5, forward: [1, 0, 0] },
                { id: 'CP09_R', type: 'split',   aliasOf: 'CP09', pos: [146, 85, 20], radius: 5.5, forward: [1, 0, 0] },
                { id: 'CP10', type: 'gate',      pos: [150, 88, 0],     radius: 5.5, forward: [1, 0, 0] },
                // P5: Gipfel-Sprint
                { id: 'CP11', type: 'gate',      pos: [168, 96, 0],     radius: 5.0, forward: [1, 0, 0] },
                { id: 'CP12', type: 'finish_pre', pos: [170, 99, 0],    radius: 5.0, forward: [1, 0, 0] },
            ],
            finish: { id: 'FINISH', type: 'finish', pos: [180, 106, 0], radius: 7.0, forward: [1, 0, 0] },
        },
    },
};
