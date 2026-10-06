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

// Every checkpoint of a stage to every checkpoint of the next (branch options and lane aliases
// share a stage), then finish to exit portal when the map has one: the racing lines a player flies.
export function collectLegs(map, scale) {
    const route = buildRouteFromParcours(map.parcours, { positionScale: scale });
    const toPoint = (id, pos) => ({ id, pos: new THREE.Vector3(pos[0], pos[1], pos[2]) });
    const stages = [];
    for (const checkpoint of route.checkpoints) {
        const last = stages[stages.length - 1];
        const point = { ...toPoint(checkpoint.id, checkpoint.pos), routeIndex: checkpoint.routeIndex };
        if (last && last[0].routeIndex === point.routeIndex) last.push(point);
        else stages.push([point]);
    }
    const finish = toPoint(route.finish.id, route.finish.pos);
    stages.push([finish]);
    const legs = [];
    for (let stage = 0; stage < stages.length - 1; stage += 1) {
        for (const from of stages[stage]) for (const to of stages[stage + 1]) legs.push([from, to]);
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
