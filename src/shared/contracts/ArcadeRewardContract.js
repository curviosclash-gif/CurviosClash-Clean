import {
    CONTENT_DESCRIPTOR_TYPES,
    createContentRegistryDescriptor,
} from './ContentDescriptorContract.js';

const ARCADE_REWARD_META = Object.freeze({
    run_speed_t1: Object.freeze({
        id: 'run_speed_t1',
        label: 'Thruster Burst',
        effectText: '+8% Intermission-Heal',
    }),
    run_armor_t1: Object.freeze({
        id: 'run_armor_t1',
        label: 'Reactive Hull',
        effectText: '+16% Intermission-Heal',
    }),
    run_combo_t1: Object.freeze({
        id: 'run_combo_t1',
        label: 'Combo Buffer',
        effectText: 'Combo-Freeze +1.2s',
    }),
    run_pickup_t1: Object.freeze({
        id: 'run_pickup_t1',
        label: 'Salvage Scanner',
        effectText: '+6% Intermission-Heal',
    }),
    run_portal_t1: Object.freeze({
        id: 'run_portal_t1',
        label: 'Portal Line',
        effectText: '+10% Shield-Topup',
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
