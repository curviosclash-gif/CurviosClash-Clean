const fs = require('node:fs/promises');
const path = require('node:path');

class SettingsOverrideFileService {
    constructor({ app }) {
        this.app = app;
        this.fileName = 'menu-defaults.override.json';
    }

    getOverrideFilePath() {
        return path.join(this.app.getPath('userData'), this.fileName);
    }

    toJsonString(value) {
        return `${JSON.stringify(value, null, 2)}\n`;
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
        const dirPath = path.dirname(filePath);
        await fs.mkdir(dirPath, { recursive: true });

        const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
        await fs.writeFile(tempPath, this.toJsonString(draft), 'utf-8');

        try {
            await fs.rename(tempPath, filePath);
        } catch (error) {
            if (error && (error.code === 'EEXIST' || error.code === 'EPERM')) {
                await fs.rm(filePath, { force: true });
                await fs.rename(tempPath, filePath);
            } else {
                await fs.rm(tempPath, { force: true });
                throw error;
            }
        }

        return {
            path: filePath,
            savedAt: Date.now(),
        };
    }
}

module.exports = {
    SettingsOverrideFileService,
};
