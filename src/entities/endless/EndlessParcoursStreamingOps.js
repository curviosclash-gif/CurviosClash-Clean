import { ENDLESS_PARCOURS_ACTIVE_WINDOW } from '../../shared/contracts/EndlessParcoursContract.js';
import { buildEndlessModuleInstance, resolveEndlessActiveColliders, resolveModuleCenterAtZ,
    syncEndlessCycleColliders } from './EndlessParcoursModuleBuilder.js';
import { clearEndlessElite } from './EndlessParcoursBotDirectorOps.js';
import { registerEndlessShakeoff } from './EndlessParcoursRunOps.js';

export function instantiateEndlessModule(runtime, module) {
    const instance = buildEndlessModuleInstance({
        module,
        geometry: runtime._sharedGeometry,
        materials: runtime._materials,
        recordDistanceMeters: runtime._records?.bestDistance?.distanceMeters
            ?? runtime._records?.best?.distanceMeters
            ?? 0,
    });
    syncEndlessCycleColliders(instance, runtime.elapsedCombatSeconds, runtime._materials);
    runtime.renderer?.addToScene?.(instance.group);
    runtime.arena?.registerStaticColliderBatch?.(instance.ownerId, resolveEndlessActiveColliders(instance));
    for (let index = 0; index < module.pickups.length; index += 1) {
        const pickup = module.pickups[index];
        const center = resolveModuleCenterAtZ(module, module.originZ + pickup.z);
        runtime.powerupManager?.spawnAtAnchor?.({
            ownerId: instance.ownerId,
            id: pickup.id,
            type: pickup.type,
            x: center.x + pickup.x,
            y: center.y + pickup.y - 8,
            z: module.originZ + pickup.z,
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
        module.originZ,
        module.originZ + module.length
    );
    runtime.entityManager?._lockOnCache?.clear?.();
    runtime.arena?.unregisterStaticColliderBatch?.(ownerId);
    runtime.renderer?.removeFromScene?.(group);
}

export function deactivateEndlessBotsInModule(runtime, module, options = {}) {
    let shaken = 0;
    for (let index = 0; index < runtime._botSlots.length; index += 1) {
        const state = runtime._botSlots[index];
        const z = Number(state.player?.position?.z);
        if (state.state !== 'active' || !Number.isFinite(z)) continue;
        if (z < module.originZ || z > module.originZ + module.length) continue;
        clearEndlessElite(state.player);
        runtime.entityManager?.deactivateBotSlot?.(state.slot, 'module_unloaded');
        state.state = 'idle';
        state.plannedAnchor = null;
        state.telegraphedAt = -1;
        state.eligibleAt = 0;
        if (options.awardShakeoff === true
            && module.originZ + module.length < runtime.maxProgressMeters) shaken += 1;
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
