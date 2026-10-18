import * as THREE from 'three';
import { sampleEndlessPortRoute } from './EndlessParcoursSidePort.js';
import { ENDLESS_PARCOURS_MODULE_LENGTH } from '../../shared/contracts/EndlessParcoursContract.js';

export const ENDLESS_HUNTER_SPEED_MULTIPLIER = 1.12;

function permanentSpeed(player) {
    const neutral = Number(player?._speedEffectBaseSpeed);
    return Number.isFinite(neutral) && neutral > 0 ? neutral : Math.max(0, Number(player?.baseSpeed) || 0);
}

export function syncEndlessHunterSpeed(runtime, player) {
    const human = runtime.entityManager?.humanPlayers?.[0];
    if (runtime._disposed || runtime._finalized || !human?.alive || !player?.alive
        || player.entitySlotActive === false || player.endlessRunId !== runtime.runId
        || typeof player.setControlOptions !== 'function') return false;
    const target = permanentSpeed(human) * ENDLESS_HUNTER_SPEED_MULTIPLIER;
    const current = permanentSpeed(player);
    if (!(target > 0) || Math.abs(current - target) < 1e-8) return false;
    // Player.setControlOptions preserves the strategy/upgrade ratio. Divide it out
    // once so the requested permanent speed is exact, including after a pickup.
    const strategyBase = Number(player._arcadeBaseSpeed) > 0 ? Number(player._arcadeBaseSpeed) : Number(player._fightBaseSpeed);
    const ratio = strategyBase > 0 && current > 0 ? current / strategyBase : 1;
    runtime._hunterSpeedOptions.speed = target / ratio;
    player.setControlOptions(runtime._hunterSpeedOptions);
    return true;
}

export function syncEndlessHunterSpeeds(runtime) {
    for (const slot of runtime._botSlots) {
        if (slot.state === 'active') syncEndlessHunterSpeed(runtime, slot.player);
    }
}

/** Bounded, borrowed route snapshots for bots only; the normal UI route stays unchanged. */
export function getEndlessHunterRoute(runtime, playerIndex) {
    if (runtime._disposed || runtime._finalized || !Number.isInteger(playerIndex) || !runtime.activeModules.size) return null;
    let player = null;
    for (const slot of runtime._botSlots) {
        if (slot.player?.index === playerIndex && slot.state === 'active') { player = slot.player; break; }
    }
    if (!player?.alive || player.entitySlotActive === false || player.endlessRunId !== runtime.runId
        || !Number.isFinite(player.position?.z)
        || !runtime.activeModules.has(Math.floor(player.position.z / ENDLESS_PARCOURS_MODULE_LENGTH))) return null;
    const projected = runtime.projectCoursePoint(player.position);
    if (!projected) return null;
    const botS = projected.s;
    let minIndex = Infinity, maxIndex = -Infinity;
    for (const index of runtime.activeModules.keys()) { minIndex = Math.min(minIndex, index); maxIndex = Math.max(maxIndex, index); }
    const metric = runtime.getPathMetric();
    const minS = metric.getStationRange(minIndex).startS + 2;
    const maxS = metric.getStationRange(maxIndex).endS - 2;
    const targetS = Math.max(minS, Math.min(maxS, botS + (botS > runtime.currentProgressMeters + 40 ? -32 : 32)));
    let route = runtime._hunterRoutes.get(playerIndex);
    if (!route) {
        route = { enabled: true, kind: 'endless_hunter', runId: runtime.runId, totalCheckpoints: 1,
            checkpoints: [{ id: `hunter:${playerIndex}`, routeIndex: 0, pos: new THREE.Vector3() }] };
        runtime._hunterRoutes.set(playerIndex, route);
    }
    if (player.endlessPortId) {
        for (const instance of runtime.activeModules.values()) {
            if (instance.sidePort?.id === player.endlessPortId
                && sampleEndlessPortRoute(instance.sidePort, player.position, route.checkpoints[0].pos)) return route;
        }
    }
    metric.sampleAtS(targetS, runtime._hunterFrame);
    route.checkpoints[0].pos.copy(runtime._hunterFrame.position);
    return route;
}
