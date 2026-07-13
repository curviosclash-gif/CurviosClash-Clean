import {
    resolveHangarDesktopLoop,
    HANGAR_MODES,
    resolveHangarMode,
    resolveHangarUserFlow,
} from '../../shared/contracts/HangarModeContract.js';
import {
    HANGAR_SELECTION_WRITEBACK_PATHS,
    HANGAR_SELECTION_WRITEBACK_VERSION,
} from './HangarSelectionWritebackContract.js';
import { resolveDesktopHangarEntryByMode } from './HangarDesktopEntryContract.js';
import { resolveHangarLifecycleContract } from './HangarLifecycleContract.js';
import { listHangarVerificationTargets } from './HangarVerificationTargetContract.js';
import { resolveArcadeVehicleManagerLegacyStatus } from './ArcadeVehicleManagerLegacyContract.js';
import {
    resolveHangarWorkshopModule,
    resolveHangarWorkshopViewSwitch,
} from './HangarWorkshopModuleContract.js';
import { resolveHangarWorkshopPersistenceCapabilities } from './HangarWorkshopPersistenceFacade.js';

export const HANGAR_SHELL_LAYOUT_VERSION = 'hangar-shell-layout.v1';

export const HANGAR_SHELL_REGION_IDS = Object.freeze({
    HEADER: 'header',
    VEHICLE_CATALOG: 'vehicle-catalog',
    VEHICLE_PREVIEW: 'vehicle-preview',
    RULES_PANEL: 'rules-panel',
    LOADOUT_PANEL: 'loadout-panel',
    ACTION_BAR: 'action-bar',
    STATUS_BAR: 'status-bar',
});

const VALID_HANGAR_SHELL_REGION_ID_SET = new Set(Object.values(HANGAR_SHELL_REGION_IDS));

export const HANGAR_SHELL_REGION_ORDER = Object.freeze([
    HANGAR_SHELL_REGION_IDS.HEADER,
    HANGAR_SHELL_REGION_IDS.VEHICLE_CATALOG,
    HANGAR_SHELL_REGION_IDS.VEHICLE_PREVIEW,
    HANGAR_SHELL_REGION_IDS.RULES_PANEL,
    HANGAR_SHELL_REGION_IDS.LOADOUT_PANEL,
    HANGAR_SHELL_REGION_IDS.ACTION_BAR,
    HANGAR_SHELL_REGION_IDS.STATUS_BAR,
]);

export const HANGAR_SHELL_COMMON_REGIONS = Object.freeze({
    [HANGAR_SHELL_REGION_IDS.HEADER]: Object.freeze({
        id: HANGAR_SHELL_REGION_IDS.HEADER,
        title: 'Hangar Header',
        componentSlot: 'hangar-header',
        purpose: 'Mode switch, breadcrumbs and high-level selection summary.',
    }),
    [HANGAR_SHELL_REGION_IDS.VEHICLE_CATALOG]: Object.freeze({
        id: HANGAR_SHELL_REGION_IDS.VEHICLE_CATALOG,
        title: 'Vehicle Catalog',
        componentSlot: 'vehicle-catalog',
        purpose: 'Browse available vehicles and loadouts for the active mode.',
    }),
    [HANGAR_SHELL_REGION_IDS.VEHICLE_PREVIEW]: Object.freeze({
        id: HANGAR_SHELL_REGION_IDS.VEHICLE_PREVIEW,
        title: 'Vehicle Preview',
        componentSlot: 'vehicle-preview',
        purpose: 'Shared preview card with stats, hitbox and quick compare details.',
    }),
    [HANGAR_SHELL_REGION_IDS.RULES_PANEL]: Object.freeze({
        id: HANGAR_SHELL_REGION_IDS.RULES_PANEL,
        title: 'Rules Panel',
        componentSlot: 'rules-panel',
        purpose: 'Shows the active contract explanations for Arcade or Fight mode.',
    }),
    [HANGAR_SHELL_REGION_IDS.LOADOUT_PANEL]: Object.freeze({
        id: HANGAR_SHELL_REGION_IDS.LOADOUT_PANEL,
        title: 'Loadout Panel',
        componentSlot: 'loadout-panel',
        purpose: 'Shared part-slot and module selection surface.',
    }),
    [HANGAR_SHELL_REGION_IDS.ACTION_BAR]: Object.freeze({
        id: HANGAR_SHELL_REGION_IDS.ACTION_BAR,
        title: 'Action Bar',
        componentSlot: 'action-bar',
        purpose: 'Shared primary actions: workshop, start match and return.',
    }),
    [HANGAR_SHELL_REGION_IDS.STATUS_BAR]: Object.freeze({
        id: HANGAR_SHELL_REGION_IDS.STATUS_BAR,
        title: 'Status Bar',
        componentSlot: 'status-bar',
        purpose: 'Persistent feedback row for save state, warnings and sync status.',
    }),
});

export const HANGAR_SHELL_MODE_REGION_EXTENSIONS = Object.freeze({
    [HANGAR_MODES.ARCADE]: Object.freeze([
        Object.freeze({
            id: 'arcade-progression-panel',
            anchorRegionId: HANGAR_SHELL_REGION_IDS.RULES_PANEL,
            insertPosition: 'after',
            componentSlot: 'arcade-progression-panel',
            purpose: 'XP, mastery and slot-unlock overview tied to Arcade contracts.',
        }),
        Object.freeze({
            id: 'arcade-run-loop-panel',
            anchorRegionId: HANGAR_SHELL_REGION_IDS.ACTION_BAR,
            insertPosition: 'before',
            componentSlot: 'arcade-run-loop-panel',
            purpose: 'Desktop loop hints for run, workshop and hangar return.',
        }),
    ]),
    [HANGAR_MODES.FIGHT]: Object.freeze([
        Object.freeze({
            id: 'fight-balance-panel',
            anchorRegionId: HANGAR_SHELL_REGION_IDS.RULES_PANEL,
            insertPosition: 'after',
            componentSlot: 'fight-balance-panel',
            purpose: 'Live rule explanation for hitbox class normalization and limits.',
        }),
        Object.freeze({
            id: 'fight-loadout-alerts',
            anchorRegionId: HANGAR_SHELL_REGION_IDS.STATUS_BAR,
            insertPosition: 'before',
            componentSlot: 'fight-loadout-alerts',
            purpose: 'Immediate exploit and safety diagnostics for Fight builds.',
        }),
    ]),
});

export const HANGAR_SHELL_SURFACE_STATUS = Object.freeze({
    runtimeStatus: 'contract-only',
    productivity: 'not-fully-productive',
    activeProductSurface: 'src/ui/arcade/ArcadeMenuSurface.js',
    note: 'The shell layout is still a target contract; real desktop wiring continues through ArcadeMenuSurface plus workshop entry adapters until a dedicated hangar shell is shipped.',
});

function cloneCommonRegion(region) {
    return {
        id: region.id,
        title: region.title,
        componentSlot: region.componentSlot,
        purpose: region.purpose,
    };
}

function cloneModeExtension(extension) {
    return {
        id: extension.id,
        anchorRegionId: extension.anchorRegionId,
        insertPosition: extension.insertPosition,
        componentSlot: extension.componentSlot,
        purpose: extension.purpose,
    };
}

export function assertHangarShellRegionId(rawRegionId) {
    const normalized = String(rawRegionId || '').trim();
    return VALID_HANGAR_SHELL_REGION_ID_SET.has(normalized) ? normalized : null;
}

export function listHangarShellCommonRegions() {
    return HANGAR_SHELL_REGION_ORDER
        .map((regionId) => HANGAR_SHELL_COMMON_REGIONS[regionId])
        .filter(Boolean)
        .map(cloneCommonRegion);
}

export function listHangarShellModeRegionExtensions(rawMode) {
    const mode = resolveHangarMode(rawMode);
    const extensions = HANGAR_SHELL_MODE_REGION_EXTENSIONS[mode] || [];
    return extensions.map(cloneModeExtension);
}

export function resolveHangarShellLayout(rawMode) {
    const flow = resolveHangarUserFlow(rawMode);
    const mode = resolveHangarMode(flow.mode);
    const desktopEntry = resolveDesktopHangarEntryByMode(mode);
    const lifecycleContract = resolveHangarLifecycleContract(mode);
    const verificationTargets = listHangarVerificationTargets();
    const arcadeVehicleManagerLegacy = resolveArcadeVehicleManagerLegacyStatus();
    const desktopLoop = resolveHangarDesktopLoop(mode);
    const workshopModule = resolveHangarWorkshopModule(mode);
    const workshopNavigation = resolveHangarWorkshopViewSwitch(mode);
    const workshopPersistenceCapabilities = resolveHangarWorkshopPersistenceCapabilities(mode);
    return Object.freeze({
        contractVersion: HANGAR_SHELL_LAYOUT_VERSION,
        mode,
        dataSpace: flow.dataSpace,
        persistenceKey: flow.persistenceKey,
        startNavEvent: flow.startNavEvent,
        desktopEntry: desktopEntry ? Object.freeze({ ...desktopEntry }) : null,
        lifecycleContract: lifecycleContract
            ? Object.freeze({
                ...lifecycleContract,
                writeback: Object.freeze({ ...(lifecycleContract.writeback || {}) }),
                transitions: Object.freeze(
                    (Array.isArray(lifecycleContract.transitions) ? lifecycleContract.transitions : [])
                        .map((entry) => Object.freeze({ ...entry }))
                ),
            })
            : null,
        verificationTargets: Object.freeze(
            (Array.isArray(verificationTargets) ? verificationTargets : []).map((target) => Object.freeze({ ...target }))
        ),
        arcadeVehicleManagerLegacy: arcadeVehicleManagerLegacy
            ? Object.freeze({ ...arcadeVehicleManagerLegacy })
            : null,
        surfaceStatus: Object.freeze({ ...HANGAR_SHELL_SURFACE_STATUS }),
        commonRegions: listHangarShellCommonRegions(),
        modeExtensions: listHangarShellModeRegionExtensions(mode),
        desktopLoop: desktopLoop
            ? Object.freeze({
                contractVersion: desktopLoop.contractVersion,
                mode: desktopLoop.mode,
                entryStepId: desktopLoop.entryStepId,
                loopPath: Object.freeze([...(Array.isArray(desktopLoop.loopPath) ? desktopLoop.loopPath : [])]),
                steps: Object.freeze(
                    (Array.isArray(desktopLoop.steps) ? desktopLoop.steps : []).map((step) => Object.freeze({
                        stepId: step.stepId,
                        title: step.title,
                        description: step.description,
                        transitions: Object.freeze(
                            (Array.isArray(step.transitions) ? step.transitions : []).map((transition) => Object.freeze({
                                actionId: transition.actionId,
                                navEvent: transition.navEvent,
                                capabilityId: transition.capabilityId,
                                nextStepId: transition.nextStepId,
                                description: transition.description,
                            }))
                        ),
                    }))
                ),
            })
            : null,
        workshopModule: workshopModule
            ? Object.freeze({
                ...workshopModule,
                capabilities: Object.freeze({ ...(workshopModule.capabilities || {}) }),
            })
            : null,
        workshopNavigation: workshopNavigation
            ? Object.freeze({
                ...workshopNavigation,
                legacyNavigation: Object.freeze({ ...(workshopNavigation.legacyNavigation || {}) }),
            })
            : null,
        workshopPersistenceCapabilities: workshopPersistenceCapabilities
            ? Object.freeze({ ...workshopPersistenceCapabilities })
            : null,
        selectionWriteback: Object.freeze({
            source: 'start-setup',
            contractVersion: HANGAR_SELECTION_WRITEBACK_VERSION,
            persistencePathMap: HANGAR_SELECTION_WRITEBACK_PATHS,
        }),
    });
}
