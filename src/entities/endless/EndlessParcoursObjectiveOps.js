const OBJECTIVES = Object.freeze([
    Object.freeze({ id: 'three_clean_checkpoints', target: 3 }),
    Object.freeze({ id: 'risk_route', target: 1 }),
    Object.freeze({ id: 'shakeoff_two', target: 2 }),
]);

function objectiveForModuleIndex(moduleIndex) {
    const block = Math.max(0, Math.floor((Math.max(1, moduleIndex) - 1) / 6));
    return OBJECTIVES[block % OBJECTIVES.length];
}

export function syncEndlessFlightObjective(runtime, moduleIndex, area) {
    const block = Math.max(0, Math.floor((Math.max(1, moduleIndex) - 1) / 6));
    if (runtime.objectiveAreaBlock === block) return;
    const definition = objectiveForModuleIndex(moduleIndex);
    runtime.objectiveAreaBlock = block;
    runtime.currentArea = String(area || 'industrial');
    runtime.flightObjective = {
        id: definition.id,
        target: definition.target,
        progress: 0,
        completed: false,
        area: runtime.currentArea,
    };
    runtime._damagedSinceCheckpoint = false;
}

export function registerEndlessPlayerDamage(runtime) {
    if (!runtime) return;
    runtime._damagedSinceCheckpoint = true;
    if (runtime.flightObjective?.id === 'three_clean_checkpoints' && !runtime.flightObjective.completed) {
        runtime.flightObjective.progress = 0;
    }
}

export function completeEndlessFlightObjective(runtime) {
    const objective = runtime?.flightObjective;
    if (!objective || objective.completed || objective.progress < objective.target) return false;
    objective.completed = true;
    runtime.flightObjectivesCompleted += 1;
    runtime.bonusScore += 400;
    runtime.collectRunXp?.('mission', 1);
    runtime.audio?.play?.('PARCOURS_FINISH');
    runtime.entityManager?._notifyPlayerFeedback?.(
        runtime.entityManager?.humanPlayers?.[0] || null,
        'Flugziel erfuellt +400'
    );
    return true;
}

export function registerEndlessObjectiveCheckpoint(runtime, moduleIndex, area) {
    syncEndlessFlightObjective(runtime, moduleIndex, area);
    const objective = runtime.flightObjective;
    if (objective?.id !== 'three_clean_checkpoints' || objective.completed) {
        runtime._damagedSinceCheckpoint = false;
        return;
    }
    if (!runtime._damagedSinceCheckpoint) objective.progress += 1;
    else objective.progress = 0;
    runtime._damagedSinceCheckpoint = false;
    completeEndlessFlightObjective(runtime);
}

export function registerEndlessObjectiveSideRoute(runtime) {
    const objective = runtime?.flightObjective;
    if (objective?.id !== 'risk_route' || objective.completed) return;
    objective.progress = 1;
    completeEndlessFlightObjective(runtime);
}

export function registerEndlessObjectiveShakeoff(runtime, count = 1) {
    const objective = runtime?.flightObjective;
    if (objective?.id !== 'shakeoff_two' || objective.completed) return;
    objective.progress = Math.min(objective.target, objective.progress + Math.max(0, Math.floor(Number(count) || 0)));
    completeEndlessFlightObjective(runtime);
}

export function updateEndlessSideRoute(runtime, human) {
    const instance = runtime?.activeModules?.get?.(runtime.currentModuleIndex);
    const route = instance?.module?.sideRoute;
    if (!route || !human?.position || runtime._rewardedSideRoutes.has(instance.module.moduleIndex)) return;
    syncEndlessFlightObjective(runtime, instance.module.moduleIndex, instance.module.area);
    const localZ = Number(human.position.z) - instance.module.originZ;
    let state = runtime._sideRouteStates.get(instance.module.moduleIndex);
    if (!state) {
        state = { entered: false, lastZ: localZ };
        runtime._sideRouteStates.set(instance.module.moduleIndex, state);
    }
    if (localZ < state.lastZ - 0.01) state.entered = false;
    const center = resolveModuleCenterAtZ(instance.module, Number(human.position.z));
    if (!state.entered && state.lastZ < route.entryZ && localZ >= route.entryZ
        && (Number(human.position.x) - center.x) * route.side >= 10) state.entered = true;
    if (state.entered && state.lastZ < route.exitZ && localZ >= route.exitZ) {
        runtime._rewardedSideRoutes.add(instance.module.moduleIndex);
        runtime.sideRoutesCompleted += 1;
        runtime.bonusScore += 200;
        registerEndlessObjectiveSideRoute(runtime);
        runtime.audio?.play?.('PARCOURS_BRANCH');
        runtime.entityManager?._notifyPlayerFeedback?.(human, 'Nebenweg +200');
    }
    state.lastZ = localZ;
}
import { resolveModuleCenterAtZ } from './EndlessParcoursModuleBuilder.js';
