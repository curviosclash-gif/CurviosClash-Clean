const schemaService = require('../services/SettingsSchemaService.cjs');
const { SettingsOverrideFileService } = require('../services/SettingsOverrideFileService.cjs');
const { SettingsBackupService } = require('../services/SettingsBackupService.cjs');
const { SettingsPrefsService } = require('../services/SettingsPrefsService.cjs');
const { SettingsBrowserDemoPolicyService } = require('../services/SettingsBrowserDemoPolicyService.cjs');

const CHANNELS = Object.freeze({
    load: 'settings-studio:load',
    validate: 'settings-studio:validate',
    save: 'settings-studio:save',
    listBackups: 'settings-studio:list-backups',
    restoreBackup: 'settings-studio:restore-backup',
    getSchema: 'settings-studio:get-schema',
    setLanguage: 'settings-studio:set-language',
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

function registerSettingsStudioIpc({ ipcMain, app }) {
    const fileService = new SettingsOverrideFileService({ app });
    const backupService = new SettingsBackupService({ app });
    const prefsService = new SettingsPrefsService({ app });
    const browserDemoPolicyService = new SettingsBrowserDemoPolicyService({ app });

    ipcMain.handle(CHANNELS.load, async () => {
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

        return {
            ok: true,
            draft: validation.normalizedDraft,
            validation: createValidationSnapshot(validation),
            schema,
            paths: {
                overrideFilePath: fileService.getOverrideFilePath(),
                browserDemoPolicyOverrideFilePath: browserDemoPolicyService.getOverrideFilePath(),
                browserDemoPolicyExportFilePath: browserDemoPolicyService.getExportFilePath(),
                backupDirectoryPath: backupService.getBackupDirectoryPath(),
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
            backups,
        };
    });

    ipcMain.handle(CHANNELS.validate, async (_event, draft) => {
        const validation = await schemaService.validateDraft(draft);
        return {
            ok: true,
            draft: validation.normalizedDraft,
            validation: createValidationSnapshot(validation),
        };
    });

    ipcMain.handle(CHANNELS.save, async (_event, draft, browserDemoPolicyDraft = null) => {
        const validation = await schemaService.validateDraft(draft);
        const validationSnapshot = createValidationSnapshot(validation);
        const browserDemoFallbackDraft = await browserDemoPolicyService.createDraft();
        const browserDemoInputDraft = browserDemoPolicyDraft == null ? browserDemoFallbackDraft : browserDemoPolicyDraft;
        const browserDemoMigration = await browserDemoPolicyService.classifyMigration(browserDemoInputDraft);
        const browserDemoDraftToValidate = browserDemoMigration.status === 'fallback'
            ? browserDemoFallbackDraft
            : browserDemoMigration.migrated;
        const browserDemoValidation = await browserDemoPolicyService.validateDraft(browserDemoDraftToValidate);
        const browserDemoValidationSnapshot = createValidationSnapshot(browserDemoValidation);

        if (!validationSnapshot.valid || !browserDemoValidationSnapshot.valid) {
            return {
                ok: false,
                draft: validation.normalizedDraft,
                validation: validationSnapshot,
                browserDemoPolicy: {
                    draft: browserDemoValidation.normalizedDraft,
                    validation: browserDemoValidationSnapshot,
                    migration: {
                        status: browserDemoMigration.status,
                        code: browserDemoMigration.code,
                        reason: browserDemoMigration.reason || null,
                    },
                },
            };
        }

        const existingRaw = await fileService.readRawFile();
        const backupPayload = existingRaw || fileService.toJsonString(validation.normalizedDraft);
        const backup = await backupService.createBackup({
            content: backupPayload,
            reason: 'pre-save',
        });
        const existingBrowserDemoRaw = await browserDemoPolicyService.readRawFile();
        const browserDemoBackupPayload = existingBrowserDemoRaw
            || browserDemoPolicyService.toJsonString(browserDemoValidation.normalizedDraft);
        const browserDemoBackup = await backupService.createBackup({
            content: browserDemoBackupPayload,
            reason: 'pre-save-browser-demo-policy',
        });

        const saveState = await fileService.saveDraft(validation.normalizedDraft);
        const browserDemoSaveState = await browserDemoPolicyService.saveDraft(browserDemoValidation.normalizedDraft);
        let browserDemoExportState = null;
        try {
            browserDemoExportState = await browserDemoPolicyService.saveExportArtifact(
                browserDemoValidation.normalizedDraft
            );
        } catch (error) {
            browserDemoExportState = {
                path: browserDemoPolicyService.getExportFilePath(),
                savedAt: null,
                contractVersion: null,
                error: error instanceof Error
                    ? error.message
                    : String(error || 'browser_demo_policy_export_failed'),
            };
        }
        return {
            ok: true,
            draft: validation.normalizedDraft,
            validation: validationSnapshot,
            saveState,
            backup,
            browserDemoPolicy: {
                draft: browserDemoValidation.normalizedDraft,
                validation: browserDemoValidationSnapshot,
                migration: {
                    status: browserDemoMigration.status,
                    code: browserDemoMigration.code,
                    reason: browserDemoMigration.reason || null,
                },
                saveState: browserDemoSaveState,
                exportState: browserDemoExportState,
                backup: browserDemoBackup,
            },
        };
    });

    ipcMain.handle(CHANNELS.listBackups, async (_event, options = {}) => {
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

    ipcMain.handle(CHANNELS.restoreBackup, async (_event, backupFileName) => {
        const backupContent = await backupService.readBackupFile(backupFileName);
        const parsed = JSON.parse(backupContent);
        const validation = await schemaService.validateDraft(parsed);
        const validationSnapshot = createValidationSnapshot(validation);
        if (!validationSnapshot.valid) {
            return {
                ok: false,
                draft: validation.normalizedDraft,
                validation: validationSnapshot,
            };
        }

        const existingRaw = await fileService.readRawFile();
        if (existingRaw) {
            await backupService.createBackup({
                content: existingRaw,
                reason: 'pre-restore',
            });
        }

        const saveState = await fileService.saveDraft(validation.normalizedDraft);
        return {
            ok: true,
            draft: validation.normalizedDraft,
            validation: validationSnapshot,
            saveState,
        };
    });

    ipcMain.handle(CHANNELS.getSchema, async () => {
        const schema = await schemaService.getSchemaDescriptor();
        return {
            ok: true,
            schema,
        };
    });

    ipcMain.handle(CHANNELS.setLanguage, async (_event, language) => {
        const normalized = normalizeLanguage(language);
        prefsService.savePrefs({ language: normalized });
        return {
            ok: true,
            language: normalized,
        };
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
