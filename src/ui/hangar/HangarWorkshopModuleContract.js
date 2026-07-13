import {
    HANGAR_CAPABILITY_IDS,
    HANGAR_MODES,
    resolveHangarMode,
} from '../../shared/contracts/HangarModeContract.js';
import { EDITOR_VIEW_PATHS } from '../../shared/contracts/EditorPathContract.js';

export const HANGAR_WORKSHOP_MODULE_CONTRACT_VERSION = 'hangar-workshop-module.v2';

export const HANGAR_WORKSHOP_MODULE_IDS = Object.freeze({
    VEHICLE_LAB: 'vehicle-lab',
});

export const HANGAR_WORKSHOP_INTERNAL_VIEW_IDS = Object.freeze({
    VEHICLE_LAB: 'hangar-workshop.vehicle-lab',
});

export const HANGAR_WORKSHOP_LEGACY_NAVIGATION = Object.freeze({
    legacyMethod: 'window.open',
    legacyPath: EDITOR_VIEW_PATHS.VEHICLE_LAB,
    status: 'deprecated',
    replacement: 'internal-view-switch',
});

export const HANGAR_WORKSHOP_MODE_MODULE_BINDINGS = Object.freeze({
    [HANGAR_MODES.ARCADE]: Object.freeze({
        mode: HANGAR_MODES.ARCADE,
        moduleId: HANGAR_WORKSHOP_MODULE_IDS.VEHICLE_LAB,
        title: 'Arcade Vehicle Lab',
        workflow: 'progression-workshop',
        ruleContract: 'ArcadeHangarRulesContract',
        sourcePath: EDITOR_VIEW_PATHS.VEHICLE_LAB,
        navigationMode: 'internal-view-switch',
        internalViewId: HANGAR_WORKSHOP_INTERNAL_VIEW_IDS.VEHICLE_LAB,
        legacyNavigation: HANGAR_WORKSHOP_LEGACY_NAVIGATION,
        openNavEvent: 'hangar_nav:open_workshop',
        closeNavEvent: 'hangar_nav:close_workshop',
        capabilities: Object.freeze({
            open: HANGAR_CAPABILITY_IDS.NAVIGATE_TO_WORKSHOP,
            close: HANGAR_CAPABILITY_IDS.NAVIGATE_FROM_WORKSHOP,
            loadCustom: HANGAR_CAPABILITY_IDS.LOAD_CUSTOM_BLUEPRINT,
            saveCustom: HANGAR_CAPABILITY_IDS.SAVE_CUSTOM_BLUEPRINT,
            renameCustom: HANGAR_CAPABILITY_IDS.RENAME_CUSTOM_BLUEPRINT,
            deleteCustom: HANGAR_CAPABILITY_IDS.DELETE_CUSTOM_BLUEPRINT,
        }),
    }),
    [HANGAR_MODES.FIGHT]: Object.freeze({
        mode: HANGAR_MODES.FIGHT,
        moduleId: HANGAR_WORKSHOP_MODULE_IDS.VEHICLE_LAB,
        title: 'Fight Vehicle Lab',
        workflow: 'balance-workshop',
        ruleContract: 'FightHangarBalanceContract',
        sourcePath: EDITOR_VIEW_PATHS.VEHICLE_LAB,
        navigationMode: 'internal-view-switch',
        internalViewId: HANGAR_WORKSHOP_INTERNAL_VIEW_IDS.VEHICLE_LAB,
        legacyNavigation: HANGAR_WORKSHOP_LEGACY_NAVIGATION,
        openNavEvent: 'hangar_nav:open_workshop',
        closeNavEvent: 'hangar_nav:close_workshop',
        capabilities: Object.freeze({
            open: HANGAR_CAPABILITY_IDS.NAVIGATE_TO_WORKSHOP,
            close: HANGAR_CAPABILITY_IDS.NAVIGATE_FROM_WORKSHOP,
            loadCustom: HANGAR_CAPABILITY_IDS.LOAD_CUSTOM_BLUEPRINT,
            saveCustom: HANGAR_CAPABILITY_IDS.SAVE_CUSTOM_BLUEPRINT,
            renameCustom: HANGAR_CAPABILITY_IDS.RENAME_CUSTOM_BLUEPRINT,
            deleteCustom: HANGAR_CAPABILITY_IDS.DELETE_CUSTOM_BLUEPRINT,
        }),
    }),
});

function cloneWorkshopBinding(binding) {
    return {
        mode: binding.mode,
        moduleId: binding.moduleId,
        title: binding.title,
        workflow: binding.workflow,
        ruleContract: binding.ruleContract,
        sourcePath: binding.sourcePath,
        navigationMode: binding.navigationMode,
        internalViewId: binding.internalViewId,
        legacyNavigation: {
            legacyMethod: binding.legacyNavigation.legacyMethod,
            legacyPath: binding.legacyNavigation.legacyPath,
            status: binding.legacyNavigation.status,
            replacement: binding.legacyNavigation.replacement,
        },
        openNavEvent: binding.openNavEvent,
        closeNavEvent: binding.closeNavEvent,
        capabilities: {
            open: binding.capabilities.open,
            close: binding.capabilities.close,
            loadCustom: binding.capabilities.loadCustom,
            saveCustom: binding.capabilities.saveCustom,
            renameCustom: binding.capabilities.renameCustom,
            deleteCustom: binding.capabilities.deleteCustom,
        },
    };
}

export function resolveHangarWorkshopModule(rawMode) {
    const mode = resolveHangarMode(rawMode);
    const binding = HANGAR_WORKSHOP_MODE_MODULE_BINDINGS[mode];
    if (!binding) return null;
    return cloneWorkshopBinding(binding);
}

export function listHangarWorkshopModules() {
    return Object.values(HANGAR_MODES)
        .map((mode) => resolveHangarWorkshopModule(mode))
        .filter(Boolean);
}

export function resolveHangarWorkshopViewSwitch(rawMode) {
    const moduleBinding = resolveHangarWorkshopModule(rawMode);
    if (!moduleBinding) return null;
    return {
        mode: moduleBinding.mode,
        moduleId: moduleBinding.moduleId,
        internalViewId: moduleBinding.internalViewId,
        navigationMode: moduleBinding.navigationMode,
        openNavEvent: moduleBinding.openNavEvent,
        closeNavEvent: moduleBinding.closeNavEvent,
        capabilityOpen: moduleBinding.capabilities.open,
        capabilityClose: moduleBinding.capabilities.close,
        legacyNavigation: { ...moduleBinding.legacyNavigation },
    };
}
