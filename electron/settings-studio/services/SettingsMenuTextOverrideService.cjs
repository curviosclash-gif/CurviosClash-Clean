const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const MENU_TEXT_OVERRIDE_SCHEMA_VERSION = 'menu-text-overrides.v1';

let catalogPromise = null;

function loadCatalog() {
    if (!catalogPromise) {
        catalogPromise = import(pathToFileURL(
            path.resolve(__dirname, '..', '..', '..', 'src', 'ui', 'menu', 'MenuTextCatalog.js')
        ).href).then((module) => module.MENU_TEXT_CATALOG);
    }
    return catalogPromise;
}

function normalizeText(value) {
    return typeof value === 'string' ? value.trim() : '';
}

class SettingsMenuTextOverrideService {
    constructor({ app }) {
        this.app = app;
        this.fileName = 'menu-text-overrides.json';
    }

    getFilePath() {
        return path.join(this.app.getPath('userData'), this.fileName);
    }

    getBackupFilePath() {
        return `${this.getFilePath()}.bak`;
    }

    toJsonString(overrides) {
        return `${JSON.stringify({
            schemaVersion: MENU_TEXT_OVERRIDE_SCHEMA_VERSION,
            overrides,
        }, null, 2)}\n`;
    }

    async readRecord() {
        try {
            const raw = await fs.readFile(this.getFilePath(), 'utf8');
            const parsed = JSON.parse(raw);
            return parsed && parsed.schemaVersion === MENU_TEXT_OVERRIDE_SCHEMA_VERSION
                ? parsed
                : { schemaVersion: MENU_TEXT_OVERRIDE_SCHEMA_VERSION, overrides: {} };
        } catch (error) {
            if (error?.code === 'ENOENT') {
                return { schemaVersion: MENU_TEXT_OVERRIDE_SCHEMA_VERSION, overrides: {} };
            }
            throw error;
        }
    }

    async listOverrides() {
        const [catalog, record] = await Promise.all([loadCatalog(), this.readRecord()]);
        const overrides = {};
        for (const [textId, value] of Object.entries(record.overrides || {})) {
            const normalizedValue = normalizeText(value);
            if (!Object.prototype.hasOwnProperty.call(catalog, textId) || !normalizedValue) continue;
            overrides[textId] = normalizedValue;
        }
        return overrides;
    }

    async assertKnownTextId(textId) {
        const normalizedTextId = normalizeText(textId);
        const catalog = await loadCatalog();
        if (!normalizedTextId || !Object.prototype.hasOwnProperty.call(catalog, normalizedTextId)) {
            const error = new Error('unknown_text_id');
            error.code = 'ERR_CURVIOS_UNKNOWN_MENU_TEXT_ID';
            throw error;
        }
        return normalizedTextId;
    }

    async saveOverrides(overrides) {
        const filePath = this.getFilePath();
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        try {
            await fs.copyFile(filePath, this.getBackupFilePath());
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
        const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
        await fs.writeFile(tempPath, this.toJsonString(overrides), 'utf8');
        try {
            await fs.rename(tempPath, filePath);
        } catch (error) {
            if (error?.code === 'EEXIST' || error?.code === 'EPERM') {
                await fs.rm(filePath, { force: true });
                await fs.rename(tempPath, filePath);
            } else {
                await fs.rm(tempPath, { force: true }).catch(() => null);
                throw error;
            }
        }
        return { path: filePath, savedAt: Date.now() };
    }

    async setOverride(textId, value) {
        const normalizedTextId = await this.assertKnownTextId(textId);
        const overrides = await this.listOverrides();
        const normalizedValue = normalizeText(value);
        if (normalizedValue) overrides[normalizedTextId] = normalizedValue;
        else delete overrides[normalizedTextId];
        const saveState = await this.saveOverrides(overrides);
        return { textId: normalizedTextId, value: normalizedValue, overrides, saveState };
    }

    async clearOverride(textId) {
        return this.setOverride(textId, '');
    }

    async resetOverrides() {
        const saveState = await this.saveOverrides({});
        return { overrides: {}, saveState };
    }
}

module.exports = {
    MENU_TEXT_OVERRIDE_SCHEMA_VERSION,
    SettingsMenuTextOverrideService,
};
