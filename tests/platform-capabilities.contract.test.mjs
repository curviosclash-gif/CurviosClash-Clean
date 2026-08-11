import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createBrowserDiscoveryAdapter,
    createBrowserHostAdapter,
} from '../src/platform/browser/BrowserPlatformAdapters.js';
import {
    createElectronPreloadDiscoveryAdapter,
    createElectronPreloadSaveAdapter,
    resolveElectronRuntimeSnapshot,
} from '../src/platform/electron/ElectronPlatformBridge.js';
import { BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION } from '../src/shared/contracts/BrowserDemoSurfacePolicyOverrideContract.js';
import {
    PLATFORM_CAPABILITY_IDS,
} from '../src/shared/contracts/PlatformCapabilityContract.js';
import {
    PLATFORM_CAPABILITY_REGISTRY,
    PLATFORM_PRODUCT_SURFACE_IDS,
    PLATFORM_PROVIDER_KINDS,
    PLATFORM_SURFACE_DEVELOPER_ACCESS_MODES,
    PLATFORM_SURFACE_DEVELOPER_ACCESS_REASONS,
    PLATFORM_SURFACE_MENU_MODE_PATHS,
    PLATFORM_SURFACE_MULTIPLAYER_ROLES,
    PLATFORM_SURFACE_POLICY_MODES,
    PLATFORM_SURFACE_QUICK_START_ACTION_IDS,
    isLegacyLobbyTransport,
    normalizeLobbyProviderTransport,
    resolveCapabilityProviderKind,
    resolveDefaultLobbyTransport,
    resolveLobbyProviderKind,
    resolvePlatformProductSurfaceId,
    resolveSurfaceCapabilityAccess,
    resolveSurfaceDeveloperAccess,
    resolveSurfacePolicy,
} from '../src/shared/contracts/PlatformCapabilityRegistry.js';
import {
    isLegacyMultiplayerTransport,
    normalizeMultiplayerTransport,
} from '../src/shared/contracts/RuntimeSessionContract.js';
import {
    normalizeLobbyServiceTransport,
} from '../src/shared/contracts/LobbyServiceContract.js';
import {
    applySurfaceMenuState,
    isSurfaceModePathAllowed,
    isSurfaceMapKeyAllowedForModePath,
    isSurfacePresetAllowed,
    isSurfaceQuickStartActionAllowed,
    isSurfaceSessionTypeAllowed,
    PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS,
    PLATFORM_SURFACE_FEATURE_IDS,
    listSurfaceAllowedMapKeysForModePath,
    listSurfaceAllowedSessionTypes,
    resolveSurfaceBlockedFeatureFeedback,
    resolveSurfaceEntryCopy,
    resolveSurfaceFallbackModePath,
    resolveSurfaceFallbackSessionType,
    resolveSurfaceFeatureClassification,
    resolveSurfaceMenuState,
    resolveSurfaceMultiplayerGateAccess,
} from '../src/shared/contracts/PlatformSurfacePolicyOps.js';
import { StoragePlatform } from '../src/state/storage/StoragePlatform.js';
import { resolveRuntimeMenuFeatureFlags } from '../src/ui/menu/MenuRuntimeFeatureFlags.js';
import { resolveSurfaceFeatureLaunchGuard } from '../src/ui/menu/MenuSurfaceFeatureAccess.js';
import { syncMenuSurfacePolicyUi } from '../src/ui/menu/MenuSurfacePolicyUiSync.js';
import { MenuTextRuntime } from '../src/ui/menu/MenuTextRuntime.js';
import { createMenuMultiplayerDiscoveryPort } from '../src/ui/menu/multiplayer/MenuMultiplayerDiscoveryPort.js';
import { createMenuMultiplayerHostIpResolver } from '../src/ui/menu/multiplayer/MenuMultiplayerHostIpResolver.js';

function createBrowserDemoBuildArtifactRuntimeGlobal({
    status = 200,
    body = '',
} = {}) {
    return {
        fetch: async () => {
            return {
                status,
                text: async () => body,
            };
        },
    };
}

test('mobile-classic resolves to a join-only LAN-only product surface', () => {
    const productSurfaceId = resolvePlatformProductSurfaceId({
        appMode: 'app',
        appTarget: 'mobile-classic',
    });
    const policy = resolveSurfacePolicy({ productSurfaceId });
    const host = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.HOST, { productSurfaceId });
    const discovery = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.DISCOVERY, { productSurfaceId });

    assert.equal(productSurfaceId, PLATFORM_PRODUCT_SURFACE_IDS.MOBILE_APP);
    assert.equal(policy.multiplayerRole, PLATFORM_SURFACE_MULTIPLAYER_ROLES.JOIN_ONLY);
    assert.deepEqual(policy.allowedSessionTypes, ['single', 'multiplayer']);
    assert.deepEqual(policy.allowedMultiplayerTransports, ['lan']);
    assert.deepEqual(policy.hostMultiplayerTransports, []);
    assert.deepEqual(policy.joinMultiplayerTransports, ['lan']);
    assert.equal(host.available, false);
    assert.equal(discovery.available, false);
});

test('V87.3 Electron discovery adapter suppresses stale capability availability without intents', () => {
    const runtimeGlobal = {
        __CURVIOS_APP__: true,
        curviosApp: {
            isApp: true,
            contracts: {
                discovery: {
                    contractVersion: 'preload.discovery.test',
                },
            },
            capabilities: {
                discovery: {
                    available: true,
                    providerKind: 'electron-ipc',
                    supportsSubscribe: true,
                },
            },
        },
    };

    const adapter = createElectronPreloadDiscoveryAdapter(runtimeGlobal);
    assert.equal(adapter.capability.available, false);
    assert.equal(adapter.isAvailable(), false);
    assert.equal(adapter.startDiscovery, null);
    assert.equal(adapter.getDiscoveredHosts, null);
    assert.equal(adapter.onDiscoveredHosts, null);
    assert.equal(adapter.capability.degradedReason, 'discovery_unavailable');
    assert.equal(adapter.capability.supportsSubscribe, false);
});

test('V115.4.5 platform capability registries and resolved policies stay immutable', () => {
    const desktopPolicy = resolveSurfacePolicy({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    const browserEnvironment = resolveDefaultLobbyTransport({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });
    const desktopProduct = PLATFORM_CAPABILITY_REGISTRY.products[PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP];

    assert.equal(browserEnvironment, 'lan');
    assert.equal(Object.isFrozen(PLATFORM_CAPABILITY_REGISTRY), true);
    assert.equal(Object.isFrozen(PLATFORM_CAPABILITY_REGISTRY.products), true);
    assert.equal(Object.isFrozen(desktopProduct), true);
    assert.equal(Object.isFrozen(desktopProduct.surfacePolicy), true);
    assert.equal(Object.isFrozen(desktopProduct.surfacePolicy.allowedSessionTypes), true);
    assert.equal(Object.isFrozen(desktopPolicy), true);
    assert.equal(Object.isFrozen(desktopPolicy.allowedSessionTypes), true);
    assert.throws(() => {
        desktopPolicy.allowedSessionTypes.push('mutated');
    }, TypeError);
});

test('V87.3 Browser discovery port stays unavailable when desktop fallbacks are absent', async () => {
    const port = createMenuMultiplayerDiscoveryPort({
        runtime: { global: {} },
    });

    assert.equal(port.isAvailable(), false);
    assert.deepEqual(await Promise.resolve(port.getHosts()), []);
    assert.equal(typeof port.subscribe(() => {}), 'function');
});

test('V87.3 Browser platform adapters expose null intents while capability availability stays false', () => {
    const discovery = createBrowserDiscoveryAdapter();
    const host = createBrowserHostAdapter();

    assert.equal(discovery.isAvailable(), false);
    assert.equal(discovery.capability.available, false);
    assert.equal(discovery.startDiscovery, null);
    assert.equal(discovery.stopDiscovery, null);
    assert.equal(discovery.getDiscoveredHosts, null);
    assert.equal(discovery.onDiscoveredHosts, null);
    assert.equal(host.isAvailable(), false);
    assert.equal(host.capability.available, false);
    assert.equal(host.getLanServerStatus, null);
    assert.equal(host.startLanServer, null);
    assert.equal(host.stopLanServer, null);
});

test('V77.2.1 surface policy contract keeps desktop default-full and browser default-deny', () => {
    const desktopPolicy = resolveSurfacePolicy({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    const browserPolicy = resolveSurfacePolicy({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(desktopPolicy.defaultAccessMode, PLATFORM_SURFACE_POLICY_MODES.DEFAULT_FULL);
    assert.equal(desktopPolicy.multiplayerRole, PLATFORM_SURFACE_MULTIPLAYER_ROLES.HOST_AND_JOIN);
    assert.equal(desktopPolicy.requiresCuratedMaps, false);
    assert.deepEqual(desktopPolicy.allowedSessionTypes, ['single', 'multiplayer', 'splitscreen']);
    assert.equal(desktopPolicy.defaultMultiplayerTransport, 'lan');
    assert.deepEqual(desktopPolicy.allowedMultiplayerTransports, ['lan', 'online']);
    assert.deepEqual(desktopPolicy.hostMultiplayerTransports, ['lan', 'online']);
    assert.ok(desktopPolicy.allowedGameModes.includes('Arcade'));
    assert.ok(desktopPolicy.allowedModePaths.includes(PLATFORM_SURFACE_MENU_MODE_PATHS.QUICK_ACTION));

    assert.equal(browserPolicy.defaultAccessMode, PLATFORM_SURFACE_POLICY_MODES.DEFAULT_DENY);
    assert.equal(browserPolicy.multiplayerRole, PLATFORM_SURFACE_MULTIPLAYER_ROLES.JOIN_ONLY);
    assert.equal(browserPolicy.requiresCuratedMaps, true);
    assert.deepEqual(browserPolicy.allowedSessionTypes, ['single', 'multiplayer']);
    assert.equal(browserPolicy.defaultMultiplayerTransport, 'lan');
    assert.deepEqual(browserPolicy.allowedMultiplayerTransports, ['lan']);
    assert.deepEqual(browserPolicy.hostMultiplayerTransports, []);
    assert.deepEqual(browserPolicy.joinMultiplayerTransports, ['lan']);
    assert.deepEqual(browserPolicy.legacyMultiplayerTransports, ['storage-bridge']);
    assert.ok(browserPolicy.allowedGameModes.includes('Parcours'));
    assert.deepEqual(browserPolicy.allowedPresetIds, ['arcade', 'fight-standard', 'normal-standard']);
    assert.deepEqual(browserPolicy.curatedMapKeysByModePath.arcade, ['parcours_rift']);
    assert.equal(browserPolicy.allowedModePaths.includes(PLATFORM_SURFACE_MENU_MODE_PATHS.QUICK_ACTION), false);
});

test('V98.2.1 resolveSurfacePolicy applies browser-demo override clamp centrally in the registry resolver', () => {
    const browserPolicy = resolveSurfacePolicy({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
        browserDemoSurfacePolicyOverrideDraft: {
            contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
            policy: {
                allowedSessionTypes: ['single', 'splitscreen'],
                allowedModePaths: ['fight', 'quick_action'],
                allowedPresetIds: ['fight-standard', 'future-preset'],
                allowedMultiplayerTransports: ['online'],
                joinMultiplayerTransports: ['online'],
            },
        },
    });

    assert.deepEqual(browserPolicy.allowedSessionTypes, ['single']);
    assert.deepEqual(browserPolicy.allowedModePaths, ['fight']);
    assert.equal(browserPolicy.defaultModePath, 'fight');
    assert.deepEqual(browserPolicy.allowedPresetIds, ['fight-standard']);
    assert.deepEqual(browserPolicy.allowedMultiplayerTransports, []);
    assert.deepEqual(browserPolicy.joinMultiplayerTransports, []);
    assert.equal(browserPolicy.browserDemoOverrideDiagnostics.status, 'applied');
    assert.equal(browserPolicy.browserDemoOverrideDiagnostics.reasonCode, 'BROWSER_DEMO_OVERRIDE_APPLIED');
    assert.equal(browserPolicy.browserDemoOverrideDiagnostics.source, 'options');
});

test('V98.2.2 PlatformSurfacePolicyOps consumers read the same merged browser-demo state without custom override branches', () => {
    const overrideOptions = {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
        browserDemoSurfacePolicyOverrideDraft: {
            contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
            policy: {
                allowedModePaths: ['fight'],
                allowedMultiplayerTransports: ['online'],
                joinMultiplayerTransports: ['online'],
            },
        },
    };

    assert.equal(isSurfaceModePathAllowed(PLATFORM_SURFACE_MENU_MODE_PATHS.FIGHT, overrideOptions), true);
    assert.equal(isSurfaceModePathAllowed(PLATFORM_SURFACE_MENU_MODE_PATHS.ARCADE, overrideOptions), false);

    const joinGate = resolveSurfaceMultiplayerGateAccess('join', overrideOptions);
    assert.equal(joinGate.allowed, false);
    assert.equal(joinGate.reason, 'surface_join_no_transport');
});

test('V98.2.3 resolveSurfaceCapabilityAccess narrows availability via capability flags and exposes structured diagnostics', () => {
    const saveCapability = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.SAVE, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
        browserDemoSurfacePolicyOverrideDraft: {
            contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
            capabilityFlags: {
                save: false,
            },
        },
    });

    assert.equal(saveCapability.available, false);
    assert.equal(saveCapability.providerKind, PLATFORM_PROVIDER_KINDS.BROWSER_DEMO);
    assert.equal(saveCapability.browserDemoOverrideDiagnostics.status, 'applied');
    assert.equal(saveCapability.browserDemoOverrideDiagnostics.reasonCode, 'BROWSER_DEMO_OVERRIDE_APPLIED');
    assert.equal(saveCapability.browserDemoOverrideDiagnostics.source, 'options');
});

test('V98.2.3 override diagnostics report fallback and reject reason-codes for browser-demo resolver paths', () => {
    const fallbackPolicy = resolveSurfacePolicy({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
        browserDemoSurfacePolicyOverrideDraft: {
            contractVersion: 'browser-demo-surface-policy.v9',
            policy: {
                allowedModePaths: ['fight'],
            },
        },
    });
    assert.equal(fallbackPolicy.browserDemoOverrideDiagnostics.status, 'fallback');
    assert.equal(
        fallbackPolicy.browserDemoOverrideDiagnostics.reasonCode,
        'BROWSER_DEMO_OVERRIDE_FALLBACK_VERSION_UNKNOWN'
    );

    const rejectedPolicy = resolveSurfacePolicy({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
        browserDemoSurfacePolicyOverrideDraft: {
            contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
            policy: {
                unknownPolicyField: true,
            },
        },
    });
    assert.equal(rejectedPolicy.browserDemoOverrideDiagnostics.status, 'reject');
    assert.equal(
        rejectedPolicy.browserDemoOverrideDiagnostics.reasonCode,
        'BROWSER_DEMO_OVERRIDE_VALIDATION_FAILED'
    );
});

test('V98.4.3 browser runtime reads build export artifact and applies monotone override clamp', async () => {
    const runtimeGlobal = createBrowserDemoBuildArtifactRuntimeGlobal({
        body: JSON.stringify({
            contractVersion: 'browser-demo-surface-policy-export.v1',
            generatedAt: '2026-04-24T00:00:00.000Z',
            source: {
                kind: 'test',
                overrideFilePath: 'memory://browser-demo-policy',
            },
            draft: {
                contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
                policy: {
                    allowedSessionTypes: ['single', 'splitscreen'],
                    allowedModePaths: ['fight', 'quick_action'],
                    allowedMultiplayerTransports: ['online'],
                },
                capabilityFlags: {
                    save: false,
                },
            },
        }),
    });

    resolveSurfacePolicy({ runtimeGlobal });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const policy = resolveSurfacePolicy({ runtimeGlobal });
    assert.deepEqual(policy.allowedSessionTypes, ['single']);
    assert.deepEqual(policy.allowedModePaths, ['fight']);
    assert.deepEqual(policy.allowedMultiplayerTransports, []);
    assert.equal(policy.browserDemoOverrideDiagnostics.status, 'applied');
    assert.equal(policy.browserDemoOverrideDiagnostics.reasonCode, 'BROWSER_DEMO_OVERRIDE_APPLIED');
    assert.equal(policy.browserDemoOverrideDiagnostics.source, 'build-artifact');

    const saveCapability = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.SAVE, {
        runtimeGlobal,
    });
    assert.equal(saveCapability.available, false);
    assert.equal(saveCapability.browserDemoOverrideDiagnostics.source, 'build-artifact');
});

test('V98.4.3 browser runtime falls back to base policy when build export artifact contract is invalid', async () => {
    const runtimeGlobal = createBrowserDemoBuildArtifactRuntimeGlobal({
        body: JSON.stringify({
            contractVersion: 'browser-demo-surface-policy-export.v9',
            draft: {
                contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
                policy: {
                    allowedModePaths: ['fight'],
                },
            },
        }),
    });

    resolveSurfacePolicy({ runtimeGlobal });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const policy = resolveSurfacePolicy({ runtimeGlobal });
    assert.deepEqual(policy.allowedModePaths, ['arcade', 'fight', 'normal']);
    assert.equal(policy.browserDemoOverrideDiagnostics.status, 'reject');
    assert.equal(
        policy.browserDemoOverrideDiagnostics.reasonCode,
        'BROWSER_DEMO_OVERRIDE_SNAPSHOT_INVALID'
    );
    assert.equal(policy.browserDemoOverrideDiagnostics.source, 'build-artifact');
});

test('V77.4.1 default lobby transport follows the shared surface transport matrix', () => {
    assert.equal(resolveDefaultLobbyTransport({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    }), 'lan');
    assert.equal(resolveDefaultLobbyTransport({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), 'lan');
});

test('V77.3.1 browser surface policy exposes curated map and preset allowlists while quickstart stays unavailable', () => {
    assert.deepEqual(
        listSurfaceAllowedMapKeysForModePath(PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL, {
            productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
        }),
        ['standard', 'maze']
    );
    assert.equal(isSurfacePresetAllowed('arcade', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), true);
    assert.equal(isSurfacePresetAllowed('competitive', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), false);
    assert.equal(isSurfaceQuickStartActionAllowed(PLATFORM_SURFACE_QUICK_START_ACTION_IDS.EVENT_PLAYLIST, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), false);
});

test('V77.3.2 blocked demo actions share the same UX feedback contract', () => {
    const blockedQuickStart = resolveSurfaceBlockedFeatureFeedback('Direktstart', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });
    const blockedPreset = resolveSurfaceBlockedFeatureFeedback('Dieses Preset', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });
    const blockedDesktop = resolveSurfaceBlockedFeatureFeedback('Direktstart', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });

    assert.equal(blockedQuickStart.reason, 'surface_policy_blocked');
    assert.equal(blockedQuickStart.tone, 'warning');
    assert.equal(blockedQuickStart.durationMs, 1600);
    assert.match(blockedQuickStart.message, /Direktstart ist in dieser Demo nicht verfuegbar/);
    assert.match(blockedPreset.message, /ist in dieser Demo nicht verfuegbar/);
    assert.match(blockedDesktop.message, /ist in dieser Surface nicht verfuegbar/);
});

test('V77.3.3 surface entry copy cuts showcase, join-only and splitscreen access per surface', () => {
    const desktopEntryCopy = resolveSurfaceEntryCopy({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
        sessionType: 'single',
    });
    const browserEntryCopy = resolveSurfaceEntryCopy({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
        sessionType: 'single',
    });

    assert.deepEqual(listSurfaceAllowedSessionTypes({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), ['single', 'multiplayer']);
    assert.equal(isSurfaceSessionTypeAllowed('splitscreen', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), false);
    assert.equal(browserEntryCopy.startButtonLabel, 'Demo starten');
    assert.equal(browserEntryCopy.hostButtonLabel, 'Nur Desktop');
    assert.equal(browserEntryCopy.joinButtonLabel, 'Beitreten');
    assert.match(browserEntryCopy.multiplayerSubtitle, /keine Lobby hosten/);
    assert.equal(desktopEntryCopy.hostButtonLabel, 'Lobby erstellen');
    assert.equal(desktopEntryCopy.sessionSummaryLabels.single, 'Einzelspieler');
});

test('surface UI sync remains the final owner of browser copy while honoring developer text overrides', () => {
    const createButton = (textContent, dataset = {}) => ({
        textContent,
        dataset: { ...dataset },
        classList: { toggle() {} },
        setAttribute() {},
        querySelector() { return null; },
        disabled: false,
        title: '',
    });
    const singleLabel = { textContent: 'Single Player' };
    const singleButton = createButton('', { sessionType: 'single' });
    singleButton.querySelector = () => singleLabel;
    const startButton = createButton('Starten');
    const editorButton = createButton('3D Map-Editor oeffnen');
    const overrides = new Map();
    const menuTextRuntime = new MenuTextRuntime({
        overridePort: {
            getOverride(textId) {
                return overrides.get(textId) || '';
            },
        },
    });
    const settings = {
        localSettings: {
            sessionType: 'single',
            modePath: 'normal',
            developerModeEnabled: false,
            releasePreviewEnabled: false,
        },
    };
    const ui = {
        sessionButtons: [singleButton],
        modePathButtons: [],
        startButton,
        openEditorButton: editorButton,
    };
    const surfacePolicy = { productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO };
    const sync = (releaseState) => syncMenuSurfacePolicyUi({
        ui,
        settings,
        sessionType: 'single',
        surfacePolicy,
        menuTextRuntime,
        releaseState,
    });

    sync({ featureEnabled: true, releasePreviewEnabled: false, releaseCutEnabled: false });
    assert.equal(singleLabel.textContent, 'Demo');
    assert.equal(startButton.textContent, 'Demo starten');
    assert.equal(editorButton.textContent, '3D-Map-Editor öffnen (Nur Desktop)');

    settings.localSettings.developerModeEnabled = true;
    overrides.set('menu.level1.single.label', 'Solo Lab');
    overrides.set('menu.level3.start.label', 'Los jetzt');
    overrides.set('menu.level4.tools.map_editor.label', 'Map Builder');
    sync({ featureEnabled: true, releasePreviewEnabled: false, releaseCutEnabled: false });
    assert.equal(singleLabel.textContent, 'Solo Lab');
    assert.equal(startButton.textContent, 'Los jetzt');
    assert.equal(editorButton.textContent, 'Map Builder (Nur Desktop)');

    settings.localSettings.releasePreviewEnabled = true;
    sync({ featureEnabled: true, releasePreviewEnabled: true, releaseCutEnabled: true });
    assert.equal(singleLabel.textContent, 'Demo');
    assert.equal(startButton.textContent, 'Demo starten');
    assert.equal(editorButton.textContent, '3D Map-Editor oeffnen (Nur Desktop)');
});

test('V77.4.4 surface menu state resolves browser-demo fallbacks without mutating settings in the UI layer', () => {
    const rawSettings = {
        mapKey: 'custom',
        localSettings: {
            sessionType: 'splitscreen',
            modePath: 'quick_action',
        },
    };

    const resolved = resolveSurfaceMenuState(rawSettings, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
        maps: {
            standard: { key: 'standard' },
            maze: { key: 'maze' },
            parcours_rift: { key: 'parcours_rift', parcours: { enabled: true } },
        },
    });

    assert.equal(resolved.sessionType, 'single');
    assert.equal(resolved.modePath, 'normal');
    assert.equal(resolved.mapKey, 'standard');
    assert.equal(rawSettings.localSettings.sessionType, 'splitscreen');
    assert.equal(rawSettings.localSettings.modePath, 'quick_action');
    assert.equal(rawSettings.mapKey, 'custom');
});

test('V77.4.4 explicit surface menu migration applies browser-demo fallbacks only on the runtime start path', () => {
    const settings = {
        mapKey: 'custom',
        localSettings: {
            sessionType: 'splitscreen',
            modePath: 'quick_action',
        },
    };

    const migration = applySurfaceMenuState(settings, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
        maps: {
            standard: { key: 'standard' },
            maze: { key: 'maze' },
            parcours_rift: { key: 'parcours_rift', parcours: { enabled: true } },
        },
    });

    assert.equal(migration.changed, true);
    assert.deepEqual(migration.changedKeys, ['sessionType', 'modePath', 'mapKey']);
    assert.equal(settings.localSettings.sessionType, 'single');
    assert.equal(settings.localSettings.modePath, 'normal');
    assert.equal(settings.mapKey, 'standard');
});

test('V77.4.4 curated fallback never resolves to a non-curated map key when browser demo maps are incomplete', () => {
    const rawSettings = {
        mapKey: 'custom',
        localSettings: {
            sessionType: 'single',
            modePath: 'normal',
        },
    };
    const resolved = resolveSurfaceMenuState(rawSettings, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
        maps: {
            custom: { key: 'custom' },
            parcours_rift: { key: 'parcours_rift', parcours: { enabled: true } },
        },
    });

    assert.equal(resolved.mapKey, 'standard');
});

test('V77.5.1 surface feature classification marks replay and video paths per product surface', () => {
    const browserReplay = resolveSurfaceFeatureClassification(PLATFORM_SURFACE_FEATURE_IDS.REPLAY_EXPORT, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });
    const browserVideo = resolveSurfaceFeatureClassification(PLATFORM_SURFACE_FEATURE_IDS.VIDEO_EXPORT, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });
    const desktopVideo = resolveSurfaceFeatureClassification(PLATFORM_SURFACE_FEATURE_IDS.VIDEO_EXPORT, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });

    assert.equal(browserReplay.classification, PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DEMO_SAFE);
    assert.equal(browserVideo.classification, PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.FUTURE_OPT_IN);
    assert.equal(desktopVideo.classification, PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY);
});

test('V77.5.1 surface feature classification keeps file IO desktop-only and tooling legacy', () => {
    const browserFileIo = resolveSurfaceFeatureClassification(PLATFORM_SURFACE_FEATURE_IDS.FILE_IO, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });
    const desktopFileIo = resolveSurfaceFeatureClassification(PLATFORM_SURFACE_FEATURE_IDS.FILE_IO, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    const browserTooling = resolveSurfaceFeatureClassification(PLATFORM_SURFACE_FEATURE_IDS.TOOLING, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(browserFileIo.classification, PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY);
    assert.equal(desktopFileIo.classification, PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY);
    assert.equal(browserTooling.classification, PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.LEGACY);
});

test('V77.5.3 map and vehicle editors stay desktop-only full-version features', () => {
    const browserMapEditor = resolveSurfaceFeatureClassification(PLATFORM_SURFACE_FEATURE_IDS.MAP_EDITOR, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });
    const desktopMapEditor = resolveSurfaceFeatureClassification(PLATFORM_SURFACE_FEATURE_IDS.MAP_EDITOR, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    const browserVehicleEditor = resolveSurfaceFeatureClassification(PLATFORM_SURFACE_FEATURE_IDS.VEHICLE_EDITOR, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(browserMapEditor.classification, PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY);
    assert.equal(desktopMapEditor.classification, PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY);
    assert.equal(browserVehicleEditor.classification, PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY);
    assert.match(browserMapEditor.rationale, /Vollversions-Authoring-Funktion/);
    assert.match(browserVehicleEditor.rationale, /Vollversions-Funktion/);
});

test('V77.5.3 launch guard blocks browser-demo editor entrypoints with structured feedback', () => {
    const blockedMapEditor = resolveSurfaceFeatureLaunchGuard(
        { productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO },
        PLATFORM_SURFACE_FEATURE_IDS.MAP_EDITOR,
        '3D Map-Editor'
    );
    const allowedMapEditor = resolveSurfaceFeatureLaunchGuard(
        { productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP },
        PLATFORM_SURFACE_FEATURE_IDS.MAP_EDITOR,
        '3D Map-Editor'
    );

    assert.equal(blockedMapEditor.allowed, false);
    assert.equal(blockedMapEditor.reason, 'surface_policy_blocked');
    assert.equal(blockedMapEditor.tone, 'warning');
    assert.equal(blockedMapEditor.durationMs, 1600);
    assert.match(blockedMapEditor.message, /3D Map-Editor ist in dieser Demo nicht verfuegbar/);
    assert.equal(blockedMapEditor.featureClassification?.classification, PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY);

    assert.equal(allowedMapEditor.allowed, true);
    assert.equal(allowedMapEditor.featureClassification?.classification, PLATFORM_SURFACE_FEATURE_CLASSIFICATIONS.DESKTOP_ONLY);
});

test('V77.2.1 browser host provider resolves unavailable when host capability is disabled', () => {
    const providerKind = resolveCapabilityProviderKind(PLATFORM_CAPABILITY_IDS.HOST, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
        available: false,
    });
    assert.equal(providerKind, PLATFORM_PROVIDER_KINDS.UNAVAILABLE);
});

test('V77.2.2 surface capability access resolves host denylist and discovery allowlist per product surface', () => {
    const desktopHost = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.HOST, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    const browserHost = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.HOST, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });
    const browserDiscovery = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.DISCOVERY, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(desktopHost.available, true);
    assert.equal(desktopHost.providerKind, PLATFORM_PROVIDER_KINDS.ELECTRON_IPC);
    assert.equal(browserHost.available, false);
    assert.equal(browserHost.providerKind, PLATFORM_PROVIDER_KINDS.UNAVAILABLE);
    assert.equal(browserDiscovery.available, true);
    assert.equal(browserDiscovery.providerKind, PLATFORM_PROVIDER_KINDS.BROWSER_DEMO);
});

test('V77.2.3 default access mode resolves unknown capabilities as default-full (desktop) and default-deny (browser)', () => {
    const desktopUnknown = resolveSurfaceCapabilityAccess('future-surface-feature', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    const browserUnknown = resolveSurfaceCapabilityAccess('future-surface-feature', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(desktopUnknown.defaultAccessMode, PLATFORM_SURFACE_POLICY_MODES.DEFAULT_FULL);
    assert.equal(desktopUnknown.available, true);
    assert.equal(desktopUnknown.providerKind, PLATFORM_PROVIDER_KINDS.ELECTRON_IPC);
    assert.equal(desktopUnknown.resolvedByDefaultPolicy, true);

    assert.equal(browserUnknown.defaultAccessMode, PLATFORM_SURFACE_POLICY_MODES.DEFAULT_DENY);
    assert.equal(browserUnknown.available, false);
    assert.equal(browserUnknown.providerKind, PLATFORM_PROVIDER_KINDS.UNAVAILABLE);
    assert.equal(browserUnknown.resolvedByDefaultPolicy, true);
});

test('V77.2.3 explicit browser save capability stays opt-in and bypasses default deny fallback', () => {
    const browserSave = resolveSurfaceCapabilityAccess(PLATFORM_CAPABILITY_IDS.SAVE, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(browserSave.available, true);
    assert.equal(browserSave.providerKind, PLATFORM_PROVIDER_KINDS.BROWSER_DOWNLOAD);
    assert.equal(browserSave.resolvedByDefaultPolicy, false);
});

test('V77.2.4 developer access contract keeps expert gates local-only instead of product promises', () => {
    const desktopDeveloperAccess = resolveSurfaceDeveloperAccess({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    const browserDeveloperAccess = resolveSurfaceDeveloperAccess({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(desktopDeveloperAccess.available, true);
    assert.equal(desktopDeveloperAccess.accessMode, PLATFORM_SURFACE_DEVELOPER_ACCESS_MODES.LOCAL_UNLOCK);
    assert.equal(desktopDeveloperAccess.reason, PLATFORM_SURFACE_DEVELOPER_ACCESS_REASONS.LOCAL_DEVTOOLS);
    assert.match(desktopDeveloperAccess.message, /Produktversprechen der Vollversion/);

    assert.equal(browserDeveloperAccess.available, true);
    assert.equal(browserDeveloperAccess.accessMode, PLATFORM_SURFACE_DEVELOPER_ACCESS_MODES.LOCAL_UNLOCK);
    assert.equal(browserDeveloperAccess.reason, PLATFORM_SURFACE_DEVELOPER_ACCESS_REASONS.DEMO_LOCAL_DEVTOOLS);
    assert.match(browserDeveloperAccess.message, /kein Demo-Unlock/);
});

test('V77.2.2 runtime menu feature flags read host access from surface capability contract', () => {
    const desktopFlags = resolveRuntimeMenuFeatureFlags(null, {
        __CURVIOS_APP__: true,
        curviosApp: { isApp: true },
    });
    const browserFlags = resolveRuntimeMenuFeatureFlags(null, {});

    assert.equal(desktopFlags.canHost, true);
    assert.equal(browserFlags.canHost, false);
});

test('V77.2.2 browser host IP resolver stays on localhost when surface policy denies hosting', async () => {
    let customCalls = 0;
    const resolver = createMenuMultiplayerHostIpResolver({
        runtime: {},
        resolveHostIp: async () => {
            customCalls += 1;
            return '192.168.0.10';
        },
    });

    assert.equal(await resolver.resolve(), 'localhost');
    assert.equal(customCalls, 0);
});

test('V87.99 StoragePlatform surfaces partial legacy migrations when legacy-key removal fails', () => {
    const memory = new Map();
    memory.set('legacy.settings', JSON.stringify({
        numBots: 2,
        localSettings: {
            shadowQuality: 2,
        },
    }));

    const warnings = [];
    const migrationEvents = [];
    const originalWarn = console.warn;
    console.warn = (...args) => {
        warnings.push(args.map((entry) => String(entry)).join(' '));
    };

    try {
        const storage = {
            getItem(key) {
                return memory.has(key) ? memory.get(key) : null;
            },
            setItem(key, value) {
                memory.set(key, String(value));
            },
            removeItem() {
                throw new Error('remove_blocked');
            },
        };

        const platform = new StoragePlatform({
            storage,
            onMigrationResult(resultEntry) {
                migrationEvents.push(resultEntry);
            },
        });
        const parsed = platform.readJson('current.settings', ['legacy.settings'], null);
        const migrationResult = platform.getLastMigrationResult('current.settings');

        assert.equal(parsed?.numBots, 2);
        assert.notEqual(memory.get('current.settings') || null, null);
        assert.notEqual(memory.get('legacy.settings') || null, null);
        assert.equal(migrationResult?.attempted, true);
        assert.equal(migrationResult?.migrated, false);
        assert.equal(migrationResult?.ok, false);
        assert.equal(migrationResult?.writeOk, true);
        assert.equal(migrationResult?.removeOk, false);
        assert.equal(migrationResult?.status, 'remove_failed');
        assert.equal(migrationResult?.reason, 'remove_blocked');
        assert.equal(migrationEvents.length, 1);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0] || '', /Legacy storage migration incomplete/);
    } finally {
        console.warn = originalWarn;
    }
});

test('V77.4.2 normalizer defaults resolve to productive LAN transport instead of legacy storage-bridge', () => {
    assert.equal(normalizeMultiplayerTransport(''), 'lan');
    assert.equal(normalizeMultiplayerTransport(undefined), 'lan');
    assert.equal(normalizeMultiplayerTransport(null), 'lan');
    assert.equal(normalizeMultiplayerTransport('storage-bridge'), 'storage-bridge');

    assert.equal(normalizeLobbyProviderTransport(''), 'lan');
    assert.equal(normalizeLobbyProviderTransport(undefined), 'lan');
    assert.equal(normalizeLobbyProviderTransport('storage-bridge'), 'storage-bridge');

    assert.equal(normalizeLobbyServiceTransport(''), 'lan');
    assert.equal(normalizeLobbyServiceTransport(undefined), 'lan');
    assert.equal(normalizeLobbyServiceTransport('storage-bridge'), 'storage-bridge');
});

test('V77.4.2 isLegacyMultiplayerTransport and isLegacyLobbyTransport identify storage-bridge as legacy', () => {
    assert.equal(isLegacyMultiplayerTransport('storage-bridge'), true);
    assert.equal(isLegacyMultiplayerTransport('lan'), false);
    assert.equal(isLegacyMultiplayerTransport('online'), false);
    assert.equal(isLegacyMultiplayerTransport(''), false);
    assert.equal(isLegacyMultiplayerTransport(undefined), false);

    assert.equal(isLegacyLobbyTransport('storage-bridge'), true);
    assert.equal(isLegacyLobbyTransport('lan'), false);
    assert.equal(isLegacyLobbyTransport('online'), false);
    assert.equal(isLegacyLobbyTransport(''), false);
});

test('V77.4.2 resolveLobbyProviderKind defaults to LAN lobby instead of legacy storage-bridge', () => {
    assert.equal(resolveLobbyProviderKind('lan'), PLATFORM_PROVIDER_KINDS.MENU_LAN_LOBBY);
    assert.equal(resolveLobbyProviderKind(''), PLATFORM_PROVIDER_KINDS.MENU_LAN_LOBBY);
    assert.equal(resolveLobbyProviderKind(undefined), PLATFORM_PROVIDER_KINDS.MENU_LAN_LOBBY);
    assert.equal(resolveLobbyProviderKind('storage-bridge'), PLATFORM_PROVIDER_KINDS.MENU_STORAGE_BRIDGE);
    assert.equal(resolveLobbyProviderKind('online'), PLATFORM_PROVIDER_KINDS.MENU_ONLINE_LOBBY);
});

test('V77.4.2 surface policy keeps storage-bridge only in legacyMultiplayerTransports, not in productive defaults', () => {
    const desktopPolicy = resolveSurfacePolicy({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    const browserPolicy = resolveSurfacePolicy({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(desktopPolicy.defaultMultiplayerTransport, 'lan');
    assert.ok(!desktopPolicy.allowedMultiplayerTransports.includes('storage-bridge'));
    assert.ok(!desktopPolicy.hostMultiplayerTransports.includes('storage-bridge'));
    assert.ok(!desktopPolicy.joinMultiplayerTransports.includes('storage-bridge'));
    assert.deepEqual(desktopPolicy.legacyMultiplayerTransports, ['storage-bridge']);

    assert.equal(browserPolicy.defaultMultiplayerTransport, 'lan');
    assert.ok(!browserPolicy.allowedMultiplayerTransports.includes('storage-bridge'));
    assert.ok(!browserPolicy.hostMultiplayerTransports.includes('storage-bridge'));
    assert.ok(!browserPolicy.joinMultiplayerTransports.includes('storage-bridge'));
    assert.deepEqual(browserPolicy.legacyMultiplayerTransports, ['storage-bridge']);
});

test('V77.4.3 desktop host gate allows hosting while browser-demo denies it', () => {
    const desktopHost = resolveSurfaceMultiplayerGateAccess('host', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    const browserHost = resolveSurfaceMultiplayerGateAccess('host', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(desktopHost.allowed, true);
    assert.equal(desktopHost.action, 'host');
    assert.equal(desktopHost.multiplayerRole, PLATFORM_SURFACE_MULTIPLAYER_ROLES.HOST_AND_JOIN);
    assert.equal(desktopHost.reason, '');

    assert.equal(browserHost.allowed, false);
    assert.equal(browserHost.action, 'host');
    assert.equal(browserHost.multiplayerRole, PLATFORM_SURFACE_MULTIPLAYER_ROLES.JOIN_ONLY);
    assert.equal(browserHost.reason, 'surface_host_denied');
    assert.match(browserHost.message, /Desktop-Vollversion/);
    assert.equal(browserHost.tone, 'warning');
    assert.ok(browserHost.durationMs > 0);
});

test('desktop host gate accepts Electron preload runtime globals', () => {
    const runtimeGlobal = {
        __CURVIOS_APP__: true,
        curviosApp: { isApp: true },
    };
    // Raw-Global-Erkennung ist Adapter-Sache: Consumer reichen den Snapshot aus
    // resolveElectronRuntimeSnapshot als platformRuntimeSnapshot an die Registry durch.
    const platformRuntimeSnapshot = resolveElectronRuntimeSnapshot(runtimeGlobal);
    const policy = resolveSurfacePolicy({ runtimeGlobal, platformRuntimeSnapshot });
    const hostGate = resolveSurfaceMultiplayerGateAccess('host', { runtimeGlobal, platformRuntimeSnapshot });

    assert.equal(policy.productSurfaceId, PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP);
    assert.equal(hostGate.allowed, true);
    assert.equal(hostGate.action, 'host');
    assert.equal(hostGate.reason, '');
    assert.equal(hostGate.multiplayerRole, PLATFORM_SURFACE_MULTIPLAYER_ROLES.HOST_AND_JOIN);
});

test('V77.4.3 both surfaces allow join while browser-demo stays join-only role', () => {
    const desktopJoin = resolveSurfaceMultiplayerGateAccess('join', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    const browserJoin = resolveSurfaceMultiplayerGateAccess('join', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(desktopJoin.allowed, true);
    assert.equal(desktopJoin.action, 'join');
    assert.equal(desktopJoin.multiplayerRole, PLATFORM_SURFACE_MULTIPLAYER_ROLES.HOST_AND_JOIN);

    assert.equal(browserJoin.allowed, true);
    assert.equal(browserJoin.action, 'join');
    assert.equal(browserJoin.multiplayerRole, PLATFORM_SURFACE_MULTIPLAYER_ROLES.JOIN_ONLY);
});

test('V77.4.3 both surfaces allow discovery', () => {
    const desktopDiscover = resolveSurfaceMultiplayerGateAccess('discover', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    const browserDiscover = resolveSurfaceMultiplayerGateAccess('discover', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(desktopDiscover.allowed, true);
    assert.equal(desktopDiscover.action, 'discover');
    assert.equal(browserDiscover.allowed, true);
    assert.equal(browserDiscover.action, 'discover');
});

test('V77.4.3 unknown multiplayer action is denied with structured feedback', () => {
    const unknownAction = resolveSurfaceMultiplayerGateAccess('', {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(unknownAction.allowed, false);
    assert.equal(unknownAction.reason, 'surface_unknown_action');
    assert.match(unknownAction.message, /Unbekannte Multiplayer-Aktion/);
});

test('V87.3 Electron save adapter clears fallback degradedReason when invoke basis is available', () => {
    const runtimeGlobal = {
        __CURVIOS_APP__: true,
        curviosApp: {
            isApp: true,
            saveReplay: async () => ({ saved: true }),
            capabilities: {
                save: {
                    available: true,
                    providerKind: 'electron-ipc',
                },
            },
        },
    };

    const adapter = createElectronPreloadSaveAdapter(runtimeGlobal);
    assert.equal(adapter.capability.available, true);
    assert.equal(adapter.isAvailable(), true);
    assert.equal(adapter.capability.degradedReason, '');
    assert.equal(typeof adapter.saveReplay, 'function');
    assert.equal(adapter.saveVideo, null);
    assert.equal(adapter.capability.supportsBinaryExport, false);
});

test('V77.6.3 resolveSurfaceFallbackModePath returns default mode path per surface', () => {
    const desktopFallback = resolveSurfaceFallbackModePath({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    const browserFallback = resolveSurfaceFallbackModePath({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });

    assert.equal(desktopFallback, PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL);
    assert.equal(browserFallback, PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL);
    assert.equal(typeof desktopFallback, 'string');
    assert.ok(desktopFallback.length > 0);
});

test('V77.6.3 isSurfaceModePathAllowed desktop allows all modes including quick_action browser denies it', () => {
    assert.equal(isSurfaceModePathAllowed(PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    }), true);
    assert.equal(isSurfaceModePathAllowed(PLATFORM_SURFACE_MENU_MODE_PATHS.ARCADE, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    }), true);
    assert.equal(isSurfaceModePathAllowed(PLATFORM_SURFACE_MENU_MODE_PATHS.FIGHT, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    }), true);
    assert.equal(isSurfaceModePathAllowed(PLATFORM_SURFACE_MENU_MODE_PATHS.QUICK_ACTION, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    }), true);

    assert.equal(isSurfaceModePathAllowed(PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), true);
    assert.equal(isSurfaceModePathAllowed(PLATFORM_SURFACE_MENU_MODE_PATHS.ARCADE, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), true);
    assert.equal(isSurfaceModePathAllowed(PLATFORM_SURFACE_MENU_MODE_PATHS.FIGHT, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), true);
    assert.equal(isSurfaceModePathAllowed(PLATFORM_SURFACE_MENU_MODE_PATHS.QUICK_ACTION, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), false);

    assert.equal(isSurfaceModePathAllowed('', { productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO }), false);
    assert.equal(isSurfaceModePathAllowed('unknown-mode', { productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO }), false);
});

test('V77.6.3 isSurfaceMapKeyAllowedForModePath browser enforces curated map keys desktop allows any valid map', () => {
    assert.equal(isSurfaceMapKeyAllowedForModePath('standard', PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), true);
    assert.equal(isSurfaceMapKeyAllowedForModePath('maze', PLATFORM_SURFACE_MENU_MODE_PATHS.FIGHT, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), true);
    assert.equal(isSurfaceMapKeyAllowedForModePath('parcours_rift', PLATFORM_SURFACE_MENU_MODE_PATHS.ARCADE, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), true);

    assert.equal(isSurfaceMapKeyAllowedForModePath('custom_map', PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), false);
    assert.equal(isSurfaceMapKeyAllowedForModePath('parcours_rift', PLATFORM_SURFACE_MENU_MODE_PATHS.FIGHT, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), false);
    assert.equal(isSurfaceMapKeyAllowedForModePath('', PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), false);

    assert.equal(isSurfaceMapKeyAllowedForModePath('custom_map', PLATFORM_SURFACE_MENU_MODE_PATHS.NORMAL, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    }), true);
    assert.equal(isSurfaceMapKeyAllowedForModePath('any_map', PLATFORM_SURFACE_MENU_MODE_PATHS.QUICK_ACTION, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    }), true);
    assert.equal(isSurfaceMapKeyAllowedForModePath('standard', PLATFORM_SURFACE_MENU_MODE_PATHS.QUICK_ACTION, {
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    }), false, 'quick_action is not allowed for browser-demo, so any map key should be denied');
});

test('V77.6.3 resolveSurfaceFallbackSessionType returns first allowed session type per surface', () => {
    const desktopFallback = resolveSurfaceFallbackSessionType({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.DESKTOP_APP,
    });
    const browserFallback = resolveSurfaceFallbackSessionType({
        productSurfaceId: PLATFORM_PRODUCT_SURFACE_IDS.BROWSER_DEMO,
    });
    const emptyFallback = resolveSurfaceFallbackSessionType({});

    assert.equal(desktopFallback, 'single');
    assert.equal(browserFallback, 'single');
    assert.equal(typeof desktopFallback, 'string');
    assert.ok(desktopFallback.length > 0);
    assert.equal(emptyFallback, 'single');
});
