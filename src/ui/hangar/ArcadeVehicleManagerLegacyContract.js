export const ARCADE_VEHICLE_MANAGER_LEGACY_CONTRACT_VERSION = 'arcade-vehicle-manager-legacy.v1';

export const ARCADE_VEHICLE_MANAGER_LEGACY_STATUS = Object.freeze({
    status: 'compatibility-entry',
    scope: 'src/ui/arcade/ArcadeVehicleManager.js',
    runtimeStatus: 'productively-wired',
    productivity: 'dedicated-workshop-active',
    activeProductSurface: Object.freeze({
        entryPath: 'src/ui/arcade/ArcadeMenuSurface.js',
        entryAdapter: 'setupArcadeMenuSurface',
        modePath: 'arcade',
        mountId: 'arcade-vehicle-manager-mount',
    }),
    replacementPath: 'src/ui/hangar/ArcadeHangarWorkshop.js',
    replacementContracts: Object.freeze([
        'HangarWorkshopModuleContract',
        'HangarWorkshopPersistenceFacade',
        'HangarLifecycleContract',
    ]),
    note: 'ArcadeVehicleManager remains a narrow compatibility export; the productive UI is the dedicated desktop workshop mounted by ArcadeMenuSurface.',
});

export function resolveArcadeVehicleManagerLegacyStatus() {
    return {
        contractVersion: ARCADE_VEHICLE_MANAGER_LEGACY_CONTRACT_VERSION,
        ...ARCADE_VEHICLE_MANAGER_LEGACY_STATUS,
    };
}
