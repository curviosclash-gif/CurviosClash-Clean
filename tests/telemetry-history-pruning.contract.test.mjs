// Belegt, dass Testserien und unbediente Fenster echte Runden nicht aus der
// Rundenhistorie draengen. Eine einzige Serie von 61 automatischen Runden
// schob bisher genauso viele echte Runden aus dem Speicher.

import assert from 'node:assert/strict';
import test from 'node:test';

import { selectTelemetryPruneIds } from '../src/state/telemetry/TelemetryHistoryPruning.js';
import { TelemetryHistoryStore } from '../src/state/TelemetryHistoryStore.js';

function rows(sources) {
    return sources.map((source, index) => ({ id: index + 1, control: source ? { source } : undefined }));
}

function createFakeIndexedDb({ addFailures = [], pruneFailures = [], initialRows = [], openFailureSequence = null } = {}) {
    const storedRows = initialRows.map((entry) => structuredClone(entry));
    const stats = {
        addAttempts: 0,
        committedAdds: 0,
        pruneReads: 0,
        deletedIds: [],
        openCount: 0,
        closeCount: 0,
    };

    const createDatabase = () => ({
        objectStoreNames: { contains: () => false },
        createObjectStore() { return { createIndex() {} }; },
        close() { stats.closeCount += 1; },
        transaction() {
            const transaction = { error: null };
            transaction.objectStore = () => ({
                add(entry) {
                    const failureName = addFailures[stats.addAttempts];
                    stats.addAttempts += 1;
                    setTimeout(() => {
                        if (failureName) {
                            transaction.error = Object.assign(new Error(failureName), { name: failureName });
                            transaction.onabort?.();
                            return;
                        }
                        const id = storedRows.reduce((largest, row) => Math.max(largest, row.id || 0), 0) + 1;
                        storedRows.push({ ...structuredClone(entry), id });
                        stats.committedAdds += 1;
                        transaction.oncomplete?.();
                    }, 0);
                    return {};
                },
                getAll() {
                    stats.pruneReads += 1;
                    const request = {};
                    const failureName = pruneFailures[stats.pruneReads - 1];
                    setTimeout(() => {
                        request.result = storedRows.map((entry) => structuredClone(entry));
                        request.onsuccess?.();
                        if (failureName) {
                            transaction.error = Object.assign(new Error(failureName), { name: failureName });
                            transaction.onabort?.();
                        } else {
                            transaction.oncomplete?.();
                        }
                    }, 0);
                    return request;
                },
                delete(id) {
                    stats.deletedIds.push(id);
                    const index = storedRows.findIndex((entry) => entry.id === id);
                    if (index !== -1) storedRows.splice(index, 1);
                },
                count() { return { result: storedRows.length }; },
                clear() { storedRows.length = 0; },
            });
            return transaction;
        },
    });

    return {
        indexedDB: {
            open() {
                stats.openCount += 1;
                const request = {};
                if (openFailureSequence) {
                    setTimeout(() => {
                        if (openFailureSequence === 'blocked') {
                            request.onblocked?.();
                        } else {
                            request.error = Object.assign(new Error('open-failed'), { name: 'UnknownError' });
                            request.onerror?.();
                        }
                    }, 0);
                    setTimeout(() => {
                        request.result = createDatabase();
                        request.onsuccess?.();
                    }, 1);
                    return request;
                }
                setTimeout(() => {
                    request.result = createDatabase();
                    request.onupgradeneeded?.({ target: { result: request.result } });
                    request.onsuccess?.();
                }, 0);
                return request;
            },
        },
        rows: storedRows,
        stats,
    };
}

async function withFakeIndexedDb(fake, run) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
    Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        enumerable: previous?.enumerable ?? true,
        writable: true,
        value: fake.indexedDB,
    });
    try {
        return await run();
    } finally {
        if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
        else Reflect.deleteProperty(globalThis, 'indexedDB');
    }
}

test('machine rounds keep their own small budget and leave real rounds alone', () => {
    const history = rows([
        ...Array.from({ length: 5 }, () => 'human'),
        ...Array.from({ length: 8 }, () => 'automation'),
        ...Array.from({ length: 2 }, () => 'idle'),
    ]);
    const dropped = selectTelemetryPruneIds(history, { maxEntries: 50, maxMachineEntries: 4, pruneBatch: 2 });
    // Zehn Maschinenrunden, vier duerfen bleiben: die sechs aeltesten fallen weg.
    assert.deepEqual(dropped, [6, 7, 8, 9, 10, 11]);
});

test('the overall limit removes machine rounds before any real round', () => {
    const history = rows(['human', 'automation', 'human', 'idle', 'human', 'human']);
    const dropped = selectTelemetryPruneIds(history, { maxEntries: 4, maxMachineEntries: 10, pruneBatch: 0 });
    assert.deepEqual(dropped, [2, 4]);
});

test('without machine rounds the oldest real rounds go first, as before', () => {
    const history = rows(['human', undefined, 'human', 'human', 'human']);
    const dropped = selectTelemetryPruneIds(history, { maxEntries: 3, maxMachineEntries: 10, pruneBatch: 1 });
    // Altdaten ohne Steuerungsblock zaehlen als echte Runden, nie als Maschine.
    assert.deepEqual(dropped, [1, 2, 3]);
});

test('nothing is dropped while every budget holds', () => {
    const history = rows(['human', 'automation', 'idle']);
    assert.deepEqual(selectTelemetryPruneIds(history, { maxEntries: 10, maxMachineEntries: 5, pruneBatch: 2 }), []);
    assert.deepEqual(selectTelemetryPruneIds([], {}), []);
});

test('a retryable post-commit prune failure does not add the same round twice or reject', async () => {
    for (const pruneFailure of ['AbortError', 'QuotaExceededError']) {
        const fake = createFakeIndexedDb({ pruneFailures: [pruneFailure] });
        await withFakeIndexedDb(fake, async () => {
            const store = new TelemetryHistoryStore();
            const unhandled = [];
            const onUnhandled = (error) => unhandled.push(error);
            process.on('unhandledRejection', onUnhandled);
            let result;
            try {
                result = await store.recordRound({ mode: 'classic', at: 123, control: { source: 'human' } });
                await new Promise((resolve) => setTimeout(resolve, 0));
            } finally {
                process.removeListener('unhandledRejection', onUnhandled);
            }

            assert.equal(result, true, `${pruneFailure}: the round was already committed`);
            assert.equal(fake.stats.addAttempts, 1, `${pruneFailure}: add is never retried after commit`);
            assert.equal(fake.stats.committedAdds, 1);
            assert.equal(fake.stats.pruneReads, 2, `${pruneFailure}: the prune retries without replaying add`);
            assert.equal(unhandled.length, 0);
            assert.equal(fake.rows.length, 1);
        });
    }
});

test('a genuine pre-commit add abort is retried and commits one round', async () => {
    const fake = createFakeIndexedDb({ addFailures: ['AbortError'] });
    await withFakeIndexedDb(fake, async () => {
        const store = new TelemetryHistoryStore();
        const result = await store.recordRound({ mode: 'classic', at: 456, control: { source: 'human' } });

        assert.equal(result, true);
        assert.equal(fake.stats.addAttempts, 2);
        assert.equal(fake.stats.committedAdds, 1);
        assert.equal(fake.stats.pruneReads, 1);
        assert.equal(fake.rows.length, 1);
    });
});

async function assertLateDatabaseOpenIsClosed(openFailureSequence) {
    const fake = createFakeIndexedDb({ openFailureSequence });
    await withFakeIndexedDb(fake, async () => {
        const store = new TelemetryHistoryStore();
        const result = await store.recordRound({ mode: 'classic', at: 789, control: { source: 'human' } });
        await new Promise((resolve) => setTimeout(resolve, 5));

        assert.equal(result, false, `${openFailureSequence}: rejected open cannot become a successful add`);
        assert.equal(fake.stats.openCount, 1, `${openFailureSequence}: late success must not trigger retry`);
        assert.equal(fake.stats.closeCount, 1, `${openFailureSequence}: late connection is closed exactly once`);
        assert.equal(fake.stats.addAttempts, 0);
        assert.equal(fake.stats.committedAdds, 0);
        assert.equal(fake.stats.pruneReads, 0);
    });
}

test('a late database open after a blocked open is closed without adding or retrying', async () => {
    await assertLateDatabaseOpenIsClosed('blocked');
});

test('a late database open after an open error is closed without adding or retrying', async () => {
    await assertLateDatabaseOpenIsClosed('error');
});

test('exhausted post-commit prune retries still resolve the committed round without replay', async () => {
    for (const pruneFailure of ['AbortError', 'QuotaExceededError']) {
        const fake = createFakeIndexedDb({ pruneFailures: Array(3).fill(pruneFailure) });
        await withFakeIndexedDb(fake, async () => {
            const store = new TelemetryHistoryStore();
            const unhandled = [];
            const onUnhandled = (error) => unhandled.push(error);
            process.on('unhandledRejection', onUnhandled);
            let result;
            try {
                result = await store.recordRound({ mode: 'classic', at: 654, control: { source: 'human' } });
                await new Promise((resolve) => setTimeout(resolve, 0));
            } finally {
                process.removeListener('unhandledRejection', onUnhandled);
            }

            assert.equal(result, true, `${pruneFailure}: the add committed before pruning exhausted retries`);
            assert.equal(fake.stats.addAttempts, 1);
            assert.equal(fake.stats.committedAdds, 1);
            assert.equal(fake.stats.pruneReads, 3);
            assert.equal(fake.rows.length, 1);
            assert.equal(unhandled.length, 0);
        });
    }
});

test('recordRound still prunes the machine budget below the overall history cap', async () => {
    const initialRows = Array.from({ length: 100 }, (_, index) => ({
        id: index + 1,
        control: { source: 'automation' },
    }));
    const fake = createFakeIndexedDb({ initialRows });
    await withFakeIndexedDb(fake, async () => {
        const store = new TelemetryHistoryStore();
        const result = await store.recordRound({ mode: 'classic', at: 789, control: { source: 'automation' } });

        assert.equal(result, true);
        assert.equal(fake.stats.pruneReads, 1, 'machine limits are checked even below 500 total rows');
        assert.deepEqual(fake.stats.deletedIds, [1], 'the oldest machine round leaves first');
        assert.equal(fake.rows.length, 100);
        assert.equal(fake.stats.closeCount, 0, 'a successful open stays owned by the store');
    });
});
