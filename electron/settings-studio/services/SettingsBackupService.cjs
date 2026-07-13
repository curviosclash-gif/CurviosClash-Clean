const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_BACKUPS = 30;
const PROTECTED_RECENT = 3;

function createTimestampLabel() {
    return new Date()
        .toISOString()
        .replaceAll(':', '-')
        .replaceAll('.', '-');
}

function parseCreatedAtFromFileName(fileName) {
    const match = String(fileName || '').match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
    if (!match) return 0;
    const normalized = `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`;
    return Date.parse(normalized) || 0;
}

function sanitizeBackupFileName(fileName) {
    const normalized = String(fileName || '').trim();
    if (!normalized) return '';
    if (normalized.includes('/') || normalized.includes('\\')) return '';
    if (!normalized.endsWith('.json')) return '';
    return normalized;
}

class SettingsBackupService {
    constructor({ app }) {
        this.app = app;
        this.backupDirName = 'settings-studio-backups';
    }

    getBackupDirectoryPath() {
        return path.join(this.app.getPath('userData'), this.backupDirName);
    }

    async ensureBackupDirectory() {
        await fs.mkdir(this.getBackupDirectoryPath(), { recursive: true });
    }

    async pruneOldBackups() {
        const dirPath = this.getBackupDirectoryPath();
        let entries;
        try {
            entries = await fs.readdir(dirPath, { withFileTypes: true });
        } catch {
            return { pruned: 0 };
        }

        const allBackups = entries
            .filter((e) => e.isFile() && e.name.endsWith('.json'))
            .map((e) => ({ name: e.name, createdAt: parseCreatedAtFromFileName(e.name) }))
            .sort((a, b) => b.createdAt - a.createdAt);

        if (allBackups.length <= MAX_BACKUPS) return { pruned: 0 };

        const protectedCount = Math.max(PROTECTED_RECENT, 0);
        const pruneStart = Math.max(protectedCount, MAX_BACKUPS);
        const toDelete = allBackups.slice(pruneStart);

        let pruned = 0;
        for (const backup of toDelete) {
            try {
                await fs.rm(path.join(dirPath, backup.name), { force: true });
                pruned++;
            } catch {
                // skip individual prune failures — do not throw
            }
        }
        return { pruned, total: allBackups.length };
    }

    async createBackup({ content, reason = 'save' }) {
        await this.ensureBackupDirectory();
        const timestamp = createTimestampLabel();
        const safeReason = String(reason || 'save')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-|-$/g, '') || 'save';
        const fileName = `menu-defaults.override.${timestamp}.${safeReason}.json`;
        const targetPath = path.join(this.getBackupDirectoryPath(), fileName);

        let writeError = null;
        try {
            await fs.writeFile(targetPath, String(content || ''), 'utf-8');
        } catch (err) {
            writeError = err instanceof Error ? err.message : String(err);
            throw new Error(`Backup-Erstellung fehlgeschlagen: ${writeError}`);
        }

        await this.pruneOldBackups().catch(() => null);

        return {
            fileName,
            path: targetPath,
            createdAt: Date.now(),
        };
    }

    async listBackups({ limit = 20 } = {}) {
        await this.ensureBackupDirectory();
        const dirPath = this.getBackupDirectoryPath();
        const entries = await fs.readdir(dirPath, { withFileTypes: true });
        const allBackups = entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
            .map((entry) => ({
                fileName: entry.name,
                path: path.join(dirPath, entry.name),
                createdAt: parseCreatedAtFromFileName(entry.name),
            }))
            .sort((left, right) => {
                const createdAtDiff = right.createdAt - left.createdAt;
                if (createdAtDiff !== 0) return createdAtDiff;
                return String(right.fileName || '').localeCompare(String(left.fileName || ''));
            });

        const totalCount = allBackups.length;
        const backups = allBackups.slice(0, Math.max(1, Number(limit) || 20));

        return {
            backups,
            retentionInfo: {
                maxBackups: MAX_BACKUPS,
                totalCount,
                protectedRecent: PROTECTED_RECENT,
            },
        };
    }

    async readBackupFile(fileName) {
        const safeName = sanitizeBackupFileName(fileName);
        if (!safeName) {
            throw new Error('Ungueltiger Backup-Dateiname.');
        }
        const filePath = path.join(this.getBackupDirectoryPath(), safeName);
        return fs.readFile(filePath, 'utf-8');
    }
}

module.exports = {
    SettingsBackupService,
};
