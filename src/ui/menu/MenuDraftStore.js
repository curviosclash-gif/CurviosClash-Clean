import { MENU_SESSION_TYPES } from './MenuStateContracts.js';
import {
    createMenuConfigSharePayloadDefaults,
    createMenuLocalSettingsDefaults,
} from './MenuDefaultsEditorConfig.js';
import {
    LEGACY_STORAGE_KEYS,
    STORAGE_KEYS,
} from '../StorageKeys.js';
import { PersistentStore } from '../base/PersistentStore.js';
import { resolveStorePlatformOptions, loadVersionedRecord } from '../base/PersistentStoreLoadUtils.js';

const MENU_DRAFT_STORAGE_KEY = STORAGE_KEYS.menuDrafts;
const MENU_DRAFT_STORAGE_LEGACY_KEYS = LEGACY_STORAGE_KEYS.menuDrafts;
const MENU_DRAFT_STORAGE_SCHEMA_VERSION = 'menu-draft-store.v1';

/** @type {Set<string>} */
const VALID_SESSION_TYPE_SET = new Set(Object.values(MENU_SESSION_TYPES));

function normalizeString(value, fallback = '') {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return normalized || fallback;
}

export function normalizeSessionType(value, fallback = MENU_SESSION_TYPES.SINGLE) {
    const requested = normalizeString(value, fallback);
    if (requested === MENU_SESSION_TYPES.LAN || requested === MENU_SESSION_TYPES.ONLINE) {
        return MENU_SESSION_TYPES.MULTIPLAYER;
    }
    return VALID_SESSION_TYPE_SET.has(requested) ? requested : fallback;
}

function cloneObject(value, fallback = {}) {
    if (!value || typeof value !== 'object') return { ...fallback };
    return JSON.parse(JSON.stringify(value));
}

function resolveModeFromSessionType(sessionType) {
    return normalizeSessionType(sessionType) === MENU_SESSION_TYPES.SPLITSCREEN ? '2p' : '1p';
}

function createSessionDraftSnapshot(settings, sessionType) {
    const source = settings && typeof settings === 'object' ? settings : {};
    const localSettings = source.localSettings && typeof source.localSettings === 'object'
        ? source.localSettings
        : {};
    const defaults = createMenuConfigSharePayloadDefaults();
    const localDefaults = createMenuLocalSettingsDefaults();

    return {
        sessionType: normalizeSessionType(sessionType, localSettings.sessionType || defaults.sessionType || MENU_SESSION_TYPES.SINGLE),
        multiplayerTransport: normalizeString(localSettings.multiplayerTransport, ''),
        mode: resolveModeFromSessionType(sessionType),
        modePath: normalizeString(localSettings.modePath, defaults.modePath),
        themeMode: normalizeString(localSettings.themeMode, defaults.themeMode),
        shadowQuality: localSettings.shadowQuality ?? localDefaults.shadowQuality,
        startSetup: cloneObject(localSettings.startSetup, localDefaults.startSetup),
        mapKey: String(source.mapKey || defaults.mapKey),
        gameMode: String(source.gameMode || defaults.gameMode),
        numBots: Number.isFinite(Number(source.numBots)) ? Number(source.numBots) : defaults.numBots,
        botDifficulty: String(source.botDifficulty || defaults.botDifficulty).toUpperCase(),
        botPolicyStrategy: normalizeString(source.botPolicyStrategy, defaults.botPolicyStrategy || 'auto'),
        winsNeeded: Number.isFinite(Number(source.winsNeeded)) ? Number(source.winsNeeded) : defaults.winsNeeded,
        autoRoll: typeof source.autoRoll === 'boolean' ? source.autoRoll : defaults.autoRoll,
        portalsEnabled: typeof source.portalsEnabled === 'boolean' ? source.portalsEnabled : defaults.portalsEnabled,
        vehicles: cloneObject(source.vehicles, defaults.vehicles),
        hunt: {
            respawnEnabled: !!(source?.hunt?.respawnEnabled ?? defaults?.hunt?.respawnEnabled),
        },
        gameplay: cloneObject(source.gameplay, defaults.gameplay),
        recording: cloneObject(source.recording, defaults.recording),
        cameraPerspective: cloneObject(source.cameraPerspective, defaults.cameraPerspective),
    };
}

function applySnapshotToSettings(settings, snapshot) {
    if (!settings || typeof settings !== 'object' || !snapshot || typeof snapshot !== 'object') return false;
    const defaults = createMenuConfigSharePayloadDefaults();

    settings.mode = snapshot.mode === '2p' ? '2p' : '1p';
    settings.mapKey = String(snapshot.mapKey || settings.mapKey || defaults.mapKey);
    settings.gameMode = String(snapshot.gameMode || settings.gameMode || defaults.gameMode);
    settings.numBots = Number.isFinite(Number(snapshot.numBots)) ? Number(snapshot.numBots) : settings.numBots;
    settings.botDifficulty = String(snapshot.botDifficulty || settings.botDifficulty || defaults.botDifficulty).toUpperCase();
    settings.botPolicyStrategy = normalizeString(snapshot.botPolicyStrategy, settings.botPolicyStrategy || defaults.botPolicyStrategy || 'auto');
    settings.winsNeeded = Number.isFinite(Number(snapshot.winsNeeded)) ? Number(snapshot.winsNeeded) : settings.winsNeeded;
    settings.autoRoll = typeof snapshot.autoRoll === 'boolean' ? snapshot.autoRoll : defaults.autoRoll;
    settings.portalsEnabled = typeof snapshot.portalsEnabled === 'boolean' ? snapshot.portalsEnabled : defaults.portalsEnabled;

    if (!settings.vehicles || typeof settings.vehicles !== 'object') {
        settings.vehicles = cloneObject(defaults.vehicles, { PLAYER_1: 'ship5', PLAYER_2: 'ship5' });
    }
    settings.vehicles.PLAYER_1 = String(snapshot?.vehicles?.PLAYER_1 || settings.vehicles.PLAYER_1 || defaults.vehicles.PLAYER_1);
    settings.vehicles.PLAYER_2 = String(snapshot?.vehicles?.PLAYER_2 || settings.vehicles.PLAYER_2 || defaults.vehicles.PLAYER_2);

    if (!settings.hunt || typeof settings.hunt !== 'object') {
        settings.hunt = cloneObject(defaults.hunt, { respawnEnabled: false });
    }
    settings.hunt.respawnEnabled = !!(snapshot?.hunt?.respawnEnabled ?? defaults?.hunt?.respawnEnabled);

    settings.gameplay = {
        ...(settings.gameplay && typeof settings.gameplay === 'object' ? settings.gameplay : cloneObject(defaults.gameplay, {})),
        ...cloneObject(snapshot.gameplay, defaults.gameplay),
    };
    settings.recording = {
        ...(settings.recording && typeof settings.recording === 'object' ? settings.recording : cloneObject(defaults.recording, {})),
        ...cloneObject(snapshot.recording, defaults.recording),
    };
    settings.cameraPerspective = {
        ...(settings.cameraPerspective && typeof settings.cameraPerspective === 'object' ? settings.cameraPerspective : cloneObject(defaults.cameraPerspective, {})),
        ...cloneObject(snapshot.cameraPerspective, defaults.cameraPerspective),
    };

    if (!settings.localSettings || typeof settings.localSettings !== 'object') {
        settings.localSettings = {};
    }
    settings.localSettings.sessionType = normalizeSessionType(snapshot.sessionType, settings.localSettings.sessionType);
    if (settings.localSettings.sessionType === MENU_SESSION_TYPES.MULTIPLAYER) {
        settings.localSettings.multiplayerTransport = normalizeString(
            snapshot.multiplayerTransport,
            settings.localSettings.multiplayerTransport || ''
        );
    } else {
        settings.localSettings.multiplayerTransport = '';
    }
    settings.localSettings.modePath = normalizeString(snapshot.modePath, settings.localSettings.modePath || defaults.modePath);
    settings.localSettings.themeMode = normalizeString(snapshot.themeMode, settings.localSettings.themeMode || defaults.themeMode);
    const localDefaults = createMenuLocalSettingsDefaults();
    settings.localSettings.shadowQuality = snapshot.shadowQuality ?? settings.localSettings.shadowQuality ?? localDefaults.shadowQuality;
    settings.localSettings.startSetup = {
        ...(settings.localSettings.startSetup && typeof settings.localSettings.startSetup === 'object'
            ? settings.localSettings.startSetup
            : cloneObject(localDefaults.startSetup, {})),
        ...cloneObject(snapshot.startSetup, localDefaults.startSetup),
    };
    return true;
}

export class MenuDraftStore extends PersistentStore {
    constructor(options = {}) {
        super({
            ...options,
            ...resolveStorePlatformOptions(options, MENU_DRAFT_STORAGE_KEY, MENU_DRAFT_STORAGE_LEGACY_KEYS),
        });
    }

    _loadStore() {
        return loadVersionedRecord(
            () => this.readJsonRecord(null),
            {
                artifactType: 'menu-draft-store',
                schemaVersion: MENU_DRAFT_STORAGE_SCHEMA_VERSION,
                createDefault: () => ({ schemaVersion: MENU_DRAFT_STORAGE_SCHEMA_VERSION, drafts: {} }),
                transform: (parsed, versionState) => {
                    const rawDrafts = versionState.hasVersionField
                        ? parsed?.drafts
                        : (
                            parsed?.drafts
                            && typeof parsed.drafts === 'object'
                            && !Array.isArray(parsed.drafts)
                                ? parsed.drafts
                                : parsed
                        );
                    return {
                        schemaVersion: MENU_DRAFT_STORAGE_SCHEMA_VERSION,
                        drafts: rawDrafts && typeof rawDrafts === 'object' && !Array.isArray(rawDrafts) ? rawDrafts : {},
                    };
                },
                onUpgrade: (normalized) => this._saveStore(normalized),
            }
        );
    }

    _saveStore(store) {
        return this.writeJsonRecord(store).ok;
    }

    saveDraft(sessionType, settings) {
        const normalizedSessionType = normalizeSessionType(sessionType);
        const store = this._loadStore();
        store.drafts[normalizedSessionType] = createSessionDraftSnapshot(settings, normalizedSessionType);
        const stored = this._saveStore(store);
        return {
            success: stored,
            sessionType: normalizedSessionType,
            draft: stored ? cloneObject(store.drafts[normalizedSessionType], null) : null,
        };
    }

    loadDraft(sessionType) {
        const normalizedSessionType = normalizeSessionType(sessionType);
        const store = this._loadStore();
        const draft = store.drafts[normalizedSessionType];
        return draft && typeof draft === 'object' ? cloneObject(draft, null) : null;
    }

    applyDraft(settings, sessionType) {
        const draft = this.loadDraft(sessionType);
        if (!draft) return { success: false, reason: 'draft_not_found' };
        const applied = applySnapshotToSettings(settings, draft);
        return {
            success: applied,
            reason: applied ? 'applied' : 'apply_failed',
            draft,
        };
    }

    clearDraft(sessionType) {
        const normalizedSessionType = normalizeSessionType(sessionType);
        const store = this._loadStore();
        if (!Object.prototype.hasOwnProperty.call(store.drafts, normalizedSessionType)) {
            return { success: false, reason: 'draft_not_found' };
        }
        delete store.drafts[normalizedSessionType];
        const stored = this._saveStore(store);
        return { success: stored, reason: stored ? 'cleared' : 'storage_failed' };
    }
}
