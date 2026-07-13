import {
    SETTINGS_CHANGE_KEYS,
    setDeveloperActorId,
    setDeveloperFixedPresetLock,
    setDeveloperModeEnabled,
    setDeveloperReleasePreviewEnabled,
    setDeveloperTheme,
    setDeveloperVisibilityMode,
} from '../../composition/core-ui/CoreSettingsPorts.js';
import { withMutationChangedKeys } from './SettingsMutationResult.js';

export function createSettingsDeveloperFacade() {
    function setDeveloperMode(settings, enabled, accessContext = null) {
        return withMutationChangedKeys(
            setDeveloperModeEnabled(settings, enabled, accessContext),
            [SETTINGS_CHANGE_KEYS.DEVELOPER_MODE_ENABLED]
        );
    }

    function setDeveloperThemeById(settings, themeId, accessContext = null) {
        return withMutationChangedKeys(
            setDeveloperTheme(settings, themeId, accessContext),
            [SETTINGS_CHANGE_KEYS.DEVELOPER_THEME_ID],
            { uiEffectOwner: 'ui' }
        );
    }

    function setDeveloperFixedPresetLockState(settings, enabled, accessContext = null) {
        return withMutationChangedKeys(
            setDeveloperFixedPresetLock(settings, enabled, accessContext),
            [SETTINGS_CHANGE_KEYS.DEVELOPER_FIXED_PRESET_LOCK]
        );
    }

    function setDeveloperActor(settings, actorId, accessContext = null) {
        return withMutationChangedKeys(
            setDeveloperActorId(settings, actorId, accessContext),
            [SETTINGS_CHANGE_KEYS.DEVELOPER_ACTOR_ID]
        );
    }

    function setDeveloperReleasePreview(settings, enabled, accessContext = null) {
        return withMutationChangedKeys(
            setDeveloperReleasePreviewEnabled(settings, enabled, accessContext),
            [SETTINGS_CHANGE_KEYS.DEVELOPER_RELEASE_PREVIEW]
        );
    }

    function setDeveloperVisibility(settings, mode, accessContext = null) {
        return withMutationChangedKeys(
            setDeveloperVisibilityMode(settings, mode, accessContext),
            [SETTINGS_CHANGE_KEYS.DEVELOPER_VISIBILITY_MODE]
        );
    }

    return {
        setDeveloperMode,
        setDeveloperThemeById,
        setDeveloperFixedPresetLockState,
        setDeveloperActor,
        setDeveloperReleasePreview,
        setDeveloperVisibility,
    };
}
