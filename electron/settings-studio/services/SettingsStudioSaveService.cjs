const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');

async function revision(filePath) {
    try { return createHash('sha256').update(await fs.readFile(filePath)).digest('hex'); }
    catch (error) {
        if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return 'missing';
        return `unreadable:${error.code}`;
    }
}

// Serializes this window's saves and compares the exact loaded file contents before writing.
// Each document reports its own outcome: a later failure never conceals an earlier write.
class SettingsStudioSaveService {
    constructor({ fileService, browserDemoPolicyService, menuTextOverrideService, backupService, schemaService }) {
        this.fileService = fileService;
        this.browserDemoPolicyService = browserDemoPolicyService;
        this.menuTextOverrideService = menuTextOverrideService;
        this.backupService = backupService;
        this.schemaService = schemaService;
        this.baseline = null;
        /** @type {Promise<unknown>} */
        this.pending = Promise.resolve();
    }

    paths() {
        return {
            defaults: this.fileService.getOverrideFilePath(),
            browserDemo: this.browserDemoPolicyService.getOverrideFilePath(),
            browserDemoExport: this.browserDemoPolicyService.getExportFilePath(),
            menuTexts: this.menuTextOverrideService.getFilePath(),
        };
    }

    async snapshot() {
        const pairs = await Promise.all(Object.entries(this.paths()).map(async ([key, file]) => [key, await revision(file)]));
        return Object.fromEntries(pairs);
    }

    save(draft, browserDraft, options = {}) {
        const operation = this.pending.catch(() => {}).then(() => this.performSave(draft, browserDraft, options));
        this.pending = operation;
        return operation;
    }

    async assertUnchanged(document, expected) {
        if (await revision(this.paths()[document]) === expected[document]) return;
        const error = Object.assign(new Error('Datei wurde inzwischen geändert. Neu laden und Änderungen vergleichen.'), { code: 'EXTERNAL_CHANGE' });
        throw error;
    }

    async performSave(draft, browserDraft, options) {
        const requested = Array.isArray(options.documents) ? options.documents : ['defaults', 'browserDemo'];
        const allowed = new Set(['defaults', 'browserDemo', 'menuTexts']);
        if (requested.some((key) => !allowed.has(key))) throw new Error('Unbekanntes Speicherdokument.');
        const documents = ['defaults', 'browserDemo', 'browserDemoExport', 'menuTexts'].filter((key) => (
            key === 'browserDemoExport' ? requested.includes('browserDemo') : requested.includes(key)
        ));
        const validation = await this.schemaService.validateDraft(draft);
        const browserFallback = await this.browserDemoPolicyService.createDraft();
        const migration = await this.browserDemoPolicyService.classifyMigration(browserDraft || browserFallback);
        const browserValidation = await this.browserDemoPolicyService.validateDraft(migration.status === 'fallback' ? browserFallback : migration.migrated);
        const response = {
            ok: false, draft: validation.normalizedDraft, validation,
            browserDemoPolicy: { draft: browserValidation.normalizedDraft, validation: browserValidation, migration },
            savedDocuments: [], pendingDocuments: [...documents], errors: [],
        };
        if (requested.includes('browserDemo') && ['fallback', 'reject'].includes(migration.status)) {
            response.errors.push({ document: 'browserDemo', code: 'UNSUPPORTED_SCHEMA', message: migration.reason || 'Unbekannte Browser-Demo-Version.' });
            return response;
        }
        if ((requested.includes('defaults') && !validation.valid) || (requested.includes('browserDemo') && !browserValidation.valid)) return response;
        const textOverrides = {};
        if (requested.includes('menuTexts')) {
            for (const [id, raw] of Object.entries(options.menuTextOverrides || {})) {
                await this.menuTextOverrideService.assertKnownTextId(id);
                if (typeof raw !== 'string') throw new Error('Menübeschriftung muss ein Text sein.');
                if (raw.trim()) textOverrides[id] = raw.trim();
            }
        }
        const before = await this.snapshot();
        const expected = options.revisions || this.baseline || before;
        const conflicts = documents.filter((key) => expected[key] !== before[key]);
        if (conflicts.length) {
            response.errors = conflicts.map((document) => ({ document, code: 'EXTERNAL_CHANGE', message: 'Datei wurde außerhalb dieses Entwurfs geändert. Vor dem Speichern neu laden und Änderungen vergleichen.' }));
            response.revisions = before;
            return response;
        }
        const committedRevisions = {};
        for (const document of documents) {
            try {
                await this.assertUnchanged(document, expected);
                if (document === 'defaults') {
                    const raw = await this.fileService.readRawFile();
                    response.backup = await this.backupService.createBackup({ content: raw || this.fileService.toJsonString(validation.normalizedDraft), reason: options.reason || 'pre-save' });
                    await this.assertUnchanged(document, expected);
                    response.saveState = await this.fileService.saveDraft(validation.normalizedDraft);
                } else if (document === 'browserDemo') {
                    const raw = await this.browserDemoPolicyService.readRawFile();
                    response.browserDemoPolicy.backup = await this.backupService.createBackup({ content: raw || this.browserDemoPolicyService.toJsonString(browserValidation.normalizedDraft), reason: `${options.reason || 'pre-save'}-browser-demo-policy` });
                    await this.assertUnchanged(document, expected);
                    response.browserDemoPolicy.saveState = await this.browserDemoPolicyService.saveDraft(browserValidation.normalizedDraft);
                } else if (document === 'browserDemoExport') {
                    response.browserDemoPolicy.exportState = await this.browserDemoPolicyService.saveExportArtifact(browserValidation.normalizedDraft);
                } else {
                    const current = await this.menuTextOverrideService.listOverrides();
                    await this.backupService.createBackup({ content: this.menuTextOverrideService.toJsonString(current), reason: `${options.reason || 'pre-save'}-menu-texts` });
                    await this.assertUnchanged(document, expected);
                    response.menuTextSaveState = await this.menuTextOverrideService.saveOverrides(textOverrides);
                    response.menuTextOverrides = textOverrides;
                }
                const savedState = document === 'defaults' ? response.saveState : document === 'browserDemo' ? response.browserDemoPolicy.saveState : document === 'browserDemoExport' ? response.browserDemoPolicy.exportState : response.menuTextSaveState;
                committedRevisions[document] = savedState.revision;
                response.savedDocuments.push(document);
            } catch (error) {
                response.errors.push({ document, code: error.code || 'WRITE_FAILED', message: error.message });
                break;
            }
        }
        response.pendingDocuments = documents.filter((key) => !response.savedDocuments.includes(key));
        response.ok = response.pendingDocuments.length === 0;
        response.revisions = { ...await this.snapshot(), ...committedRevisions };
        // Advance only our saved documents. An unrelated external change must remain a conflict.
        this.baseline = { ...expected };
        for (const key of response.savedDocuments) this.baseline[key] = response.revisions[key];
        return response;
    }
}

module.exports = { SettingsStudioSaveService, revision };
