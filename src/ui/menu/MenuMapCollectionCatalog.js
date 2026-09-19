const COLLECTION_DEFINITIONS = [
    {
        id: 'arena',
        label: 'Arenen',
        mapKeys: [
            'standard', 'empty', 'maze', 'complex', 'pyramid', 'vertical_maze',
            'trench', 'notre_dame_arena', 'notre_dame_fire_arena', 'eiffel_tower_arena',
            'eiffel_tower_siege', 'reactor_site', 'burg_falkenwacht_arena',
        ],
    },
    {
        id: 'themed',
        label: 'Themenwelten',
        mapKeys: [
            'foam_forest',
            'crossfire',
            'checkerboard',
            'the_pit',
            'core_fusion',
            'pillar_hall',
            'spiral_tower',
            'portal_madness',
            'the_loop',
        ],
    },
    {
        id: 'adventure',
        label: 'Abenteuer',
        mapKeys: [
            'rift_bazaar',
            'aether_relay',
            'neon_abyss',
            'crystal_ruins',
            'vulkan_odyssey',
            'frozen_helix',
            'neon_circuit',
            'sky_islands',
            'abyssal_descent',
            'magma_maze',
            'chrono_forge_nexus',
            'eclipse_foundry',
            'kinetic_tide',
            'verdant_aperture',
            'dandelion_sky',
            'aetherion_orrery',
            'notre_dame',
            'notre_dame_fire',
            'eiffel_tower',
            'burg_falkenwacht',
            'clockwork_canyon',
            'storm_bridge_siege',
        ],
    },
    {
        id: 'parcours',
        label: 'Parcours',
        mapKeys: [
            'tutorial_classic',
            'parcours_assault',
            'parcours_rift',
            'parcours_rift_sprint',
            'parcours_rift_precision',
            'micro_maw',
            'mirror_docks',
            'glass_serpent',
            'storm_switchyard',
            'wind_cathedral',
            'chrono_spillway',
        ],
    },
    {
        id: 'expert',
        label: 'Expertenkarten',
        mapKeys: ['expert_gauntlet', 'mega_maze', 'mega_maze_xl', 'die_festung'],
    },
    {
        id: 'showcase',
        label: 'Showcase & Tests',
        mapKeys: ['glb_hangar', 'upgrade_showcase', 'item_showcase', 'showcase_nexus', 'glb_gallery'],
    },
    {
        id: 'custom',
        label: 'Eigene Karten',
        mapKeys: ['custom'],
    },
];

const FALLBACK_COLLECTION = Object.freeze({
    id: 'other',
    label: 'Weitere Karten',
    order: COLLECTION_DEFINITIONS.length,
    pickerOrder: Number.MAX_SAFE_INTEGER,
});

export const MAP_PICKER_COLLECTIONS = Object.freeze(COLLECTION_DEFINITIONS.map((collection, order) => Object.freeze({
    id: collection.id,
    label: collection.label,
    order,
    mapKeys: Object.freeze([...collection.mapKeys]),
})));

const COLLECTION_BY_MAP_KEY = new Map();
MAP_PICKER_COLLECTIONS.forEach((collection) => {
    collection.mapKeys.forEach((mapKey, pickerOrder) => {
        COLLECTION_BY_MAP_KEY.set(mapKey, Object.freeze({
            id: collection.id,
            label: collection.label,
            order: collection.order,
            pickerOrder,
        }));
    });
});

export function resolveMapPickerCollection(mapKey) {
    return COLLECTION_BY_MAP_KEY.get(String(mapKey || '').trim()) || FALLBACK_COLLECTION;
}

export function compareMapPickerEntries(left, right) {
    const collectionOrder = Number(left?.collectionOrder) - Number(right?.collectionOrder);
    if (collectionOrder !== 0) return collectionOrder;
    const pickerOrder = Number(left?.pickerOrder) - Number(right?.pickerOrder);
    if (pickerOrder !== 0) return pickerOrder;
    return String(left?.name || left?.key || '').localeCompare(
        String(right?.name || right?.key || ''),
        'de',
        { sensitivity: 'base' }
    );
}
