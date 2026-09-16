// ============================================
// Clockwork Canyon - Mittlere Ebene: Das große Uhrwerk
// Zahnrad-Scheiben, Achsen, Zahnkränze und Pendelstangen um den Uhrturm
// ============================================

export const CLOCKWORK_CANYON_GEAR_OBSTACLES = [
    // --- Große Zahnrad-Scheiben (Ost/West/Süd/Nord um den Uhrturm) ---
    { pos: [38, 28, 0], size: [4, 18, 22], tunnel: { radius: 5, axis: 'x' } },
    { pos: [-38, 28, 0], size: [4, 18, 22], tunnel: { radius: 5, axis: 'x' } },
    { pos: [0, 28, 38], size: [22, 18, 4], tunnel: { radius: 5, axis: 'z' } },
    { pos: [0, 28, -45], size: [22, 18, 4], tunnel: { radius: 5, axis: 'z' } },

    // --- Achsen durch die Zahnrad-Naben ---
    { shape: 'tube', kind: 'hard', start: [28, 28, 0], end: [48, 28, 0], radius: 4 },
    { shape: 'tube', kind: 'hard', start: [-48, 28, 0], end: [-28, 28, 0], radius: 4 },
    { shape: 'tube', kind: 'hard', start: [0, 28, 28], end: [0, 28, 48], radius: 4 },
    { shape: 'tube', kind: 'hard', start: [0, 28, -55], end: [0, 28, -35], radius: 4 },

    // --- Zahnkranz-Zähne am Ost-Zahnrad ---
    { pos: [38, 37, 0], size: [5, 4, 4] },
    { pos: [38, 20, 0], size: [5, 4, 4] },

    // --- Zahnkranz-Zähne am West-Zahnrad ---
    { pos: [-38, 37, 0], size: [5, 4, 4] },
    { pos: [-38, 20, 0], size: [5, 4, 4] },

    // --- Zahnkranz-Zähne am Süd-Zahnrad ---
    { pos: [0, 37, 38], size: [4, 4, 5] },
    { pos: [0, 20, 38], size: [4, 4, 5] },

    // --- Zahnkranz-Zähne am Nord-Zahnrad ---
    { pos: [0, 37, -45], size: [4, 4, 5] },
    { pos: [0, 20, -45], size: [4, 4, 5] },

    // --- Kleinere Zwischen-Zahnräder in den Diagonalen ---
    { pos: [55, 26, 22], size: [3, 14, 14], tunnel: { radius: 3, axis: 'x' } },
    { pos: [-55, 26, -22], size: [3, 14, 14], tunnel: { radius: 3, axis: 'x' } },
    { pos: [22, 26, 55], size: [14, 14, 3], tunnel: { radius: 3, axis: 'z' } },
    { pos: [-22, 26, -55], size: [14, 14, 3], tunnel: { radius: 3, axis: 'z' } },

    // --- Gantry-Ring: Wartungsstege zwischen den großen Zahnrädern ---
    { pos: [24, 46, 24], size: [10, 2, 4] },
    { pos: [-24, 46, -24], size: [10, 2, 4] },
    { pos: [24, 46, -24], size: [4, 2, 10] },
    { pos: [-24, 46, 24], size: [4, 2, 10] },

    // --- Pendelstangen, hängen aus dem Uhrwerk ---
    { shape: 'tube', kind: 'hard', start: [55, 46, 12], end: [55, 24, 12], radius: 1.5 },
    { shape: 'tube', kind: 'hard', start: [-55, 46, -12], end: [-55, 24, -12], radius: 1.5 },
];
