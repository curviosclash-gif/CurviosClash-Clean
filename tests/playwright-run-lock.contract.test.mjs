import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { test } from 'node:test';

import {
    PLAYWRIGHT_RUN_LOCK_ENV,
    PLAYWRIGHT_RUN_LOCK_HOLDER_ENV,
    acquirePlaywrightRunLock,
    readPlaywrightRunLock,
    resolvePlaywrightRunLockPath,
} from '../scripts/playwright-run-lock.mjs';

function createLockPath(name) {
    return path.join(os.tmpdir(), `curviosclash-lock-test-${process.pid}-${name}-${Date.now().toString(36)}.lock`);
}

function cleanup(lockPath) {
    try { fs.unlinkSync(lockPath); } catch { /* already gone */ }
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
