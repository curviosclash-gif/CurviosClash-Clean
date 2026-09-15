import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';

import {
    PLAYWRIGHT_RUN_LOCK_DEFAULT_WAIT_MS,
    PLAYWRIGHT_RUN_LOCK_ENV,
    PLAYWRIGHT_RUN_LOCK_HOLDER_ENV,
    PLAYWRIGHT_RUN_LOCK_TIMEOUT_EXIT_CODE,
    acquirePlaywrightRunLock,
    enqueuePlaywrightRunLockTicket,
    readPlaywrightRunLock,
    readPlaywrightRunLockQueue,
    resolvePlaywrightRunLockPath,
    resolvePlaywrightRunLockQueueDir,
} from '../scripts/playwright-run-lock.mjs';

function createLockPath(name) {
    return path.join(os.tmpdir(), `curviosclash-lock-test-${process.pid}-${name}-${Date.now().toString(36)}.lock`);
}

function cleanup(lockPath) {
    try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
    try { fs.rmSync(resolvePlaywrightRunLockQueueDir(lockPath), { recursive: true, force: true }); } catch { /* already gone */ }
}

const noSleep = async () => {};
const quietLog = () => {};

test('playwright lock: acquiring writes the holder, releasing removes the file', async () => {
    const lockPath = createLockPath('acquire');
    const env = {};
    try {
        const lock = await acquirePlaywrightRunLock({ label: 'desktop-e2e core-shell', env, lockPath, log: quietLog });
        assert.equal(lock.acquired, true);
        assert.equal(lock.inherited, false);
        const holder = readPlaywrightRunLock(lockPath);
        assert.equal(holder.pid, process.pid);
        assert.equal(holder.label, 'desktop-e2e core-shell');
        assert.equal(env[PLAYWRIGHT_RUN_LOCK_HOLDER_ENV], String(process.pid), 'children inherit the holder pid');

        lock.release();
        assert.equal(fs.existsSync(lockPath), false);
        assert.equal(PLAYWRIGHT_RUN_LOCK_HOLDER_ENV in env, false);
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: a child of the holder inherits instead of waiting', async () => {
    const lockPath = createLockPath('inherit');
    const env = { [PLAYWRIGHT_RUN_LOCK_HOLDER_ENV]: String(process.pid) };
    try {
        fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, label: 'parent cluster' }));
        const lock = await acquirePlaywrightRunLock({ label: 'child spec', env, lockPath, waitMs: 20, pollMs: 5, sleep: noSleep, log: quietLog });
        assert.equal(lock.acquired, true);
        assert.equal(lock.inherited, true);
        lock.release();
        assert.equal(fs.existsSync(lockPath), true, 'the child must not remove the parent lock');
        assert.equal(readPlaywrightRunLock(lockPath).label, 'parent cluster');
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: a stale lock of a dead process is taken over', async () => {
    const lockPath = createLockPath('stale');
    const env = {};
    try {
        fs.writeFileSync(lockPath, JSON.stringify({ pid: 999999999, label: 'crashed run' }));
        const lock = await acquirePlaywrightRunLock({ label: 'fresh run', env, lockPath, waitMs: 20, pollMs: 5, sleep: noSleep, log: quietLog });
        assert.equal(lock.acquired, true);
        assert.equal(readPlaywrightRunLock(lockPath).label, 'fresh run');
        lock.release();
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: a live holder makes the next run wait and finally time out', async () => {
    const lockPath = createLockPath('busy');
    const env = {};
    const messages = [];
    try {
        fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, label: 'other session desktop-flows', startedAt: '2026-09-14T18:28:00.000Z' }));
        // A fake clock keeps the test independent of how slow the disk is under load.
        let clock = 1_000_000;
        let polls = 0;
        await assert.rejects(
            acquirePlaywrightRunLock({
                label: 'my physics-core',
                env,
                lockPath,
                waitMs: 30,
                pollMs: 10,
                now: () => clock,
                sleep: async (ms) => { polls += 1; clock += ms; },
                log: (message) => messages.push(message),
            }),
            /other session desktop-flows/
        );
        assert.equal(polls, 3, `expected three polls of 10 ms inside a 30 ms window, polled ${polls}x`);
        assert.ok(messages.some((message) => message.includes('waiting')), 'the wait is reported');
        assert.equal(readPlaywrightRunLock(lockPath).label, 'other session desktop-flows', 'the live lock stays untouched');
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: the lock can be switched off per environment', async () => {
    const lockPath = createLockPath('disabled');
    const env = { [PLAYWRIGHT_RUN_LOCK_ENV]: '0' };
    try {
        fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, label: 'busy' }));
        const lock = await acquirePlaywrightRunLock({ label: 'unlocked run', env, lockPath, waitMs: 20, pollMs: 5, sleep: noSleep, log: quietLog });
        assert.equal(lock.acquired, true);
        assert.equal(lock.disabled, true);
        lock.release();
        assert.equal(readPlaywrightRunLock(lockPath).label, 'busy');
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: the default path lives in the temp folder and can be overridden', () => {
    assert.equal(path.dirname(resolvePlaywrightRunLockPath({})), os.tmpdir());
    assert.equal(resolvePlaywrightRunLockPath({ CURVIOS_PLAYWRIGHT_LOCK_PATH: 'X:\\custom.lock' }), 'X:\\custom.lock');
});

test('playwright lock: waiting a full window ends in LOCK_TIMEOUT with exit code 75', async () => {
    const lockPath = createLockPath('exitcode');
    const env = {};
    const messages = [];
    try {
        fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, label: 'other session editor' }));
        let clock = 5_000_000;
        const error = await acquirePlaywrightRunLock({
            label: 'my core-surface',
            env,
            lockPath,
            waitMs: 20,
            pollMs: 10,
            now: () => clock,
            sleep: async (ms) => { clock += ms; },
            log: (message) => messages.push(message),
        }).then(() => null, (rejection) => rejection);

        assert.ok(error, 'the wait must reject instead of resolving');
        assert.equal(error.exitCode, PLAYWRIGHT_RUN_LOCK_TIMEOUT_EXIT_CODE);
        assert.equal(PLAYWRIGHT_RUN_LOCK_TIMEOUT_EXIT_CODE, 75, 'EX_TEMPFAIL keeps a lock timeout apart from a test failure');
        const timeoutLine = messages.find((message) => message.includes('LOCK_TIMEOUT'));
        assert.ok(timeoutLine, `expected a LOCK_TIMEOUT line, got ${JSON.stringify(messages)}`);
        assert.match(timeoutLine, /^\[playwright:lock\] LOCK_TIMEOUT holder=other session editor pid=\d+ waited=\d+s$/);
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: the default wait window is two hours', () => {
    assert.equal(PLAYWRIGHT_RUN_LOCK_DEFAULT_WAIT_MS, 120 * 60 * 1000);
});

test('playwright lock: a stale heartbeat frees the lock even while the pid lives', async () => {
    const lockPath = createLockPath('heartbeat');
    const env = {};
    const messages = [];
    try {
        const nowMs = Date.parse('2026-09-15T12:00:00.000Z');
        fs.writeFileSync(lockPath, JSON.stringify({
            pid: process.pid,
            label: 'hung cluster run',
            startedAt: '2026-09-15T10:00:00.000Z',
            heartbeat: '2026-09-15T11:45:00.000Z',
        }));
        const lock = await acquirePlaywrightRunLock({
            label: 'fresh run',
            env,
            lockPath,
            waitMs: 50,
            pollMs: 10,
            now: () => nowMs,
            sleep: noSleep,
            log: (message) => messages.push(message),
        });
        assert.equal(lock.acquired, true);
        assert.equal(readPlaywrightRunLock(lockPath).label, 'fresh run');
        assert.ok(messages.some((message) => message.includes('stale')), 'the takeover is reported');
        lock.release();
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: a fresh heartbeat keeps the lock even for an old run', async () => {
    const lockPath = createLockPath('heartbeat-live');
    const env = {};
    try {
        const nowMs = Date.parse('2026-09-15T12:00:00.000Z');
        fs.writeFileSync(lockPath, JSON.stringify({
            pid: process.pid,
            label: 'long cluster run',
            startedAt: '2026-09-15T09:00:00.000Z',
            heartbeat: '2026-09-15T11:59:40.000Z',
        }));
        let clock = nowMs;
        await assert.rejects(
            acquirePlaywrightRunLock({
                label: 'fresh run',
                env,
                lockPath,
                waitMs: 20,
                pollMs: 10,
                now: () => clock,
                sleep: async (ms) => { clock += ms; },
                log: quietLog,
            }),
            /long cluster run/
        );
        assert.equal(readPlaywrightRunLock(lockPath).label, 'long cluster run');
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: the holder writes a heartbeat into the lock file', async () => {
    const lockPath = createLockPath('beat-write');
    const env = {};
    try {
        const lock = await acquirePlaywrightRunLock({
            label: 'beating run',
            env,
            lockPath,
            heartbeatMs: 5,
            log: quietLog,
        });
        const first = readPlaywrightRunLock(lockPath);
        assert.ok(Number.isFinite(Date.parse(String(first.heartbeat))), 'the lock carries a heartbeat from the start');
        await new Promise((resolve) => setTimeout(resolve, 30));
        const second = readPlaywrightRunLock(lockPath);
        assert.ok(
            Date.parse(String(second.heartbeat)) > Date.parse(String(first.heartbeat)),
            'the heartbeat moves forward while the run holds the lock'
        );
        lock.release();
        const afterRelease = readPlaywrightRunLock(lockPath);
        assert.equal(afterRelease, null, 'releasing removes the lock and stops the heartbeat');
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: an older live waiter goes first (FIFO)', async () => {
    const lockPath = createLockPath('fifo');
    const queueDir = resolvePlaywrightRunLockQueueDir(lockPath);
    const env = {};
    const messages = [];
    try {
        enqueuePlaywrightRunLockTicket(queueDir, { pid: 4242, label: 'earlier session desktop-flows', enqueuedAt: 1_000 });
        let clock = 2_000_000;
        await assert.rejects(
            acquirePlaywrightRunLock({
                label: 'my core-shell',
                env,
                lockPath,
                waitMs: 20,
                pollMs: 10,
                now: () => clock,
                sleep: async (ms) => { clock += ms; },
                log: (message) => messages.push(message),
                isAlive: () => true,
            }),
            /earlier session desktop-flows/
        );
        assert.equal(fs.existsSync(lockPath), false, 'the free lock stays free while an older waiter is ahead');
        const waitLine = messages.find((message) => message.includes('waiting'));
        assert.ok(waitLine, `expected a waiting line, got ${JSON.stringify(messages)}`);
        assert.match(waitLine, /position 2 of 2/);
        assert.equal(readPlaywrightRunLockQueue(queueDir, { isAlive: () => true }).length, 1, 'our own ticket is cleaned up');
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: tickets of dead waiters are skipped and removed', async () => {
    const lockPath = createLockPath('fifo-dead');
    const queueDir = resolvePlaywrightRunLockQueueDir(lockPath);
    const env = {};
    try {
        enqueuePlaywrightRunLockTicket(queueDir, { pid: 999_999_999, label: 'killed session', enqueuedAt: 1_000 });
        const lock = await acquirePlaywrightRunLock({
            label: 'fresh run',
            env,
            lockPath,
            waitMs: 200,
            pollMs: 5,
            sleep: noSleep,
            log: quietLog,
        });
        assert.equal(lock.acquired, true, 'a dead ticket must not block the queue');
        assert.equal(readPlaywrightRunLockQueue(queueDir).length, 0, 'dead tickets are removed from the queue');
        lock.release();
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: acquiring leaves no ticket behind', async () => {
    const lockPath = createLockPath('queue-clean');
    const queueDir = resolvePlaywrightRunLockQueueDir(lockPath);
    const env = {};
    try {
        const lock = await acquirePlaywrightRunLock({ label: 'clean run', env, lockPath, log: quietLog });
        assert.equal(readPlaywrightRunLockQueue(queueDir).length, 0);
        lock.release();
    } finally {
        cleanup(lockPath);
    }
});
