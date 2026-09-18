/**
 * Bausteine der Endlosjagd. Jeder Baustein sagt, welche Anschluesse an seinem
 * Ausgang erlaubt sind (`exitCandidates`), welche Hindernisse er stellt und wo
 * Jaeger einsteigen duerfen. Hindernisse mit `cycle` sind Schleusen: sie
 * schalten im Takt zwischen offen und geschlossen, statt sich kontinuierlich zu
 * bewegen - so bleibt die Kollision ein statischer Batch, der nur beim
 * Umschalten neu registriert wird.
 */

function freezeModule(definition) {
    return Object.freeze({
        recovery: false,
        exitCandidates: Object.freeze(['straight']),
        ...definition,
        colliders: Object.freeze((definition.colliders || []).map((entry) => Object.freeze({
            ...entry,
            cycle: entry.cycle ? Object.freeze({ ...entry.cycle }) : null,
        }))),
        pickups: Object.freeze((definition.pickups || []).map((entry) => Object.freeze({ ...entry }))),
        botAnchors: Object.freeze((definition.botAnchors || []).map((entry) => Object.freeze({
            ahead: false,
            elite: false,
            ...entry,
        }))),
    });
}

/**
 * Einstiegspunkte der Jaeger. `ahead` markiert einen Anker weit vor dem
 * Spieler: daraus entsteht eine Sperre statt einer Verfolgung. `elite` markiert
 * die Buehne fuer einen Anfuehrer - mittig und mit Anlauf.
 */
const COMMON_BOT_ANCHORS = Object.freeze([
    Object.freeze({ x: -18, y: 8, z: 24, ahead: false, elite: false }),
    Object.freeze({ x: 18, y: 10, z: 48, ahead: false, elite: false }),
    Object.freeze({ x: -16, y: 12, z: 76, ahead: false, elite: false }),
    Object.freeze({ x: 16, y: 8, z: 102, ahead: false, elite: false }),
    Object.freeze({ x: -8, y: 18, z: 62, ahead: false, elite: false }),
    Object.freeze({ x: 9, y: 2, z: 88, ahead: false, elite: false }),
    Object.freeze({ x: -14, y: 9, z: 116, ahead: true, elite: false }),
    Object.freeze({ x: 14, y: 13, z: 112, ahead: true, elite: false }),
    Object.freeze({ x: 0, y: 11, z: 108, ahead: true, elite: true }),
]);

const ALL_EXITS = Object.freeze([
    'straight', 'straight', 'bend_left', 'bend_right', 'climb', 'dive', 'bank_left', 'bank_right',
]);
const FLAT_EXITS = Object.freeze(['straight', 'bend_left', 'bend_right']);
const LEVEL_EXITS = Object.freeze(['straight', 'climb', 'dive']);

export const ENDLESS_PARCOURS_SAFE_MODULE_ID = 'fast_straight';

export const ENDLESS_PARCOURS_MODULE_CATALOG = Object.freeze([
    freezeModule({
        id: 'combat_free_intro', label: 'Intro', weight: 0, minimumTier: 0,
        colliders: [], pickups: [], botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: FLAT_EXITS,
    }),
    freezeModule({
        id: 'fast_straight', label: 'Schnelle Gerade', weight: 8, minimumTier: 1,
        colliders: [], pickups: [{ x: 0, y: 8, z: 72, type: 'SPEED_UP' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: ALL_EXITS,
    }),
    freezeModule({
        id: 'slalom', label: 'Slalom', weight: 7, minimumTier: 1,
        colliders: [
            { x: -13, y: 8, z: 28, sx: 7, sy: 15, sz: 7 },
            { x: 13, y: 10, z: 58, sx: 7, sy: 19, sz: 7 },
            { x: -13, y: 12, z: 88, sx: 7, sy: 23, sz: 7 },
        ], pickups: [{ x: 0, y: 13, z: 104, type: 'ROCKET_WEAK' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: FLAT_EXITS,
    }),
    freezeModule({
        id: 'choke_point', label: 'Engstelle', weight: 6, minimumTier: 1,
        colliders: [
            { x: -19, y: 10, z: 58, sx: 16, sy: 24, sz: 34 },
            { x: 19, y: 10, z: 58, sx: 16, sy: 24, sz: 34 },
        ], pickups: [{ x: 0, y: 10, z: 92, type: 'SHIELD' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: LEVEL_EXITS,
    }),
    freezeModule({
        id: 'tunnel', label: 'Tunnel', weight: 5, minimumTier: 1,
        colliders: [
            { x: 0, y: -2, z: 60, sx: 46, sy: 4, sz: 82 },
            { x: 0, y: 24, z: 60, sx: 46, sy: 4, sz: 82 },
        ], pickups: [{ x: 0, y: 10, z: 60, type: 'ROCKET_MEDIUM' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: Object.freeze(['straight']),
    }),
    freezeModule({
        id: 'vertical_passage', label: 'Vertikale Passage', weight: 5, minimumTier: 2,
        colliders: [
            { x: 0, y: 1, z: 36, sx: 26, sy: 4, sz: 18 },
            { x: 0, y: 21, z: 82, sx: 26, sy: 4, sz: 18 },
        ], pickups: [{ x: 0, y: 22, z: 66, type: 'SHIELD' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: LEVEL_EXITS,
    }),
    freezeModule({
        id: 'obstacle_weave', label: 'Hindernis-Weave', weight: 6, minimumTier: 2,
        colliders: [
            { x: -10, y: 7, z: 24, sx: 12, sy: 14, sz: 5 },
            { x: 10, y: 13, z: 48, sx: 12, sy: 14, sz: 5 },
            { x: -10, y: 15, z: 72, sx: 12, sy: 14, sz: 5 },
            { x: 10, y: 8, z: 96, sx: 12, sy: 14, sz: 5 },
        ], pickups: [{ x: 0, y: 12, z: 108, type: 'ROCKET_HEAVY' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: ALL_EXITS,
    }),
    freezeModule({
        id: 'boost_passage', label: 'Boost-Passage', weight: 6, minimumTier: 1,
        colliders: [
            { x: -16, y: 9, z: 56, sx: 5, sy: 18, sz: 70 },
            { x: 16, y: 9, z: 56, sx: 5, sy: 18, sz: 70 },
        ], pickups: [
            { x: 0, y: 8, z: 34, type: 'SPEED_UP' },
            { x: 0, y: 8, z: 82, type: 'SPEED_UP' },
        ], botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: Object.freeze(['straight', 'climb']),
    }),
    freezeModule({
        id: 'hazard_corridor', label: 'Gefahrenkorridor', weight: 3, minimumTier: 3,
        colliders: [
            { x: -14, y: 6, z: 30, sx: 8, sy: 12, sz: 8 },
            { x: 14, y: 14, z: 52, sx: 8, sy: 20, sz: 8 },
            { x: 0, y: 4, z: 78, sx: 14, sy: 8, sz: 8 },
            { x: -14, y: 15, z: 102, sx: 8, sy: 18, sz: 8 },
        ], pickups: [{ x: 14, y: 8, z: 102, type: 'ROCKET_MEGA' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: ALL_EXITS,
    }),
    freezeModule({
        id: 'recovery', label: 'Erholungsmodul', weight: 5, minimumTier: 1, recovery: true,
        colliders: [], pickups: [
            { x: -6, y: 8, z: 48, type: 'HEALTH' },
            { x: 6, y: 8, z: 76, type: 'SHIELD' },
        ], botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: FLAT_EXITS,
    }),
    freezeModule({
        id: 'sluice_gates', label: 'Taktschleusen', weight: 6, minimumTier: 2,
        colliders: [
            { x: -13, y: 9, z: 32, sx: 24, sy: 26, sz: 5, cycle: { periodSeconds: 3.4, openSeconds: 1.5, phase: 0 } },
            { x: 13, y: 9, z: 32, sx: 24, sy: 26, sz: 5, cycle: { periodSeconds: 3.4, openSeconds: 1.5, phase: 1.7 } },
            { x: 13, y: 9, z: 74, sx: 24, sy: 26, sz: 5, cycle: { periodSeconds: 3.4, openSeconds: 1.5, phase: 0 } },
            { x: -13, y: 9, z: 74, sx: 24, sy: 26, sz: 5, cycle: { periodSeconds: 3.4, openSeconds: 1.5, phase: 1.7 } },
        ], pickups: [{ x: 0, y: 9, z: 104, type: 'SHIELD' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: FLAT_EXITS,
    }),
    freezeModule({
        id: 'pendulum_bars', label: 'Pendelsperren', weight: 5, minimumTier: 2,
        colliders: [
            { x: 0, y: 4, z: 40, sx: 40, sy: 7, sz: 6, cycle: { periodSeconds: 2.8, openSeconds: 1.3, phase: 0 } },
            { x: 0, y: 18, z: 68, sx: 40, sy: 7, sz: 6, cycle: { periodSeconds: 2.8, openSeconds: 1.3, phase: 1.4 } },
            { x: 0, y: 11, z: 96, sx: 40, sy: 7, sz: 6, cycle: { periodSeconds: 2.8, openSeconds: 1.3, phase: 0.7 } },
        ], pickups: [{ x: 0, y: 11, z: 112, type: 'ROCKET_MEDIUM' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: LEVEL_EXITS,
    }),
    freezeModule({
        id: 'closing_walls', label: 'Wandpresse', weight: 4, minimumTier: 3,
        colliders: [
            { x: -20, y: 9, z: 56, sx: 14, sy: 26, sz: 44, cycle: { periodSeconds: 4.2, openSeconds: 2.1, phase: 0 } },
            { x: 20, y: 9, z: 56, sx: 14, sy: 26, sz: 44, cycle: { periodSeconds: 4.2, openSeconds: 2.1, phase: 2.1 } },
        ], pickups: [{ x: 0, y: 9, z: 100, type: 'ROCKET_HEAVY' }],
        botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: FLAT_EXITS,
    }),
    freezeModule({
        id: 'sprint_shafts', label: 'Sprintschächte', weight: 4, minimumTier: 3,
        colliders: [
            { x: -17, y: 9, z: 30, sx: 6, sy: 26, sz: 40 },
            { x: 17, y: 9, z: 82, sx: 6, sy: 26, sz: 40 },
            { x: 0, y: 22, z: 56, sx: 30, sy: 5, sz: 14, cycle: { periodSeconds: 2.4, openSeconds: 1.1, phase: 0 } },
        ], pickups: [
            { x: 6, y: 8, z: 30, type: 'SPEED_UP' },
            { x: -6, y: 8, z: 82, type: 'SPEED_UP' },
        ], botAnchors: COMMON_BOT_ANCHORS, checkpointZ: 116,
        exitCandidates: ALL_EXITS,
    }),
]);

export const ENDLESS_PARCOURS_MODULE_BY_ID = new Map(
    ENDLESS_PARCOURS_MODULE_CATALOG.map((definition) => [definition.id, definition])
);
