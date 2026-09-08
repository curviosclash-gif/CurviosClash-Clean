export function createEdgeKey(fromFile, toFile) {
    return `${fromFile} -> ${toFile}`;
}

/** @type {[string, string][]} */
const legacyStateToUiImportEntries = [];

/** @type {[string, string][]} */
const legacyUiToStateImportEntries = [];

/** @type {[string, string][]} */
const legacyCoreToUiImportEntries = [];

export const LEGACY_CONSTRUCTOR_GAME_ALLOWLIST = new Map([]);

export const LEGACY_DOM_ACCESS_ALLOWLIST = new Map([
    ['src/core/AppInitializerLifecycle.js', 'Bootstrap readiness check remains infrastructure after the AppInitializer lifecycle split.'],
    ['src/core/BuildInfoController.js', 'Clipboard fallback still needs temporary DOM helpers.'],
    ['src/core/GameBootstrap.js', 'Canvas bootstrap is allowed infrastructure DOM access.'],
    ['src/core/GameLoop.js', 'Loop visibility handling and emergency overlay remain infrastructure concerns.'],
    ['src/core/MediaRecorderSystem.js', 'Recorder downloads and capture canvas creation are infrastructure DOM paths.'],
    ['src/core/RuntimeDiagnosticsSystem.js', 'Diagnostics overlay is an infrastructure DOM exception.'],
    ['src/core/RuntimeErrorOverlay.js', 'Fatal runtime overlay is intentionally outside src/ui.'],
    ['src/entities/arena/ArenaBuildResourceCache.js', 'Offscreen canvas generation is a rendering infrastructure exception.'],
]);

/** @type {[string, string][]} */
const legacyUiToCoreImportEntries = [];

/** @type {[string, string][]} */
const legacyStateToCoreImportEntries = [];

/** @type {[string, string][]} */
const legacySharedContractsToCoreImportEntries = [];

export const LEGACY_UI_TO_CORE_IMPORTS = new Map(legacyUiToCoreImportEntries);
export const LEGACY_CORE_TO_UI_IMPORTS = new Map(legacyCoreToUiImportEntries);
export const LEGACY_UI_TO_STATE_IMPORTS = new Map(legacyUiToStateImportEntries);
export const LEGACY_STATE_TO_UI_IMPORTS = new Map(legacyStateToUiImportEntries);

export const LEGACY_ENTITIES_TO_CORE_IMPORTS = new Map();
export const LEGACY_STATE_TO_CORE_IMPORTS = new Map(legacyStateToCoreImportEntries);
export const LEGACY_SHARED_CONTRACTS_TO_CORE_IMPORTS = new Map(legacySharedContractsToCoreImportEntries);
export const LEGACY_APPLICATION_TO_UI_IMPORTS = new Map();
export const LEGACY_APPLICATION_TO_CORE_IMPORTS = new Map();

// Feature- und Infrastrukturmodule stehen neben den benannten Schichten und waren
// bisher in keiner Kantenregel Absender: sie konnten importieren, was sie wollten.
// Der Weg nach draussen fuehrt ueber shared/contracts und injizierte Ports.
export const FEATURE_MODULE_PREFIXES = Object.freeze([
    'src/hunt/',
    'src/modes/',
    'src/four-player-planar/',
    'src/network/',
    'src/platform/',
]);

// Enger gefasst: hunt, modes und four-player-planar kapseln Spielregeln und haben
// in der Runtime nichts zu suchen. network und platform sind Infrastruktur und
// duerfen core weiterhin benutzen.
export const FEATURE_MODULE_RUNTIME_PREFIXES = Object.freeze([
    'src/hunt/',
    'src/modes/',
    'src/four-player-planar/',
]);

export const LEGACY_FEATURE_TO_UI_IMPORTS = new Map([
    [
        createEdgeKey(
            'src/four-player-planar/FourPlayerPlanarModule.js',
            'src/ui/four-player-planar/FourPlayerPlanarHudView.js'
        ),
        'Four-player planar module still mounts its own HUD view; awaiting a composition-side view factory.',
    ],
    [
        createEdgeKey(
            'src/four-player-planar/FourPlayerPlanarModule.js',
            'src/ui/four-player-planar/FourPlayerPlanarSetupView.js'
        ),
        'Four-player planar module still mounts its own setup view; awaiting a composition-side view factory.',
    ],
]);

export const LEGACY_FEATURE_TO_RUNTIME_IMPORTS = new Map([
    [
        createEdgeKey('src/four-player-planar/FourPlayerPlanarModule.js', 'src/core/Config.js'),
        'Four-player planar module reads CONFIG directly; awaiting injected tuning values.',
    ],
    [
        createEdgeKey(
            'src/hunt/KillcamPixelReplayLifecycle.js',
            'src/core/recording/KillcamPixelReplayBuffer.js'
        ),
        'Killcam replay lifecycle still reaches into the core recording buffer; awaiting a recording port.',
    ],
]);

export const BOUNDARY_MATRIX = Object.freeze({
    id: 'V96.1-boundary-matrix',
    updatedAt: '2026-08-03',
    sourceBlock: 'V96.1',
    snapshotSource: 'architecture-report scorecard + architecture-budget-ratchet.json',
    edgeDirections: Object.freeze({
        applicationToUi: Object.freeze({
            edge: 'application -> ui',
            currentAllowlist: 'LEGACY_APPLICATION_TO_UI_IMPORTS',
            currentBudgetKey: 'applicationToUiImportEdges',
            owner: 'Application session-runtime',
            status: 'enforced-zero',
            targetPhase: 'complete',
            targetState: '0 productive imports; enforced by the architecture guard',
            preferredPaths: Object.freeze([
                'Application-owned lobby_session_snapshot',
                'Shared contracts for menu lifecycle payloads',
                'Injected discovery/storage ports',
            ]),
            noNewConsumers: true,
        }),
        applicationToCore: Object.freeze({
            edge: 'application -> core',
            currentAllowlist: 'LEGACY_APPLICATION_TO_CORE_IMPORTS',
            currentBudgetKey: 'applicationToCoreImportEdges',
            owner: 'SessionRuntimeCommandUseCases',
            status: 'enforced-zero',
            targetPhase: 'complete',
            targetState: '0 productive imports; enforced by the architecture guard',
            preferredPaths: Object.freeze([
                'Command backend interfaces',
                'Runtime command/event contracts',
                'Composition-side core adapters',
            ]),
            noNewConsumers: true,
        }),
        uiToState: Object.freeze({
            edge: 'ui -> state',
            currentAllowlist: 'LEGACY_UI_TO_STATE_IMPORTS',
            currentBudgetKey: 'uiToStateImportEdges',
            owner: 'UI compatibility adapters',
            status: 'enforced-zero',
            targetPhase: 'complete',
            targetState: '0 productive imports; the former 3-edge baseline is gone because UI now reaches storage through src/shared/storage',
            preferredPaths: Object.freeze([
                'Read-only UI snapshots',
                'Intent commands',
                'Shared storage/profile contracts',
            ]),
            noNewConsumers: true,
        }),
        applicationToPlatform: Object.freeze({
            edge: 'application -> platform',
            currentBudgetKey: 'applicationToPlatformImportEdges',
            owner: 'Platform composition bindings',
            status: 'enforced-zero',
            targetPhase: 'complete',
            targetState: '0 productive imports; platform bindings are injected at the composition boundary',
            preferredPaths: Object.freeze(['Injected platform bindings', 'Shared capability descriptors']),
            noNewConsumers: true,
        }),
        sharedContractsToImplementation: Object.freeze({
            edge: 'shared/contracts -> implementation',
            currentBudgetKey: 'sharedContractsToImplementationImportEdges',
            owner: 'Shared contract layer',
            status: 'enforced-zero',
            targetPhase: 'complete',
            targetState: '0 productive imports into core, entities, state, UI, application, platform, hunt or modes',
            preferredPaths: Object.freeze(['Canonical shared registries', 'Canonical shared schemas']),
            noNewConsumers: true,
        }),
        featureToUi: Object.freeze({
            edge: 'hunt|modes|four-player-planar|network|platform -> ui',
            currentAllowlist: 'LEGACY_FEATURE_TO_UI_IMPORTS',
            currentBudgetKey: 'featureToUiImportEdges',
            owner: 'Feature and infrastructure modules',
            status: 'frozen-baseline',
            targetPhase: 'incremental',
            targetState: 'no new feature-to-UI imports; the 2-edge four-player-planar baseline can only shrink',
            preferredPaths: Object.freeze([
                'Injected view factories from the composition seam',
                'Shared contracts for HUD and setup payloads',
            ]),
            noNewConsumers: true,
        }),
        featureToRuntime: Object.freeze({
            edge: 'hunt|modes|four-player-planar -> core',
            currentAllowlist: 'LEGACY_FEATURE_TO_RUNTIME_IMPORTS',
            currentBudgetKey: 'featureToRuntimeImportEdges',
            owner: 'Gameplay feature modules',
            status: 'frozen-baseline',
            targetPhase: 'incremental',
            targetState: 'no new feature-to-core imports; the 2-edge baseline can only shrink behind ports',
            preferredPaths: Object.freeze([
                'Injected tuning values instead of CONFIG reads',
                'Narrow recording and runtime ports',
            ]),
            noNewConsumers: true,
        }),
        coreToUiComposition: Object.freeze({
            edge: 'core -> composition/core-ui',
            currentBudgetKey: 'coreToUiCompositionImportEdges',
            owner: 'Core/UI composition seam',
            status: 'frozen-baseline',
            targetPhase: 'incremental',
            targetState: 'tracked mediated UI dependencies; edge count may only shrink',
            preferredPaths: Object.freeze(['Injected UI factories', 'Narrow runtime ports']),
            noNewConsumers: true,
        }),
    }),
    layerTargets: Object.freeze({
        applicationUseCases: Object.freeze({
            label: 'Application-Use-Cases',
            owns: 'Commands, events, session snapshots and use-case orchestration',
            directPartners: Object.freeze(['shared/contracts', 'runtime ports', 'platform capability descriptors']),
            forbidden: Object.freeze(['src/ui/** helpers as business dependencies', 'direct src/core/** service imports']),
        }),
        platformAdapters: Object.freeze({
            label: 'Platform-Adapter',
            owns: 'Desktop/browser capability resolution and global-read isolation',
            directPartners: Object.freeze(['shared/contracts', 'application capability consumers']),
            forbidden: Object.freeze(['match rules', 'session ownership', 'UI projections']),
        }),
        sharedContracts: Object.freeze({
            label: 'Shared-Contracts',
            owns: 'Side-effect-free IDs, payloads, snapshots, capabilities and versioned shapes',
            directPartners: Object.freeze(['application', 'core runtime', 'platform adapters', 'UI consumers']),
            forbidden: Object.freeze(['src/core/** imports', 'global runtime reads', 'platform side effects']),
        }),
        runtimePorts: Object.freeze({
            label: 'Runtime-Ports',
            owns: 'Narrow migration seams for lifecycle, session, rendering, input and settings intents',
            directPartners: Object.freeze(['runtime composition', 'application commands', 'read-only projections']),
            forbidden: Object.freeze(['new generic game/runtimeFacade fallbacks', 'broad service locator behavior']),
        }),
    }),
});

export const ARCHITECTURE_SCORECARD_TARGETS = Object.freeze({
    configWrites: 0,
    disallowedConstructorGameFiles: 0,
    disallowedDomAccessFiles: 0,
    disallowedCoreToUiImports: 0,
    disallowedUiToCoreImports: 0,
    disallowedUiToStateImports: 0,
    disallowedStateToUiImports: 0,
    disallowedEntitiesToCoreImports: 0,
    disallowedStateToCoreImports: 0,
    disallowedSharedContractsToCoreImports: 0,
    disallowedApplicationToUiImports: 0,
    disallowedApplicationToCoreImports: 0,
    disallowedApplicationToPlatformImports: 0,
    disallowedSharedContractsToImplementationImports: 0,
    disallowedFeatureToUiImports: 0,
    disallowedFeatureToRuntimeImports: 0,
});

export const ARCHITECTURE_SCORECARD_BUDGETS = Object.freeze({
    constructorGameFiles: LEGACY_CONSTRUCTOR_GAME_ALLOWLIST.size,
    domAccessFiles: LEGACY_DOM_ACCESS_ALLOWLIST.size,
    coreToUiImportEdges: LEGACY_CORE_TO_UI_IMPORTS.size,
    uiToCoreImportEdges: LEGACY_UI_TO_CORE_IMPORTS.size,
    uiToStateImportEdges: LEGACY_UI_TO_STATE_IMPORTS.size,
    stateToUiImportEdges: LEGACY_STATE_TO_UI_IMPORTS.size,
    entitiesToCoreImportEdges: LEGACY_ENTITIES_TO_CORE_IMPORTS.size,
    stateToCoreImportEdges: LEGACY_STATE_TO_CORE_IMPORTS.size,
    sharedContractsToCoreImportEdges: LEGACY_SHARED_CONTRACTS_TO_CORE_IMPORTS.size,
    applicationToUiImportEdges: LEGACY_APPLICATION_TO_UI_IMPORTS.size,
    applicationToCoreImportEdges: LEGACY_APPLICATION_TO_CORE_IMPORTS.size,
    applicationToPlatformImportEdges: 0,
    sharedContractsToImplementationImportEdges: 0,
    coreToUiCompositionImportEdges: 27,
    featureToUiImportEdges: LEGACY_FEATURE_TO_UI_IMPORTS.size,
    featureToRuntimeImportEdges: LEGACY_FEATURE_TO_RUNTIME_IMPORTS.size,
});
