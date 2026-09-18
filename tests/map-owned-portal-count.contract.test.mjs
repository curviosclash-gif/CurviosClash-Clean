import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
    DEFAULT_DYNAMIC_PORTAL_ENTRY_COUNT,
    resolveMapPortalEntryCount,
} from '../src/shared/contracts/PortalAuthoringContract.js';
import { createRuntimeConfigSnapshot } from '../src/core/RuntimeConfig.js';
import { CONFIG } from '../src/core/Config.js';
import { SettingsManager } from '../src/core/SettingsManager.js';
import {
    classifyOverrideDraftMigration,
    createSettingsOverrideDraft,
    migrateOverrideDraft,
    validateSettingsOverrideDraft,
} from '../src/core/settings/SettingsOverrideContract.js';

import { createMemoryStoragePlatform } from './helpers/settings-manager-contract-test-utils.mjs';

test('every map yields its own portal entry count', () => {
    assert.equal(resolveMapPortalEntryCount({ portalCount: 4 }), 4);
    assert.equal(resolveMapPortalEntryCount({ portalCount: 0 }), 0);
    assert.equal(resolveMapPortalEntryCount({}), DEFAULT_DYNAMIC_PORTAL_ENTRY_COUNT);
    assert.equal(resolveMapPortalEntryCount(null), DEFAULT_DYNAMIC_PORTAL_ENTRY_COUNT);
    assert.equal(resolveMapPortalEntryCount({ portalCount: -2 }), DEFAULT_DYNAMIC_PORTAL_ENTRY_COUNT);
    for (const [mapKey, map] of Object.entries(CONFIG.MAPS)) {
        const count = resolveMapPortalEntryCount(map);
        assert.ok(Number.isInteger(count) && count >= 0, `map ${mapKey} yields a portal count`);
    }
});

test('the match takes the portal count from the map, not from a stored setting', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const settings = manager.createDefaultSettings();
    settings.mapKey = 'empty';
    settings.gameplay.portalCount = 20;
    const runtimeConfig = createRuntimeConfigSnapshot(settings);
    assert.equal(runtimeConfig.gameplay.portalCount, resolveMapPortalEntryCount(CONFIG.MAPS.empty));
});

test('a stored portal count loads without effect and without error', () => {
    const manager = new SettingsManager({ storagePlatform: createMemoryStoragePlatform() });
    const legacy = manager.createDefaultSettings();
    legacy.gameplay.portalCount = 20;
    const sanitized = manager.sanitizeSettings(legacy);
    assert.equal('portalCount' in sanitized.gameplay, false);
    assert.equal('portalCount' in manager.createDefaultSettings().gameplay, false);
});

test('a defaults override that still sets the portal count migrates and stays valid', () => {
    const legacyDraft = createSettingsOverrideDraft();
    legacyDraft.schemaVersion = 'menu-defaults-override.v3';
    legacyDraft.baseSettings = { ...(legacyDraft.baseSettings || {}), gameplay: { speed: 25, portalCount: 12 } };
    const migration = classifyOverrideDraftMigration(legacyDraft);
    assert.equal(migration.status, 'upgrade');
    const migrated = migrateOverrideDraft(legacyDraft, migration);
    assert.equal(migrated.baseSettings.gameplay.portalCount, undefined);
    assert.equal(migrated.baseSettings.gameplay.speed, 25);
    const result = validateSettingsOverrideDraft(migrated);
    assert.deepEqual(result.errors, []);
});

test('the menu no longer offers a portal count slider', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    assert.doesNotMatch(html, /portal-count-slider/);
});
