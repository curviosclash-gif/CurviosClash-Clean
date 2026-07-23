import fs from 'node:fs';

export function createMemoryStoragePlatform(initialRecords = {}, options = {}) {
    const records = new Map(Object.entries(initialRecords));
    const writeJson = typeof options.writeJson === 'function'
        ? options.writeJson
        : (key, value) => {
            records.set(key, value);
            return { ok: true, reason: 'ok', quotaExceeded: false };
        };
    return {
        driver: { storage: null },
        readJson(key, legacyKeys = [], fallback = null) {
            const candidates = [key, ...(Array.isArray(legacyKeys) ? legacyKeys : [])];
            for (const candidate of candidates) {
                if (!records.has(candidate)) continue;
                return records.get(candidate);
            }
            return fallback;
        },
        writeJson(key, value) {
            return writeJson(key, value, records);
        },
        getRecord(key) {
            return records.get(key);
        },
    };
}

export function createOwnerAccessContext(overrides = {}) {
    return {
        ownerId: 'owner',
        actorId: 'owner',
        isOwner: true,
        developerModeVisibility: 'owner_only',
        developerModeEnabled: true,
        releasePreviewEnabled: false,
        expertModeUnlocked: true,
        expertModeAvailable: true,
        expertModeAccessMode: 'owner_only',
        expertModeReason: '',
        expertModeProductSurfaceId: 'desktop-app',
        ...overrides,
    };
}

export function createMemoryBrowserStorage(initialRecords = {}) {
    const records = new Map(
        Object.entries(initialRecords).map(([key, value]) => [key, String(value)])
    );
    return {
        getItem(key) {
            return records.has(key) ? records.get(key) : null;
        },
        setItem(key, value) {
            records.set(String(key), String(value));
        },
        removeItem(key) {
            records.delete(String(key));
        },
        clear() {
            records.clear();
        },
    };
}

export function withMockLocalStorage(run) {
    const previous = globalThis.localStorage;
    globalThis.localStorage = createMemoryBrowserStorage();
    try {
        return run();
    } finally {
        if (typeof previous === 'undefined') {
            delete globalThis.localStorage;
        } else {
            globalThis.localStorage = previous;
        }
    }
}

export function readProductiveSourceFiles(rootUrl, relativePath = '') {
    const directoryUrl = new URL(`../src/${relativePath}`, rootUrl);
    const entries = fs.readdirSync(directoryUrl, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
        const entryPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            files.push(...readProductiveSourceFiles(rootUrl, entryPath));
            continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        if (entryPath === 'core/SettingsManager.js') continue;
        files.push(entryPath);
    }
    return files;
}
