import { MENU_CONTROLLER_EVENT_TYPES } from '../../../shared/contracts/MenuControllerContract.js';

export function registerDeveloperMenuEventHandlers(facade, registry) {
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_MODE_TOGGLE, (event) => facade.handleDeveloperModeToggle(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_THEME_CHANGE, (event) => facade.handleDeveloperThemeChange(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_VISIBILITY_CHANGE, (event) => facade.handleDeveloperVisibilityChange(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_FIXED_PRESET_LOCK_TOGGLE, (event) => facade.handleDeveloperFixedPresetLockToggle(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_ACTOR_CHANGE, (event) => facade.handleDeveloperActorChange(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_RELEASE_PREVIEW_TOGGLE, (event) => facade.handleDeveloperReleasePreviewToggle(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_TEXT_OVERRIDE_SET, (event) => facade.handleDeveloperTextOverrideSet(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_TEXT_OVERRIDE_CLEAR, (event) => facade.handleDeveloperTextOverrideClear(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_TRAINING_RESET, (event) => facade.handleDeveloperTrainingReset(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_TRAINING_STEP, (event) => facade.handleDeveloperTrainingStep(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_TRAINING_AUTO_STEP, (event) => facade.handleDeveloperTrainingAutoStep(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_TRAINING_RUN_BATCH, (event) => facade.handleDeveloperTrainingRunBatch(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_TRAINING_RUN_EVAL, (event) => facade.handleDeveloperTrainingRunEval(event));
    registry.set(MENU_CONTROLLER_EVENT_TYPES.DEVELOPER_TRAINING_RUN_GATE, (event) => facade.handleDeveloperTrainingRunGate(event));
}
