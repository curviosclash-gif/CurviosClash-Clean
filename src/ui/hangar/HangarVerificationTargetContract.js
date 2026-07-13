export const HANGAR_VERIFICATION_TARGET_CONTRACT_VERSION = 'hangar-verification-targets.v1';

export const HANGAR_VERIFICATION_SURFACE_STATUS = Object.freeze({
    runtimeStatus: 'contract-only',
    productivity: 'not-fully-productive',
    activeProductSurface: 'src/ui/arcade/ArcadeMenuSurface.js',
    note: 'Verification targets describe the intended hangar shell and workshop split; the current productive UI path still runs through ArcadeMenuSurface plus desktop workshop adapters.',
});

export const HANGAR_VERIFICATION_TARGETS = Object.freeze({
    catalog: Object.freeze({
        id: 'catalog',
        title: 'Vehicle Catalog Contracts',
        focus: 'Catalog entries, labels and mode-aware surfacing stay deterministic.',
        recommendedSpecs: Object.freeze([
            'tests/arcade-hangar-rules.contract.test.mjs',
        ]),
    }),
    balanceContracts: Object.freeze({
        id: 'balance_contracts',
        title: 'Fight + Arcade Balance Contracts',
        focus: 'Derived-only fight stats and arcade unlock/budget contracts remain stable.',
        recommendedSpecs: Object.freeze([
            'tests/arcade-hangar-rules.contract.test.mjs',
        ]),
    }),
    progressionPaths: Object.freeze({
        id: 'progression_paths',
        title: 'Progression Paths',
        focus: 'XP, upgrades and progression snapshots remain deterministic by level.',
        recommendedSpecs: Object.freeze([
            'tests/arcade-hangar-rules.contract.test.mjs',
        ]),
    }),
    desktopBridge: Object.freeze({
        id: 'desktop_bridge',
        title: 'Desktop Bridge Contracts',
        focus: 'Desktop entry, workshop navigation and return lifecycle remain capability-based.',
        recommendedSpecs: Object.freeze([
            'tests/platform-capabilities.contract.test.mjs',
        ]),
    }),
    vehicleLabIntegration: Object.freeze({
        id: 'vehicle_lab_integration',
        title: 'Vehicle Lab Integration',
        focus: 'Vehicle lab module and persistence facade use named capabilities end-to-end.',
        recommendedSpecs: Object.freeze([
            'tests/editor-authoring-contract.contract.test.mjs',
        ]),
    }),
});

export function listHangarVerificationTargets() {
    return Object.freeze(Object.values(HANGAR_VERIFICATION_TARGETS).map((target) => ({
        id: target.id,
        title: target.title,
        focus: target.focus,
        recommendedSpecs: [...target.recommendedSpecs],
        surfaceStatus: Object.freeze({ ...HANGAR_VERIFICATION_SURFACE_STATUS }),
    })));
}
