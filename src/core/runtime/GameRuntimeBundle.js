import { GAME_MODE_TYPES } from '../../hunt/HuntMode.js';
import { GAME_STATE_IDS } from '../../shared/contracts/GameStateIds.js';
import {
    deriveSessionRuntimeStateFromGameStateId,
    ensureSessionRuntimeLifecycleState,
    SESSION_RUNTIME_STATE_MACHINE_VERSION,
    syncSessionRuntimeLifecycleDisposed,
    syncSessionRuntimeLifecycleWithGameState,
} from '../../shared/contracts/SessionRuntimeStateMachine.js';
import { SESSION_RUNTIME_EVENT_TYPES } from '../../shared/contracts/SessionRuntimeEventContract.js';
import {
    createDefaultSessionRuntimeObservabilityState,
    ensureSessionRuntimeObservabilityState,
    recordSessionRuntimeEvent,
    resolveSessionRuntime,
} from '../../shared/runtime/SessionRuntimeObservability.js';
import {
    clearActiveRuntimeConfig,
    setActiveRuntimeConfig,
} from './ActiveRuntimeConfigStore.js';

const BUNDLE_TARGET_COMPONENTS = 'components';
const BUNDLE_TARGET_STATE = 'state';
const MATCH_SESSION_REF_KEYS = Object.freeze(['arena', 'entityManager', 'powerupManager', 'particles']);
const MATCH_SESSION_SETTINGS_KEYS = Object.freeze([
    'mapKey',
    'numHumans',
    'numBots',
    'winsNeeded',
    'activeGameMode',
    'roundStateController',
]);

const LEGACY_ALIAS_MIGRATION = Object.freeze({
    KEEP: 'keep',
    REPLACE_BY_PORT: 'replace-by-port',
    REMOVE_AFTER_MIGRATION: 'remove-after-migration',
});

export const GAME_RUNTIME_LEGACY_ALIAS_SPECS = Object.freeze([
    { key: 'renderer', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'mediaRecorderSystem', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'input', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'audio', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: 'ui', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: 'uiManager', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'runtimePorts', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: 'runtimeCoordinator', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'runtimeFacade', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'hudP1', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'hudP2', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'huntHud', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'screenShake', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'hudRuntimeSystem', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'crosshairSystem', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'matchFlowUiController', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REMOVE_AFTER_MIGRATION },
    { key: 'runtimeDiagnosticsSystem', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'keybindEditorController', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'planarAimAssistSystem', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'matchSessionRuntimeBridge', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'gameLoop', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'buildInfoController', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: 'menuExpertLoginRuntime', target: BUNDLE_TARGET_COMPONENTS, migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: 'config', target: BUNDLE_TARGET_STATE, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'runtimeConfig', target: BUNDLE_TARGET_STATE, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'activeGameMode', target: BUNDLE_TARGET_STATE, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'roundStateController', target: BUNDLE_TARGET_STATE, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'mapKey', target: BUNDLE_TARGET_STATE, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'numHumans', target: BUNDLE_TARGET_STATE, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'numBots', target: BUNDLE_TARGET_STATE, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'winsNeeded', target: BUNDLE_TARGET_STATE, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'arena', target: BUNDLE_TARGET_STATE, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'entityManager', target: BUNDLE_TARGET_STATE, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'powerupManager', target: BUNDLE_TARGET_STATE, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: 'particles', target: BUNDLE_TARGET_STATE, migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
]);

export const GAME_RUNTIME_LEGACY_WRAPPER_SPECS = Object.freeze([
    { key: '_showMainNav', target: 'uiManager.showMainNav', migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: '_saveSettings', target: 'settingsManager.saveSettings', migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: '_applySettingsToRuntime', target: 'runtimeFacade.applySettingsToRuntime', migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: '_setupMenuListeners', target: 'runtimeFacade.setupMenuListeners', migration: LEGACY_ALIAS_MIGRATION.REMOVE_AFTER_MIGRATION },
    { key: '_handleMenuControllerEvent', target: 'runtimeFacade.handleMenuControllerEvent', migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: '_onSettingsChanged', target: 'runtimeFacade.onSettingsChanged', migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: '_markSettingsDirty', target: 'runtimeFacade.markSettingsDirty', migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: '_updateSaveButtonState', target: 'runtimeFacade.updateSaveButtonState', migration: LEGACY_ALIAS_MIGRATION.REPLACE_BY_PORT },
    { key: '_syncProfileControls', target: 'profileUiController.syncProfileControls', migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: '_syncProfileActionState', target: 'profileUiController.syncProfileActionState', migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: '_setProfileTransferStatus', target: 'profileUiController.setProfileTransferStatus', migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: '_saveProfile', target: 'profileUiController.saveProfile', migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: '_duplicateProfile', target: 'profileUiController.duplicateProfile', migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: '_loadProfile', target: 'profileUiController.loadProfile', migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: '_exportProfile', target: 'profileUiController.exportProfile', migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: '_importProfile', target: 'profileUiController.importProfile', migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: '_setDefaultProfile', target: 'profileUiController.setDefaultProfile', migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: '_deleteProfile', target: 'profileUiController.deleteProfile', migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: '_showStatusToast', target: 'uiManager.showToast', migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: 'startMatch', target: 'runtimeFacade.startMatch', migration: LEGACY_ALIAS_MIGRATION.KEEP },
    { key: '_returnToMenu', target: 'runtimeFacade.returnToMenu', migration: LEGACY_ALIAS_MIGRATION.KEEP },
]);

const GAME_RUNTIME_STATUS_SPECS = Object.freeze([
    { key: 'state', path: ['lifecycle', 'gameStateId'], defaultValue: GAME_STATE_IDS.MENU },
    { key: '_disposed', path: ['lifecycle', 'disposed'], defaultValue: false },
]);

function createDefaultRuntimeState() {
    return {
        config: null,
        runtimeConfig: null,
        activeGameMode: GAME_MODE_TYPES.CLASSIC,
        roundStateController: null,
        mapKey: null,
        numHumans: 1,
        numBots: 0,
        winsNeeded: 1,
        arena: null,
        entityManager: null,
        powerupManager: null,
        particles: null,
        menuController: null,
        menuMultiplayerBridge: null,
        _navButtons: [],
        _menuButtonByPanel: new Map(),
        _activeSubmenu: null,
        _lastMenuTrigger: null,
        _buildInfoClipboardText: '',
    };
}

function createSharedPropertyView(source, keys) {
    const view = {};
    for (const key of keys) {
        Object.defineProperty(view, key, {
            configurable: true,
            enumerable: true,
            get() {
                return source?.[key];
            },
            set(value) {
                if (source && typeof source === 'object') {
                    source[key] = value;
                }
            },
        });
    }
    return view;
}

function deriveInitialLifecycleStatus({ gameStateId = GAME_STATE_IDS.MENU, disposed = false, status = undefined } = {}) {
    if (disposed) {
        return 'disposed';
    }
    return deriveSessionRuntimeStateFromGameStateId(
        gameStateId,
        typeof status === 'string' && status.trim() ? status.trim() : 'menu'
    );
}

function createSessionRuntimeCore({ state, components, ports = null, lifecycle = {} } = {}) {
    const runtimeHandles = components || {};
    runtimeHandles.runtimePorts = ports || runtimeHandles.runtimePorts || null;
    return {
        contractVersion: 'session-runtime-core.v1',
        state,
        handles: runtimeHandles,
        session: {
            refs: createSharedPropertyView(state, MATCH_SESSION_REF_KEYS),
            settings: createSharedPropertyView(state, MATCH_SESSION_SETTINGS_KEYS),
            sequence: 0,
            activeSessionId: null,
        },
        finalize: {
            status: 'idle',
            pendingOperation: null,
            lastReason: null,
            lastTrigger: null,
            lastCompletedReason: null,
            errorMessage: null,
            updatedAt: Date.now(),
        },
        lifecycle: {
            gameStateId: lifecycle.gameStateId ?? GAME_STATE_IDS.MENU,
            disposed: !!lifecycle.disposed,
            pendingSessionInit: null,
            machineVersion: SESSION_RUNTIME_STATE_MACHINE_VERSION,
            status: deriveInitialLifecycleStatus(lifecycle),
            updatedAt: Date.now(),
        },
        observability: createDefaultSessionRuntimeObservabilityState(),
    };
}

function resolveAliasContainer(bundle, target) {
    if (target === BUNDLE_TARGET_COMPONENTS) {
        if (!bundle.components || typeof bundle.components !== 'object') {
            bundle.components = {};
        }
        return bundle.components;
    }
    if (!bundle.state || typeof bundle.state !== 'object') {
        bundle.state = {};
    }
    return bundle.state;
}

function adoptExistingAliasValue(game, bundle, spec) {
    const descriptor = Object.getOwnPropertyDescriptor(game, spec.key);
    if (!descriptor) return;
    if ('get' in descriptor || 'set' in descriptor) return;

    const container = resolveAliasContainer(bundle, spec.target);
    if (descriptor.value !== undefined && container[spec.key] === undefined) {
        container[spec.key] = descriptor.value;
    }
}

function defineAliasAccessor(game, bundle, spec) {
    const descriptor = Object.getOwnPropertyDescriptor(game, spec.key);
    if (descriptor?.configurable === false) {
        return;
    }

    delete game[spec.key];
    Object.defineProperty(game, spec.key, {
        configurable: true,
        enumerable: true,
        get() {
            return resolveAliasContainer(bundle, spec.target)[spec.key];
        },
        set(value) {
            resolveAliasContainer(bundle, spec.target)[spec.key] = value;
        },
    });
}

function cloneLegacyAliasInventory() {
    return GAME_RUNTIME_LEGACY_ALIAS_SPECS.map((spec) => Object.freeze({ ...spec }));
}

function cloneLegacyWrapperInventory() {
    return GAME_RUNTIME_LEGACY_WRAPPER_SPECS.map((spec) => Object.freeze({ ...spec }));
}

function getRuntimeStatusCursor(bundle, path = []) {
    let cursor = bundle?.sessionRuntime || null;
    for (const segment of path) {
        if (!cursor || typeof cursor !== 'object') {
            return null;
        }
        cursor = cursor[segment];
    }
    return cursor;
}

function setRuntimeStatusValue(bundle, path, value) {
    if (Array.isArray(path) && path.length === 2 && path[0] === 'lifecycle' && path[1] === 'gameStateId') {
        const transition = syncSessionRuntimeLifecycleWithGameState(bundle?.sessionRuntime, value);
        recordLifecycleTransitionObservation(bundle, transition, 'runtime_bundle_game_state_sync', {
            requestedGameStateId: value,
        });
        return;
    }
    if (Array.isArray(path) && path.length === 2 && path[0] === 'lifecycle' && path[1] === 'disposed') {
        const transition = syncSessionRuntimeLifecycleDisposed(bundle?.sessionRuntime, value === true);
        recordLifecycleTransitionObservation(bundle, transition, 'runtime_bundle_dispose_sync', {
            disposed: value === true,
        });
        return;
    }
    if (!Array.isArray(path) || path.length === 0) return;
    const parent = getRuntimeStatusCursor(bundle, path.slice(0, -1));
    if (!parent || typeof parent !== 'object') return;
    parent[path[path.length - 1]] = value;
}

function recordLifecycleTransitionObservation(source, transition, sourceId, extra = null) {
    if (!transition?.changed) {
        return transition;
    }
    recordSessionRuntimeEvent(source, {
        type: SESSION_RUNTIME_EVENT_TYPES.STATE_TRANSITIONED,
        source: sourceId,
        payload: {
            previousState: transition.currentState,
            nextState: transition.nextState,
            gameStateId: transition.lifecycle?.gameStateId || '',
            disposed: transition.lifecycle?.disposed === true,
            ...(extra && typeof extra === 'object' ? extra : {}),
        },
    });
    return transition;
}

function adoptExistingRuntimeStatusValue(game, bundle, spec) {
    const descriptor = Object.getOwnPropertyDescriptor(game, spec.key);
    if (!descriptor) return;
    if ('get' in descriptor || 'set' in descriptor) return;
    if (descriptor.value === undefined) return;
    setRuntimeStatusValue(bundle, spec.path, descriptor.value);
}

function defineRuntimeStatusAccessor(game, bundle, spec) {
    const descriptor = Object.getOwnPropertyDescriptor(game, spec.key);
    if (descriptor?.configurable === false) {
        return;
    }

    delete game[spec.key];
    Object.defineProperty(game, spec.key, {
        configurable: true,
        enumerable: true,
        get() {
            return getRuntimeStatusCursor(bundle, spec.path) ?? spec.defaultValue;
        },
        set(value) {
            setRuntimeStatusValue(bundle, spec.path, value);
        },
    });
}

export function createInitialGameRuntimeState(initialState = {}) {
    return {
        ...createDefaultRuntimeState(),
        ...initialState,
    };
}

export function createGameRuntimeBundle({ state = {}, components = {}, ports = null, lifecycle = {} } = {}) {
    const runtimeState = createInitialGameRuntimeState(state);
    const runtimeComponents = { ...components, runtimePorts: ports || components.runtimePorts || null };
    const sessionRuntime = createSessionRuntimeCore({
        state: runtimeState,
        components: runtimeComponents,
        ports,
        lifecycle,
    });
    ensureSessionRuntimeLifecycleState(sessionRuntime);
    const bundle = {
        state: runtimeState,
        components: runtimeComponents,
        sessionRuntime,
        metadata: Object.freeze({
            legacyAliases: Object.freeze(cloneLegacyAliasInventory()),
            legacyWrappers: Object.freeze(cloneLegacyWrapperInventory()),
            runtimeConfigAdapter: Object.freeze({
                kind: 'ActiveRuntimeConfigStore',
                migration: 'transition-adapter',
                ownerScope: 'runtimeBundle',
                clearsOnDispose: true,
            }),
        }),
    };

    Object.defineProperty(bundle, 'ports', {
        configurable: true,
        enumerable: true,
        get() {
            return runtimeComponents.runtimePorts || null;
        },
        set(value) {
            runtimeComponents.runtimePorts = value || null;
        },
    });

    return bundle;
}

export function attachGameRuntimeBundle(game, bundle) {
    if (!game || !bundle) return bundle;

    Object.defineProperty(game, 'runtimeBundle', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: bundle,
    });
    Object.defineProperty(game, 'sessionRuntime', {
        configurable: true,
        enumerable: false,
        writable: true,
        value: bundle.sessionRuntime,
    });

    for (const spec of GAME_RUNTIME_LEGACY_ALIAS_SPECS) {
        adoptExistingAliasValue(game, bundle, spec);
        defineAliasAccessor(game, bundle, spec);
    }
    for (const spec of GAME_RUNTIME_STATUS_SPECS) {
        adoptExistingRuntimeStatusValue(game, bundle, spec);
        defineRuntimeStatusAccessor(game, bundle, spec);
    }

    return bundle;
}

export function getSessionRuntime(source) {
    return resolveSessionRuntime(source);
}

export function getSessionRuntimeState(source) {
    const sessionRuntime = getSessionRuntime(source);
    return sessionRuntime?.state || null;
}

export function getSessionRuntimeHandles(source) {
    const sessionRuntime = getSessionRuntime(source);
    return sessionRuntime?.handles || null;
}

export function getSessionRuntimeHandle(source, key) {
    if (!key) return null;
    const runtimeHandles = getSessionRuntimeHandles(source);
    return runtimeHandles?.[key] || null;
}

export function setSessionRuntimeHandle(source, key, value) {
    if (!key) return null;
    const runtimeHandles = getSessionRuntimeHandles(source);
    if (!runtimeHandles || typeof runtimeHandles !== 'object') {
        return null;
    }
    runtimeHandles[key] = value ?? null;
    return runtimeHandles[key];
}

export function getGameRuntimeState(source) {
    return getSessionRuntimeState(source) || source?.state || null;
}

export function applyRuntimeSettingsState(bundle, {
    runtimeConfig = undefined,
    config = undefined,
    session = undefined,
} = {}) {
    const state = getGameRuntimeState(bundle);
    if (!state) return null;

    if (runtimeConfig !== undefined) {
        state.runtimeConfig = runtimeConfig;
    }

    if (config !== undefined) {
        state.config = config;
        if (config && typeof config === 'object') {
            setActiveRuntimeConfig(config, { owner: bundle });
        } else {
            clearActiveRuntimeConfig({ owner: bundle });
        }
    }

    if (session && typeof session === 'object') {
        if (Object.prototype.hasOwnProperty.call(session, 'numHumans')) state.numHumans = session.numHumans;
        if (Object.prototype.hasOwnProperty.call(session, 'numBots')) state.numBots = session.numBots;
        if (Object.prototype.hasOwnProperty.call(session, 'mapKey')) state.mapKey = session.mapKey;
        if (Object.prototype.hasOwnProperty.call(session, 'winsNeeded')) state.winsNeeded = session.winsNeeded;
        if (Object.prototype.hasOwnProperty.call(session, 'activeGameMode')) state.activeGameMode = session.activeGameMode;
    }

    return state;
}

export function applyMatchSessionState(bundle, matchSession) {
    const state = getGameRuntimeState(bundle);
    if (!state || !matchSession) return null;

    state.particles = matchSession.particles || null;
    state.arena = matchSession.arena || null;
    state.powerupManager = matchSession.powerupManager || null;
    state.entityManager = matchSession.entityManager || null;
    if (Object.prototype.hasOwnProperty.call(matchSession, 'effectiveMapKey')) {
        state.mapKey = matchSession.effectiveMapKey;
    }
    if (Object.prototype.hasOwnProperty.call(matchSession, 'numHumans')) {
        state.numHumans = matchSession.numHumans;
    }
    if (Object.prototype.hasOwnProperty.call(matchSession, 'numBots')) {
        state.numBots = matchSession.numBots;
    }
    if (Object.prototype.hasOwnProperty.call(matchSession, 'winsNeeded')) {
        state.winsNeeded = matchSession.winsNeeded;
    }

    return state;
}

export function getCurrentMatchSessionRefs(bundle) {
    const state = getGameRuntimeState(bundle);
    return {
        arena: state?.arena || null,
        entityManager: state?.entityManager || null,
        powerupManager: state?.powerupManager || null,
        particles: state?.particles || null,
    };
}

export function clearMatchSessionState(bundle) {
    const state = getGameRuntimeState(bundle);
    if (!state) return null;

    state.particles = null;
    state.arena = null;
    state.entityManager = null;
    state.powerupManager = null;
    return state;
}

export function clearGameRuntimeState(bundle, initialOverrides = undefined) {
    const state = getGameRuntimeState(bundle);
    if (!state) return null;

    Object.assign(state, createInitialGameRuntimeState(initialOverrides));
    clearActiveRuntimeConfig({ owner: bundle });
    const sessionRuntime = getSessionRuntime(bundle);
    if (sessionRuntime) {
        ensureSessionRuntimeLifecycleState(sessionRuntime);
        ensureSessionRuntimeObservabilityState(sessionRuntime);
        sessionRuntime.session.activeSessionId = null;
        sessionRuntime.session.sequence = 0;
        sessionRuntime.lifecycle.pendingSessionInit = null;
        sessionRuntime.finalize.pendingOperation = null;
        sessionRuntime.finalize.status = 'idle';
        sessionRuntime.finalize.lastReason = null;
        sessionRuntime.finalize.lastTrigger = null;
        sessionRuntime.finalize.lastCompletedReason = null;
        sessionRuntime.finalize.errorMessage = null;
        sessionRuntime.finalize.updatedAt = Date.now();
        sessionRuntime.lifecycle.status = deriveInitialLifecycleStatus({
            gameStateId: sessionRuntime.lifecycle.gameStateId,
            disposed: sessionRuntime.lifecycle.disposed,
        });
        sessionRuntime.lifecycle.updatedAt = Date.now();
    }
    return state;
}
