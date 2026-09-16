// ============================================
// Clockwork Canyon - Boden-Ebene (y: 0-18)
// Wüsten-Canyon mit erodierten Felsen und
// verstreuten Zahnrad-Trümmern der Uhrwerk-Maschine
// ============================================

export const CLOCKWORK_CANYON_FLOOR_OBSTACLES = [
    // --- Canyon-Randwände (äußerer Rand, Ost/West) ---
    { pos: [-68, 9, -35], size: [6, 18, 20] },
    { pos: [-68, 9, 35], size: [6, 18, 20] },
    { pos: [68, 9, -35], size: [6, 18, 20] },
    { pos: [68, 9, 35], size: [6, 18, 20] },

    // --- Canyon-Randwände (äußerer Rand, Nord/Süd) ---
    { pos: [-35, 9, -68], size: [20, 18, 6] },
    { pos: [35, 9, -68], size: [20, 18, 6] },
    { pos: [-35, 9, 68], size: [20, 18, 6] },
    { pos: [35, 9, 68], size: [20, 18, 6] },

    // --- Erodierte Felssäulen (mittlerer Canyon-Ring) ---
    { pos: [40, 8, -18], size: [5, 16, 5] },
    { pos: [-40, 8, 18], size: [5, 16, 5] },
    { pos: [18, 8, 40], size: [5, 16, 5] },
    { pos: [-18, 8, -40], size: [5, 16, 5] },
    { pos: [50, 8, -50], size: [5, 16, 5] },
    { pos: [-50, 8, 50], size: [5, 16, 5] },

    // --- Niedrige Canyon-Mauern mit Durchflugtunneln ---
    { pos: [50, 6, 18], size: [5, 12, 16], kind: 'hard', tunnel: { radius: 4, axis: 'x' } },
    { pos: [-50, 6, -18], size: [5, 12, 16], kind: 'hard', tunnel: { radius: 4, axis: 'x' } },
    { pos: [18, 6, -50], size: [16, 12, 5], kind: 'hard', tunnel: { radius: 4, axis: 'z' } },
    { pos: [-18, 6, 50], size: [16, 12, 5], kind: 'hard', tunnel: { radius: 4, axis: 'z' } },

    // --- Geröll und Trümmer (weiche Hindernisse) ---
    { pos: [60, 3, -18], size: [6, 6, 6], kind: 'foam' },
    { pos: [-60, 3, 18], size: [6, 6, 6], kind: 'foam' },
    { pos: [15, 3, 60], size: [6, 6, 6], kind: 'foam' },
    { pos: [-15, 3, -60], size: [6, 6, 6], kind: 'foam' },
    { pos: [38, 3, -60], size: [5, 5, 5], kind: 'foam' },
    { pos: [-38, 3, 60], size: [5, 5, 5], kind: 'foam' },

    // --- Zerbrochene Zahnrad-Fragmente (Uhrwerk-Maschine, flach liegend) ---
    { pos: [33, 2, -33], size: [8, 3, 8], kind: 'foam' },
    { pos: [-33, 2, 33], size: [8, 3, 8], kind: 'foam' },
    { pos: [52, 2, -30], size: [8, 3, 8], kind: 'foam' },
    { pos: [-52, 2, 30], size: [8, 3, 8], kind: 'foam' },
    { pos: [12, 2, -62], size: [8, 3, 8], kind: 'foam' },
];
