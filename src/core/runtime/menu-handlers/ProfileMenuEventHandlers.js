import { MENU_CONTROLLER_EVENT_TYPES } from '../../../shared/contracts/MenuControllerContract.js';

export function registerProfileMenuEventHandlers(facade, registry) {
    const profileLifecycleController = facade.profileLifecycleController || facade;
    registry.set(MENU_CONTROLLER_EVENT_TYPES.START_KEY_CAPTURE, (event) => facade.startKeyCapture(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.PROFILE_UI_STATE_SYNC, (event) => profileLifecycleController.syncProfileUiState(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.SAVE_PROFILE, (event) => profileLifecycleController.saveProfile(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.LOAD_PROFILE, (event) => profileLifecycleController.loadProfile(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DELETE_PROFILE, (event) => profileLifecycleController.deleteProfile(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DUPLICATE_PROFILE, (event) => profileLifecycleController.duplicateProfile(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.EXPORT_PROFILE, (event) => profileLifecycleController.exportProfile(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.IMPORT_PROFILE, (event) => profileLifecycleController.importProfile(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.SET_DEFAULT_PROFILE, (event) => profileLifecycleController.setDefaultProfile(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.RESET_KEYS, () => facade.resetKeys());
    registry.set(MENU_CONTROLLER_EVENT_TYPES.SAVE_KEYS, () => facade.saveKeys());
    registry.set(MENU_CONTROLLER_EVENT_TYPES.SHOW_STATUS_TOAST, (event) => facade.showStatusToast(event));
}
