export const GAMEPAD_BUTTON_LABELS = Object.freeze([
    'A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Ansicht / Back', 'Menü / Start',
    'Linker Stick drücken', 'Rechter Stick drücken', 'Steuerkreuz oben',
    'Steuerkreuz unten', 'Steuerkreuz links', 'Steuerkreuz rechts',
]);

export const GAMEPAD_ACTIONS = Object.freeze([
    { key: 'BOOST', label: 'Boost', button: 0 },
    { key: 'SLOWMO', label: 'Zeitlupe', button: 4 },
    { key: 'SHOOT', label: 'Rakete abfeuern', button: 7 },
    { key: 'SHOOT_MG', label: 'MG schießen', button: 6 },
    { key: 'USE_ITEM', label: 'Item nutzen', button: 2 },
    { key: 'NEXT_ITEM', label: 'Item wechseln', button: 3 },
    { key: 'CAMERA', label: 'Kamera', button: 1 },
    { key: 'PAUSE', label: 'Pause / Fortsetzen', button: 9 },
]);

export const GAMEPAD_AXES = Object.freeze([
    { key: 'pitchAxis', label: 'Pitch', axis: 1 },
    { key: 'yawAxis', label: 'Links / rechts (Gier)', axis: 0 },
    { key: 'rollAxis', label: 'Rollen', axis: 2 },
]);
export const GAMEPAD_AXIS_LABELS = Object.freeze([
    'Linker Stick horizontal', 'Linker Stick vertikal',
    'Rechter Stick horizontal', 'Rechter Stick vertikal',
]);

export const SPLITSCREEN_INPUT_LAYOUTS = Object.freeze([
    { value: 'auto', label: 'Automatisch' },
    { value: 'controller-keyboard', label: 'Spieler 1: Controller · Spieler 2: Tastatur' },
    { value: 'keyboard-controller', label: 'Spieler 1: Tastatur · Spieler 2: Controller' },
    { value: 'keyboard-keyboard', label: 'Beide Spieler: Tastatur' },
    { value: 'controller-controller', label: 'Beide Spieler: Controller' },
]);

export function normalizeSplitscreenInputLayout(value) {
    return SPLITSCREEN_INPUT_LAYOUTS.some((layout) => layout.value === value) ? value : 'auto';
}

export function resolveSplitscreenInputDevice(layout, playerIndex) {
    const normalized = normalizeSplitscreenInputLayout(layout);
    if (normalized === 'auto' || (playerIndex !== 0 && playerIndex !== 1)) return null;
    const keyboard = normalized === 'keyboard-keyboard'
        || (normalized === 'keyboard-controller' && playerIndex === 0)
        || (normalized === 'controller-keyboard' && playerIndex === 1);
    return { type: keyboard ? 'keyboard' : 'gamepad', gamepadIndex: normalized === 'controller-controller' ? playerIndex : 0 };
}

const ACTION_FIELDS = GAMEPAD_ACTIONS.map((action) => ({ key: action.key, fallback: action.button }));
const AXIS_FIELDS = GAMEPAD_AXES.map((axis) => ({ key: axis.key, fallback: axis.axis }));

/**
 * One group (buttons or axes) is kept only as a whole: a single invalid or
 * duplicate index resets the entire group to its defaults.
 * @param {Record<string, number>} result
 * @param {Record<string, unknown> | null | undefined} source
 * @param {ReadonlyArray<{ key: string, fallback: number }>} fields
 * @param {number} count
 */
function normalizeMappingGroup(result, source, fields, count) {
    const used = new Set();
    let valid = true;
    for (const field of fields) {
        const value = /** @type {number} */ (source?.[field.key] ?? field.fallback);
        if (!Number.isInteger(value) || value < 0 || value >= count || used.has(value)) valid = false;
        used.add(value);
        result[field.key] = value;
    }
    if (!valid) for (const field of fields) result[field.key] = field.fallback;
}

// Invalid or conflicting imports fall back to a complete, usable mapping.
/**
 * @param {Record<string, unknown> | null} [source]
 * @returns {Record<string, number>}
 */
export function normalizeGamepadControls(source) {
    /** @type {Record<string, number>} */
    const result = {};
    normalizeMappingGroup(result, source, ACTION_FIELDS, 16);
    normalizeMappingGroup(result, source, AXIS_FIELDS, 4);
    return result;
}

// Only an explicit false disables controllers, so older saves keep them enabled.
export function isGamepadInputEnabled(controls) {
    return controls?.GAMEPAD?.enabled !== false;
}

export function createGamepadControlsSnapshot(controls) {
    const result = {
        GAMEPAD: { enabled: isGamepadInputEnabled(controls) },
        SPLITSCREEN: { layout: normalizeSplitscreenInputLayout(controls?.SPLITSCREEN?.layout) },
    };
    for (let slot = 1; slot <= 4; slot++) result[`GAMEPAD_${slot}`] = normalizeGamepadControls(controls?.[`GAMEPAD_${slot}`]);
    return result;
}
