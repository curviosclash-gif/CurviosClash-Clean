import {
    MENU_TEXT_CATALOG,
    SETTINGS_CHANGE_KEYS,
} from '../../composition/core-ui/CoreSettingsPorts.js';
import { createSettingsMutationFailure, withMutationChangedKeys } from './SettingsMutationResult.js';

export function createSettingsTextOverrideFacade(options = {}) {
    const menuTextOverrideStore = options.menuTextOverrideStore;

    function listMenuTextOverrides() {
        return menuTextOverrideStore.listOverrides();
    }

    function setMenuTextOverride(textId, textValue) {
        const normalizedTextId = String(textId || '').trim();
        if (!normalizedTextId || !Object.prototype.hasOwnProperty.call(MENU_TEXT_CATALOG, normalizedTextId)) {
            return createSettingsMutationFailure('unknown_text_id');
        }
        return withMutationChangedKeys(
            menuTextOverrideStore.setOverride(textId, textValue),
            [SETTINGS_CHANGE_KEYS.DEVELOPER_TEXT_OVERRIDES],
            { textId: normalizedTextId }
        );
    }

    function clearMenuTextOverride(textId) {
        const normalizedTextId = String(textId || '').trim();
        if (!normalizedTextId || !Object.prototype.hasOwnProperty.call(MENU_TEXT_CATALOG, normalizedTextId)) {
            return createSettingsMutationFailure('unknown_text_id');
        }
        return withMutationChangedKeys(
            menuTextOverrideStore.clearOverride(textId),
            [SETTINGS_CHANGE_KEYS.DEVELOPER_TEXT_OVERRIDES],
            { textId: normalizedTextId }
        );
    }

    return {
        listMenuTextOverrides,
        setMenuTextOverride,
        clearMenuTextOverride,
    };
}
