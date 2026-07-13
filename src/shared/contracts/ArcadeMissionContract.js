// ─── Arcade Mission Contract: Shared Type Definitions & Formatters ───
// Layer: Shared (UI & State can both depend on this)
// Purpose: Decouple UI (ArcadeMissionHUD) from State (ArcadeMissionState) via shared contracts

import {
    CONTENT_DESCRIPTOR_TYPES,
    createContentRegistryDescriptor,
} from './ContentDescriptorContract.js';

function freezeMissionType(typeDef) {
    const defaultParams = typeDef.defaultParams && typeof typeDef.defaultParams === 'object'
        ? Object.freeze({ ...typeDef.defaultParams })
        : Object.freeze({});
    return Object.freeze({
        ...typeDef,
        defaultParams,
    });
}

export const MISSION_TYPES = Object.freeze({
    KILL_COUNT: freezeMissionType({
        id: 'KILL_COUNT',
        label: 'Eliminate',
        icon: 'crosshair',
        defaultParams: { target: 5 },
        check: (progress) => (progress.kills || 0) >= (progress.target || 5),
        format: (progress) => `${Math.min(progress.kills || 0, progress.target || 5)}/${progress.target || 5}`,
    }),
    COLLECT_ITEMS: freezeMissionType({
        id: 'COLLECT_ITEMS',
        label: 'Collect',
        icon: 'gem',
        defaultParams: { target: 3 },
        check: (progress) => (progress.collected || 0) >= (progress.target || 3),
        format: (progress) => `${Math.min(progress.collected || 0, progress.target || 3)}/${progress.target || 3}`,
    }),
    SURVIVE_DURATION: freezeMissionType({
        id: 'SURVIVE_DURATION',
        label: 'Survive',
        icon: 'clock',
        defaultParams: { target: 45 },
        check: (progress) => (progress.survived || 0) >= (progress.target || 45),
        format: (progress) => `${Math.floor(progress.survived || 0)}/${progress.target || 45}s`,
    }),
    REACH_PORTAL: freezeMissionType({
        id: 'REACH_PORTAL',
        label: 'Reach Exit',
        icon: 'portal',
        defaultParams: {},
        check: (progress) => progress.reached === true,
        format: (progress) => progress.reached ? 'Done' : 'Find the exit portal',
    }),
    TIME_TRIAL: freezeMissionType({
        id: 'TIME_TRIAL',
        label: 'Speed Run',
        icon: 'stopwatch',
        defaultParams: { target: 30 },
        check: (progress) => progress.elapsed > 0 && progress.elapsed <= (progress.target || 30),
        format: (progress) => `${Math.floor(progress.elapsed || 0)}/${progress.target || 30}s`,
    }),
    // 61.3.1 — New mission types
    NO_DAMAGE: freezeMissionType({
        id: 'NO_DAMAGE',
        label: 'No Damage',
        icon: 'shield',
        defaultParams: {},
        check: (progress) => progress.sectorCompleted === true && progress.hitCount === 0,
        format: (progress) => (progress.hitCount || 0) === 0 ? 'Untouched' : `Hits: ${progress.hitCount}`,
    }),
    MULTI_KILL: freezeMissionType({
        id: 'MULTI_KILL',
        label: 'Multi-Kill',
        icon: 'burst',
        defaultParams: { target: 3, windowSec: 15 },
        check: (progress) => (progress.windowKills || 0) >= (progress.target || 3),
        format: (progress) => `${Math.min(progress.windowKills || 0, progress.target || 3)}/${progress.target || 3} in ${progress.windowSec || 15}s`,
    }),
    TRAIL_MASTER: freezeMissionType({
        id: 'TRAIL_MASTER',
        label: 'Trail Master',
        icon: 'trail',
        defaultParams: { target: 100 },
        check: (progress) => (progress.metersSafe || 0) >= (progress.target || 100),
        format: (progress) => `${Math.floor(progress.metersSafe || 0)}/${progress.target || 100}m`,
    }),
    // 61.3.2 — Additional new mission types
    ITEM_CHAIN: freezeMissionType({
        id: 'ITEM_CHAIN',
        label: 'Item Chain',
        icon: 'chain',
        defaultParams: { target: 3 },
        check: (progress) => (progress.chain || 0) >= (progress.target || 3),
        format: (progress) => `${Math.min(progress.chain || 0, progress.target || 3)}/${progress.target || 3} chain`,
    }),
    CLOSE_CALL: freezeMissionType({
        id: 'CLOSE_CALL',
        label: 'Close Call',
        icon: 'heartbeat',
        defaultParams: { target: 3 },
        check: (progress) => (progress.count || 0) >= (progress.target || 3),
        format: (progress) => `${Math.min(progress.count || 0, progress.target || 3)}/${progress.target || 3} survived`,
    }),
});

/**
 * Format mission progress for display.
 * @param {Object} mission - Mission object with progress/completed fields
 * @returns {string} Formatted progress string
 */
export function formatMissionProgress(mission) {
    if (!mission || typeof mission !== 'object') return '';
    const typeDef = MISSION_TYPES[mission.type];
    if (!typeDef) return '';
    return typeDef.format(mission.progress || {});
}

export function listArcadeMissionDescriptors() {
    // Runtime consumers use this descriptor list to validate authored mission pools before instantiation.
    return Object.values(MISSION_TYPES)
        .map((typeDef) => ({
            id: typeDef.id,
            label: typeDef.label,
            icon: typeDef.icon,
            defaultParams: typeDef.defaultParams && typeof typeDef.defaultParams === 'object'
                ? { ...typeDef.defaultParams }
                : {},
        }))
        .sort((left, right) => left.id.localeCompare(right.id, 'en', { sensitivity: 'base' }));
}

export function getArcadeMissionRegistryDescriptor() {
    return createContentRegistryDescriptor({
        descriptorType: CONTENT_DESCRIPTOR_TYPES.ARCADE_MISSIONS,
        source: 'src/shared/contracts/ArcadeMissionContract.js',
        entries: listArcadeMissionDescriptors(),
    });
}

export default {
    MISSION_TYPES,
    formatMissionProgress,
};
