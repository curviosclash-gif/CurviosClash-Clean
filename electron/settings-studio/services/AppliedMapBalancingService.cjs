const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');

const APPLIED_MAP_BALANCING_FILE = 'map-balancing.applied.json';
const SOURCE_ROOT = path.resolve(__dirname, '..', '..', '..');

function readAppliedMapBalancingSnapshotSync(filePath) {
    try {
        const raw = readFileSync(filePath, 'utf8');
        if (Buffer.byteLength(raw, 'utf8') > 1024 * 1024) throw new Error('Kartenwerte-Datei ist zu groß.');
        return { exists: true, document: JSON.parse(raw), error: null };
    } catch (error) {
        return { exists: error?.code !== 'ENOENT', document: null, error: error?.code === 'ENOENT' ? null : String(error.message) };
    }
}

async function writeAtomic(filePath, text) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporary = `${filePath}.tmp.${randomUUID()}`;
    try {
        await fs.writeFile(temporary, text, 'utf8');
        await fs.rename(temporary, filePath);
    } catch (error) {
        await fs.unlink(temporary).catch(() => {});
        throw error;
    }
}

class AppliedMapBalancingService {
    constructor({ app, projectRoot = SOURCE_ROOT, write = writeAtomic }) {
        this.localPath = path.join(app.getPath('userData'), APPLIED_MAP_BALANCING_FILE);
        this.projectRoot = projectRoot;
        this.write = write;
        /** @type {Promise<typeof import('../../../src/shared/contracts/AppliedMapBalancingContract.js')> | null} */
        this.contractPromise = null;
        /** @type {Promise<unknown>} */
        this.pending = Promise.resolve();
    }

    async contract() {
        this.contractPromise ||= import(pathToFileURL(path.join(SOURCE_ROOT, 'src/shared/contracts/AppliedMapBalancingContract.js')).href);
        return this.contractPromise;
    }

    async readRecord() {
        const contract = await this.contract();
        const snapshot = readAppliedMapBalancingSnapshotSync(this.localPath);
        const record = snapshot.document || { version: 1, entries: [] };
        const validation = contract.validateAppliedMapBalancingDocument(record);
        if (snapshot.error || (snapshot.exists && !snapshot.document) || !validation.ok) {
            throw new Error(snapshot.error || validation.errors.join('; ') || 'Ungültige übernommene Kartenwerte.');
        }
        return contract.normalizeAppliedMapBalancingDocument(record);
    }

    valuesFromDescription(description) {
        return Object.fromEntries(description.fields.filter((field) => field.group !== 'arcadeStage').map((field) => [field.key, field.value]));
    }

    async describe(description) {
        const record = await this.readRecord();
        const entry = record.entries.find((item) => item.mapKey === description.mapKey && item.modePath === description.modePath);
        const current = this.valuesFromDescription(description);
        return {
            enabled: entry?.enabled === true,
            matches: entry?.enabled === true && Object.keys(current).every((key) => current[key] === entry.values[key]),
        };
    }

    change(description, enabled, expectedValues) {
        // Serialize read/modify/write so two clicks cannot lose another map's approval.
        const operation = this.pending.catch(() => {}).then(() => this.update(description, enabled, expectedValues));
        this.pending = operation;
        return operation;
    }

    async update(description, enabled, expectedValues) {
        const contract = await this.contract();
        const { mapKey, modePath } = description;
        const values = this.valuesFromDescription(description);
        if (enabled && (!expectedValues || Object.keys(values).length !== Object.keys(expectedValues).length
            || Object.keys(values).some((key) => values[key] !== expectedValues[key]))) {
            throw new Error('Die gespeicherten Werte wurden inzwischen geändert. Karte neu auswählen und erneut prüfen.');
        }
        const entry = { mapKey, modePath, enabled, ...(enabled ? { values } : {}) };
        const validation = contract.validateAppliedMapBalancingDocument({ version: 1, entries: [entry] });
        if (!validation.ok) throw new Error(validation.errors.join('; '));
        const record = await this.readRecord();
        const next = contract.normalizeAppliedMapBalancingDocument({
            version: 1,
            entries: [...record.entries.filter((item) => contract.appliedMapBalancingKey(item) !== contract.appliedMapBalancingKey(entry)), entry],
        });
        const sourcePath = path.join(this.projectRoot, 'data/balancing/applied', `${mapKey}.${modePath}.json`);
        const previousSource = await fs.readFile(sourcePath, 'utf8').catch((error) => {
            if (error.code !== 'ENOENT') throw error;
            return null;
        });
        const backupName = `${mapKey}.${modePath}.${randomUUID()}.json`;
        if (previousSource !== null) {
            const backupPath = path.join(this.projectRoot, 'tmp/balancing-backups', backupName);
            await fs.mkdir(path.dirname(backupPath), { recursive: true });
            await fs.writeFile(backupPath, previousSource, 'utf8');
        }
        // Back up local data before either destination changes.
        try {
            const backupPath = path.join(path.dirname(this.localPath), 'balancing-backups', backupName);
            await fs.mkdir(path.dirname(backupPath), { recursive: true });
            await fs.copyFile(this.localPath, backupPath);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        await this.write(sourcePath, `${JSON.stringify({ version: 1, ...entry }, null, 2)}\n`);
        try {
            await this.write(this.localPath, `${JSON.stringify(next, null, 2)}\n`);
        } catch (error) {
            // A failed local activation must not leave a newly approved release file behind.
            if (previousSource === null) await fs.unlink(sourcePath);
            else await writeAtomic(sourcePath, previousSource);
            throw error;
        }
        return { sourcePath, localPath: this.localPath, enabled };
    }
}

module.exports = { APPLIED_MAP_BALANCING_FILE, readAppliedMapBalancingSnapshotSync, AppliedMapBalancingService };
