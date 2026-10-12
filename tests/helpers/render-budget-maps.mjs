import { MAP_PRESET_CATALOG } from '../../src/core/config/maps/MapPresetCatalog.js';
import { getMapPickerMeta } from '../../src/shared/maps/MapPickerMeta.js';

/**
 * Maps a player can pick: everything in the catalog except development maps (tier "dev",
 * behind the Showcase filter), maps hidden from the picker and the editor slot "custom",
 * whose content the player builds. These carry a render budget.
 * @returns {string[]}
 */
export function listRenderBudgetMapKeys() {
    return Object.keys(MAP_PRESET_CATALOG)
        .filter((key) => getMapPickerMeta(key)?.tier !== 'dev')
        .filter((key) => getMapPickerMeta(key)?.collection !== 'custom')
        .filter((key) => !MAP_PRESET_CATALOG[key]?.hiddenFromMapPicker);
}
