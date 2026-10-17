const schemaService = require('../services/SettingsSchemaService.cjs');
const { SettingsOverrideFileService } = require('../services/SettingsOverrideFileService.cjs');
const { SettingsBackupService } = require('../services/SettingsBackupService.cjs');
const { SettingsPrefsService } = require('../services/SettingsPrefsService.cjs');
const { SettingsBrowserDemoPolicyService } = require('../services/SettingsBrowserDemoPolicyService.cjs');
const { SettingsMenuTextOverrideService } = require('../services/SettingsMenuTextOverrideService.cjs');
const { assertTrustedWindowSender } = require('../../ipc-sender-guard.cjs');
const { createMapBalancingStore, resolveMapBalancingStoreRoot } = require('../../map-balancing-store.cjs');
const { AppliedMapBalancingService } = require('../services/AppliedMapBalancingService.cjs');

const { SettingsStudioSaveService } = require('../services/SettingsStudioSaveService.cjs');

const CHANNELS = Object.freeze({
    load: 'settings-studio:load',
    validate: 'settings-studio:validate',
    save: 'settings-studio:save',
    listBackups: 'settings-studio:list-backups',
    restoreBackup: 'settings-studio:restore-backup',
    getSchema: 'settings-studio:get-schema',
    setLanguage: 'settings-studio:set-language',
    listMenuTextOverrides: 'settings-studio:menu-text-overrides:list',
    setMenuTextOverride: 'settings-studio:menu-text-overrides:set',
    clearMenuTextOverride: 'settings-studio:menu-text-overrides:clear',
    resetMenuTextOverrides: 'settings-studio:menu-text-overrides:reset',
    mapBalancing: 'settings-studio:map-balancing',
});

const SUPPORTED_LANGUAGES = new Set(['de', 'en']);

function normalizeLanguage(language) {
    const normalized = String(language || 'de').trim().toLowerCase();
    return SUPPORTED_LANGUAGES.has(normalized) ? normalized : 'de';
}

function createValidationSnapshot(validationResult) {
    const result = validationResult || {};
    return {
        valid: result.valid === true,
        errors: Array.isArray(result.errors) ? result.errors : [],
        warnings: Array.isArray(result.warnings) ? result.warnings : [],
    };
}

function registerSettingsStudioIpc({
    ipcMain,
    app,
    browserDemoProjectRootPath,
    getWindow,
    mapBalancingStore = createMapBalancingStore(resolveMapBalancingStoreRoot({ isPackaged: app?.isPackaged !== false })),
}) {
    const fileService = new SettingsOverrideFileService({ app });
    const backupService = new SettingsBackupService({ app });
    const prefsService = new SettingsPrefsService({ app });
    const appliedMapBalancing = new AppliedMapBalancingService({ app, projectRoot: mapBalancingStore.dataRoot || mapBalancingStore.root });
    const browserDemoPolicyService = new SettingsBrowserDemoPolicyService({
        app,
        projectRootPath: browserDemoProjectRootPath,
    });
    const menuTextOverrideService = new SettingsMenuTextOverrideService({ app });
    const saveService = new SettingsStudioSaveService({ fileService, browserDemoPolicyService, menuTextOverrideService, backupService, schemaService });
    const registerTrustedHandler = (channel, handler) => {
        ipcMain.handle(channel, (event, ...args) => {
            assertTrustedWindowSender(event, getWindow?.());
            return handler(...args);
        });
    };

    registerTrustedHandler(CHANNELS.load, async () => {
        // Capture before reading drafts: a concurrent edit during load must cause a
        // conservative conflict, never bless newer bytes alongside an older draft.
        const revisions = await saveService.snapshot();
        const prefs = prefsService.loadPrefs();
        const schema = await schemaService.getSchemaDescriptor();
        const fallbackDraft = await schemaService.createDraft();
        const loaded = await fileService.loadDraft({ fallbackDraft });

        const migration = await schemaService.classifyMigration(loaded.draft);
        const draftToValidate = migration.status === 'fallback' ? fallbackDraft : migration.migrated;
        const draftWithPrefLang = { ...draftToValidate, language: prefs.language };

        const validation = await schemaService.validateDraft(draftWithPrefLang);
        const backupResult = await backupService.listBackups({ limit: 20 });
        const backups = Array.isArray(backupResult?.backups) ? backupResult.backups
            : (Array.isArray(backupResult) ? backupResult : []);

        const browserDemoFallbackDraft = await browserDemoPolicyService.createDraft();
        const browserDemoLoaded = await browserDemoPolicyService.loadDraft({ fallbackDraft: browserDemoFallbackDraft });
        const browserDemoMigration = await browserDemoPolicyService.classifyMigration(browserDemoLoaded.draft);
        const browserDemoDraftToValidate = browserDemoMigration.status === 'fallback'
            ? browserDemoFallbackDraft
            : browserDemoMigration.migrated;
        const browserDemoValidation = await browserDemoPolicyService.validateDraft(browserDemoDraftToValidate);
        let menuTextOverrides = {}, menuTextLoadError = null;
        try { menuTextOverrides = await menuTextOverrideService.listOverrides(); }
        catch (error) { menuTextLoadError = error.message; }
        const menuEditorModel = await schemaService.createMenuEditorModel(
            validation.normalizedDraft,
            menuTextOverrides
        );

        saveService.baseline = revisions;
        return {
            ok: true,
            revisions,
            draft: validation.normalizedDraft,
            validation: createValidationSnapshot(validation),
            schema,
            paths: {
                overrideFilePath: fileService.getOverrideFilePath(),
                browserDemoPolicyOverrideFilePath: browserDemoPolicyService.getOverrideFilePath(),
                browserDemoPolicyExportFilePath: browserDemoPolicyService.getExportFilePath(),
                backupDirectoryPath: backupService.getBackupDirectoryPath(),
                menuTextOverrideFilePath: menuTextOverrideService.getFilePath(),
            },
            fileState: {
                exists: loaded.exists,
                loadError: loaded.error || null,
            },
            migration: {
                status: migration.status,
                code: migration.code,
                reason: migration.reason || null,
            },
            browserDemoPolicy: {
                draft: browserDemoValidation.normalizedDraft,
                validation: createValidationSnapshot(browserDemoValidation),
                fileState: {
                    exists: browserDemoLoaded.exists,
                    loadError: browserDemoLoaded.error || null,
                },
                migration: {
                    status: browserDemoMigration.status,
                    code: browserDemoMigration.code,
                    reason: browserDemoMigration.reason || null,
                },
            },
            menuTextOverrides,
            menuTextLoadError,
            menuEditorModel,
            backups,
        };
    });

    registerTrustedHandler(CHANNELS.validate, async (draft) => {
        const validation = await schemaService.validateDraft(draft);
        return {
            ok: true,
            draft: validation.normalizedDraft,
            validation: createValidationSnapshot(validation),
        };
    });

    registerTrustedHandler(CHANNELS.save, (draft, browserDemoPolicyDraft = null, options = {}) => saveService.save(draft, browserDemoPolicyDraft, options));

    registerTrustedHandler(CHANNELS.listBackups, async (options = {}) => {
        const result = await backupService.listBackups({
            limit: Number(options?.limit || 20),
        });
        const backups = Array.isArray(result?.backups) ? result.backups
            : (Array.isArray(result) ? result : []);
        return {
            ok: true,
            backups,
            retentionInfo: result?.retentionInfo || null,
        };
    });

    registerTrustedHandler(CHANNELS.restoreBackup, async (backupFileName, options = {}) => {
        const parsed = JSON.parse(await backupService.readBackupFile(backupFileName));
        const fallbackDraft = await schemaService.createDraft();
        const current = await fileService.loadDraft({ fallbackDraft });
        const browserFallback = await browserDemoPolicyService.createDraft();
        const browser = await browserDemoPolicyService.loadDraft({ fallbackDraft: browserFallback });
        const baseOptions = { revisions: options.revisions || saveService.baseline, reason: 'pre-restore' };
        if (parsed.schemaVersion === 'menu-text-overrides.v1') {
            return saveService.save(current.draft, browser.draft, { ...baseOptions, documents: ['menuTexts'], menuTextOverrides: parsed.overrides });
        }
        if (parsed.policy && parsed.capabilityFlags) {
            return saveService.save(current.draft, parsed, { ...baseOptions, documents: ['browserDemo'] });
        }
        if (!parsed.baseSettings || typeof parsed.schemaVersion !== 'string') throw new Error('Diese Sicherung enthält keine bekannten Studio-Daten.');
        return saveService.save(parsed, browser.draft, { ...baseOptions, documents: ['defaults'] });
    });

    registerTrustedHandler(CHANNELS.getSchema, async () => {
        const schema = await schemaService.getSchemaDescriptor();
        return {
            ok: true,
            schema,
        };
    });

    registerTrustedHandler(CHANNELS.setLanguage, async (language) => {
        const normalized = normalizeLanguage(language);
        prefsService.savePrefs({ language: normalized });
        return {
            ok: true,
            language: normalized,
        };
    });

    registerTrustedHandler(CHANNELS.listMenuTextOverrides, async () => ({
        ok: true,
        overrides: await menuTextOverrideService.listOverrides(),
    }));

    registerTrustedHandler(CHANNELS.setMenuTextOverride, async (textId, value) => ({
        ok: true,
        ...(await menuTextOverrideService.setOverride(textId, value)),
    }));

    registerTrustedHandler(CHANNELS.clearMenuTextOverride, async (textId) => ({
        ok: true,
        ...(await menuTextOverrideService.clearOverride(textId)),
    }));

    registerTrustedHandler(CHANNELS.resetMenuTextOverrides, async () => ({
        ok: true,
        ...(await menuTextOverrideService.resetOverrides()),
    }));

    // Karten-Balancing: files under data/balancing, written only from an unpacked repository.
    registerTrustedHandler(CHANNELS.mapBalancing, async (payload = null) => {
        const request = payload && typeof payload === 'object' ? payload : {};
        const store = mapBalancingStore;
        const status = { writable: store?.writable === true, message: String(store?.message || '') };
        if (!status.writable) return { ok: false, reason: String(store?.reason || 'unavailable'), status };
        const mapKey = typeof request.mapKey === 'string' ? request.mapKey : '';
        const layer = request.layer && typeof request.layer === 'object' ? request.layer : null;
        try {
            switch (String(request.op || '')) {
                case 'list-maps': return { ok: true, status, maps: await store.listMaps() };
                case 'describe': {
                    const description = await store.describe({ mapKey, modePath: request.modePath, layer });
                    description.appliedState = await appliedMapBalancing.describe(description);
                    return { ok: true, status, description };
                }
                case 'validate': return { ok: true, status, validation: await store.validateMapLayer(mapKey, layer) };
                case 'save': return { ok: true, status, saved: await store.saveMapLayer(mapKey, layer, request.expectedRevision) };
                case 'apply':
                case 'retract': {
                    const known = await store.listMaps();
                    if (!known.some((entry) => entry.mapKey === mapKey)) throw new Error('Unbekannte Karte.');
                    if (!['normal', 'fight', 'arcade'].includes(request.modePath)) throw new Error('Ungültiger Modus.');
                    // Always approve the saved, validated file; a renderer cannot publish an unsaved draft.
                    const description = await store.describe({ mapKey, modePath: request.modePath });
                    const applied = await appliedMapBalancing.change(description, request.op === 'apply', request.expectedValues);
                    return { ok: true, status, applied };
                }
                default: return { ok: false, reason: 'unknown_op', status };
            }
        } catch (error) {
            return { ok: false, reason: String(error?.reason || 'failed'), detail: error instanceof Error ? error.message : String(error), status };
        }
    });

    return () => {
        for (const channel of Object.values(CHANNELS)) {
            ipcMain.removeHandler(channel);
        }
    };
}

module.exports = {
    registerSettingsStudioIpc,
};
