import { DandelionSeedController } from './DandelionSeedController.js';
import { SunflowerKernelController } from './SunflowerKernelController.js';
import { CherryLeafController } from './CherryLeafController.js';

/**
 * The shootable plants of a GLB map: dandelion seeds, sunflower kernels and cherry leaves.
 * The controllers stay on the arena (arena._dandelionSeeds, _sunflowerKernels, _cherryLeaves);
 * these functions are the arena's behaviour around them. A network replica only mirrors what
 * the host releases, so it never releases or consumes on its own.
 */

export function attachShootablePlants(arena, scene) {
    const seeds = new DandelionSeedController(scene);
    arena._dandelionSeeds = seeds.count > 0 ? seeds : null;
    const sunflowerKernels = new SunflowerKernelController(scene);
    arena._sunflowerKernels = sunflowerKernels.count > 0 ? sunflowerKernels : null;
    const cherryLeaves = new CherryLeafController(scene);
    arena._cherryLeaves = cherryLeaves.count > 0 ? cherryLeaves : null;
    seeds.onRelease = (position, at) => arena._shootableReleaseListener?.(position, at, 'dandelionSeeds');
    sunflowerKernels.onRelease = (position, at) => arena._shootableReleaseListener?.(position, at, 'sunflowerKernels');
}

export function clearShootablePlants(arena) {
    arena._dandelionSeeds = null;
    arena._sunflowerKernels = null;
    arena._cherryLeaves?.reset();
    arena._cherryLeaves = null;
}

export function updateShootablePlants(arena, elapsedSeconds) {
    arena._dandelionSeeds?.update(elapsedSeconds);
    arena._sunflowerKernels?.update(elapsedSeconds);
    arena._cherryLeaves?.update(elapsedSeconds);
}

export function raycastShootablePlant(arena, origin, direction, maxDistance, padding = 0) {
    const dandelion = arena._dandelionSeeds?.raycast(origin, direction, maxDistance, padding) || null;
    const sunflower = arena._sunflowerKernels?.raycast(origin, direction, maxDistance, padding) || null;
    return !dandelion ? sunflower : (!sunflower || dandelion.distance <= sunflower.distance ? dandelion : sunflower);
}

export function releaseShootablePlant(arena, name, hitDirection = null) {
    if (arena._dandelionSeedNetworkReplica) return false;
    const seconds = arena.glbAnimationElapsedSeconds;
    return arena._dandelionSeeds?.releaseByName(name, seconds) === true
        || arena._sunflowerKernels?.releaseByName(name, seconds, hitDirection) === true;
}

export function consumeDandelionSeedCollision(arena, position, radius, playerIndex, previousPosition = null) {
    if (arena._dandelionSeedNetworkReplica) return null;
    arena._cherryLeaves?.releaseNearPass(previousPosition, position, radius, arena.glbAnimationElapsedSeconds);
    return arena._dandelionSeeds?.consumeCollision(position, radius, playerIndex, previousPosition) || null;
}

export function resetDandelionSeeds(arena) {
    arena._dandelionSeeds?.reset();
    arena._cherryLeaves?.reset();
}
