import {
    MENU_DEVELOPER_ACCESS_MODES,
    ensureMenuContractState,
} from './MenuStateContracts.js';
import {
    MENU_ACCESS_POLICIES,
    evaluateMenuAccessPolicy,
    resolveMenuAccessContext,
} from './MenuAccessPolicy.js';
import { resolveMenuDeveloperTheme } from './MenuDeveloperThemeCatalog.js';

/** @type {Set<string>} */
const VALID_DEVELOPER_ACCESS_MODE_SET = new Set(Object.values(MENU_DEVELOPER_ACCESS_MODES));

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized || fallback;
}

function resolveDeveloperPolicy(settings) {
    const visibilityMode = normalizeString(settings?.localSettings?.developerModeVisibility, MENU_DEVELOPER_ACCESS_MODES.OWNER_ONLY);
    if (visibilityMode === MENU_DEVELOPER_ACCESS_MODES.OPEN) {
        return MENU_ACCESS_POLICIES.OPEN;
    }
    if (visibilityMode === MENU_DEVELOPER_ACCESS_MODES.HIDDEN_FOR_PLAYERS) {
        return MENU_ACCESS_POLICIES.HIDDEN_FOR_PLAYERS;
    }
    return MENU_ACCESS_POLICIES.OWNER_ONLY;
}

function ensureDeveloperAccess(settings, accessContext = null) {
    ensureMenuContractState(settings);
    const resolvedContext = accessContext && typeof accessContext === 'object'
        ? accessContext
        : resolveMenuAccessContext(settings);
    const policy = resolveDeveloperPolicy(settings);
    const accessResult = evaluateMenuAccessPolicy(policy, resolvedContext);
    return {
        policy,
        accessResult,
        context: resolvedContext,
    };
}

function createResult(success, reason, patch = null) {
    return {
        success: !!success,
        reason: normalizeString(reason),
        patch: patch && typeof patch === 'object' ? { ...patch } : null,
    };
}

export function setDeveloperModeEnabled(settings, enabled, accessContext = null) {
    const accessState = ensureDeveloperAccess(settings, accessContext);
    if (!accessState.accessResult.allowed) {
        return createResult(false, accessState.accessResult.reason);
    }

    settings.localSettings.developerModeEnabled = !!enabled;
    return createResult(true, 'updated', {
        developerModeEnabled: settings.localSettings.developerModeEnabled,
    });
}

export function setDeveloperTheme(settings, themeId, accessContext = null) {
    const accessState = ensureDeveloperAccess(settings, accessContext);
    if (!accessState.accessResult.allowed) {
        return createResult(false, accessState.accessResult.reason);
    }

    const theme = resolveMenuDeveloperTheme(themeId);
    settings.localSettings.developerThemeId = theme.id;
    return createResult(true, 'updated', {
        developerThemeId: theme.id,
    });
}

export function setDeveloperFixedPresetLock(settings, enabled, accessContext = null) {
    const accessState = ensureDeveloperAccess(settings, accessContext);
    if (!accessState.accessResult.allowed) {
        return createResult(false, accessState.accessResult.reason);
    }

    settings.localSettings.fixedPresetLockEnabled = !!enabled;
    return createResult(true, 'updated', {
        fixedPresetLockEnabled: settings.localSettings.fixedPresetLockEnabled,
    });
}

export function setDeveloperActorId(settings, actorId, accessContext = null) {
    ensureMenuContractState(settings);
    const sourceContext = accessContext && typeof accessContext === 'object'
        ? accessContext
        : resolveMenuAccessContext(settings);
    if (!sourceContext.isOwner) {
        return createResult(false, 'owner_required');
    }
    settings.localSettings.actorId = normalizeString(actorId, settings.localSettings.ownerId || 'owner');
    return createResult(true, 'updated', {
        actorId: settings.localSettings.actorId,
    });
}

export function setDeveloperReleasePreviewEnabled(settings, enabled, accessContext = null) {
    const accessState = ensureDeveloperAccess(settings, accessContext);
    if (!accessState.accessResult.allowed) {
        return createResult(false, accessState.accessResult.reason);
    }
    settings.localSettings.releasePreviewEnabled = !!enabled;
    return createResult(true, 'updated', {
        releasePreviewEnabled: settings.localSettings.releasePreviewEnabled,
    });
}

export function setDeveloperVisibilityMode(settings, mode, accessContext = null) {
    ensureMenuContractState(settings);
    const sourceContext = accessContext && typeof accessContext === 'object'
        ? accessContext
        : resolveMenuAccessContext(settings);
    if (!sourceContext.isOwner) {
        return createResult(false, 'owner_required');
    }
    const requestedMode = normalizeString(mode, MENU_DEVELOPER_ACCESS_MODES.OWNER_ONLY);
    const resolvedMode = VALID_DEVELOPER_ACCESS_MODE_SET.has(requestedMode)
        ? requestedMode
        : MENU_DEVELOPER_ACCESS_MODES.OWNER_ONLY;
    settings.localSettings.developerModeVisibility = resolvedMode;
    return createResult(true, 'updated', {
        developerModeVisibility: resolvedMode,
    });
}

export function applyDeveloperThemeToDocument(themeId, options = {}) {
    const theme = resolveMenuDeveloperTheme(themeId);
    const root = options.rootElement || (typeof document !== 'undefined' ? document.documentElement : null);
    if (!root) {
        return createResult(false, 'missing_root');
    }
    for (const [variableName, variableValue] of Object.entries(theme.variables)) {
        root.style.setProperty(variableName, String(variableValue));
    }
    root.setAttribute('data-menu-theme', theme.id);
    return createResult(true, 'updated', {
        themeId: theme.id,
    });
}
