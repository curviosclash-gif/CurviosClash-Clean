import { MENU_DEVELOPER_ACCESS_MODES } from './MenuStateContracts.js';
import { resolveMenuExpertState } from './MenuExpertLoginRuntime.js';

export const MENU_ACCESS_POLICIES = Object.freeze({
    OPEN: 'open',
    OWNER_ONLY: 'owner_only',
    HIDDEN_FOR_PLAYERS: 'hidden_for_players',
    LOCKED: 'locked',
});

const VALID_ACCESS_POLICY_SET = new Set(Object.values(MENU_ACCESS_POLICIES));

export const MENU_ACCESS_GUARD_REASONS = Object.freeze({
    ALLOWED: 'allowed',
    OWNER_REQUIRED: 'owner_required',
    LOCKED: 'locked',
    HIDDEN_FOR_PLAYER: 'hidden_for_player',
    EXPERT_LOGIN_REQUIRED: 'expert_login_required',
    EXPERT_SURFACE_POLICY: 'expert_surface_policy',
    INVALID_POLICY: 'invalid_policy',
});

export const MENU_EVENT_ACCESS_POLICIES = Object.freeze({
    multiplayer_host: MENU_ACCESS_POLICIES.OPEN,
    multiplayer_join: MENU_ACCESS_POLICIES.OPEN,
    multiplayer_ready_toggle: MENU_ACCESS_POLICIES.OPEN,
    developer_mode_toggle: (context) => resolveDeveloperAccessPolicy(context),
    developer_theme_change: (context) => resolveDeveloperAccessPolicy(context),
    developer_visibility_change: MENU_ACCESS_POLICIES.OWNER_ONLY,
    developer_fixed_preset_lock_toggle: (context) => resolveDeveloperAccessPolicy(context),
    developer_actor_change: MENU_ACCESS_POLICIES.OWNER_ONLY,
    developer_release_preview_toggle: (context) => resolveDeveloperAccessPolicy(context),
    developer_text_override_set: (context) => resolveDeveloperAccessPolicy(context),
    developer_text_override_clear: (context) => resolveDeveloperAccessPolicy(context),
    developer_training_reset: (context) => resolveDeveloperAccessPolicy(context),
    developer_training_step: (context) => resolveDeveloperAccessPolicy(context),
    developer_training_auto_step: (context) => resolveDeveloperAccessPolicy(context),
    developer_training_run_batch: (context) => resolveDeveloperAccessPolicy(context),
    developer_training_run_eval: (context) => resolveDeveloperAccessPolicy(context),
    developer_training_run_gate: (context) => resolveDeveloperAccessPolicy(context),
    preset_set_fixed_lock: (context) => resolveDeveloperAccessPolicy(context),
    preset_save_fixed: MENU_ACCESS_POLICIES.OWNER_ONLY,
    preset_delete_fixed: MENU_ACCESS_POLICIES.OWNER_ONLY,
    preset_save_open: MENU_ACCESS_POLICIES.OPEN,
    preset_delete_open: MENU_ACCESS_POLICIES.OPEN,
    preset_apply: MENU_ACCESS_POLICIES.OPEN,
});

function normalizeString(value, fallback) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

export function resolveMenuAccessContext(settings) {
    const localSettings = settings?.localSettings && typeof settings.localSettings === 'object'
        ? settings.localSettings
        : {};
    const ownerId = normalizeString(localSettings.ownerId, 'owner');
    const actorId = normalizeString(localSettings.actorId, ownerId);
    const requestedMode = normalizeString(localSettings.developerModeVisibility, MENU_DEVELOPER_ACCESS_MODES.OWNER_ONLY);
    const developerModeVisibility = Object.values(MENU_DEVELOPER_ACCESS_MODES).includes(requestedMode)
        ? requestedMode
        : MENU_DEVELOPER_ACCESS_MODES.OWNER_ONLY;

    const expertState = resolveMenuExpertState(settings);
    return {
        ownerId,
        actorId,
        isOwner: actorId === ownerId,
        developerModeVisibility,
        developerModeEnabled: settings?.menuFeatureFlags?.developerModeEnabled !== false,
        releasePreviewEnabled: !!localSettings.releasePreviewEnabled,
        expertModeUnlocked: expertState?.unlocked === true,
        expertModeAvailable: expertState?.available !== false,
        expertModeAccessMode: normalizeString(expertState?.accessMode, ''),
        expertModeReason: normalizeString(expertState?.reason, ''),
        expertModeProductSurfaceId: normalizeString(expertState?.productSurfaceId, ''),
    };
}

export function normalizeAccessPolicy(accessPolicy) {
    const normalized = normalizeString(accessPolicy, MENU_ACCESS_POLICIES.OPEN);
    return VALID_ACCESS_POLICY_SET.has(normalized) ? normalized : null;
}

export function resolveExpertAccessState(accessContext) {
    if (accessContext?.expertModeAvailable === false) {
        return { allowed: false, reason: MENU_ACCESS_GUARD_REASONS.EXPERT_SURFACE_POLICY };
    }
    if (accessContext?.expertModeUnlocked === true) {
        return { allowed: true, reason: MENU_ACCESS_GUARD_REASONS.ALLOWED };
    }
    return { allowed: false, reason: MENU_ACCESS_GUARD_REASONS.EXPERT_LOGIN_REQUIRED };
}

export function resolveDeveloperAccessPolicy(accessContext) {
    const expertAccessState = resolveExpertAccessState(accessContext);
    if (!expertAccessState.allowed) {
        return MENU_ACCESS_POLICIES.LOCKED;
    }
    const mode = normalizeString(accessContext?.developerModeVisibility, MENU_DEVELOPER_ACCESS_MODES.OWNER_ONLY);
    if (mode === MENU_DEVELOPER_ACCESS_MODES.OPEN) return MENU_ACCESS_POLICIES.OPEN;
    if (mode === MENU_DEVELOPER_ACCESS_MODES.HIDDEN_FOR_PLAYERS) return MENU_ACCESS_POLICIES.HIDDEN_FOR_PLAYERS;
    return MENU_ACCESS_POLICIES.OWNER_ONLY;
}

export function resolveDebugAccessPolicy(accessContext) {
    const expertAccessState = resolveExpertAccessState(accessContext);
    if (!expertAccessState.allowed) {
        return MENU_ACCESS_POLICIES.LOCKED;
    }
    return MENU_ACCESS_POLICIES.OWNER_ONLY;
}

export function evaluateMenuAccessPolicy(accessPolicy, accessContext) {
    const policy = normalizeAccessPolicy(accessPolicy);
    if (!policy) {
        return { allowed: false, reason: MENU_ACCESS_GUARD_REASONS.INVALID_POLICY };
    }

    const context = accessContext && typeof accessContext === 'object'
        ? accessContext
        : { isOwner: true, developerModeVisibility: MENU_DEVELOPER_ACCESS_MODES.OWNER_ONLY };
    const isOwner = !!context.isOwner;

    if (policy === MENU_ACCESS_POLICIES.OPEN) {
        return { allowed: true, reason: MENU_ACCESS_GUARD_REASONS.ALLOWED };
    }
    if (policy === MENU_ACCESS_POLICIES.OWNER_ONLY) {
        return isOwner
            ? { allowed: true, reason: MENU_ACCESS_GUARD_REASONS.ALLOWED }
            : { allowed: false, reason: MENU_ACCESS_GUARD_REASONS.OWNER_REQUIRED };
    }
    if (policy === MENU_ACCESS_POLICIES.HIDDEN_FOR_PLAYERS) {
        if (isOwner) return { allowed: true, reason: MENU_ACCESS_GUARD_REASONS.ALLOWED };
        return context.developerModeVisibility === MENU_DEVELOPER_ACCESS_MODES.OPEN
            ? { allowed: true, reason: MENU_ACCESS_GUARD_REASONS.ALLOWED }
            : { allowed: false, reason: MENU_ACCESS_GUARD_REASONS.HIDDEN_FOR_PLAYER };
    }
    return { allowed: false, reason: MENU_ACCESS_GUARD_REASONS.LOCKED };
}

export function isPanelVisibleForAccess(panelConfig, accessContext) {
    if (!panelConfig || typeof panelConfig !== 'object') return false;
    if (panelConfig.visibility === 'hidden') return false;
    const accessResult = evaluateMenuAccessPolicy(panelConfig.accessPolicy, accessContext);
    return accessResult.allowed;
}

export function guardMenuRuntimeEvent(eventType, accessContext, policyMap = MENU_EVENT_ACCESS_POLICIES) {
    const type = normalizeString(eventType, '');
    const context = accessContext && typeof accessContext === 'object'
        ? accessContext
        : { isOwner: true, developerModeVisibility: MENU_DEVELOPER_ACCESS_MODES.OWNER_ONLY };
    const isDeveloperEvent = type.startsWith('developer_');
    const releaseCutActive = context.developerModeEnabled === false || context.releasePreviewEnabled === true;
    if (isDeveloperEvent && type !== 'developer_release_preview_toggle' && releaseCutActive) {
        return { allowed: false, reason: MENU_ACCESS_GUARD_REASONS.LOCKED };
    }
    const rawPolicy = policyMap[type] || MENU_ACCESS_POLICIES.OPEN;
    const policy = typeof rawPolicy === 'function' ? rawPolicy(context) : rawPolicy;
    return evaluateMenuAccessPolicy(policy, context);
}
