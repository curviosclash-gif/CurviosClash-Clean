import { MAP_PICKER_COLLECTION_DEFS, MAP_PICKER_FALLBACK_COLLECTION } from '../../shared/contracts/MapPickerMetaContract.js';
import { MAP_PICKER_META } from '../../shared/maps/MapPickerMeta.js';

// Collections and their order come from the shared map metadata table; the picker order of a map
// is its position among the table entries of the same collection. The parcours collection is a
// campaign: it runs from easy to hard (teaching 1-2, craft 3, mastery 4-5), and maps of equal
// difficulty keep their table order.
const SORTED_BY_DIFFICULTY = new Set(['parcours']);

const COLLECTION_DEFINITIONS = MAP_PICKER_COLLECTION_DEFS.map((collection) => {
    const mapKeys = Object.keys(MAP_PICKER_META).filter((mapKey) => MAP_PICKER_META[mapKey].collection === collection.id);
    if (SORTED_BY_DIFFICULTY.has(collection.id)) {
        mapKeys.sort((left, right) => MAP_PICKER_META[left].difficulty - MAP_PICKER_META[right].difficulty);
    }
    return { id: collection.id, label: collection.label, mapKeys };
});

const FALLBACK_COLLECTION = Object.freeze({
    id: MAP_PICKER_FALLBACK_COLLECTION.id,
    label: MAP_PICKER_FALLBACK_COLLECTION.label,
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
