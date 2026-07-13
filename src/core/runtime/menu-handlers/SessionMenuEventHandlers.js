import { MENU_CONTROLLER_EVENT_TYPES } from '../../../shared/contracts/MenuControllerContract.js';

export function registerSessionMenuEventHandlers(facade, registry) {
    registry.set(MENU_CONTROLLER_EVENT_TYPES.SETTINGS_CHANGED, (event) => facade.onSettingsChanged(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.SESSION_TYPE_CHANGE, (event) => facade.handleSessionTypeChange(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.MODE_PATH_CHANGE, (event) => facade.handleModePathChange(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.QUICKSTART_LAST_START, () => facade.handleQuickStartLastStart());
    registry.set(MENU_CONTROLLER_EVENT_TYPES.QUICKSTART_EVENT_PLAYLIST_START, () => facade.handleQuickStartEventPlaylistStart());
    registry.set(MENU_CONTROLLER_EVENT_TYPES.QUICKSTART_RANDOM_START, () => facade.handleQuickStartRandomStart());
    registry.set(MENU_CONTROLLER_EVENT_TYPES.LEVEL3_RESET, () => facade.handleLevel3Reset());
    registry.set(MENU_CONTROLLER_EVENT_TYPES.LEVEL4_OPEN, (event) => facade.handleLevel4Open(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.LEVEL4_CLOSE, () => facade.handleLevel4Close());
    registry.set(MENU_CONTROLLER_EVENT_TYPES.LEVEL4_RESET, () => facade.handleLevel4Reset());
    registry.set(MENU_CONTROLLER_EVENT_TYPES.CONFIG_EXPORT_CODE, () => facade.handleConfigExportCode());
    registry.set(MENU_CONTROLLER_EVENT_TYPES.CONFIG_EXPORT_JSON, () => facade.handleConfigExportJson());
    registry.set(MENU_CONTROLLER_EVENT_TYPES.CONFIG_IMPORT, (event) => facade.handleConfigImport(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.START_MATCH, () => facade.startMatch());
}
