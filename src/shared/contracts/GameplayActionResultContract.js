export const GAMEPLAY_ACTION_RESULT_CODES = Object.freeze({
    ITEM_USE_SUCCESS: 'item.use.success',
    ITEM_USE_FORBIDDEN: 'item.use.forbidden',
    ITEM_USE_INVALID_INDEX: 'item.use.invalid-index',
    ITEM_USE_EMPTY: 'item.use.empty',
    ITEM_USE_COOLDOWN: 'item.use.cooldown',
    ITEM_USE_INVALID_TYPE: 'item.use.invalid-type',
    ITEM_SHOOT_SUCCESS: 'item.shoot.success',
    ITEM_SHOOT_FORBIDDEN: 'item.shoot.forbidden',
    ITEM_SHOOT_INVALID_INDEX: 'item.shoot.invalid-index',
    ITEM_SHOOT_EMPTY: 'item.shoot.empty',
    ITEM_SHOOT_COOLDOWN: 'item.shoot.cooldown',
    ITEM_SHOOT_SYSTEM_MISSING: 'item.shoot.system-missing',
    ITEM_SHOOT_INVALID_TYPE: 'item.shoot.invalid-type',
    MG_SHOOT_SUCCESS: 'mg.shoot.success',
    MG_SHOOT_COOLDOWN: 'mg.shoot.cooldown',
    MG_SHOOT_OVERHEATED: 'mg.shoot.overheated',
    MG_SHOOT_INACTIVE: 'mg.shoot.inactive',
    ITEM_PICKUP_SUCCESS: 'item.pickup.success',
    PORTAL_TRAVEL: 'portal.travel',
    PORTAL_TRAVEL_COOLDOWN: 'portal.travel.cooldown',
    PORTAL_TRAVEL_INACTIVE: 'portal.travel.inactive',
    EXIT_PORTAL_TRIGGER: 'portal.exit.trigger',
    EXIT_PORTAL_COOLDOWN: 'portal.exit.cooldown',
    EXIT_PORTAL_INACTIVE: 'portal.exit.inactive',
    GATE_TRIGGER_BOOST: 'gate.trigger.boost',
    GATE_TRIGGER_SLINGSHOT: 'gate.trigger.slingshot',
    GATE_TRIGGER_COOLDOWN: 'gate.trigger.cooldown',
    GATE_TRIGGER_UNKNOWN: 'gate.trigger.unknown',
    MAP_WARNING_GATE_TYPE: 'map.warning.gate-type',
    MAP_WARNING_PORTAL_PAIR: 'map.warning.portal-pair',
    MAP_WARNING_PORTAL_MODE: 'map.warning.portal-mode',
});

export function buildGameplayActionResult({
    ok = false,
    code = '',
    type = null,
    mode = null,
    message = '',
    cooldownSeconds = null,
    cooldownRemaining = null,
    meta = null,
} = {}) {
    return {
        ok: ok === true,
        code: String(code || '').trim(),
        type: type == null ? null : String(type || '').trim().toUpperCase(),
        mode: mode == null ? null : String(mode || '').trim().toLowerCase(),
        reason: String(message || '').trim(),
        cooldownSeconds: Number.isFinite(Number(cooldownSeconds)) ? Number(cooldownSeconds) : null,
        cooldownRemaining: Number.isFinite(Number(cooldownRemaining)) ? Number(cooldownRemaining) : null,
        meta: meta && typeof meta === 'object' ? { ...meta } : null,
    };
}

export function encodeGameplayActionResultForLog(result = {}, fallback = {}) {
    const mode = String(result.mode || fallback.mode || 'other').trim().toLowerCase() || 'other';
    const type = String(result.type || fallback.type || 'UNKNOWN').trim().toUpperCase() || 'UNKNOWN';
    const code = String(result.code || fallback.code || 'unknown').trim() || 'unknown';
    const ok = result.ok === true ? 1 : 0;
    return `mode=${mode} type=${type} code=${code} ok=${ok}`;
}

export function parseGameplayActionResultLog(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    const result = {
        mode: 'other',
        type: 'UNKNOWN',
        code: 'unknown',
        ok: false,
    };
    if (!raw) return result;

    const keyValuePattern = /([a-zA-Z0-9_]+)=([^\s]+)/g;
    let matched = false;
    let match = keyValuePattern.exec(raw);
    while (match) {
        matched = true;
        const key = String(match[1] || '').trim().toLowerCase();
        const valuePart = String(match[2] || '').trim();
        if (key === 'mode' && valuePart) {
            result.mode = valuePart.toLowerCase();
        } else if (key === 'type' && valuePart) {
            result.type = valuePart.toUpperCase();
        } else if (key === 'code' && valuePart) {
            result.code = valuePart;
        } else if (key === 'ok') {
            result.ok = valuePart === '1' || valuePart.toLowerCase() === 'true';
        }
        match = keyValuePattern.exec(raw);
    }

    if (!matched) {
        result.type = raw.toUpperCase();
    }
    return result;
}
