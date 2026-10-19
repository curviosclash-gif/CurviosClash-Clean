import { areCanonicalJsonValuesEqual } from '../../shared/utils/CanonicalJson.js';

export const SNAPSHOT_CAS_MAX_RETRIES = 6;

const SNAPSHOT_LOCK_LEASE_MS = 1500;
const SNAPSHOT_LOCK_SUFFIX = '.lock';
export const SNAPSHOT_NOOP = Symbol('multiplayer_snapshot_noop');

function createStorageLobbyLockStorageKey(createLobbyStorageKey, lobbyCode) {
    const storageKey = createLobbyStorageKey(lobbyCode);
    return storageKey ? `${storageKey}${SNAPSHOT_LOCK_SUFFIX}` : '';
}

export function acquireStorageLobbySnapshotLock(options = {}) {
    const storage = options.storage;
    const lobbyCode = options.lobbyCode;
    if (!storage?.getItem || !storage?.setItem || !lobbyCode) return null;

    const lockStorageKey = createStorageLobbyLockStorageKey(options.createLobbyStorageKey, lobbyCode);
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

export function releaseStorageLobbySnapshotLock(options = {}) {
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

function toJsonValue(value) {
    if (value === undefined) return null;
    try {
        return JSON.parse(JSON.stringify(value));
    } catch {
        return undefined;
    }
}

/** Compares two values the way they survive a localStorage round trip (key order and undefined ignored). */
export function areStorageLobbyJsonValuesEqual(left, right) {
    const leftJson = toJsonValue(left);
    const rightJson = toJsonValue(right);
    if (leftJson === undefined || rightJson === undefined) return false;
    return areCanonicalJsonValuesEqual(leftJson, rightJson);
}

function readRevision(snapshot) {
    return Math.max(0, Math.floor(Number(snapshot?.revision) || 0));
}

function isConfirmedWrite(readback, writtenSnapshot, expectedNextRevision) {
    if (!readback.raw || readRevision(writtenSnapshot) !== expectedNextRevision) return false;
    let storedValue = null;
    try {
        storedValue = JSON.parse(readback.raw);
    } catch {
        return false;
    }
    return readRevision(storedValue) === expectedNextRevision
        && areStorageLobbyJsonValuesEqual(storedValue, writtenSnapshot);
}

/** True when a successful read shows exactly `writtenSnapshot` (or a missing key for a delete). */
export function isStorageLobbyWriteVisible(record, writtenSnapshot) {
    if (!record?.ok) return false;
    if (!writtenSnapshot) return record.raw === null;
    return isConfirmedWrite(record, writtenSnapshot, readRevision(writtenSnapshot));
}

/**
 * Writes under the lobby lock and reports `ok` only when the readback is exactly this write: the
 * expected next revision with identical content, or a missing key for a delete. localStorage has no
 * cross-tab transaction; the lease plus this readback only catch lost writes and foreign writes this
 * tab can already see. A thrown readback leaves the outcome open (`unconfirmed`).
 */
export function persistStorageLobbySnapshotWithCas(options = {}) {
    const lobbyCode = options.normalizeLobbyCode(options.lobbyCode || options.snapshot?.lobbyCode || '', '');
    const failed = { ok: false, conflict: false, snapshot: null };
    if (!lobbyCode) return failed;

    const expectedRevision = Math.max(0, Math.floor(Number(options.expectedRevision) || 0));
    const latest = options.readSnapshotRecord(lobbyCode);
    if (!latest?.ok) return failed;
    if (readRevision(latest.snapshot) !== expectedRevision) {
        return { ok: false, conflict: true, snapshot: latest.snapshot };
    }

    let writtenSnapshot = null;
    try {
        writtenSnapshot = options.writeSnapshot(options.snapshot, {
            previousLobbyCode: lobbyCode,
            expectedRevision,
        });
    } catch {
        return failed;
    }
    if (writtenSnapshot && readRevision(writtenSnapshot) !== expectedRevision + 1) return failed;

    const readback = options.readSnapshotRecord(lobbyCode);
    if (!readback?.ok) return { ok: false, conflict: false, unconfirmed: true, snapshot: writtenSnapshot };
    if (!isStorageLobbyWriteVisible(readback, writtenSnapshot)) {
        return { ok: false, conflict: true, snapshot: readback.snapshot };
    }
    return {
        ok: true,
        conflict: false,
        snapshot: writtenSnapshot,
    };
}
