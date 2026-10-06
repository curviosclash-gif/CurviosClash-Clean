import * as THREE from 'three';

import { ArenaCollision } from '../../src/entities/arena/ArenaCollision.js';
import { ArenaGeometryCompilePipeline } from '../../src/entities/arena/ArenaGeometryCompilePipeline.js';
import { buildRouteFromParcours } from '../../src/entities/systems/ParcoursProgressUtils.js';

// Racing-line probe shared by the parcours contract tests: a ship-sized sphere (world units) is
// moved every STEP along each straight ring-to-ring leg through the collision the arena really
// compiles (walls, hard boxes, foam, tunnel bores, tubes). Scene (GLB mesh) colliders are not
// part of it, so only maps whose collision is their authored obstacles can be judged here.
export const PROBE_RADIUS = 1.2;
export const STEP = 1.5;

export function compileArenaCollision(map, scale) {
    const [sx, sy, sz] = map.size.map((value) => value * scale);
    const arena = {
        renderer: { addToScene() {}, removeFromScene() {} },
        obstacles: [],
        bounds: { minX: -sx / 2, maxX: sx / 2, minY: 0, maxY: sy, minZ: -sz / 2, maxZ: sz / 2 },
        _pendingWallGeos: [],
        _pendingObstacleGeos: [],
        _pendingFoamGeos: [],
        _pendingObstacleEdgeGeos: [],
        _pendingFoamEdgeGeos: [],
    };
    const pipeline = new ArenaGeometryCompilePipeline(arena);
    pipeline.compileWallStage({ sx, sy, sz, scale });
    pipeline.compileObstacleStage({ obstacleDefs: map.obstacles || [], scale });
    return new ArenaCollision(arena);
}

// The racing lines a player flies: every ring to each ring it links to (nextCheckpointIds, so a
// branch only connects to its own continuation), a lane alias flies like its main ring and can be
// entered wherever its main ring can, rings without a successor fly to the finish, then finish to
// exit portal when the map has one. The checkpoint list is in authored order, not stage order.
export function collectLegs(map, scale) {
    const route = buildRouteFromParcours(map.parcours, { positionScale: scale });
    const toPoint = (id, pos) => ({ id, pos: new THREE.Vector3(pos[0], pos[1], pos[2]) });
    const byId = new Map(route.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
    const aliasesOf = (id) => route.checkpoints.filter((checkpoint) => checkpoint.aliasOf === id);
    const successors = (checkpoint) => {
        const main = checkpoint.aliasOf ? byId.get(checkpoint.aliasOf) : null;
        const ids = [...(checkpoint.nextCheckpointIds || []), ...(main?.nextCheckpointIds || [])];
        const targets = ids.map((id) => byId.get(id)).filter(Boolean);
        return [...new Set([...targets, ...targets.flatMap((target) => aliasesOf(target.id))])];
    };
    const finish = toPoint(route.finish.id, route.finish.pos);
    const legs = [];
    for (const checkpoint of route.checkpoints) {
        const from = toPoint(checkpoint.id, checkpoint.pos);
        const next = successors(checkpoint);
        if (next.length === 0) legs.push([from, finish]);
        for (const target of next) legs.push([from, toPoint(target.id, target.pos)]);
    }
    if (Array.isArray(map.fivePortalsExit?.pos)) {
        legs.push([finish, toPoint('EXIT', map.fivePortalsExit.pos.map((value) => value * scale))]);
    }
    return legs;
}

/** @returns {{ leg: string, at: number[] }[]} first blocked sample per leg, in authored units */
export function findBlockedLegs(map, scale) {
    const collision = compileArenaCollision(map, scale);
    const sample = new THREE.Vector3();
    const blocked = [];
    for (const [from, to] of collectLegs(map, scale)) {
        const steps = Math.ceil(from.pos.distanceTo(to.pos) / STEP);
        for (let step = 1; step < steps; step += 1) {
            sample.lerpVectors(from.pos, to.pos, step / steps);
            if (collision.checkCollisionFast(sample, PROBE_RADIUS)) {
                blocked.push({ leg: `${from.id}->${to.id}`, at: sample.toArray().map((value) => Math.round(value / scale)) });
                break;
            }
        }
    }
    return blocked;
}
