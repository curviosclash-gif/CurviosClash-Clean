// ============================================
// BotActionContract.js - sanitize and normalize bot action payloads
// ============================================

const TRUE_LITERALS = new Set(['1', 'true', 'yes', 'on']);

export const BOT_ACTION_DEFAULTS = Object.freeze({
    pitchUp: false,
    pitchDown: false,
    yawLeft: false,
    yawRight: false,
    rollLeft: false,
    rollRight: false,
    boost: false,
    cameraSwitch: false,
    dropItem: false,
    shootItem: false,
    shootMG: false,
    shootItemIndex: -1,
    nextItem: false,
    useItem: -1,
});

const BOOLEAN_KEYS = Object.freeze([
    'pitchUp',
    'pitchDown',
    'yawLeft',
    'yawRight',
    'rollLeft',
    'rollRight',
    'boost',
    'cameraSwitch',
    'dropItem',
    'shootItem',
    'shootMG',
    'nextItem',
]);

function coerceBool(value) {
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        return value !== 0;
    }
    if (typeof value === 'string') {
        return TRUE_LITERALS.has(value.trim().toLowerCase());
    }
    return false;
}

function clampIndex(value, min, max) {
    const num = Number(value);
    if (!Number.isFinite(num)) return min;
    const intValue = Math.trunc(num);
    if (intValue < min) return min;
    if (intValue > max) return max;
    return intValue;
}

function resolveInventoryLength(options) {
    const raw = Number(options?.inventoryLength);
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.trunc(raw));
}

function notifyInvalid(options, message) {
    if (typeof options?.onInvalid === 'function') {
        options.onInvalid(message);
    }
}

export function createNeutralBotAction(target = {}) {
    target.pitchUp = false;
    target.pitchDown = false;
    target.yawLeft = false;
    target.yawRight = false;
    target.rollLeft = false;
    target.rollRight = false;
    target.boost = false;
    target.cameraSwitch = false;
    target.dropItem = false;
    target.shootItem = false;
    target.shootMG = false;
    target.shootItemIndex = -1;
    target.nextItem = false;
    target.useItem = -1;
    return target;
}

export function sanitizeBotAction(action, options = {}, target = {}) {
    const sanitized = createNeutralBotAction(target);
    if (!action || typeof action !== 'object') {
        notifyInvalid(options, 'bot action is not an object payload');
        return sanitized;
    }

    for (let i = 0; i < BOOLEAN_KEYS.length; i++) {
        const key = BOOLEAN_KEYS[i];
        sanitized[key] = coerceBool(action[key]);
    }

    const inventoryLength = resolveInventoryLength(options);
    const maxInventoryIndex = inventoryLength > 0 ? inventoryLength - 1 : -1;
    const rawShootItemIndex = clampIndex(action.shootItemIndex, -1, maxInventoryIndex);
    const rawUseItemIndex = clampIndex(action.useItem, -1, maxInventoryIndex);

    if (sanitized.shootItem && rawShootItemIndex >= 0) {
        sanitized.shootItemIndex = rawShootItemIndex;
    } else if (sanitized.shootItem) {
        notifyInvalid(options, 'shootItem requested without valid shootItemIndex');
        sanitized.shootItem = false;
        sanitized.shootItemIndex = -1;
    }

    sanitized.useItem = rawUseItemIndex >= 0 ? rawUseItemIndex : -1;

    if (rawShootItemIndex !== Number(action.shootItemIndex) && Number.isFinite(Number(action.shootItemIndex))) {
        notifyInvalid(options, 'shootItemIndex clamped to inventory range');
    }
    if (rawUseItemIndex !== Number(action.useItem) && Number.isFinite(Number(action.useItem))) {
        notifyInvalid(options, 'useItem clamped to inventory range');
    }

    return sanitized;
}
