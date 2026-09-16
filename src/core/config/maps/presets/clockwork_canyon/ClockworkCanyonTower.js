// ============================================
// Clockwork Canyon - Turmzone (Uhrturm)
// Zentrales Bauwerk: Sockel, gestufter Turmschaft
// mit kreuzenden Durchflug-Tunneln, Zifferblatt-Ring
// und Aussichtsplattform mit Zierspitzen
// ============================================

export const CLOCKWORK_CANYON_TOWER_OBSTACLES = [
    // --- Sockel-Plinthe (Fundament des Turms) ---
    { pos: [0, 3, 0], size: [16, 6, 16], kind: 'hard' },

    // --- Eck-Strebepfeiler am Sockel ---
    { pos: [12, 7, 12], size: [4, 14, 4], kind: 'hard' },
    { pos: [-12, 7, 12], size: [4, 14, 4], kind: 'hard' },
    { pos: [12, 7, -12], size: [4, 14, 4], kind: 'hard' },
    { pos: [-12, 7, -12], size: [4, 14, 4], kind: 'hard' },

    // --- Zahnrad-Achsen am Sockel (dekorativ, kein Durchflug) ---
    { shape: 'tube', kind: 'hard', start: [-16, 3, 0], end: [16, 3, 0], radius: 1.5 },
    { shape: 'tube', kind: 'hard', start: [0, 7, -16], end: [0, 7, 16], radius: 1.5 },

    // --- Turmschaft, Segment 1 (unten): Durchflug-Tunnel entlang X ---
    { pos: [0, 13, 0], size: [14, 14, 14], kind: 'hard', tunnel: { radius: 5, axis: 'x' } },

    // --- Turmschaft, Segment 2 (mitte): Durchflug-Tunnel entlang Z ---
    { pos: [0, 27, 0], size: [13, 14, 13], kind: 'hard', tunnel: { radius: 5, axis: 'z' } },

    // --- Zifferblatt-Ring: breite dünne Scheibe mit Durchflug entlang Z ---
    { pos: [0, 34, 0], size: [18, 18, 3], kind: 'hard', tunnel: { radius: 5, axis: 'z' } },

    // --- Turmschaft, Segment 3 (oben): Durchflug-Tunnel entlang X ---
    { pos: [0, 41, 0], size: [12, 14, 12], kind: 'hard', tunnel: { radius: 5, axis: 'x' } },

    // --- Aussichtsplattform (Deckfläche bei y ≈ 50) ---
    { pos: [0, 49, 0], size: [14, 2, 14], kind: 'hard' },

    // --- Zierspitzen an den Plattform-Ecken (nicht in der Mitte) ---
    { pos: [6, 52, 6], size: [2, 4, 2], kind: 'hard' },
    { pos: [-6, 52, 6], size: [2, 4, 2], kind: 'hard' },
    { pos: [6, 52, -6], size: [2, 4, 2], kind: 'hard' },
    { pos: [-6, 52, -6], size: [2, 4, 2], kind: 'hard' },
];
