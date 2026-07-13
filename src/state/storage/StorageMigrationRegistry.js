function normalizeKey(value) {
    const normalized = typeof value === 'string' ? value.trim() : '';
    return normalized;
}

function createStorageMigrationResult(source = {}) {
    const payload = /** @type {Record<string, any>} */ (
        source && typeof source === 'object' ? source : {}
    );
    return Object.freeze({
        primaryKey: normalizeKey(payload.primaryKey),
        sourceKey: normalizeKey(payload.sourceKey),
        attempted: payload.attempted === true,
        migrated: payload.migrated === true,
        ok: payload.ok === true,
        writeOk: payload.writeOk === true,
        removeOk: payload.removeOk === true,
        status: normalizeKey(payload.status) || 'idle',
        reason: normalizeKey(payload.reason) || 'ok',
    });
}

export class StorageMigrationRegistry {
    constructor(options = {}) {
        this.driver = options.driver || null;
    }

    resolve(primaryKey, legacyKeys = []) {
        const normalizedPrimaryKey = normalizeKey(primaryKey);
        if (!normalizedPrimaryKey || !this.driver) return null;

        const candidates = [
            normalizedPrimaryKey,
            ...legacyKeys.map((entry) => normalizeKey(entry)).filter((entry) => entry.length > 0),
        ];
        for (const candidate of candidates) {
            const result = this.driver.readRaw(candidate);
            if (!result.ok || typeof result.value !== 'string' || result.value.length === 0) {
                continue;
            }
            return {
                key: candidate,
                raw: result.value,
                migrated: candidate !== normalizedPrimaryKey,
            };
        }
        return null;
    }

    migrate(primaryKey, resolvedEntry) {
        const normalizedPrimaryKey = normalizeKey(primaryKey);
        const sourceKey = normalizeKey(resolvedEntry?.key);
        if (!normalizedPrimaryKey || !resolvedEntry || !this.driver) {
            return createStorageMigrationResult({
                primaryKey: normalizedPrimaryKey,
                sourceKey,
                status: 'idle',
                reason: 'missing_migration_context',
                ok: true,
            });
        }
        if (sourceKey === normalizedPrimaryKey) {
            return createStorageMigrationResult({
                primaryKey: normalizedPrimaryKey,
                sourceKey,
                status: 'current_key',
                reason: 'already_current',
                ok: true,
            });
        }
        const write = this.driver.writeRaw(normalizedPrimaryKey, resolvedEntry.raw);
        if (!write.ok) {
            return createStorageMigrationResult({
                primaryKey: normalizedPrimaryKey,
                sourceKey,
                attempted: true,
                status: 'write_failed',
                reason: write.reason,
                writeOk: false,
                removeOk: false,
                ok: false,
            });
        }
        const remove = this.driver.remove(resolvedEntry.key);
        return createStorageMigrationResult({
            primaryKey: normalizedPrimaryKey,
            sourceKey,
            attempted: true,
            migrated: remove.ok,
            writeOk: true,
            removeOk: remove.ok,
            status: remove.ok ? 'migrated' : 'remove_failed',
            reason: remove.reason,
            ok: remove.ok,
        });
    }
}
