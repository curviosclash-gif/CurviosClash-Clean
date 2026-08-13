import { VIEWPORT_LAYOUTS } from '../shared/contracts/ViewportLayoutContract.js';

export const SPLIT_SCREEN_VARIANTS = Object.freeze({
    STANDARD: 'standard',
    FOUR_PLAYER_PLANAR: 'four_player_planar',
});

export const FOUR_PLAYER_PLANAR_MODES = Object.freeze({
    CLASSIC: 'classic',
    HUNT: 'hunt',
});

export const FOUR_PLAYER_PLANAR_MAX_BOTS = 6;
export const FOUR_PLAYER_PLANAR_HUMAN_COUNT = 4;
export const FOUR_PLAYER_PLANAR_MAX_PARTICIPANTS = 10;
export const FOUR_PLAYER_PLANAR_VIEWPORT_LAYOUT = VIEWPORT_LAYOUTS.FOUR_GRID;

export const FOUR_PLAYER_PLANAR_PLAYER_COLORS = Object.freeze([
    0x33d6ff,
    0xff4d7d,
    0x7dff6a,
    0xffd34d,
]);

export const FOUR_PLAYER_PLANAR_KEY_BINDINGS = Object.freeze([
    Object.freeze({ left: 'KeyA', right: 'KeyD', action: 'KeyW', label: 'A / D / W' }),
    Object.freeze({ left: 'KeyJ', right: 'KeyL', action: 'KeyI', label: 'J / L / I' }),
    Object.freeze({ left: 'ArrowLeft', right: 'ArrowRight', action: 'ArrowUp', label: '← / → / ↑' }),
    Object.freeze({ left: 'Numpad4', right: 'Numpad6', action: 'Numpad8', label: 'Num 4 / 6 / 8' }),
]);

export function normalizeSplitScreenVariant(value) {
    return value === SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR
        ? SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR
        : SPLIT_SCREEN_VARIANTS.STANDARD;
}

export function normalizeFourPlayerPlanarMode(value) {
    return String(value || '').trim().toLowerCase() === FOUR_PLAYER_PLANAR_MODES.HUNT
        ? FOUR_PLAYER_PLANAR_MODES.HUNT
        : FOUR_PLAYER_PLANAR_MODES.CLASSIC;
}

function normalizeSelection(value, allowedValues, fallback) {
    const candidate = String(value || '').trim();
    if (candidate && (!allowedValues || allowedValues.has(candidate))) return candidate;
    return fallback;
}

export function normalizeFourPlayerPlanarSettings(value = null, options = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const fallbackMapKey = String(options.fallbackMapKey || 'standard');
    const fallbackVehicleId = String(options.fallbackVehicleId || 'ship5');
    const botCount = Math.max(0, Math.min(
        FOUR_PLAYER_PLANAR_MAX_BOTS,
        FOUR_PLAYER_PLANAR_MAX_PARTICIPANTS - FOUR_PLAYER_PLANAR_HUMAN_COUNT,
        Math.trunc(Number(source.botCount) || 0)
    ));
    return {
        mode: normalizeFourPlayerPlanarMode(source.mode),
        mapKey: normalizeSelection(source.mapKey, options.allowedMapKeys, fallbackMapKey),
        vehicleId: normalizeSelection(source.vehicleId, options.allowedVehicleIds, fallbackVehicleId),
        botCount,
    };
}

export function isFourPlayerPlanarVariant(settings = null) {
    return String(settings?.localSettings?.sessionType || '').trim().toLowerCase() === 'splitscreen'
        && normalizeSplitScreenVariant(settings?.localSettings?.splitScreenVariant)
            === SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR;
}

export function createFourPlayerPlanarRuntimeSelection(settings = null, options = {}) {
    const active = isFourPlayerPlanarVariant(settings);
    const selection = normalizeFourPlayerPlanarSettings(
        settings?.localSettings?.fourPlayerPlanar,
        options
    );
    return {
        active,
        variant: active
            ? SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR
            : SPLIT_SCREEN_VARIANTS.STANDARD,
        viewportLayout: active ? FOUR_PLAYER_PLANAR_VIEWPORT_LAYOUT : VIEWPORT_LAYOUTS.TWO_COLUMNS,
        numHumans: active ? FOUR_PLAYER_PLANAR_HUMAN_COUNT : 2,
        ...selection,
    };
}

export function isFourPlayerPlanarRuntime(runtimeConfig = null) {
    return runtimeConfig?.session?.splitScreenVariant === SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR
        && runtimeConfig?.session?.viewportLayout === FOUR_PLAYER_PLANAR_VIEWPORT_LAYOUT;
}
