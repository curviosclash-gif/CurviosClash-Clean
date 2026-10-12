import { readFileSync } from 'node:fs';

import { MAP_PRESET_CATALOG } from '../../src/core/config/maps/MapPresetCatalog.js';
import { getMapPickerMeta } from '../../src/shared/maps/MapPickerMeta.js';

export const RENDER_BUDGET_URL = new URL('../../scripts/architecture/map-render-budgets.json', import.meta.url);

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

export function readRenderBudget() {
    return JSON.parse(readFileSync(RENDER_BUDGET_URL, 'utf8'));
}
