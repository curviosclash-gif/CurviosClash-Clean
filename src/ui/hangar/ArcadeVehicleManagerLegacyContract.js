export const ARCADE_VEHICLE_MANAGER_LEGACY_CONTRACT_VERSION = 'arcade-vehicle-manager-legacy.v1';

export const ARCADE_VEHICLE_MANAGER_LEGACY_STATUS = Object.freeze({
    status: 'legacy-embedded',
    scope: 'src/ui/arcade/ArcadeVehicleManager.js',
    runtimeStatus: 'productively-wired',
    productivity: 'legacy-compatibility-path',
    activeProductSurface: Object.freeze({
        entryPath: 'src/ui/arcade/ArcadeMenuSurface.js',
        entryAdapter: 'setupArcadeMenuSurface',
        modePath: 'arcade',
        mountId: 'arcade-vehicle-manager-mount',
    }),
    replacementPath: 'hangar-workshop.vehicle-lab',
    replacementContracts: Object.freeze([
        'HangarWorkshopModuleContract',
        'HangarWorkshopPersistenceFacade',
        'HangarLifecycleContract',
    ]),
    note: 'Embedded Arcade vehicle manager stays productively wired via ArcadeMenuSurface until the dedicated workshop path fully replaces it.',
});

export function resolveArcadeVehicleManagerLegacyStatus() {
    return {
        contractVersion: ARCADE_VEHICLE_MANAGER_LEGACY_CONTRACT_VERSION,
        ...ARCADE_VEHICLE_MANAGER_LEGACY_STATUS,
    };
}
