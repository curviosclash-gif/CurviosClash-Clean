// Parcours ring clearance: a ring centre must never sit inside an authored box obstacle.
//
// The 17.09.2026 playtest found glass_serpent balconies running through five ring centres; a
// later sweep with the real arena collision found the same on nine more maps. This rule checks
// the boxes the arena really compiles (see Arena.finalizeBuild): every box on maps without GLB
// models or with glbColliderMode 'fallbackOnly'/'dynamic', and on scene-collider GLB maps only
// the boxes marked compileWithGlb. Scene-collider geometry itself is not visible here; the
// desktop spec parcours-ring-clearance.desktop.spec.js covers those maps.

import { resolveGLBColliderMode } from '../src/entities/mapSchema/MapSchemaGlbOps.js';

// Ship hitbox radius (PLAYER.HITBOX_RADIUS 0.8) plus a small tolerance, in world units.
export const RING_CLEARANCE_WORLD_RADIUS = 1.2;

function hasGlbModels(mapDef) {
    return (Array.isArray(mapDef?.glbModels) && mapDef.glbModels.length > 0) || !!mapDef?.glbModel;
}

export function listCompiledBoxObstacles(mapDef) {
    const obstacles = Array.isArray(mapDef?.obstacles) ? mapDef.obstacles : [];
    const mode = resolveGLBColliderMode(mapDef?.glbColliderMode);
    const allBoxes = !hasGlbModels(mapDef) || mode === 'fallbackOnly' || mode === 'dynamic';
    return obstacles.filter((obstacle) => (
        Array.isArray(obstacle?.pos) && Array.isArray(obstacle?.size)
        && obstacle.shape !== 'tube' && !obstacle.tunnel
        && (allBoxes || obstacle.compileWithGlb === true)
    ));
}

export function listRingsInsideObstacles(mapDef, mapScale) {
    // centerObstructionAllowed marks a ring threaded around something on purpose (the Eiffel antenna).
    const rings = [...(mapDef?.parcours?.checkpoints || []), mapDef?.parcours?.finish]
        .filter((ring) => Array.isArray(ring?.pos) && ring.centerObstructionAllowed !== true);
    const margin = RING_CLEARANCE_WORLD_RADIUS / Math.max(0.001, Number(mapScale) || 1);
    const boxes = listCompiledBoxObstacles(mapDef);
    const blocked = [];
    for (const ring of rings) {
        const box = boxes.find((candidate) => ring.pos.every((value, axis) => (
            Math.abs(value - candidate.pos[axis]) < candidate.size[axis] / 2 + margin
        )));
        if (box) blocked.push({ ringId: ring.id || 'unknown', obstacle: box });
    }
    return blocked;
}
