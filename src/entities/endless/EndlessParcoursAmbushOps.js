import { deriveEndlessSeed } from '../../shared/contracts/EndlessParcoursContract.js';
import { ENDLESS_PARCOURS_WAVE_TIMING } from '../../shared/contracts/EndlessParcoursWaveContract.js';
import { createEndlessPathSample } from './EndlessParcoursPathMetric.js';
import { resolveEndlessCoursePoint } from './EndlessParcoursCourseSpace.js';

const FRAME = createEndlessPathSample();
const SIZE = 3;

/** A formation owns existing reservations; it never adds capacity or replaces elites. */
export function assignEndlessAmbush(runtime) {
    if (runtime.waveNumber < 4 || runtime.waveNumber % 4 || runtime._ambushWavePlanned === runtime.waveNumber) return;
    const slots = runtime._botSlots.filter(s => s.state === 'reserved' && !s.plannedElite).slice(0, SIZE);
    if (slots.length !== SIZE) return;
    runtime._ambushWavePlanned = runtime.waveNumber;
    runtime._ambushId = `ambush:${runtime.runId}:${runtime.waveNumber}`;
    for (const slot of slots) slot.ambushId = runtime._ambushId;
}

export function isEndlessAmbushAnchorLoaded(runtime, anchor) {
    return Boolean(anchor?.ambushId && anchor.ambushId === runtime._ambushId
        && runtime.activeModules.has(anchor.ambushModuleIndex));
}

/** Plan all anchors before announcing any. Blocked geometry waits for a later module. */
export function prepareEndlessAmbush(runtime, slots) {
    if (!slots.length) return false;
    const human = runtime.entityManager?.humanPlayers?.[0];
    if (!human?.alive) return false;
    if (slots.every(s => s.plannedAnchor && s.telegraphedAt >= 0)) return true;
    const angle = (deriveEndlessSeed(runtime.baseSeed, `ambush:${runtime.waveNumber}`) % 360) * Math.PI / 180;
    for (const instance of runtime.activeModules.values()) {
        const module = instance.module;
        if (module.recovery) continue;
        const anchors = [];
        for (let member = 0; member < slots.length; member++) {
            const theta = angle + member * Math.PI * 2 / SIZE;
            const point = resolveEndlessCoursePoint(module, Math.cos(theta) * 16, Math.sin(theta) * 16, 96, FRAME).position;
            const anchor = { id: `${runtime._ambushId}:${module.moduleIndex}:${member}`, x: point.x, y: point.y, z: point.z,
                ahead: true, ambushId: runtime._ambushId, ambushModuleIndex: module.moduleIndex };
            // All members are ahead of the human in station space as well as safely distant.
            if (runtime.projectCoursePoint(anchor)?.s < runtime.currentProgressMeters + 60
                || !runtime._isSpawnAnchorSafe(anchor, human)) break;
            anchors.push(anchor);
        }
        if (anchors.length !== slots.length) continue;
        for (let member = 0; member < slots.length; member++) {
            slots[member].plannedAnchor = anchors[member];
            slots[member].telegraphedAt = runtime.elapsedCombatSeconds;
        }
        runtime.spawnWarning = { side: 'ahead', count: slots.length, ambush: true,
            remaining: ENDLESS_PARCOURS_WAVE_TIMING.telegraphSeconds, elite: false };
        runtime.audio?.play?.('PARCOURS_BRANCH');
        return true;
    }
    return false;
}

/** Recheck the whole formation immediately before activation, including mutual spacing. */
export function isEndlessAmbushReady(runtime, slots) {
    const human = runtime.entityManager?.humanPlayers?.[0];
    for (let i = 0; i < slots.length; i++) {
        const slot = slots[i], anchor = slot.plannedAnchor;
        if (!isEndlessAmbushAnchorLoaded(runtime, anchor) || !runtime._isSpawnAnchorSafe(anchor, human)) {
            for (const member of slots) { member.plannedAnchor = null; member.telegraphedAt = -1; }
            return false;
        }
        for (let j = 0; j < i; j++) {
            const other = slots[j].plannedAnchor;
            const dx = anchor.x - other.x, dy = anchor.y - other.y, dz = anchor.z - other.z;
            if (dx * dx + dy * dy + dz * dz < 18 * 18) return false;
        }
    }
    return true;
}
