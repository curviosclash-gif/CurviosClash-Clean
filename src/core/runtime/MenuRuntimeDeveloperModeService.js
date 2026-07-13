// ============================================
// MenuRuntimeDeveloperModeService.js - developer-panel mode/theme/visibility actions
// ============================================

import { resolveMutationChangedKeys } from './RuntimeSettingsChangeKeys.js';

function resolveDeveloperFailureMessage(result, fallbackMessage) {
    switch (result?.reason) {
    case 'owner_required':
        return 'Nur der Host darf diese Einstellung aendern.';
    case 'hidden_for_player':
        return 'Diese Einstellung ist fuer Mitspieler ausgeblendet.';
    case 'expert_login_required':
        return 'Expertenmodus ist gesperrt.';
    case 'expert_surface_policy':
        return 'Expertenmodus ist auf dieser Surface nicht verfuegbar.';
    case 'locked':
        return 'Developer-Funktion ist derzeit gesperrt.';
    case 'unknown_text_id':
        return 'Text-ID ist unbekannt.';
    default:
        return fallbackMessage;
    }
}

/**
 * @param {{
 *   game: object,
 *   event: object|null,
 *   resolveMenuAccessContext: () => object,
 *   onSettingsChanged: (payload: object) => void,
 *   SETTINGS_CHANGE_KEYS: object,
 * }} ctx
 */
export function handleDeveloperModeToggleAction(ctx) {
    const { game, event, resolveMenuAccessContext, onSettingsChanged, SETTINGS_CHANGE_KEYS } = ctx;
    const result = game.settingsManager.setDeveloperMode(
        game.settings,
        !!event?.enabled,
        resolveMenuAccessContext()
    );
    if (!result.success) {
        game._showStatusToast(resolveDeveloperFailureMessage(result, 'Developer-Modus gesperrt.'), 1500, 'error');
        return;
    }
    onSettingsChanged({
        changedKeys: resolveMutationChangedKeys(result, [SETTINGS_CHANGE_KEYS.DEVELOPER_MODE_ENABLED]),
    });
}

export function handleDeveloperThemeChangeAction(ctx) {
    const { game, event, resolveMenuAccessContext, onSettingsChanged, SETTINGS_CHANGE_KEYS } = ctx;
    const themeId = String(event?.themeId || '').trim();
    const result = game.settingsManager.setDeveloperTheme(
        game.settings,
        themeId,
        resolveMenuAccessContext()
    );
    if (!result.success) {
        game._showStatusToast(resolveDeveloperFailureMessage(result, 'Theme-Wechsel gesperrt.'), 1500, 'error');
        return;
    }
    onSettingsChanged({
        changedKeys: resolveMutationChangedKeys(result, [SETTINGS_CHANGE_KEYS.DEVELOPER_THEME_ID]),
    });
}

export function handleDeveloperVisibilityChangeAction(ctx) {
    const { game, event, resolveMenuAccessContext, onSettingsChanged, SETTINGS_CHANGE_KEYS } = ctx;
    const result = game.settingsManager.setDeveloperVisibility(
        game.settings,
        String(event?.mode || '').trim(),
        resolveMenuAccessContext()
    );
    if (!result.success) {
        game._showStatusToast(resolveDeveloperFailureMessage(result, 'Developer-Visibility gesperrt.'), 1500, 'error');
        return;
    }
    onSettingsChanged({
        changedKeys: resolveMutationChangedKeys(result, [SETTINGS_CHANGE_KEYS.DEVELOPER_VISIBILITY_MODE]),
    });
}

export function handleDeveloperFixedPresetLockToggleAction(ctx) {
    const { game, event, resolveMenuAccessContext, onSettingsChanged, SETTINGS_CHANGE_KEYS } = ctx;
    const result = game.settingsManager.setDeveloperFixedPresetLock(
        game.settings,
        !!event?.enabled,
        resolveMenuAccessContext()
    );
    if (!result.success) {
        game._showStatusToast(resolveDeveloperFailureMessage(result, 'Fixed-Preset-Lock gesperrt.'), 1500, 'error');
        return;
    }
    onSettingsChanged({
        changedKeys: resolveMutationChangedKeys(result, [SETTINGS_CHANGE_KEYS.DEVELOPER_FIXED_PRESET_LOCK]),
    });
}

export function handleDeveloperActorChangeAction(ctx) {
    const { game, event, resolveMenuAccessContext, onSettingsChanged, SETTINGS_CHANGE_KEYS } = ctx;
    const actorId = String(event?.actorId || '').trim();
    const result = game.settingsManager.setDeveloperActor(
        game.settings,
        actorId,
        resolveMenuAccessContext()
    );
    if (!result.success) {
        game._showStatusToast(resolveDeveloperFailureMessage(result, 'Actor-Wechsel gesperrt.'), 1500, 'error');
        return;
    }
    onSettingsChanged({
        changedKeys: resolveMutationChangedKeys(result, [SETTINGS_CHANGE_KEYS.DEVELOPER_ACTOR_ID]),
    });
}

export function handleDeveloperReleasePreviewToggleAction(ctx) {
    const { game, event, resolveMenuAccessContext, onSettingsChanged, SETTINGS_CHANGE_KEYS } = ctx;
    const enabled = !!event?.enabled;
    const result = game.settingsManager.setDeveloperReleasePreview(
        game.settings,
        enabled,
        resolveMenuAccessContext()
    );
    if (!result.success) {
        game._showStatusToast(resolveDeveloperFailureMessage(result, 'Release-Vorschau gesperrt.'), 1500, 'error');
        return;
    }
    onSettingsChanged({
        changedKeys: resolveMutationChangedKeys(result, [SETTINGS_CHANGE_KEYS.DEVELOPER_RELEASE_PREVIEW]),
    });
    game._showStatusToast(
        enabled
            ? 'Release-Vorschau aktiv: Developer-Pfad simuliert deaktiviert.'
            : 'Release-Vorschau deaktiviert.',
        1500,
        'info'
    );
}

export function handleDeveloperTextOverrideSetAction(ctx) {
    const { game, event, onSettingsChanged, SETTINGS_CHANGE_KEYS } = ctx;
    const textId = String(event?.textId || '').trim();
    const textValue = String(event?.textValue || '');
    if (!textId) {
        game._showStatusToast('Text-ID fehlt.', 1400, 'error');
        return;
    }

    const result = game.settingsManager.setMenuTextOverride(textId, textValue);
    if (!result.success) {
        game._showStatusToast(resolveDeveloperFailureMessage(result, 'Text-Override konnte nicht gesetzt werden.'), 1700, 'error');
        return;
    }

    onSettingsChanged({
        changedKeys: resolveMutationChangedKeys(result, [SETTINGS_CHANGE_KEYS.DEVELOPER_TEXT_OVERRIDES]),
    });
    game._showStatusToast('Text-Override gespeichert.', 1200, 'success');
}

export function handleDeveloperTextOverrideClearAction(ctx) {
    const { game, event, onSettingsChanged, SETTINGS_CHANGE_KEYS } = ctx;
    const textId = String(event?.textId || '').trim();
    if (!textId) {
        game._showStatusToast('Text-ID fehlt.', 1400, 'error');
        return;
    }
    const result = game.settingsManager.clearMenuTextOverride(textId);
    if (!result.success) {
        game._showStatusToast(resolveDeveloperFailureMessage(result, 'Text-Override konnte nicht geloescht werden.'), 1700, 'error');
        return;
    }
    onSettingsChanged({
        changedKeys: resolveMutationChangedKeys(result, [SETTINGS_CHANGE_KEYS.DEVELOPER_TEXT_OVERRIDES]),
    });
    game._showStatusToast('Text-Override geloescht.', 1200, 'success');
}
