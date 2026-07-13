import assert from 'node:assert/strict';
import test from 'node:test';

import { REPLAY_EXPORT_CONTRACT_VERSION, ReplayRecorder } from '../src/core/replay/ReplayRecorder.js';
import {
    SETTINGS_OVERRIDE_SCHEMA_VERSION as SETTINGS_V1,
    SCHEMA_MIGRATION_CODES,
    classifyOverrideDraftMigration,
    migrateOverrideDraft,
    createSettingsOverrideDraft,
    validateSettingsOverrideDraft,
} from '../src/core/settings/SettingsOverrideContract.js';
import { createDefaultSettingsSnapshotWithOverride } from '../src/core/settings/SettingsDefaultsFacade.js';
import { MAP_SCHEMA_VERSION } from '../src/entities/mapSchema/MapSchemaConstants.js';
import { migrateMapDocument } from '../src/entities/mapSchema/MapSchemaMigrationOps.js';
import {
    CUSTOM_MAP_STORAGE_CAPABILITY_CONTRACT_VERSION,
    loadCustomMapFromStorage,
    resolveCustomMapStorageCapability,
} from '../src/entities/CustomMapLoader.js';
import { applyLoadoutPreset, loadVehicleProfiles } from '../src/state/arcade/ArcadeVehicleProfile.js';
import {
    ARTIFACT_VERSION_DECISIONS,
    resolveArtifactVersionState,
} from '../src/shared/contracts/ArtifactVersionMigrationContract.js';
import { SettingsStore } from '../src/ui/SettingsStore.js';
import { createVehicleManagerLoadoutPresetStore } from '../src/ui/arcade/vehicle-manager/VehicleManagerLoadoutPresets.js';
import { MenuDraftStore } from '../src/ui/menu/MenuDraftStore.js';
import {
    exportMenuConfigAsJson,
    importMenuConfigFromInput,
    MENU_CONFIG_SHARE_CONTRACT_VERSION,
} from '../src/ui/menu/MenuConfigShareOps.js';
import { MenuTelemetryStore } from '../src/ui/menu/MenuTelemetryStore.js';
import { MenuTextOverrideStore } from '../src/ui/menu/MenuTextOverrideStore.js';
import { parseProfileImport } from '../src/ui/ProfileTransferOps.js';

function createMemoryStoragePlatform(initialRecords = {}) {
    const records = new Map(Object.entries(initialRecords));
    return {
        driver: { storage: null },
        readJson(key, legacyKeys = [], fallback = null) {
            const candidates = [key, ...(Array.isArray(legacyKeys) ? legacyKeys : [])];
            for (const candidate of candidates) {
                if (!records.has(candidate)) continue;
                return records.get(candidate);
            }
            return fallback;
        },
        writeJson(key, value) {
            records.set(key, value);
            return { ok: true, reason: 'ok', quotaExceeded: false };
        },
        remove(key) {
            records.delete(key);
            return { ok: true, reason: 'ok', quotaExceeded: false };
        },
        getRecord(key) {
            return records.get(key);
        },
    };
}

test('V85.2 migration contract classifies current, upgrade, fallback, and reject decisions', () => {
    const current = resolveArtifactVersionState({ schemaVersion: 2 }, {
        artifactType: 'settings',
        versionFields: ['schemaVersion'],
        supportedVersions: [1, 2],
        currentVersion: 2,
        allowMissingVersion: true,
        coerceNumericVersions: true,
    });
    assert.equal(current.decision, ARTIFACT_VERSION_DECISIONS.CURRENT);

    const upgrade = resolveArtifactVersionState({ schemaVersion: 1 }, {
        artifactType: 'settings',
        versionFields: ['schemaVersion'],
        supportedVersions: [1, 2],
        currentVersion: 2,
        allowMissingVersion: true,
        coerceNumericVersions: true,
    });
    assert.equal(upgrade.decision, ARTIFACT_VERSION_DECISIONS.UPGRADE);

    const fallback = resolveArtifactVersionState({}, {
        artifactType: 'settings',
        versionFields: ['schemaVersion'],
        supportedVersions: [1, 2],
        currentVersion: 2,
        allowMissingVersion: true,
        coerceNumericVersions: true,
    });
    assert.equal(fallback.decision, ARTIFACT_VERSION_DECISIONS.FALLBACK);

    const reject = resolveArtifactVersionState({ schemaVersion: 3 }, {
        artifactType: 'settings',
        versionFields: ['schemaVersion'],
        supportedVersions: [1, 2],
        currentVersion: 2,
        allowMissingVersion: true,
        coerceNumericVersions: true,
    });
    assert.equal(reject.decision, ARTIFACT_VERSION_DECISIONS.REJECT);
});

test('V85.2 profile import rejects unknown contract versions but keeps legacy fallback', () => {
    const normalizeProfileName = (value) => String(value || '').trim();
    const rejectResult = parseProfileImport(JSON.stringify({
        contractVersion: 'profile-export.v2',
        profile: {
            name: 'Pilot',
            settings: {},
        },
    }), { normalizeProfileName });
    assert.equal(rejectResult.success, false);
    assert.match(rejectResult.error || '', /contractVersion/i);

    const legacyResult = parseProfileImport(JSON.stringify({
        name: 'Legacy Pilot',
        settings: {},
    }), { normalizeProfileName });
    assert.equal(legacyResult.success, true);
    assert.equal(legacyResult.profile?.name, 'Legacy Pilot');
    assert.equal(legacyResult.usedLegacyFallback, true);
    assert.match(legacyResult.message || '', /Legacy-Profil importiert/i);
    assert.match(legacyResult.warnings?.[0] || '', /contractVersion/i);
    assert.equal(legacyResult.migration?.applied, true);

    const invalidVersionResult = parseProfileImport(JSON.stringify({
        contractVersion: '  ',
        profile: {
            name: 'Invalid Pilot',
            settings: {},
        },
    }), { normalizeProfileName });
    assert.equal(invalidVersionResult.success, false);
    assert.match(invalidVersionResult.error || '', /contractVersion/i);

    const currentResult = parseProfileImport(JSON.stringify({
        contractVersion: 'profile-export.v1',
        profile: {
            name: 'Pilot',
            settings: {},
        },
    }), { normalizeProfileName });
    assert.equal(currentResult.success, true);
    assert.equal(currentResult.usedLegacyFallback, false);
    assert.equal(currentResult.contractVersion, 'profile-export.v1');
});

test('V85.2 map migration keeps legacy fallback and rejects future schema versions', () => {
    const migrated = migrateMapDocument({
        schemaVersion: 2,
        arenaSize: { width: 1200, height: 400, depth: 900 },
    });
    assert.equal(migrated.map.schemaVersion, MAP_SCHEMA_VERSION);
    assert.ok(migrated.warnings.some((entry) => String(entry).includes('Map schema v2 detected')));

    assert.throws(
        () => migrateMapDocument({ schemaVersion: MAP_SCHEMA_VERSION + 1 }),
        /Unsupported schemaVersion/
    );
});

test('V85.2 replay exports include contractVersion and legacy version alias', () => {
    const recorder = new ReplayRecorder();
    const replay = recorder.getReplay();
    assert.equal(replay.contractVersion, REPLAY_EXPORT_CONTRACT_VERSION);
    assert.equal(replay.version, REPLAY_EXPORT_CONTRACT_VERSION);
});

test('V85.4 menu config share import/export validates contractVersion with legacy fallback', () => {
    const exportedPayload = JSON.parse(exportMenuConfigAsJson({
        mapKey: 'arena_simple',
        numBots: 2,
        localSettings: { sessionType: 'solo' },
    }));
    assert.equal(exportedPayload.contractVersion, MENU_CONFIG_SHARE_CONTRACT_VERSION);
    assert.ok(exportedPayload.payload && typeof exportedPayload.payload === 'object');

    const settings = {};
    const importResult = importMenuConfigFromInput(settings, JSON.stringify(exportedPayload));
    assert.equal(importResult.success, true);
    assert.equal(importResult.usedLegacyFallback, false);
    assert.match(importResult.message || '', /Config importiert/i);
    assert.equal(settings.mapKey, 'arena_simple');

    const legacyResult = importMenuConfigFromInput(settings, JSON.stringify({
        mapKey: 'arena_legacy',
        numBots: 1,
    }));
    assert.equal(legacyResult.success, true);
    assert.equal(legacyResult.usedLegacyFallback, true);
    assert.match(legacyResult.message || '', /Legacy-Config importiert/i);
    assert.match(legacyResult.warnings?.[0] || '', /contractVersion/i);
    assert.equal(legacyResult.migration?.applied, true);
    assert.equal(settings.mapKey, 'arena_legacy');

    const rejectResult = importMenuConfigFromInput(settings, JSON.stringify({
        contractVersion: 'menu-config-share.v9',
        payload: { mapKey: 'arena_reject' },
    }));
    assert.equal(rejectResult.success, false);
    assert.equal(rejectResult.reason, 'unsupported_contract_version');
    assert.match(rejectResult.error || '', /menu-config-share\.v1/i);
});

test('V85.2 settings profiles migrate legacy arrays into schema envelope', () => {
    const platform = createMemoryStoragePlatform({
        'cuviosclash.settings-profiles.v1': [
            { name: 'Pilot', settings: { speed: 1 } },
        ],
    });
    const store = new SettingsStore({
        storagePlatform: platform,
        sanitizeSettings: (settings) => ({ ...(settings || {}) }),
    });
    const profiles = store.loadProfiles();
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].name, 'Pilot');

    const persisted = platform.getRecord('cuviosclash.settings-profiles.v1');
    assert.equal(persisted.schemaVersion, 'settings-profiles.v1');
    assert.ok(Array.isArray(persisted.profiles));
});

test('V85.2 menu draft/text/telemetry stores migrate legacy payloads to schema wrappers', () => {
    const draftPlatform = createMemoryStoragePlatform({
        'cuviosclash.menu-drafts.v1': {
            single: { mapKey: 'arena_simple' },
        },
    });
    const draftStore = new MenuDraftStore({ storagePlatform: draftPlatform });
    const draft = draftStore.loadDraft('single');
    assert.ok(draft);
    const draftPersisted = draftPlatform.getRecord('cuviosclash.menu-drafts.v1');
    assert.equal(draftPersisted.schemaVersion, 'menu-draft-store.v1');
    assert.ok(draftPersisted.drafts && typeof draftPersisted.drafts === 'object');

    const textPlatform = createMemoryStoragePlatform({
        'cuviosclash.menu-text-overrides.v1': {
            'menu.start': '  Start Jetzt  ',
        },
    });
    const textStore = new MenuTextOverrideStore({ storagePlatform: textPlatform });
    const overrides = textStore.listOverrides();
    assert.equal(overrides['menu.start'], 'Start Jetzt');
    const textPersisted = textPlatform.getRecord('cuviosclash.menu-text-overrides.v1');
    assert.equal(textPersisted.schemaVersion, 'menu-text-overrides.v1');
    assert.equal(textPersisted.overrides['menu.start'], 'Start Jetzt');

    const telemetryPlatform = createMemoryStoragePlatform({
        'cuviosclash.menu-telemetry.v1': {
            startAttempts: 3,
            events: [{ type: 'start_attempt', at: 'now', payload: null }],
        },
    });
    const telemetryStore = new MenuTelemetryStore({ storagePlatform: telemetryPlatform });
    const snapshot = telemetryStore.getSnapshot();
    assert.equal(snapshot.startAttempts, 3);
    const telemetryPersisted = telemetryPlatform.getRecord('cuviosclash.menu-telemetry.v1');
    assert.equal(telemetryPersisted.schemaVersion, 'menu-telemetry.v1');
    assert.ok(telemetryPersisted.state && typeof telemetryPersisted.state === 'object');
});

test('V85.2 arcade persistence drops rejected future schemas and rewrites legacy payloads', () => {
    const profileStore = {
        data: {
            ship1: { xp: 120, level: 2, upgrades: { core_t2: 'T2' } },
            ship2: { schemaVersion: 'arcade-vehicle-profile.v9', xp: 9999 },
        },
        saved: null,
        loadJsonRecord() {
            return this.data;
        },
        saveJsonRecord(_key, value) {
            this.saved = value;
        },
    };
    const profiles = loadVehicleProfiles(profileStore);
    assert.ok(profiles.ship1);
    assert.equal(profiles.ship1.schemaVersion, 'arcade-vehicle-profile.v1');
    assert.equal(profiles.ship2, undefined);
    assert.ok(profileStore.saved);
    assert.equal(profileStore.saved.ship2, undefined);

    const loadoutStore = {
        data: {
            presets: [
                {
                    vehicleId: 'ship5',
                    name: 'Burst',
                    upgrades: { wing_left_t2: 'T2' },
                },
            ],
        },
        saved: null,
        loadJsonRecord() {
            return this.data;
        },
        saveJsonRecord(_key, value) {
            this.saved = value;
            this.data = value;
        },
    };
    const loadoutPresetStore = createVehicleManagerLoadoutPresetStore({ store: loadoutStore });
    const presets = loadoutPresetStore.listPresets('ship5');
    assert.equal(presets.length, 1);
    assert.equal(loadoutStore.saved?.schemaVersion, 'arcade-vehicle-loadouts.v1');
});

test('B04 F2 preset import blocks invalid upgrade slots and tiers before profile apply', () => {
    const profile = {
        schemaVersion: 'arcade-vehicle-profile.v1',
        vehicleId: 'ship5',
        xp: 0,
        level: 1,
        unlockedSlots: ['core', 'nose', 'wing_left', 'wing_right', 'engine_left', 'engine_right'],
        upgrades: {},
    };
    const loadoutStore = {
        data: {
            schemaVersion: 'arcade-vehicle-loadouts.v1',
            presets: [{
                presetId: 'legacy-audit-import',
                vehicleId: 'ship5',
                name: 'Legacy import',
                upgrades: {
                    core: 'T3',
                    wing_left: 'T2',
                    hacker_slot: 'T2',
                    nose: 'T9',
                },
                updatedAtMs: 1234,
            }],
        },
        loadJsonRecord() {
            return this.data;
        },
        saveJsonRecord(_key, value) {
            this.data = value;
        },
    };
    const presetStore = createVehicleManagerLoadoutPresetStore({ store: loadoutStore });
    const importedPreset = presetStore.loadPreset('ship5', 'legacy-audit-import');
    const applyResult = applyLoadoutPreset(profile, importedPreset?.upgrades || {});

    assert.ok(importedPreset);
    assert.equal(importedPreset.invalidEntries.some((entry) => entry.code === 'invalid_slot'), true);
    assert.equal(importedPreset.invalidEntries.some((entry) => entry.code === 'invalid_tier'), true);
    assert.equal(applyResult.rejectedEntries.some((entry) => entry.code === 'tier_locked'), true);
    assert.deepEqual(applyResult.upgrades, {});
});

// ─── V97 Settings Override Migration ─────────────────

test('V97 settings override v1 classifies as current and validates without errors', () => {
    const draft = createSettingsOverrideDraft();
    const migration = classifyOverrideDraftMigration(draft);
    assert.equal(migration.status, 'current');
    assert.equal(migration.code, SCHEMA_MIGRATION_CODES.CURRENT);
    const validation = validateSettingsOverrideDraft(draft);
    assert.equal(validation.valid, true, `expected valid: ${JSON.stringify(validation.errors)}`);
});

test('V97 settings override without schemaVersion upgrades and validates after migration', () => {
    const rawDraft = { language: 'de', limitOverrides: {}, baseSettings: {}, localSettings: {}, level3Reset: {}, configShare: {}, fixedPresets: [] };
    const migration = classifyOverrideDraftMigration(rawDraft);
    assert.equal(migration.status, 'upgrade');
    const migrated = migrateOverrideDraft(rawDraft, migration);
    assert.equal(migrated.schemaVersion, SETTINGS_V1);
    const validation = validateSettingsOverrideDraft(migrated);
    assert.equal(validation.valid, true, `post-migration: ${JSON.stringify(validation.errors)}`);
});

test('V97 unknown future schema classifies as fallback', () => {
    const migration = classifyOverrideDraftMigration({ schemaVersion: 'menu-defaults-override.v99' });
    assert.equal(migration.status, 'fallback');
    assert.equal(migration.code, SCHEMA_MIGRATION_CODES.FALLBACK);
});

test('V97 non-object draft classifies as reject', () => {
    assert.equal(classifyOverrideDraftMigration(null).status, 'reject');
    assert.equal(classifyOverrideDraftMigration('string').status, 'reject');
    assert.equal(classifyOverrideDraftMigration(42).status, 'reject');
});

test('V97 facade applies upgrade-migrated draft and sets __overrideDiagnostics', () => {
    const rawDraft = { language: 'de', limitOverrides: {}, baseSettings: { numBots: 2 }, localSettings: {}, level3Reset: {}, configShare: {}, fixedPresets: [] };
    const migration = classifyOverrideDraftMigration(rawDraft);
    const migrated = migrateOverrideDraft(rawDraft, migration);
    const defaults = createDefaultSettingsSnapshotWithOverride(migrated, migration);
    assert.equal(defaults.numBots, 2, 'override numBots must apply after migration');
    assert.equal(defaults.__overrideSkipped, undefined, 'override must not be skipped');
    if (defaults.__overrideDiagnostics) {
        assert.equal(defaults.__overrideDiagnostics.status, 'applied_with_migration');
    }
});

test('V97 SCHEMA_MIGRATION_CODES has CURRENT, UPGRADE, FALLBACK, REJECT', () => {
    assert.ok(SCHEMA_MIGRATION_CODES.CURRENT);
    assert.ok(SCHEMA_MIGRATION_CODES.UPGRADE);
    assert.ok(SCHEMA_MIGRATION_CODES.FALLBACK);
    assert.ok(SCHEMA_MIGRATION_CODES.REJECT);
    const codes = new Set(Object.values(SCHEMA_MIGRATION_CODES));
    assert.equal(codes.size, 4, 'all four codes must be unique');
});

test('V85.4 custom-map import exposes explicit browser storage capability contract', () => {
    const capability = resolveCustomMapStorageCapability();
    assert.equal(capability.contractVersion, CUSTOM_MAP_STORAGE_CAPABILITY_CONTRACT_VERSION);
    assert.equal(typeof capability.available, 'boolean');
    if (capability.available) {
        assert.equal(capability.degradedReason, '');
    } else {
        assert.equal(capability.degradedReason, 'storage_unavailable');
    }

    const result = loadCustomMapFromStorage();
    assert.equal(result.capability?.contractVersion, CUSTOM_MAP_STORAGE_CAPABILITY_CONTRACT_VERSION);
    if (result.ok) {
        assert.equal(result.capability?.available, true);
        assert.equal(typeof result.message, 'string');
    } else {
        assert.equal(typeof result.error, 'string');
        assert.equal(typeof result.message, 'string');
    }
});
