import { VIEWPORT_LAYOUTS } from '../shared/contracts/ViewportLayoutContract.js';

export const SPLIT_SCREEN_VARIANTS = Object.freeze({
    STANDARD: 'standard',
    FOUR_PLAYER_PLANAR: 'four_player_planar',
    THREE_PLAYER: 'three_player',
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

export const FOUR_PLAYER_PLANAR_ROLL_BINDINGS = Object.freeze([
    Object.freeze({ left: 'KeyQ', right: 'KeyE' }),
    Object.freeze({ left: 'KeyU', right: 'KeyO' }),
    Object.freeze({ left: 'PageUp', right: 'PageDown' }),
    Object.freeze({ left: 'Numpad7', right: 'Numpad9' }),
]);

export const THREE_PLAYER_SPLIT_HUMAN_COUNT = 3;
export const THREE_PLAYER_SPLIT_MAX_BOTS = 6;
export const THREE_PLAYER_SPLIT_MAX_PARTICIPANTS = 9;
export const THREE_PLAYER_SPLIT_VIEWPORT_LAYOUTS = Object.freeze({
    PORTRAIT: VIEWPORT_LAYOUTS.THREE_COLUMNS,
    LANDSCAPE: VIEWPORT_LAYOUTS.THREE_ROWS,
});

// The full 3D flight model applies here, unlike the flattened four-player-planar mode.
// These labels mirror the three full keyboard binding scopes from CONFIG.KEYS.
export const THREE_PLAYER_SPLIT_KEY_BINDINGS = Object.freeze([
    Object.freeze({ label: 'W / S / A / D' }),
    Object.freeze({ label: 'Num 8 / 5 / 4 / 6' }),
    Object.freeze({ label: 'I / K / J / L' }),
]);
export const THREE_PLAYER_SPLIT_PLAYER_COLORS = Object.freeze(
    FOUR_PLAYER_PLANAR_PLAYER_COLORS.slice(0, THREE_PLAYER_SPLIT_HUMAN_COUNT)
);

export const THREE_PLAYER_SPLIT_INPUT_DEVICES = Object.freeze({
    KEYBOARD: 'keyboard',
    GAMEPAD_1: 'gamepad-1',
    GAMEPAD_2: 'gamepad-2',
    GAMEPAD_3: 'gamepad-3',
});
/** @type {Set<string>} */
const THREE_PLAYER_SPLIT_INPUT_DEVICE_SET = new Set(Object.values(THREE_PLAYER_SPLIT_INPUT_DEVICES));

// Matches the user's stated default: two gamepads, one keyboard, in slot order.
export const THREE_PLAYER_SPLIT_DEFAULT_DEVICE_ASSIGNMENT = Object.freeze([
    THREE_PLAYER_SPLIT_INPUT_DEVICES.GAMEPAD_1,
    THREE_PLAYER_SPLIT_INPUT_DEVICES.GAMEPAD_2,
    THREE_PLAYER_SPLIT_INPUT_DEVICES.KEYBOARD,
]);

export function normalizeThreePlayerSplitDeviceAssignment(value = null) {
    const source = Array.isArray(value) ? value : [];
    const usedGamepads = new Set();
    return THREE_PLAYER_SPLIT_DEFAULT_DEVICE_ASSIGNMENT.map((fallback, index) => {
        const candidate = String(source[index] || '').trim().toLowerCase();
        const preferred = THREE_PLAYER_SPLIT_INPUT_DEVICE_SET.has(candidate) ? candidate : fallback;
        if (preferred === THREE_PLAYER_SPLIT_INPUT_DEVICES.KEYBOARD) return preferred;
        const device = !usedGamepads.has(preferred)
            ? preferred
            : [fallback, ...Object.values(THREE_PLAYER_SPLIT_INPUT_DEVICES)]
                .find((entry) => entry !== THREE_PLAYER_SPLIT_INPUT_DEVICES.KEYBOARD && !usedGamepads.has(entry));
        usedGamepads.add(device);
        return device;
    });
}

export function normalizeThreePlayerSplitViewportLayout(value) {
    return value === THREE_PLAYER_SPLIT_VIEWPORT_LAYOUTS.LANDSCAPE
        ? THREE_PLAYER_SPLIT_VIEWPORT_LAYOUTS.LANDSCAPE
        : THREE_PLAYER_SPLIT_VIEWPORT_LAYOUTS.PORTRAIT;
}

export function isThreePlayerSplitViewportLayout(value) {
    return value === THREE_PLAYER_SPLIT_VIEWPORT_LAYOUTS.PORTRAIT
        || value === THREE_PLAYER_SPLIT_VIEWPORT_LAYOUTS.LANDSCAPE;
}

/**
 * Pure lookup, kept in the same {type, gamepadIndex} shape as the existing
 * two-player resolveSplitscreenInputDevice() so it drops into the input
 * resolver without a redesign once that file is free to touch again.
 */
export function resolveThreePlayerSplitInputDevice(deviceAssignment, playerIndex) {
    if (playerIndex < 0 || playerIndex >= THREE_PLAYER_SPLIT_HUMAN_COUNT) return null;
    const assignment = normalizeThreePlayerSplitDeviceAssignment(deviceAssignment);
    const device = assignment[playerIndex];
    if (device === THREE_PLAYER_SPLIT_INPUT_DEVICES.KEYBOARD) return { type: 'keyboard', gamepadIndex: -1 };
    const gamepadIndex = Number(device.slice('gamepad-'.length)) - 1;
    return { type: 'gamepad', gamepadIndex };
}

const RESERVED_ROLL_KEY_CODES = new Set(['Escape', 'Enter']);
const KEY_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9]{1,31}$/;

function cloneDefaultRollBindings() {
    return FOUR_PLAYER_PLANAR_ROLL_BINDINGS.map((binding) => ({ ...binding }));
}

export function normalizeFourPlayerPlanarRollBindings(value = null) {
    const source = Array.isArray(value) ? value : [];
    const bindings = FOUR_PLAYER_PLANAR_ROLL_BINDINGS.map((fallback, index) => {
        const candidate = source[index] && typeof source[index] === 'object' ? source[index] : {};
        const normalizeCode = (code, fallbackCode) => {
            const normalized = String(code || '').trim();
            return KEY_CODE_PATTERN.test(normalized) && !RESERVED_ROLL_KEY_CODES.has(normalized)
                ? normalized
                : fallbackCode;
        };
        return {
            left: normalizeCode(candidate.left, fallback.left),
            right: normalizeCode(candidate.right, fallback.right),
        };
    });
    const allCodes = [
        ...FOUR_PLAYER_PLANAR_KEY_BINDINGS.flatMap((binding) => [binding.left, binding.right, binding.action]),
        ...bindings.flatMap((binding) => [binding.left, binding.right]),
    ];
    return new Set(allCodes).size === allCodes.length ? bindings : cloneDefaultRollBindings();
}

export function normalizeSplitScreenVariant(value) {
    if (value === SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR) return SPLIT_SCREEN_VARIANTS.FOUR_PLAYER_PLANAR;
    if (value === SPLIT_SCREEN_VARIANTS.THREE_PLAYER) return SPLIT_SCREEN_VARIANTS.THREE_PLAYER;
    return SPLIT_SCREEN_VARIANTS.STANDARD;
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
        rollBindings: normalizeFourPlayerPlanarRollBindings(source.rollBindings),
    };
}

export function normalizeThreePlayerSplitSettings(value = null, options = {}) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const fallbackMapKey = String(options.fallbackMapKey || 'standard');
    const fallbackVehicleId = String(options.fallbackVehicleId || 'ship5');
    const botCount = Math.max(0, Math.min(
        THREE_PLAYER_SPLIT_MAX_BOTS,
        THREE_PLAYER_SPLIT_MAX_PARTICIPANTS - THREE_PLAYER_SPLIT_HUMAN_COUNT,
        Math.trunc(Number(source.botCount) || 0)
    ));
    return {
        mode: normalizeFourPlayerPlanarMode(source.mode),
        mapKey: normalizeSelection(source.mapKey, options.allowedMapKeys, fallbackMapKey),
        vehicleId: normalizeSelection(source.vehicleId, options.allowedVehicleIds, fallbackVehicleId),
        botCount,
        viewportLayout: normalizeThreePlayerSplitViewportLayout(source.viewportLayout),
        deviceAssignment: normalizeThreePlayerSplitDeviceAssignment(source.deviceAssignment),
    };
}

export function isThreePlayerSplitVariant(settings = null) {
    return String(settings?.localSettings?.sessionType || '').trim().toLowerCase() === 'splitscreen'
        && normalizeSplitScreenVariant(settings?.localSettings?.splitScreenVariant)
            === SPLIT_SCREEN_VARIANTS.THREE_PLAYER;
}

export function createThreePlayerSplitRuntimeSelection(settings = null, options = {}) {
    const active = isThreePlayerSplitVariant(settings);
    const selection = normalizeThreePlayerSplitSettings(
        settings?.localSettings?.threePlayerSplit,
        options
    );
    return {
        active,
        variant: active ? SPLIT_SCREEN_VARIANTS.THREE_PLAYER : SPLIT_SCREEN_VARIANTS.STANDARD,
        numHumans: active ? THREE_PLAYER_SPLIT_HUMAN_COUNT : 2,
        ...selection,
        viewportLayout: active ? selection.viewportLayout : VIEWPORT_LAYOUTS.TWO_COLUMNS,
    };
}

export function isThreePlayerSplitRuntime(runtimeConfig = null) {
    return runtimeConfig?.session?.splitScreenVariant === SPLIT_SCREEN_VARIANTS.THREE_PLAYER
        && isThreePlayerSplitViewportLayout(runtimeConfig?.session?.viewportLayout);
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
