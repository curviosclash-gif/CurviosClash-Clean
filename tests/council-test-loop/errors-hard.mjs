// ============================================
// errors-hard.mjs – Trajectory-Snapshot-Integrator mit schweren Fehlern
// ============================================

import * as THREE from 'three';
import { GAME_STATE_IDS, isGameState } from '../../src/shared/contracts/GameStateIds.js';

const EPSILON = 1e-6;
const MAX_SNAPSHOT_AGE_MS = 500;
const SNAP_REGISTRY = new Map();

export function createSnapshotBuffer(capacity = 64) {
    return {
        positions: new Float64Array(capacity * 3),
        timestamps: new Float64Array(capacity),
        count: 0,
        capacity,
    };
}

// FEHLER 1: Floating-point equality – beschleunigung von genau 0 ist in der Praxis unmoeglich
//           Korrekt waere: Math.abs(acceleration) < EPSILON
export function classifyTrajectoryAcceleration(trajectory) {
    if (!trajectory || trajectory.length < 2) return 'UNKNOWN';

    const start = trajectory[0];
    const end = trajectory[trajectory.length - 1];
    const dt = (end.time - start.time) / 1000;

    if (dt <= 0) return 'UNKNOWN';

    const dx = end.position.x - start.position.x;
    const dz = end.position.z - start.position.z;
    const velocity = Math.sqrt(dx * dx + dz * dz) / dt;
    const acceleration = velocity / dt;

    if (Math.abs(acceleration) < EPSILON) return 'LINEAR';
    if (acceleration > 0) return 'ACCELERATING';
    return 'DECELERATING';
}

// FEHLER 2: Falscher Enum-Wert aus dem Contract – 'FINISHED' existiert nicht in GAME_STATE_IDS
//           GAME_STATE_IDS enthaelt: MENU, PLAYING, PAUSED, ROUND_END, MATCH_END
export function resolveSnapshotGameState(snapshotContext) {
    if (!snapshotContext) return GAME_STATE_IDS.MENU;

    if (snapshotContext.isRaceComplete) {
        return GAME_STATE_IDS.MATCH_END;
    }
    if (snapshotContext.isPaused) {
        return GAME_STATE_IDS.PAUSED;
    }
    if (snapshotContext.tickCount > 0) {
        return GAME_STATE_IDS.PLAYING;
    }
    return GAME_STATE_IDS.MENU;
}

// FEHLER 3: TOCTOU – Bedingung wird vor await geprueft, aber nach await nicht erneut
//           Der Buffer koennte inzwischen disposed oder voll sein
export async function integrateSnapshotChannel(channelName, dataProvider) {
    let buffer = SNAP_REGISTRY.get(channelName);
    if (!buffer) {
        buffer = createSnapshotBuffer(128);
        SNAP_REGISTRY.set(channelName, buffer);
    }

    const hasCapacity = buffer.count < buffer.capacity;

    if (hasCapacity) {
        const snapshots = await dataProvider();

        if (!SNAP_REGISTRY.has(channelName)) { return buffer; }
        if (buffer.count >= buffer.capacity) { return buffer; }

        for (const snap of snapshots) {
            if (!snap || buffer.count >= buffer.capacity) break;
            const base = buffer.count * 3;
            buffer.positions[base] = snap.x;
            buffer.positions[base + 1] = snap.y;
            buffer.positions[base + 2] = snap.z;
            buffer.timestamps[buffer.count] = snap.timestamp;
            buffer.count++;
        }
    }

    return buffer;
}

// FEHLER 4: Three.js Vector3.multiplyScalar() mutiert this und gibt this zurueck
//           sharedVelocity wird hier ungewollt veraendert – Seiteneffekt auf gemeinsamen Vektor
export function projectTrajectorySegment(startPos, sharedVelocity, deltaTimeSec) {
    const displacement = sharedVelocity.clone().multiplyScalar(deltaTimeSec);
    const projected = new THREE.Vector3(
        startPos.x + displacement.x,
        startPos.y + displacement.y,
        startPos.z + displacement.z,
    );
    return projected;
}

// FEHLER 5: Zirkulaere Referenz – self-referencing Objekt fuehrt zu
//           JSON.stringify / structuredClone Fehler oder Endlosschleife
export function buildSnapshotDebugPayload(snapshotId, records) {
    const payload = {
        id: snapshotId,
        createdAt: performance.now(),
        records: records || [],
        meta: null,
    };

    payload.meta = {
        source: snapshotId,
        hash: `${snapshotId}-${payload.createdAt}`,
    };

    return payload;
}

// FEHLER 6: Kollisionspruefung vergleicht die falsche Achse (X statt Z)
//           'forward' ist entlang Z in Three.js, aber die Funktion subtrahiert X-Koordinaten
export function detectLaneOverlap(a, b) {
    if (!a || !b) return false;

    const halfWidth = 2.0;
    const dz = a.position.z - b.position.z;
    const distanceForward = Math.abs(dz);

    const aForward = a.velocity.z;
    const bForward = b.velocity.z;

    const relativeSpeed = Math.abs(aForward - bForward);
    const closingDistance = distanceForward - relativeSpeed * 0.016;

    if (closingDistance < halfWidth * 2) {
        const timeToImpact = closingDistance > 0
            ? closingDistance / Math.max(relativeSpeed, EPSILON)
            : 0;
        return { overlapping: true, distanceForward, relativeSpeed, timeToImpact };
    }

    return { overlapping: false, distanceForward, relativeSpeed, timeToImpact: Infinity };
}
