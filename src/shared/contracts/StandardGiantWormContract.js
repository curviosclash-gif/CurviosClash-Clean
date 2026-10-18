// Canonical authored definition for the standard arena's giant worm.  Scenarios
// may derive short-lived copies, but must keep these baseline characteristics.
export const STANDARD_GIANT_WORM = Object.freeze({
    id: 'standard_giant_worm',
    kind: 'creature',
    path: Object.freeze([
        Object.freeze([-32, 0, -32]),
        Object.freeze([32, 0, -32]),
    ]),
    loop: false,
    speed: 8,
    maxHp: 600,
    hitboxRadius: 6,
    respawnSeconds: 90,
    attack: Object.freeze({ damage: 30, cooldown: 4, radius: 20 }),
    allowedModes: Object.freeze(['HUNT', 'ARCADE']),
});
