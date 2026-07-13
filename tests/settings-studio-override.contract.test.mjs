import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
    createSettingsOverrideFieldRegistry,
    createSettingsStudioSchemaDescriptor,
    SETTINGS_OVERRIDE_SCHEMA_VERSION,
    SCHEMA_MIGRATION_CODES,
    classifyOverrideDraftMigration,
    migrateOverrideDraft,
    createSettingsOverrideDraft,
    validateSettingsOverrideDraft,
} from '../src/core/settings/SettingsOverrideContract.js';

import { createDefaultSettingsSnapshotWithOverride } from '../src/core/settings/SettingsDefaultsFacade.js';
import {
    BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
    createBrowserDemoSurfacePolicyOverrideDraft,
} from '../src/shared/contracts/BrowserDemoSurfacePolicyOverrideContract.js';
import { SECTIONS } from '../electron/settings-studio/ui/settings-studio-i18n.js';

const require = createRequire(import.meta.url);
const { registerSettingsStudioIpc } = require('../electron/settings-studio/ipc/settings-studio-ipc.cjs');
const {
    BROWSER_DEMO_POLICY_EXPORT_CONTRACT_VERSION,
} = require('../electron/settings-studio/services/SettingsBrowserDemoPolicyService.cjs');

const SETTINGS_STUDIO_CHANNELS = Object.freeze({
    load: 'settings-studio:load',
    save: 'settings-studio:save',
    listBackups: 'settings-studio:list-backups',
    restoreBackup: 'settings-studio:restore-backup',
});

function createIpcHarness() {
    const handlers = new Map();
    return {
        ipcMain: {
            handle(channel, handler) {
                handlers.set(channel, handler);
            },
            removeHandler(channel) {
                handlers.delete(channel);
            },
        },
        async invoke(channel, ...args) {
            const handler = handlers.get(channel);
            assert.equal(typeof handler, 'function', `missing IPC handler: ${channel}`);
            return handler({}, ...args);
        },
    };
}

async function createSettingsStudioTestHarness(t) {
    const userDataPath = await fs.mkdtemp(path.join(os.tmpdir(), 'curvios-settings-studio-v98-'));
    const harness = createIpcHarness();
    const app = {
        getPath(kind) {
            assert.equal(kind, 'userData');
            return userDataPath;
        },
    };
    const unregister = registerSettingsStudioIpc({
        ipcMain: harness.ipcMain,
        app,
    });

    t.after(async () => {
        unregister();
        await fs.rm(userDataPath, { recursive: true, force: true });
    });

    return {
        userDataPath,
        invoke: harness.invoke,
    };
}

// ─── 97.1 Field registry metadata ────────────────────

test('Field registry entries include riskLevel, help, impact, example', () => {
    const registry = createSettingsOverrideFieldRegistry();
    assert.ok(registry.length > 0, 'registry must not be empty');

    for (const field of registry) {
        assert.ok('riskLevel' in field, `${field.path} missing riskLevel`);
        assert.ok('help' in field, `${field.path} missing help`);
        assert.ok('impact' in field, `${field.path} missing impact`);
        assert.ok('example' in field, `${field.path} missing example`);
        assert.ok(['low', 'medium', 'high'].includes(field.riskLevel), `${field.path} riskLevel invalid: ${field.riskLevel}`);
    }
});

test('Known high-risk field baseSettings.botBridge.timeoutMs has riskLevel high', () => {
    const registry = createSettingsOverrideFieldRegistry();
    const field = registry.find((f) => f.path === 'baseSettings.botBridge.timeoutMs');
    assert.ok(field, 'field not found');
    assert.equal(field.riskLevel, 'high');
    assert.ok(field.help?.de, 'missing DE help text');
    assert.ok(field.help?.en, 'missing EN help text');
});

test('Known medium-risk field baseSettings.gameplay.speed has riskLevel medium', () => {
    const registry = createSettingsOverrideFieldRegistry();
    const field = registry.find((f) => f.path === 'baseSettings.gameplay.speed');
    assert.ok(field, 'field not found');
    assert.equal(field.riskLevel, 'medium');
    assert.ok(field.impact?.de, 'missing DE impact text');
});

test('configShare fields inherit metadata from baseSettings mirror', () => {
    const registry = createSettingsOverrideFieldRegistry();
    const field = registry.find((f) => f.path === 'configShare.gameplay.speed');
    assert.ok(field, 'configShare.gameplay.speed not found');
    assert.equal(field.riskLevel, 'medium');
    assert.ok(field.help?.de, 'missing inherited DE help text');
});

test('Schema descriptor fields include help metadata', () => {
    const descriptor = createSettingsStudioSchemaDescriptor();
    assert.ok(Array.isArray(descriptor.fields), 'descriptor.fields must be array');
    const field = descriptor.fields.find((f) => f.path === 'baseSettings.gameplay.speed');
    assert.ok(field, 'speed field not found in descriptor');
    assert.ok('riskLevel' in field, 'descriptor field missing riskLevel');
    assert.ok('help' in field, 'descriptor field missing help');
    assert.ok('impact' in field, 'descriptor field missing impact');
});

// ─── 97.4 Migration classification ───────────────────

test('classifyOverrideDraftMigration returns current for valid v1 draft', () => {
    const draft = createSettingsOverrideDraft();
    const result = classifyOverrideDraftMigration(draft);
    assert.equal(result.status, 'current');
    assert.equal(result.code, SCHEMA_MIGRATION_CODES.CURRENT);
    assert.equal(result.reason, null);
});

test('classifyOverrideDraftMigration returns upgrade for draft without schemaVersion', () => {
    const draft = { baseSettings: {}, language: 'de' };
    const result = classifyOverrideDraftMigration(draft);
    assert.equal(result.status, 'upgrade');
    assert.equal(result.code, SCHEMA_MIGRATION_CODES.UPGRADE);
    assert.ok(result.reason, 'missing upgrade reason');
});

test('classifyOverrideDraftMigration returns fallback for unknown future version', () => {
    const draft = { schemaVersion: 'menu-defaults-override.v99', baseSettings: {} };
    const result = classifyOverrideDraftMigration(draft);
    assert.equal(result.status, 'fallback');
    assert.equal(result.code, SCHEMA_MIGRATION_CODES.FALLBACK);
    assert.ok(result.reason?.includes('v99'), 'reason should mention unknown version');
});

test('classifyOverrideDraftMigration returns reject for non-object', () => {
    const result = classifyOverrideDraftMigration('not-an-object');
    assert.equal(result.status, 'reject');
    assert.equal(result.code, SCHEMA_MIGRATION_CODES.REJECT);
});

test('migrateOverrideDraft on upgrade sets correct schemaVersion', () => {
    const rawDraft = { language: 'de', baseSettings: {} };
    const migration = classifyOverrideDraftMigration(rawDraft);
    assert.equal(migration.status, 'upgrade');
    const migrated = migrateOverrideDraft(rawDraft, migration);
    assert.equal(migrated.schemaVersion, SETTINGS_OVERRIDE_SCHEMA_VERSION);
    assert.equal(migrated.language, 'de');
});

test('migrateOverrideDraft on current returns draft unchanged', () => {
    const draft = createSettingsOverrideDraft();
    const migration = classifyOverrideDraftMigration(draft);
    const migrated = migrateOverrideDraft(draft, migration);
    assert.deepEqual(migrated, draft);
});

// ─── 97.1/97.4 SettingsDefaultsFacade diagnostics ────

test('SettingsDefaultsFacade sets __overrideDiagnostics on validation failure', () => {
    const invalidDraft = {
        schemaVersion: SETTINGS_OVERRIDE_SCHEMA_VERSION,
        baseSettings: { numBots: 'not-a-number' },
    };
    const result = createDefaultSettingsSnapshotWithOverride(invalidDraft);
    assert.equal(result.__overrideSkipped, true, '__overrideSkipped must be true');
    assert.ok(result.__overrideSkippedReason, 'must have __overrideSkippedReason');
    assert.ok(result.__overrideDiagnostics, 'must have __overrideDiagnostics');
    assert.equal(result.__overrideDiagnostics.status, 'skipped');
    assert.equal(result.__overrideDiagnostics.reason, 'VALIDATION_FAILED');
    assert.ok(Array.isArray(result.__overrideDiagnostics.errorCodes), 'errorCodes must be array');
});

test('SettingsDefaultsFacade passes migrationCode into diagnostics', () => {
    const invalidDraft = { schemaVersion: SETTINGS_OVERRIDE_SCHEMA_VERSION, numBots: 'bad' };
    const migrationInfo = { status: 'upgrade', code: SCHEMA_MIGRATION_CODES.UPGRADE, reason: 'test upgrade' };
    const result = createDefaultSettingsSnapshotWithOverride(invalidDraft, migrationInfo);
    if (result.__overrideDiagnostics) {
        assert.equal(result.__overrideDiagnostics.migrationCode, SCHEMA_MIGRATION_CODES.UPGRADE);
    }
});

test('SettingsDefaultsFacade returns base defaults when override is null', () => {
    const result = createDefaultSettingsSnapshotWithOverride(null);
    assert.equal(result.__overrideSkipped, undefined);
    assert.equal(result.__overrideDiagnostics, undefined);
});

// ─── 97.5 Backup retention constants ─────────────────

test('validateSettingsOverrideDraft accepts a fresh default draft', () => {
    const draft = createSettingsOverrideDraft();
    const result = validateSettingsOverrideDraft(draft);
    assert.equal(result.valid, true, `validation failed: ${JSON.stringify(result.errors)}`);
    assert.equal(result.errors.length, 0);
});

test('V98.5.2 settings studio keeps browser-demo section and save-preview risk hints wired', async () => {
    assert.equal(SECTIONS.some((entry) => entry.key === 'browserDemoPolicy'), true);

    const appSource = await fs.readFile(
        new URL('../electron/settings-studio/ui/settings-studio-app.js', import.meta.url),
        'utf8'
    );
    assert.equal(appSource.includes('renderBrowserDemoPreviewHints'), true);
    assert.equal(appSource.includes('browserDemoRiskHintTitle'), true);
    assert.equal(appSource.includes("sectionKey === 'browserDemoPolicy'"), true);
    assert.equal(appSource.includes('statusSavedBrowserDemoPolicy'), true);
});

test('V98.5.2 settings studio load exposes browser-demo policy draft plus dedicated override and export paths', async (t) => {
    const harness = await createSettingsStudioTestHarness(t);
    const response = await harness.invoke(SETTINGS_STUDIO_CHANNELS.load);

    assert.equal(response.ok, true);
    assert.equal(response.browserDemoPolicy.validation.valid, true);
    assert.equal(
        response.browserDemoPolicy.draft.contractVersion,
        BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION
    );
    assert.match(
        String(response.paths.browserDemoPolicyOverrideFilePath || ''),
        /browser-demo-surface-policy\.override\.json$/u
    );
    assert.match(
        String(response.paths.browserDemoPolicyExportFilePath || '').replaceAll('\\', '/'),
        /data\/contracts\/browser-demo-surface-policy\.export\.v1\.json$/u
    );
});

test('V98.5.2 settings studio save returns browser-demo validation errors and does not write invalid policy drafts', async (t) => {
    const harness = await createSettingsStudioTestHarness(t);
    const mainDraft = createSettingsOverrideDraft();
    const invalidBrowserDemoDraft = {
        contractVersion: BROWSER_DEMO_SURFACE_POLICY_OVERRIDE_CONTRACT_VERSION,
        policy: {
            unknownPolicyField: true,
        },
    };

    const saveResponse = await harness.invoke(
        SETTINGS_STUDIO_CHANNELS.save,
        mainDraft,
        invalidBrowserDemoDraft
    );

    assert.equal(saveResponse.ok, false);
    assert.equal(saveResponse.browserDemoPolicy.validation.valid, false);
    assert.equal(saveResponse.browserDemoPolicy.migration.status, 'current');
    assert.equal(
        saveResponse.browserDemoPolicy.validation.errors.some((entry) => entry.code === 'POLICY_FIELD_UNKNOWN'),
        true
    );

    await assert.rejects(
        fs.access(path.join(harness.userDataPath, 'browser-demo-surface-policy.override.json')),
        /ENOENT/u
    );
});

test('V98.5.2 restore hygiene keeps browser-demo override untouched while restoring menu defaults backup', async (t) => {
    const harness = await createSettingsStudioTestHarness(t);
    const loadResponse = await harness.invoke(SETTINGS_STUDIO_CHANNELS.load);
    const firstMainDraft = JSON.parse(JSON.stringify(loadResponse.draft));
    const secondMainDraft = JSON.parse(JSON.stringify(loadResponse.draft));
    firstMainDraft.baseSettings.gameplay.speed = 0.84;
    secondMainDraft.baseSettings.gameplay.speed = 1.04;

    const firstBrowserDraft = JSON.parse(JSON.stringify(createBrowserDemoSurfacePolicyOverrideDraft()));
    firstBrowserDraft.policy = {
        allowedModePaths: ['fight'],
    };
    firstBrowserDraft.capabilityFlags = {
        save: { enabled: false },
    };

    const secondBrowserDraft = JSON.parse(JSON.stringify(createBrowserDemoSurfacePolicyOverrideDraft()));
    secondBrowserDraft.policy = {
        allowedModePaths: ['arcade'],
        allowedSessionTypes: ['single'],
    };
    secondBrowserDraft.capabilityFlags = {
        save: { enabled: false },
        recording: { enabled: false },
    };

    const firstSave = await harness.invoke(
        SETTINGS_STUDIO_CHANNELS.save,
        firstMainDraft,
        firstBrowserDraft
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    const secondSave = await harness.invoke(
        SETTINGS_STUDIO_CHANNELS.save,
        secondMainDraft,
        secondBrowserDraft
    );

    assert.equal(firstSave.ok, true);
    assert.equal(secondSave.ok, true);
    assert.equal(
        secondSave.browserDemoPolicy.exportState.contractVersion,
        BROWSER_DEMO_POLICY_EXPORT_CONTRACT_VERSION
    );

    const listResponse = await harness.invoke(SETTINGS_STUDIO_CHANNELS.listBackups, { limit: 30 });
    const backups = Array.isArray(listResponse?.backups) ? listResponse.backups : [];
    const restoreCandidate = backups.find((entry) => /\.pre-save\.json$/u.test(String(entry.fileName || '')));
    assert.ok(restoreCandidate, 'expected a pre-save backup for menu-defaults');
    assert.equal(
        backups.some((entry) => String(entry.fileName || '').includes('.pre-save-browser-demo-policy.json')),
        true
    );

    const restoreResponse = await harness.invoke(
        SETTINGS_STUDIO_CHANNELS.restoreBackup,
        restoreCandidate.fileName
    );
    assert.equal(restoreResponse.ok, true);

    const restoredMainRaw = await fs.readFile(loadResponse.paths.overrideFilePath, 'utf8');
    const restoredMainDraft = JSON.parse(restoredMainRaw);
    assert.deepEqual(restoredMainDraft, firstSave.draft);

    const browserPolicyRaw = await fs.readFile(loadResponse.paths.browserDemoPolicyOverrideFilePath, 'utf8');
    const browserPolicyDraft = JSON.parse(browserPolicyRaw);
    assert.deepEqual(browserPolicyDraft, secondSave.browserDemoPolicy.draft);

    const exportRaw = await fs.readFile(loadResponse.paths.browserDemoPolicyExportFilePath, 'utf8');
    const exportArtifact = JSON.parse(exportRaw);
    assert.equal(exportArtifact.contractVersion, BROWSER_DEMO_POLICY_EXPORT_CONTRACT_VERSION);
    assert.deepEqual(exportArtifact.draft, secondSave.browserDemoPolicy.draft);
});
