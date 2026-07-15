export const ARCADE_VEHICLE_MANAGER_LEGACY_CONTRACT_VERSION = 'arcade-vehicle-manager-legacy.v1';

export const ARCADE_VEHICLE_MANAGER_LEGACY_STATUS = Object.freeze({
    status: 'window-only-entry',
    scope: 'src/ui/arcade/ArcadeVehicleManager.js',
    runtimeStatus: 'productively-wired',
    productivity: 'dedicated-workshop-active',
    activeProductSurface: Object.freeze({
        entryPath: 'src/ui/hangar/HangarWindowApp.js',
        entryAdapter: 'setupArcadeHangarWorkshop',
        modePath: 'arcade',
        mountId: 'hangar-window-mount',
    }),
    replacementPath: 'src/ui/hangar/ArcadeHangarWorkshop.js',
    replacementContracts: Object.freeze([
        'HangarWorkshopModuleContract',
        'HangarWorkshopPersistenceFacade',
        'HangarLifecycleContract',
    ]),
    note: 'ArcadeVehicleManager remains a narrow compatibility export; ArcadeMenuSurface only launches the dedicated Hangar window, where HangarWindowApp mounts the productive workshop.',
});

export function resolveArcadeVehicleManagerLegacyStatus() {
    return {
        contractVersion: ARCADE_VEHICLE_MANAGER_LEGACY_CONTRACT_VERSION,
        ...ARCADE_VEHICLE_MANAGER_LEGACY_STATUS,
    };
}
