const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const BROWSER_DEMO_POLICY_OVERRIDE_FILE_NAME = 'browser-demo-surface-policy.override.json';
const BROWSER_DEMO_POLICY_EXPORT_CONTRACT_VERSION = 'browser-demo-surface-policy-export.v1';
const BROWSER_DEMO_POLICY_EXPORT_FILE_NAME = 'browser-demo-surface-policy.export.v1.json';
const BROWSER_DEMO_POLICY_EXPORT_PATH_SEGMENTS = Object.freeze([
    'data',
    'contracts',
    BROWSER_DEMO_POLICY_EXPORT_FILE_NAME,
]);

let cachedBrowserDemoPolicyContractPromise = null;

function loadBrowserDemoPolicyContractModule() {
    if (cachedBrowserDemoPolicyContractPromise) {
        return cachedBrowserDemoPolicyContractPromise;
    }

    const contractModuleUrl = pathToFileURL(
        path.resolve(
            __dirname,
            '..',
            '..',
            '..',
            'src',
            'shared',
            'contracts',
            'BrowserDemoSurfacePolicyOverrideContract.js'
        )
    ).href;

    cachedBrowserDemoPolicyContractPromise = import(contractModuleUrl);
    return cachedBrowserDemoPolicyContractPromise;
}

class SettingsBrowserDemoPolicyService {
    constructor({ app }) {
        this.app = app;
        this.fileName = BROWSER_DEMO_POLICY_OVERRIDE_FILE_NAME;
        this.projectRootPath = path.resolve(__dirname, '..', '..', '..');
    }

    getOverrideFilePath() {
        return path.join(this.app.getPath('userData'), this.fileName);
    }

    getExportFilePath() {
        return path.join(this.projectRootPath, ...BROWSER_DEMO_POLICY_EXPORT_PATH_SEGMENTS);
    }

    toJsonString(value) {
        return `${JSON.stringify(value, null, 2)}\n`;
    }

    async writeFileAtomically(filePath, content) {
        const dirPath = path.dirname(filePath);
        await fs.mkdir(dirPath, { recursive: true });

        const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
        await fs.writeFile(tempPath, String(content || ''), 'utf-8');

        try {
            await fs.rename(tempPath, filePath);
        } catch (error) {
            if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
                await fs.rm(filePath, { force: true });
                await fs.rename(tempPath, filePath);
                return;
            }
            await fs.rm(tempPath, { force: true });
            throw error;
        }
    }

    async createDraft() {
        const moduleApi = await loadBrowserDemoPolicyContractModule();
        return moduleApi.createBrowserDemoSurfacePolicyOverrideDraft();
    }

    async validateDraft(draft) {
        const moduleApi = await loadBrowserDemoPolicyContractModule();
        return moduleApi.validateBrowserDemoSurfacePolicyOverrideDraft(draft);
    }

    async classifyMigration(draft) {
        const moduleApi = await loadBrowserDemoPolicyContractModule();
        const migration = moduleApi.classifyBrowserDemoSurfacePolicyOverrideMigration(draft);
        const migrated = moduleApi.migrateBrowserDemoSurfacePolicyOverrideDraft(draft, migration);
        return { ...migration, migrated };
    }

    async readRawFile() {
        try {
            return await fs.readFile(this.getOverrideFilePath(), 'utf-8');
        } catch (error) {
            if (error && error.code === 'ENOENT') {
                return '';
            }
            throw error;
        }
    }

    async loadDraft({ fallbackDraft }) {
        const filePath = this.getOverrideFilePath();
        try {
            const raw = await fs.readFile(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            return {
                exists: true,
                path: filePath,
                raw,
                draft: parsed,
                error: null,
            };
        } catch (error) {
            if (error && error.code === 'ENOENT') {
                return {
                    exists: false,
                    path: filePath,
                    raw: '',
                    draft: fallbackDraft,
                    error: null,
                };
            }
            return {
                exists: true,
                path: filePath,
                raw: '',
                draft: fallbackDraft,
                error: error instanceof Error ? error.message : String(error || 'Datei konnte nicht gelesen werden.'),
            };
        }
    }

    async saveDraft(draft) {
        const filePath = this.getOverrideFilePath();
        await this.writeFileAtomically(filePath, this.toJsonString(draft));

        return {
            path: filePath,
            savedAt: Date.now(),
        };
    }

    createExportArtifact(draft) {
        return {
            contractVersion: BROWSER_DEMO_POLICY_EXPORT_CONTRACT_VERSION,
            generatedAt: new Date().toISOString(),
            source: {
                kind: 'settings-studio',
                overrideFilePath: this.getOverrideFilePath(),
            },
            draft,
        };
    }

    async saveExportArtifact(draft) {
        const filePath = this.getExportFilePath();
        const exportArtifact = this.createExportArtifact(draft);
        await this.writeFileAtomically(filePath, this.toJsonString(exportArtifact));

        return {
            path: filePath,
            savedAt: Date.now(),
            contractVersion: BROWSER_DEMO_POLICY_EXPORT_CONTRACT_VERSION,
        };
    }
}

module.exports = {
    SettingsBrowserDemoPolicyService,
    BROWSER_DEMO_POLICY_OVERRIDE_FILE_NAME,
    BROWSER_DEMO_POLICY_EXPORT_CONTRACT_VERSION,
    BROWSER_DEMO_POLICY_EXPORT_FILE_NAME,
};
