import * as THREE from 'three';
import { PLAYABLE_VOLUME_INSIDE, probeArenaPlayableVolumes } from '../arena/ArenaPlayableVolumes.js';
import { applySteeringTowardPosition, clearSteeringInput } from '../../hunt/HuntBotSteeringOps.js';

// An open face (exclusionZone.openFaces) has no wall in the flight physics, and bots are exempt
// from the exclusion-zone salvo. Bot probes do treat the face as a wall, but once a bot is past it
// every probe point lies "inside the wall", so avoidance can no longer pick a way back. This soft
// boundary runs after every bot policy: a bot in the edge band that heads outward, or one already
// outside, is steered back along that axis. Closed arenas return before any work.
const MIN_EDGE_MARGIN = 6;
const EDGE_MARGIN_SPEED_SECONDS = 0.5;
const OUTWARD_HEADING_MIN = 0.05;

const OPEN_FACES = Object.freeze([
    Object.freeze({ face: 'minX', opposite: 'maxX', axis: 'x', sign: -1 }),
    Object.freeze({ face: 'maxX', opposite: 'minX', axis: 'x', sign: 1 }),
    Object.freeze({ face: 'minZ', opposite: 'maxZ', axis: 'z', sign: -1 }),
    Object.freeze({ face: 'maxZ', opposite: 'minZ', axis: 'z', sign: 1 }),
    Object.freeze({ face: 'maxY', opposite: 'minY', axis: 'y', sign: 1 }),
]);

// Scratch space shaped like a policy so the shared hunt steering helper can reuse it.
const steering = {
    _tmpGate: new THREE.Vector3(),
    _tmpForward: new THREE.Vector3(),
    _tmpRight: new THREE.Vector3(),
    _tmpUp: new THREE.Vector3(),
};
const returnTarget = new THREE.Vector3();
const lookAhead = new THREE.Vector3();

/** Returns true when the bot's steering was replaced to bring it back inside the arena. */
export function applyBotOpenFaceReturn(input, player, arena) {
    const openFaces = arena?.openFaces;
    if (!input || !Array.isArray(openFaces) || openFaces.length === 0) return false;
    const bounds = arena.bounds;
    const position = player?.position;
    if (!bounds || !position || typeof player.getDirection !== 'function') return false;
    const forward = player.getDirection(steering._tmpForward);
    if (!forward || forward.lengthSq() <= 0.000001) return false;
    forward.normalize();
    const margin = Math.max(MIN_EDGE_MARGIN, Math.abs(Number(player.speed) || 0) * EDGE_MARGIN_SPEED_SECONDS);
    returnTarget.copy(position);
    let active = false;
    for (let index = 0; index < OPEN_FACES.length; index += 1) {
        const entry = OPEN_FACES[index];
        if (!openFaces.includes(entry.face)) continue;
        const limit = Number(bounds[entry.face]);
        const coordinate = position[entry.axis];
        const depth = (coordinate - limit) * entry.sign + margin;
        if (!(depth > 0)) continue;
        const outside = depth > margin;
        if (!outside && forward[entry.axis] * entry.sign <= OUTWARD_HEADING_MIN) continue;
        returnTarget[entry.axis] = (limit + Number(bounds[entry.opposite])) * 0.5;
        active = true;
    }
    if (!active || !Number.isFinite(returnTarget.x + returnTarget.y + returnTarget.z)) return false;
    // A map room lies outside the arena box on purpose; a bot in it or flying into it is no runaway.
    const volumes = arena.playableVolumes;
    if (probeArenaPlayableVolumes(volumes, position) === PLAYABLE_VOLUME_INSIDE) return false;
    lookAhead.copy(position).addScaledVector(forward, margin);
    if (probeArenaPlayableVolumes(volumes, lookAhead) === PLAYABLE_VOLUME_INSIDE) return false;
    clearSteeringInput(input);
    applySteeringTowardPosition(steering, input, player, returnTarget);
    return true;
}
