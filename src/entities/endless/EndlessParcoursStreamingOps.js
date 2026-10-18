import { ENDLESS_PARCOURS_ACTIVE_WINDOW } from '../../shared/contracts/EndlessParcoursContract.js';
import { buildEndlessModuleInstance, resolveEndlessActiveColliders,
    syncEndlessCycleColliders } from './EndlessParcoursModuleBuilder.js';
import { clearEndlessElite } from './EndlessParcoursBotDirectorOps.js';
import { registerEndlessShakeoff } from './EndlessParcoursRunOps.js';
import { createEndlessPathSample } from './EndlessParcoursPathMetric.js';
import { resolveEndlessCoursePoint } from './EndlessParcoursCourseSpace.js';

const PICKUP_FRAME = createEndlessPathSample();

export function instantiateEndlessModule(runtime, module) {
    const instance = buildEndlessModuleInstance({
        module,
        geometry: runtime._sharedGeometry,
        materials: runtime._materials,
        metric: runtime._path.getMetric(),
        baseSeed: runtime.baseSeed,
        setpieceBank: runtime._setpieceBank,
        elapsedSeconds: runtime._setpieceElapsedSeconds,
        recordDistanceMeters: runtime.getRecordDistanceMeters(),
    });
    syncEndlessCycleColliders(instance, runtime.elapsedCombatSeconds, runtime._materials);
    runtime.renderer?.addToScene?.(instance.group);
    runtime.arena?.registerStaticColliderBatch?.(instance.ownerId, resolveEndlessActiveColliders(instance));
    for (let index = 0; index < module.pickups.length; index += 1) {
        const pickup = module.pickups[index];
        const point = resolveEndlessCoursePoint(module, pickup.x, pickup.y - 8, pickup.z, PICKUP_FRAME).position;
        runtime.powerupManager?.spawnAtAnchor?.({
            ownerId: instance.ownerId,
            id: pickup.id,
            type: pickup.type,
            x: point.x,
            y: point.y,
            z: point.z,
        });
    }
    return instance;
}

export function removeEndlessModule(runtime, instance, options = {}) {
    if (!instance) return;
    const { ownerId, module, group } = instance;
    runtime._deactivateBotsInModule(module, options);
    runtime.powerupManager?.removeByOwnerId?.(ownerId);
    runtime.entityManager?._projectileSystem?.clearInBounds?.(
        -1000,
        1000,
        instance.bounds?.min.z ?? module.originZ,
        instance.bounds?.max.z ?? module.originZ + module.length
    );
    runtime.entityManager?._lockOnCache?.clear?.();
    runtime.arena?.unregisterStaticColliderBatch?.(ownerId);
    instance.setpiece?.dispose();
    runtime.renderer?.removeFromScene?.(group);
    if (!instance.ownedResourcesDisposed) {
        for (const geometry of instance.ownedGeometries || []) geometry.dispose();
        instance.ownedResourcesDisposed = true;
    }
}

export function deactivateEndlessBotsInModule(runtime, module, options = {}) {
    let shaken = 0;
    for (let index = 0; index < runtime._botSlots.length; index += 1) {
        const state = runtime._botSlots[index];
        if (state.state !== 'active') continue;
        const projected = runtime.projectCoursePoint(state.player?.position);
        if (!projected || projected.moduleIndex !== module.moduleIndex) continue;
        clearEndlessElite(state.player);
        runtime.entityManager?.deactivateBotSlot?.(state.slot, 'module_unloaded');
        state.state = 'idle';
        state.plannedAnchor = null;
        state.telegraphedAt = -1;
        state.eligibleAt = 0;
        if (options.awardShakeoff === true
            && runtime._path.getMetric().getStationRange(module.moduleIndex).endS < runtime.maxProgressMeters) shaken += 1;
    }
    if (shaken > 0 && runtime.combatStarted) registerEndlessShakeoff(runtime, shaken);
}

export function syncEndlessModules(runtime, currentModuleIndex, difficultyTier) {
    const minIndex = Math.max(0, currentModuleIndex - ENDLESS_PARCOURS_ACTIVE_WINDOW.behind);
    const maxIndex = currentModuleIndex + ENDLESS_PARCOURS_ACTIVE_WINDOW.ahead;
    for (let index = minIndex; index <= maxIndex; index += 1) {
        if (runtime.activeModules.has(index)) continue;
        runtime.activeModules.set(index, runtime._instantiateModule(runtime._path.getModule(index, difficultyTier)));
    }
    for (const [index, instance] of runtime.activeModules) {
        if (index >= minIndex && index <= maxIndex) continue;
        runtime._removeModule(instance, { awardShakeoff: index < minIndex });
        runtime.activeModules.delete(index);
    }
}

export function syncEndlessCycleCollidersForRuntime(runtime) {
    for (const instance of runtime.activeModules.values()) {
        if (!syncEndlessCycleColliders(instance, runtime.elapsedCombatSeconds, runtime._materials)) continue;
        runtime.arena?.registerStaticColliderBatch?.(instance.ownerId, resolveEndlessActiveColliders(instance));
    }
}
