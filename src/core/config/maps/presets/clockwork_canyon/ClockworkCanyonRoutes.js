// ============================================
// Clockwork Canyon - Routen (Portale & Gates)
// Wüsten-Canyon mit riesigen Zahnrädern und
// zentralem Uhrturm
// ============================================

// Portal-Paare zwischen den Canyon-Wänden und den
// schwebenden Zahnrad-Plattformen. Jede Verbindung
// bekommt eine eigene warme Metallfarbe, damit
// Spieler die Gegenstücke optisch zuordnen können.
export const CLOCKWORK_CANYON_PORTALS = [
    // Messing (brass): Boden-Ecke Süd-West ↔ Zahnrad-Plattform Nord-West
    { a: [-60, 10, -60], b: [40, 40, -40], color: 0xc9a227 },
    // Kupfer (copper): Boden-Ecke Nord-Ost ↔ Zahnrad-Plattform Süd-Ost
    { a: [60, 10, 60], b: [-40, 40, 40], color: 0xb87333 },
    // Amber: Boden-Ecke Nord-West ↔ mittlere Plattform Süd-West
    { a: [60, 10, -60], b: [-60, 25, 60], color: 0xffbf00 },
    // Teal (Zifferblatt-Akzent): Boden-Ecke Süd-Ost ↔ mittlere Plattform Nord-Ost
    { a: [-60, 10, 60], b: [60, 25, -60], color: 0x2fa89e },
];

// Boost-Gates entlang der vier Canyon-Wände (treiben Richtung
// Zentrum) sowie zwei Slingshots auf den Diagonal-Plattformen,
// die Richtung Uhrturm in der Mitte schleudern.
export const CLOCKWORK_CANYON_GATES = [
    {
        type: 'boost',
        pos: [-45, 8, 0],
        forward: [1, 0, 0],
        params: { duration: 1.6, forwardImpulse: 50, bonusSpeed: 65 }
    },
    {
        type: 'boost',
        pos: [45, 8, 0],
        forward: [-1, 0, 0],
        params: { duration: 1.6, forwardImpulse: 50, bonusSpeed: 65 }
    },
    {
        type: 'boost',
        pos: [0, 8, -45],
        forward: [0, 0, 1],
        params: { duration: 1.6, forwardImpulse: 50, bonusSpeed: 65 }
    },
    {
        type: 'boost',
        pos: [0, 8, 45],
        forward: [0, 0, -1],
        params: { duration: 1.6, forwardImpulse: 50, bonusSpeed: 65 }
    },
    // Slingshot Süd-Ost-Plattform, schleudert Richtung Zentrum (Uhrturm)
    {
        type: 'slingshot',
        pos: [30, 12, 30],
        forward: [-0.7071, 0, -0.7071],
        up: [0, 1, 0],
        params: { duration: 2.2, forwardImpulse: 20, liftImpulse: 18 }
    },
    // Slingshot Nord-West-Plattform, schleudert Richtung Zentrum (Uhrturm)
    {
        type: 'slingshot',
        pos: [-30, 12, -30],
        forward: [0.7071, 0, 0.7071],
        up: [0, 1, 0],
        params: { duration: 2.2, forwardImpulse: 20, liftImpulse: 18 }
    },
];
