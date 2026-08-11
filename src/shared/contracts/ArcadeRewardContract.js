import {
    CONTENT_DESCRIPTOR_TYPES,
    createContentRegistryDescriptor,
} from './ContentDescriptorContract.js';

const ARCADE_REWARD_META = Object.freeze({
    run_speed_t1: Object.freeze({
        id: 'run_speed_t1',
        label: 'Thruster Burst',
        effectText: '+4% Grundtempo (max. +20%)',
    }),
    run_armor_t1: Object.freeze({
        id: 'run_armor_t1',
        label: 'Reactive Hull',
        effectText: '+12 max. HP (max. +48)',
    }),
    run_combo_t1: Object.freeze({
        id: 'run_combo_t1',
        label: 'Combo Buffer',
        effectText: '+0.8s Combo-Fenster (max. +3.2s)',
    }),
    run_pickup_t1: Object.freeze({
        id: 'run_pickup_t1',
        label: 'Salvage Scanner',
        effectText: 'Item-Spawnrate x1.15 (max. x1.75)',
    }),
    run_portal_t1: Object.freeze({
        id: 'run_portal_t1',
        label: 'Portal Line',
        effectText: '+25% Schildumwandlung (max. +100%)',
    }),
});

function normalizeRewardId(rewardId) {
    return typeof rewardId === 'string' ? rewardId.trim().toLowerCase() : '';
}

export function resolveArcadeRewardMeta(rewardId) {
    const normalized = normalizeRewardId(rewardId);
    return ARCADE_REWARD_META[normalized] || null;
}

export function listArcadeRewardMeta() {
    return Object.values(ARCADE_REWARD_META);
}

export function listArcadeRewardDescriptors() {
    return Object.values(ARCADE_REWARD_META)
        .map((entry) => ({
            id: entry.id,
            label: entry.label,
            effectText: entry.effectText,
        }))
        .sort((left, right) => left.id.localeCompare(right.id, 'en', { sensitivity: 'base' }));
}

export function getArcadeRewardRegistryDescriptor() {
    return createContentRegistryDescriptor({
        descriptorType: CONTENT_DESCRIPTOR_TYPES.ARCADE_REWARDS,
        source: 'src/shared/contracts/ArcadeRewardContract.js',
        entries: listArcadeRewardDescriptors(),
    });
}
