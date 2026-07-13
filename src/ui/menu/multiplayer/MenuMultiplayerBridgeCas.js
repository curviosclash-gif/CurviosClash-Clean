export const SNAPSHOT_CAS_MAX_RETRIES = 6;
const SNAPSHOT_LOCK_LEASE_MS = 1500;
const SNAPSHOT_LOCK_SUFFIX = '.lock';
export const SNAPSHOT_NOOP = Symbol('multiplayer_snapshot_noop');

function createLobbyLockStorageKey(createLobbyStorageKey, lobbyCode) {
    const storageKey = createLobbyStorageKey(lobbyCode);
    return storageKey ? `${storageKey}${SNAPSHOT_LOCK_SUFFIX}` : '';
}

export function acquireMenuMultiplayerSnapshotLock(options = {}) {
    const storage = options.storage;
    const lobbyCode = options.lobbyCode;
    if (!storage?.getItem || !storage?.setItem || !lobbyCode) return null;

    const lockStorageKey = createLobbyLockStorageKey(options.createLobbyStorageKey, lobbyCode);
    if (!lockStorageKey) return null;

    const ownerToken = `${options.peerId}:${options.buildRuntimeId(options.nowProvider, options.randomProvider, 5)}`;
    for (let attempt = 0; attempt < SNAPSHOT_CAS_MAX_RETRIES; attempt += 1) {
        const now = options.nowProvider();
        let activeLease = null;
        try {
            activeLease = JSON.parse(storage.getItem(lockStorageKey) || 'null');
        } catch {
            activeLease = null;
        }
        const activeOwnerToken = options.normalizeString(activeLease?.ownerToken, '');
        const activeExpiresAt = options.toTimestamp(activeLease?.expiresAt, 0);
        if (
            activeOwnerToken
            && activeOwnerToken !== ownerToken
            && activeExpiresAt > now
        ) {
            continue;
        }

        const lease = {
            ownerToken,
            peerId: options.peerId,
            acquiredAt: now,
            expiresAt: now + SNAPSHOT_LOCK_LEASE_MS,
        };
        try {
            storage.setItem(lockStorageKey, JSON.stringify(lease));
        } catch {
            return null;
        }

        try {
            const confirmedLease = JSON.parse(storage.getItem(lockStorageKey) || 'null');
            if (options.normalizeString(confirmedLease?.ownerToken, '') === ownerToken) {
                return {
                    lockStorageKey,
                    ownerToken,
                };
            }
        } catch {
            // Ignore lock verification parse failures and retry.
        }
    }
    return null;
}

export function releaseMenuMultiplayerSnapshotLock(options = {}) {
    const storage = options.storage;
    const lease = options.lease;
    const lockStorageKey = options.normalizeString(lease?.lockStorageKey, '');
    if (!lockStorageKey || !storage?.getItem || !storage?.removeItem) return;
    try {
        const currentLease = JSON.parse(storage.getItem(lockStorageKey) || 'null');
        if (options.normalizeString(currentLease?.ownerToken, '') !== options.normalizeString(lease?.ownerToken, '')) return;
        storage.removeItem(lockStorageKey);
    } catch {
        // Ignore lock release failures.
    }
}

export function persistMenuMultiplayerSnapshotWithCas(options = {}) {
    const lobbyCode = options.normalizeLobbyCode(options.lobbyCode || options.snapshot?.lobbyCode || '', '');
    if (!lobbyCode) return { ok: false, conflict: false, snapshot: null };

    const expectedRevision = Math.max(0, Math.floor(Number(options.expectedRevision) || 0));
    const latestSnapshot = options.getSnapshot(lobbyCode);
    const latestRevision = Math.max(0, Math.floor(Number(latestSnapshot?.revision) || 0));
    if (latestRevision !== expectedRevision) {
        return { ok: false, conflict: true, snapshot: latestSnapshot };
    }

    const persistedSnapshot = options.persistSnapshot(options.snapshot, {
        previousLobbyCode: lobbyCode,
        preserveLobbyCode: options.preserveLobbyCode === true,
        expectedRevision,
    });

    const readbackSnapshot = options.getSnapshot(lobbyCode);
    if (!options.snapshot) {
        if (readbackSnapshot) {
            return { ok: false, conflict: true, snapshot: readbackSnapshot };
        }
        return { ok: true, conflict: false, snapshot: null };
    }

    const expectedNextRevision = expectedRevision + 1;
    const readbackRevision = Math.max(0, Math.floor(Number(readbackSnapshot?.revision) || 0));
    if (readbackRevision < expectedNextRevision) {
        return { ok: false, conflict: true, snapshot: readbackSnapshot };
    }
    return {
        ok: true,
        conflict: false,
        snapshot: persistedSnapshot,
    };
}
