// ─── Arcade Mission System: Types, Progress Tracking, Completion ───

import {
    MISSION_TYPES,
    formatMissionProgress,
    listArcadeMissionDescriptors,
} from '../../shared/contracts/ArcadeMissionContract.js';
import { toSafeNumber, createSeededRandom, normalizeSeed } from '../../shared/utils/ArcadeUtils.js';

const MISSION_DESCRIPTOR_TYPE_IDS = new Set(listArcadeMissionDescriptors().map((entry) => entry.id));

function isKnownMissionType(typeId) {
    const normalizedTypeId = String(typeId || '').trim();
    return normalizedTypeId.length > 0 && MISSION_DESCRIPTOR_TYPE_IDS.has(normalizedTypeId);
}

// ─── Mission Instance ───

export function createMissionInstance(typeId, params = {}) {
    const typeDef = MISSION_TYPES[typeId];
    if (!typeDef || !isKnownMissionType(typeId)) return null;
    const mergedParams = { ...typeDef.defaultParams, ...params };
    const initialProgress = typeId === 'NO_DAMAGE'
        ? { ...mergedParams, hitCount: 0, sectorCompleted: false }
        : { ...mergedParams };
    return {
        id: `${typeId}-${Date.now().toString(36)}`,
        type: typeId,
        label: typeDef.label,
        icon: typeDef.icon,
        params: mergedParams,
        progress: initialProgress,
        completed: false,
    };
}

// ─── Progress Updates ───

export function updateMissionProgress(mission, event) {
    if (!mission || mission.completed) return mission;
    const progress = { ...mission.progress };

    switch (mission.type) {
        case 'KILL_COUNT':
            if (event.type === 'kill') {
                progress.kills = (progress.kills || 0) + toSafeNumber(event.count, 1);
            }
            break;
        case 'COLLECT_ITEMS':
            if (event.type === 'collect') {
                progress.collected = (progress.collected || 0) + toSafeNumber(event.count, 1);
            }
            break;
        case 'SURVIVE_DURATION':
            if (event.type === 'tick') {
                progress.survived = toSafeNumber(event.elapsed, progress.survived);
            }
            break;
        case 'REACH_PORTAL':
            if (event.type === 'exit_portal') {
                progress.reached = true;
            }
            break;
        case 'TIME_TRIAL':
            if (event.type === 'sector_complete') {
                progress.elapsed = toSafeNumber(event.elapsed, 0);
            }
            break;
        // 61.3.1 — New mission types
        case 'NO_DAMAGE':
            if (event.type === 'damage' || event.type === 'hit') {
                progress.hitCount = (progress.hitCount || 0) + 1;
            } else if (event.type === 'sector_complete') {
                progress.sectorCompleted = true;
            }
            break;
        case 'MULTI_KILL': {
            if (event.type === 'kill') {
                const nowMs = toSafeNumber(event.nowMs, Date.now());
                const windowSec = toSafeNumber(progress.windowSec || mission.params?.windowSec, 15);
                const windowMs = windowSec * 1000;
                const times = Array.isArray(progress.killTimes) ? [...progress.killTimes] : [];
                times.push(nowMs);
                // Keep only kills within the rolling window
                const cutoff = nowMs - windowMs;
                const recentKills = times.filter((t) => t >= cutoff);
                progress.killTimes = recentKills;
                progress.windowKills = recentKills.length;
            }
            break;
        }
        case 'TRAIL_MASTER':
            if (event.type === 'trail_extend') {
                progress.metersSafe = (progress.metersSafe || 0) + Math.max(0, toSafeNumber(event.delta, 0));
            } else if (event.type === 'self_collision') {
                progress.metersSafe = 0;
            }
            break;
        // 61.3.2 — Additional new mission types
        case 'ITEM_CHAIN': {
            if (event.type === 'collect') {
                const nowMs = toSafeNumber(event.nowMs, Date.now());
                const gapMs = 10000; // 10s gap resets chain
                const lastMs = toSafeNumber(progress.lastPickupMs, 0);
                if (lastMs > 0 && (nowMs - lastMs) <= gapMs) {
                    progress.chain = (progress.chain || 1) + 1;
                } else {
                    progress.chain = 1;
                }
                progress.lastPickupMs = nowMs;
            }
            break;
        }
        case 'CLOSE_CALL': {
            if (event.type === 'health_update' || event.type === 'damage') {
                const hp = toSafeNumber(event.hp, 100);
                const maxHp = Math.max(1, toSafeNumber(event.maxHp, 100));
                const isLow = (hp / maxHp) < 0.20;
                const wasLow = progress.wasLowHealth === true;
                if (isLow && !wasLow) {
                    progress.count = (progress.count || 0) + 1;
                }
                progress.wasLowHealth = isLow;
            }
            break;
        }
        default:
            return mission;
    }

    const typeDef = MISSION_TYPES[mission.type];
    const completed = typeDef ? typeDef.check(progress) : false;

    return { ...mission, progress, completed };
}

export function checkMissionComplete(mission) {
    if (!mission || typeof mission !== 'object') return false;
    const typeDef = MISSION_TYPES[mission.type];
    if (!typeDef) return false;
    return typeDef.check(mission.progress || {});
}

// formatMissionProgress is now exported from ArcadeMissionContract
// (re-exported below for backwards compatibility)

// ─── Mission Assignment ───

export function assignSectorMissions(sectorTemplate, mapMissions, seed, sectorNumber) {
    const assignmentSeed = `${seed}-missions-${sectorNumber}`;
    const randomFn = createSeededRandom(assignmentSeed);
    const missionCount = 1 + (randomFn() > 0.5 ? 1 : 0); // 1-2 missions

    // Build weighted pool from map-specific missions, or fallback to generic
    let pool = [];
    if (Array.isArray(mapMissions) && mapMissions.length > 0) {
        pool = mapMissions;
    } else {
        // Generic fallback pool based on sector template
        const templateId = String(sectorTemplate?.id || sectorTemplate || 'sector_intro');
        pool = buildGenericMissionPool(templateId);
    }
    pool = pool.filter((entry) => isKnownMissionType(entry?.type));

    if (pool.length === 0) return [];

    const missions = [];
    const usedTypes = new Set();

    for (let i = 0; i < missionCount && pool.length > 0; i += 1) {
        // Weighted random selection
        const totalWeight = pool.reduce((sum, entry) => sum + toSafeNumber(entry.weight, 1), 0);
        let roll = randomFn() * totalWeight;
        let chosen = pool[0];

        for (let j = 0; j < pool.length; j += 1) {
            roll -= toSafeNumber(pool[j].weight, 1);
            if (roll <= 0) {
                chosen = pool[j];
                break;
            }
        }

        // Avoid duplicate mission types in same sector
        if (usedTypes.has(chosen.type) && pool.length > 1) {
            const alternatives = pool.filter((m) => !usedTypes.has(m.type));
            if (alternatives.length > 0) {
                chosen = alternatives[Math.floor(randomFn() * alternatives.length)];
            }
        }

        const instance = createMissionInstance(chosen.type, chosen.params);
        if (instance) {
            instance.id = `${chosen.type.toLowerCase()}-${normalizeSeed(`${assignmentSeed}:${i}:${chosen.type}`).toString(36)}`;
            missions.push(instance);
            usedTypes.add(chosen.type);
        }
    }

    // 61.3.4: Optional bonus mission in non-intro sectors (50% chance, harder params)
    const templateId = String(sectorTemplate?.id || sectorTemplate || 'sector_intro');
    if (templateId !== 'sector_intro' && randomFn() < 0.5) {
        const bonusPool = buildBonusMissionPool(templateId, usedTypes);
        if (bonusPool.length > 0) {
            const bonusEntry = bonusPool[Math.floor(randomFn() * bonusPool.length)];
            const bonusInstance = createMissionInstance(bonusEntry.type, bonusEntry.params);
            if (bonusInstance) {
                bonusInstance.id = `${bonusEntry.type.toLowerCase()}-${normalizeSeed(`${assignmentSeed}:bonus:${bonusEntry.type}`).toString(36)}`;
                bonusInstance.bonus = true;
                missions.push(bonusInstance);
            }
        }
    }

    return missions;
}

function buildBonusMissionPool(templateId, usedTypes = new Set()) {
    const allBonus = {
        sector_pressure: [
            { type: 'MULTI_KILL', params: { target: 4, windowSec: 12 } },
            { type: 'NO_DAMAGE', params: {} },
            { type: 'TRAIL_MASTER', params: { target: 120 } },
        ],
        sector_hazard: [
            { type: 'MULTI_KILL', params: { target: 5, windowSec: 10 } },
            { type: 'KILL_COUNT', params: { target: 10 } },
            { type: 'TRAIL_MASTER', params: { target: 200 } },
        ],
        sector_endurance: [
            { type: 'MULTI_KILL', params: { target: 6, windowSec: 10 } },
            { type: 'KILL_COUNT', params: { target: 15 } },
            { type: 'CLOSE_CALL', params: { target: 4 } },
        ],
    };
    const pool = allBonus[templateId] || allBonus.sector_pressure;
    return pool.filter((entry) => !usedTypes.has(entry.type));
}

function buildGenericMissionPool(templateId) {
    // 61.3.3: Kill targets scale more aggressively (3->5->8->12->18 goal)
    switch (templateId) {
        case 'sector_intro':
            return [
                { type: 'KILL_COUNT', params: { target: 3 }, weight: 2 },
                { type: 'SURVIVE_DURATION', params: { target: 30 }, weight: 1 },
                { type: 'NO_DAMAGE', params: {}, weight: 1 },
                { type: 'ITEM_CHAIN', params: { target: 3 }, weight: 0.8 },
            ];
        case 'sector_pressure':
            return [
                { type: 'KILL_COUNT', params: { target: 5 }, weight: 2 },
                { type: 'SURVIVE_DURATION', params: { target: 45 }, weight: 1.5 },
                { type: 'COLLECT_ITEMS', params: { target: 3 }, weight: 1 },
                { type: 'MULTI_KILL', params: { target: 3, windowSec: 15 }, weight: 1.2 },
                { type: 'TRAIL_MASTER', params: { target: 80 }, weight: 1 },
            ];
        case 'sector_hazard':
            return [
                { type: 'KILL_COUNT', params: { target: 8 }, weight: 1.5 },
                { type: 'SURVIVE_DURATION', params: { target: 55 }, weight: 1 },
                { type: 'TIME_TRIAL', params: { target: 40 }, weight: 1.5 },
                { type: 'MULTI_KILL', params: { target: 4, windowSec: 12 }, weight: 1.3 },
                { type: 'CLOSE_CALL', params: { target: 2 }, weight: 0.8 },
            ];
        case 'sector_endurance':
            return [
                { type: 'KILL_COUNT', params: { target: 12 }, weight: 2 },
                { type: 'SURVIVE_DURATION', params: { target: 60 }, weight: 1 },
                { type: 'REACH_PORTAL', params: {}, weight: 1.5 },
                { type: 'MULTI_KILL', params: { target: 5, windowSec: 10 }, weight: 1.2 },
                { type: 'TRAIL_MASTER', params: { target: 150 }, weight: 1 },
                { type: 'CLOSE_CALL', params: { target: 3 }, weight: 0.9 },
            ];
        default:
            return [
                { type: 'KILL_COUNT', params: { target: 5 }, weight: 2 },
                { type: 'SURVIVE_DURATION', params: { target: 40 }, weight: 1 },
            ];
    }
}

// ─── Sector Mission State ───

export function createSectorMissionState(missions) {
    return {
        missions: Array.isArray(missions) ? missions : [],
        allCompleted: false,
        completedCount: 0,
    };
}

export function updateSectorMissionState(state, event) {
    if (!state || !Array.isArray(state.missions)) return state;
    let changed = false;
    const missions = state.missions.map((mission) => {
        if (mission.completed) return mission;
        const updated = updateMissionProgress(mission, event);
        if (updated !== mission) changed = true;
        return updated;
    });
    if (!changed) return state;
    const completedCount = missions.filter((m) => m.completed).length;
    return {
        missions,
        completedCount,
        allCompleted: completedCount === missions.length && missions.length > 0,
    };
}

export default {
    MISSION_TYPES,
    createMissionInstance,
    updateMissionProgress,
    checkMissionComplete,
    formatMissionProgress,
    assignSectorMissions,
    createSectorMissionState,
    updateSectorMissionState,
};
