import assert from 'node:assert/strict';
import test from 'node:test';

import { SettingsManager } from '../src/core/SettingsManager.js';
import { STORAGE_KEYS } from '../src/ui/StorageKeys.js';
import { MENU_TEXT_CATALOG } from '../src/ui/menu/MenuTextCatalog.js';

function createMemoryStoragePlatform(initialRecords = {}, options = {}) {
    const records = new Map(Object.entries(initialRecords));
    return {
        driver: { storage: null },
        readJson(key, legacyKeys = [], fallback = null) {
            for (const candidate of [key, ...legacyKeys]) {
                if (records.has(candidate)) return records.get(candidate);
            }
            return fallback;
        },
        writeJson(key, value) {
            if (options.failWrites) {
                return { ok: false, reason: 'storage_unavailable', quotaExceeded: false };
            }
            records.set(key, value);
            return { ok: true, reason: 'ok', quotaExceeded: false };
        },
        getRecord(key) {
            return records.get(key);
        },
    };
}

test('current-version sidecar records rewrite to canonical safe shapes', () => {
    const textId = Object.keys(MENU_TEXT_CATALOG)[0];
    const storagePlatform = createMemoryStoragePlatform({
        [STORAGE_KEYS.menuPresets]: {
            schemaVersion: 'menu-preset-store.v1',
            presets: [{
                id: 'self-heal',
                name: 'Self Heal',
                metadata: {
                    id: 'self-heal',
                    kind: 'open',
                    ownerId: 'owner',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    updatedAt: '2026-01-01T00:00:00.000Z',
                },
                values: {
                    'gameplay.speed': 20,
                    'localSettings.ownerId': 'attacker',
                },
            }],
        },
        [STORAGE_KEYS.menuDrafts]: {
            schemaVersion: 'menu-draft-store.v1',
            drafts: {
                single: {
                    sessionType: 'single',
                    mode: '2p',
                    modePath: 'normal',
                    mapKey: 'standard',
                    gameMode: 'CLASSIC',
                    gameplay: { speed: 18 },
                    unexpected: true,
                },
                invalid_session: { mapKey: 'maze' },
            },
        },
        [STORAGE_KEYS.menuTextOverrides]: {
            schemaVersion: 'menu-text-overrides.v1',
            overrides: {
                [`  ${textId}  `]: '  Canonical text  ',
                empty: '   ',
            },
        },
        [STORAGE_KEYS.menuTelemetry]: {
            schemaVersion: 'menu-telemetry.v1',
            state: {
                abortCount: -4,
                events: 'invalid',
            },
        },
    });
    const manager = new SettingsManager({ storagePlatform });
    const settings = manager.createDefaultSettings();

    manager.listMenuPresets();
    manager.applySessionDraft(settings, 'single');
    manager.listMenuTextOverrides();
    manager.getMenuTelemetrySnapshot();

    const presetRecord = storagePlatform.getRecord(STORAGE_KEYS.menuPresets);
    const draftRecord = storagePlatform.getRecord(STORAGE_KEYS.menuDrafts);
    const textRecord = storagePlatform.getRecord(STORAGE_KEYS.menuTextOverrides);
    const telemetryRecord = storagePlatform.getRecord(STORAGE_KEYS.menuTelemetry);
    const health = manager.getSettingsHealthSnapshot(settings);

    assert.deepEqual(presetRecord.presets[0].values, { 'gameplay.speed': 20 });
    assert.deepEqual(Object.keys(draftRecord.drafts), ['single']);
    assert.equal(draftRecord.drafts.single.mode, '1p');
    assert.equal('unexpected' in draftRecord.drafts.single, false);
    assert.deepEqual(textRecord.overrides, { [textId]: 'Canonical text' });
    assert.equal(telemetryRecord.state.abortCount, 0);
    assert.deepEqual(telemetryRecord.state.events, []);
    assert.deepEqual(health.persistenceStatus, {
        settings: 'unknown',
        profiles: 'unknown',
        records: 'unknown',
        presets: 'ok',
        drafts: 'ok',
        textOverrides: 'ok',
        telemetry: 'ok',
    });
});

test('health snapshot exposes separate sidecar write failures and reasons', () => {
    const storagePlatform = createMemoryStoragePlatform({}, { failWrites: true });
    const manager = new SettingsManager({ storagePlatform });
    const settings = manager.createDefaultSettings();
    const textId = Object.keys(MENU_TEXT_CATALOG)[0];
    const ownerContext = { ownerId: 'owner', actorId: 'owner', isOwner: true };

    manager.saveMenuPreset(settings, { id: 'failed-preset', name: 'Failed' }, ownerContext);
    manager.saveSessionDraft(settings, 'single');
    manager.setMenuTextOverride(textId, 'Failed override');
    manager.recordMenuTelemetry(settings, 'abort');

    const health = manager.getSettingsHealthSnapshot(settings);

    assert.deepEqual(health.persistenceStatus, {
        settings: 'unknown',
        profiles: 'unknown',
        records: 'unknown',
        presets: 'failed',
        drafts: 'failed',
        textOverrides: 'failed',
        telemetry: 'failed',
    });
    assert.deepEqual(health.persistenceReasons, {
        settings: '',
        profiles: '',
        records: '',
        presets: 'storage_unavailable',
        drafts: 'storage_unavailable',
        textOverrides: 'storage_unavailable',
        telemetry: 'storage_unavailable',
    });
});
