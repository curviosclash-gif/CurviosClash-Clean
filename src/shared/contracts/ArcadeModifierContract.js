import {
    CONTENT_DESCRIPTOR_TYPES,
    createContentRegistryDescriptor,
} from './ContentDescriptorContract.js';

const ARCADE_MODIFIER_META = Object.freeze({
    tight_turns: Object.freeze({
        id: 'tight_turns',
        icon: 'TT',
        label: 'Tight Turns',
        effectText: 'Lenkrate -30%',
    }),
    heat_stress: Object.freeze({
        id: 'heat_stress',
        icon: 'HS',
        label: 'Heat Stress',
        effectText: '2.5 HP/s Drain',
    }),
    portal_storm: Object.freeze({
        id: 'portal_storm',
        icon: 'PS',
        label: 'Portal Storm',
        effectText: 'Spawnrate x2.0',
    }),
    boost_tax: Object.freeze({
        id: 'boost_tax',
        icon: 'BT',
        label: 'Boost Tax',
        effectText: 'Boost kostet 8 HP/s',
    }),
});

function normalizeModifierId(modifierId) {
    return typeof modifierId === 'string' ? modifierId.trim().toLowerCase() : '';
}

export function resolveArcadeModifierMeta(modifierId) {
    const normalizedId = normalizeModifierId(modifierId);
    return ARCADE_MODIFIER_META[normalizedId] || null;
}

export function listArcadeModifierDescriptors() {
    return Object.values(ARCADE_MODIFIER_META)
        .map((entry) => ({
            id: entry.id,
            label: entry.label,
            icon: entry.icon,
            effectText: entry.effectText,
        }))
        .sort((left, right) => left.id.localeCompare(right.id, 'en', { sensitivity: 'base' }));
}

export function getArcadeModifierRegistryDescriptor() {
    return createContentRegistryDescriptor({
        descriptorType: CONTENT_DESCRIPTOR_TYPES.ARCADE_MODIFIERS,
        source: 'src/shared/contracts/ArcadeModifierContract.js',
        entries: listArcadeModifierDescriptors(),
    });
}
