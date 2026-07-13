import { MENU_CONTROLLER_EVENT_TYPES } from '../../../shared/contracts/MenuControllerContract.js';

export function registerPresetMenuEventHandlers(facade, registry) {
    registry.set(MENU_CONTROLLER_EVENT_TYPES.PRESET_APPLY, (event) => facade.applyMenuPreset(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.PRESET_SAVE_OPEN, (event) => facade.saveMenuPreset(event, 'open'));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.PRESET_SAVE_FIXED, (event) => facade.saveMenuPreset(event, 'fixed'));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.PRESET_DELETE, (event) => facade.deleteMenuPreset(event));
}
