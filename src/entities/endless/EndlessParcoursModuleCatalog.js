const STRAIGHT_CONNECTOR = Object.freeze({ id: 'straight', x: 0, y: 8, heading: 0 });

function freezeModule(definition) {
    return Object.freeze({
        ...definition,
        entrance: STRAIGHT_CONNECTOR,
        exit: STRAIGHT_CONNECTOR,
        colliders: Object.freeze((definition.colliders || []).map((entry) => Object.freeze({ ...entry }))),
        pickups: Object.freeze((definition.pickups || []).map((entry) => Object.freeze({ ...entry }))),
        botAnchors: Object.freeze((definition.botAnchors || []).map((entry) => Object.freeze({ ...entry }))),
    });
}

const COMMON_BOT_ANCHORS = Object.freeze([
    Object.freeze({ x: -18, y: 8, z: 24 }),
    Object.freeze({ x: 18, y: 10, z: 48 }),
    Object.freeze({ x: -16, y: 12, z: 76 }),
    Object.freeze({ x: 16, y: 8, z: 102 }),
]);

export const ENDLESS_PARCOURS_SAFE_MODULE_ID = 'fast_straight';

export const ENDLESS_PARCOURS_MODULE_CATALOG = Object.freeze([
    freezeModule({
        id: 'combat_free_intro', label: 'Intro', weight: 0, minimumTier: 0,
        colliders: [], pickups: [], botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 120,
    }),
    freezeModule({
        id: 'fast_straight', label: 'Schnelle Gerade', weight: 8, minimumTier: 1,
        colliders: [], pickups: [{ x: 0, y: 8, z: 72, type: 'SPEED_UP' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 120,
    }),
    freezeModule({
        id: 'slalom', label: 'Slalom', weight: 7, minimumTier: 1,
        colliders: [
            { x: -13, y: 8, z: 28, sx: 7, sy: 15, sz: 7 },
            { x: 13, y: 10, z: 58, sx: 7, sy: 19, sz: 7 },
            { x: -13, y: 12, z: 88, sx: 7, sy: 23, sz: 7 },
        ], pickups: [{ x: 0, y: 13, z: 104, type: 'ROCKET_WEAK' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 120,
    }),
    freezeModule({
        id: 'choke_point', label: 'Engstelle', weight: 6, minimumTier: 1,
        colliders: [
            { x: -19, y: 10, z: 58, sx: 16, sy: 24, sz: 34 },
            { x: 19, y: 10, z: 58, sx: 16, sy: 24, sz: 34 },
        ], pickups: [{ x: 0, y: 10, z: 92, type: 'SHIELD' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 120,
    }),
    freezeModule({
        id: 'tunnel', label: 'Tunnel', weight: 5, minimumTier: 1,
        colliders: [
            { x: 0, y: -2, z: 60, sx: 46, sy: 4, sz: 82 },
            { x: 0, y: 24, z: 60, sx: 46, sy: 4, sz: 82 },
        ], pickups: [{ x: 0, y: 10, z: 60, type: 'ROCKET_MEDIUM' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 120,
    }),
    freezeModule({
        id: 'vertical_passage', label: 'Vertikale Passage', weight: 5, minimumTier: 2,
        colliders: [
            { x: 0, y: 1, z: 36, sx: 26, sy: 4, sz: 18 },
            { x: 0, y: 21, z: 82, sx: 26, sy: 4, sz: 18 },
        ], pickups: [{ x: 0, y: 22, z: 66, type: 'SHIELD' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 120,
    }),
    freezeModule({
        id: 'obstacle_weave', label: 'Hindernis-Weave', weight: 6, minimumTier: 2,
        colliders: [
            { x: -10, y: 7, z: 24, sx: 12, sy: 14, sz: 5 },
            { x: 10, y: 13, z: 48, sx: 12, sy: 14, sz: 5 },
            { x: -10, y: 15, z: 72, sx: 12, sy: 14, sz: 5 },
            { x: 10, y: 8, z: 96, sx: 12, sy: 14, sz: 5 },
        ], pickups: [{ x: 0, y: 12, z: 108, type: 'ROCKET_HEAVY' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 120,
    }),
    freezeModule({
        id: 'boost_passage', label: 'Boost-Passage', weight: 6, minimumTier: 1,
        colliders: [
            { x: -16, y: 9, z: 56, sx: 5, sy: 18, sz: 70 },
            { x: 16, y: 9, z: 56, sx: 5, sy: 18, sz: 70 },
        ], pickups: [
            { x: 0, y: 8, z: 34, type: 'SPEED_UP' },
            { x: 0, y: 8, z: 82, type: 'SPEED_UP' },
        ], botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 120,
    }),
    freezeModule({
        id: 'hazard_corridor', label: 'Gefahrenkorridor', weight: 3, minimumTier: 3,
        colliders: [
            { x: -14, y: 6, z: 30, sx: 8, sy: 12, sz: 8 },
            { x: 14, y: 14, z: 52, sx: 8, sy: 20, sz: 8 },
            { x: 0, y: 4, z: 78, sx: 14, sy: 8, sz: 8 },
            { x: -14, y: 15, z: 102, sx: 8, sy: 18, sz: 8 },
        ], pickups: [{ x: 14, y: 8, z: 102, type: 'ROCKET_MEGA' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 120,
    }),
    freezeModule({
        id: 'recovery', label: 'Erholungsmodul', weight: 5, minimumTier: 1, recovery: true,
        colliders: [], pickups: [
            { x: -6, y: 8, z: 48, type: 'HEALTH' },
            { x: 6, y: 8, z: 76, type: 'SHIELD' },
        ], botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 120,
    }),
]);

export const ENDLESS_PARCOURS_MODULE_BY_ID = new Map(
    ENDLESS_PARCOURS_MODULE_CATALOG.map((definition) => [definition.id, definition])
);
