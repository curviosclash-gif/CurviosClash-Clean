// Product configuration for headless training runs.
//
// Without a base config the headless session finds no map presets and silently builds an unscaled
// 80x30x80 fallback box instead of the product arena. The GLB worlds are left out because the
// headless loader cannot rebuild them after disposal; size, scale and preset obstacles stay.

import { CONFIG_BASE } from '../../../../src/core/Config.js';

export const HEADLESS_PRODUCT_BASE_CONFIG = Object.freeze({
    ...CONFIG_BASE,
    MAPS: Object.freeze(Object.fromEntries(Object.entries(CONFIG_BASE.MAPS).map(([mapKey, preset]) => [
        mapKey,
        { ...preset, glbModels: [] },
    ]))),
});

export function verifyHeadlessProductArena(arena, mapKey, baseConfig = HEADLESS_PRODUCT_BASE_CONFIG) {
    const preset = baseConfig.MAPS[mapKey];
    const scale = Number(baseConfig.ARENA.MAP_SCALE);
    const bounds = arena?.bounds;
    const dimensions = [
        Number(bounds?.maxX) - Number(bounds?.minX),
        Number(bounds?.maxY) - Number(bounds?.minY),
        Number(bounds?.maxZ) - Number(bounds?.minZ),
    ];
    if (!preset || arena?.currentMapKey !== mapKey
        || dimensions.some((value, index) => Math.abs(value - Number(preset.size[index]) * scale) > 0.001)) {
        throw new Error(`headless arena mismatch for ${mapKey}: built ${arena?.currentMapKey} ${dimensions.join('x')}`);
    }
}
