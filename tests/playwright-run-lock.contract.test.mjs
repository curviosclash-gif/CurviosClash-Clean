import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
    isLongPlaywrightRun,
    isPlaywrightRunLockStale,
    orderPlaywrightRunLockQueue,
    readPlaywrightRunLockQueue,
    resolvePlaywrightRunLockPath,
    resolvePlaywrightRunLockQueueDir,
    resolveYieldQueueStamp,
    yieldPlaywrightRunLock,
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

// 28.09.2026: a cluster run in sky-ladder ran for fifty minutes next to the lock holder and
// printed no single [playwright:lock] line. Windows reuses pids, so a leftover holder variable
// that points at any living process used to count as "inherited". Only the pid the lock file
// names may be inherited from, and both bypass branches now say so in the log.
test('playwright lock: a holder variable the lock file does not name is ignored', async () => {
    const lockPath = createLockPath('inherit-foreign');
    const env = { [PLAYWRIGHT_RUN_LOCK_HOLDER_ENV]: String(process.pid) };
    const messages = [];
    try {
        fs.writeFileSync(lockPath, JSON.stringify({ pid: 4545, label: 'other session desktop-flows', heartbeat: new Date().toISOString() }));
        let clock = Date.now();
        const error = await acquirePlaywrightRunLock({
            label: 'my cluster run',
            env,
            lockPath,
            waitMs: 20,
            pollMs: 10,
            now: () => clock,
            sleep: async (ms) => { clock += ms; },
            isAlive: () => true,
            log: (message) => messages.push(message),
        }).then(() => null, (rejection) => rejection);

        assert.ok(error, 'a foreign holder must make us wait, not inherit');
        assert.equal(error.exitCode, 75);
        assert.equal(readPlaywrightRunLock(lockPath).pid, 4545, 'the real holder keeps the lock');
        assert.ok(messages.some((message) => /ignoring CURVIOS_PLAYWRIGHT_LOCK_HOLDER=\d+: the lock names pid 4545/.test(message)), `expected an ignore line, got ${JSON.stringify(messages)}`);
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: a holder variable without any lock file takes the lock normally', async () => {
    const lockPath = createLockPath('inherit-nolock');
    const env = { [PLAYWRIGHT_RUN_LOCK_HOLDER_ENV]: '4646' };
    try {
        const lock = await acquirePlaywrightRunLock({ label: 'fresh run', env, lockPath, isAlive: () => true, log: quietLog });
        assert.equal(lock.inherited, false);
        assert.equal(readPlaywrightRunLock(lockPath).pid, process.pid, 'the run now holds the lock itself');
        assert.equal(env[PLAYWRIGHT_RUN_LOCK_HOLDER_ENV], String(process.pid), 'children inherit from the real holder');
        lock.release();
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: inheriting and switching the lock off are both logged', async () => {
    const lockPath = createLockPath('bypass-log');
    const messages = [];
    const log = (message) => messages.push(message);
    try {
        fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, label: 'parent cluster' }));
        await acquirePlaywrightRunLock({ label: 'child spec', env: { [PLAYWRIGHT_RUN_LOCK_HOLDER_ENV]: String(process.pid) }, lockPath, log });
        await acquirePlaywrightRunLock({ label: 'unlocked run', env: { [PLAYWRIGHT_RUN_LOCK_ENV]: '0' }, lockPath, log });
        assert.ok(messages.some((message) => /^\[playwright:lock\] inherited from pid \d+ for child spec$/.test(message)), JSON.stringify(messages));
        assert.ok(messages.some((message) => /^\[playwright:lock\] DISABLED by CURVIOS_PLAYWRIGHT_LOCK=0 for unlocked run$/.test(message)), JSON.stringify(messages));
    } finally {
        cleanup(lockPath);
    }
});

// 29.09.2026: the lock payload was built when a run started to wait and written unchanged when it
// finally got the lock. After a wait of more than ten minutes the new holder looked hung from its
// first second on, the next waiter removed it as stale within five seconds and both ran at once.
test('playwright lock: a run that waited long writes a fresh heartbeat when it takes the lock', async () => {
    const lockPath = createLockPath('late-acquire');
    const env = {};
    try {
        fs.writeFileSync(lockPath, JSON.stringify({ pid: 4848, label: 'long cluster run', heartbeat: new Date(5_000_000).toISOString() }));
        let clock = 5_000_000;
        let acquiredAt = null;
        const lock = await acquirePlaywrightRunLock({
            label: 'short run after a long wait',
            env,
            lockPath,
            waitMs: 60 * 60 * 1000,
            pollMs: 10,
            now: () => clock,
            // The holder beats until it leaves after fifteen minutes; then the lock is free.
            sleep: async () => {
                clock += 60 * 1000;
                if (clock - 5_000_000 >= 15 * 60 * 1000) {
                    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
                    acquiredAt = clock;
                    return;
                }
                fs.writeFileSync(lockPath, JSON.stringify({ pid: 4848, label: 'long cluster run', heartbeat: new Date(clock).toISOString() }));
            },
            isAlive: () => true,
            heartbeatMs: 60_000,
            log: quietLog,
        });
        const written = readPlaywrightRunLock(lockPath);
        assert.equal(written.pid, process.pid);
        assert.equal(Date.parse(written.heartbeat), acquiredAt, 'the heartbeat is the moment the lock was taken, not the start of the wait');
        assert.equal(Date.parse(written.startedAt), acquiredAt, '"since" names when the run got the lock');
        assert.equal(isPlaywrightRunLockStale(written, acquiredAt + 5_000, { isAlive: () => true }), false, 'the next waiter must not see the new holder as hung');
        lock.release();
    } finally {
        cleanup(lockPath);
    }
});

// 29.09.2026 05:18: a wrapper with the old code (before 71f6b4b6) still wrote its wait start as
// heartbeat when it took the lock; a waiter with the new code removed it as stale at once. The
// file itself was written a moment ago, and every holder rewrites it with each beat, so its
// modification time is a liveness sign that old wrappers give as well.
test('playwright lock: a freshly written lock with an old heartbeat stamp is not taken as stale', async () => {
    const lockPath = createLockPath('old-stamp-fresh-file');
    const env = {};
    try {
        const waitStart = new Date(Date.now() - 35 * 60 * 1000).toISOString();
        fs.writeFileSync(lockPath, JSON.stringify({ pid: 5050, label: 'old wrapper after a long wait', startedAt: waitStart, heartbeat: waitStart }));
        let clock = Date.now();
        const error = await acquirePlaywrightRunLock({
            label: 'new waiter at the head of the queue',
            env,
            lockPath,
            waitMs: 20,
            pollMs: 10,
            now: () => clock,
            sleep: async (ms) => { clock += ms; },
            isAlive: () => true,
            log: quietLog,
        }).then(() => null, (rejection) => rejection);

        assert.ok(error, 'the waiter must keep waiting instead of taking the lock');
        assert.equal(error.exitCode, 75);
        assert.equal(readPlaywrightRunLock(lockPath).pid, 5050, 'the old wrapper keeps its lock');
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: a holder whose lock was taken over says so instead of running on silently', async () => {
    const lockPath = createLockPath('lost-lock');
    const env = {};
    const messages = [];
    try {
        const lock = await acquirePlaywrightRunLock({ label: 'victim run', env, lockPath, heartbeatMs: 5, log: (message) => messages.push(message) });
        fs.writeFileSync(lockPath, JSON.stringify({ pid: 4949, label: 'intruder run', heartbeat: new Date().toISOString() }));
        await new Promise((resolve) => setTimeout(resolve, 40));
        const lostLines = messages.filter((message) => message.includes('LOST'));
        assert.equal(lostLines.length, 1, `expected one LOST line, got ${JSON.stringify(messages)}`);
        assert.match(lostLines[0], /^\[playwright:lock\] LOST the lock of victim run to intruder run \(pid 4949\)/);
        lock.release();
        assert.equal(readPlaywrightRunLock(lockPath).pid, 4949, 'the release must not remove the other run\'s lock');
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
    // realpath: the system temp may be spelled with a short 8.3 name on Windows.
    assert.equal(fs.realpathSync.native(path.dirname(resolvePlaywrightRunLockPath({}))), fs.realpathSync.native(os.tmpdir()));
    assert.equal(resolvePlaywrightRunLockPath({ CURVIOS_PLAYWRIGHT_LOCK_PATH: 'X:\\custom.lock' }), 'X:\\custom.lock');
});

// 29.09.2026: a session redirected TEMP/TMP into its worktree so esbuild could write, and started
// the Playwright wrapper with that environment. The wrapper created a private lock there, saw no
// queue and ran next to the real holder without a single [playwright:lock] line.
test('playwright lock: a redirected TEMP never moves the lock on Windows', { skip: process.platform !== 'win32' }, () => {
    const redirected = 'F:\\worktree\\tmp\\build-temp';
    assert.equal(
        resolvePlaywrightRunLockPath({ TEMP: redirected, TMP: redirected, LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }),
        'C:\\Users\\u\\AppData\\Local\\Temp\\curviosclash-playwright-run.lock'
    );

    const buildTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'lock-build-temp-'));
    try {
        const moduleUrl = new URL('../scripts/playwright-run-lock.mjs', import.meta.url).href;
        const child = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(moduleUrl)}).then((m) => console.log(m.resolvePlaywrightRunLockPath()))`], {
            encoding: 'utf8',
            env: { ...process.env, TEMP: buildTemp, TMP: buildTemp },
        });
        assert.equal(child.status, 0, child.stderr);
        const childLockDir = fs.realpathSync.native(path.dirname(child.stdout.trim()));
        assert.equal(childLockDir, fs.realpathSync.native(path.dirname(resolvePlaywrightRunLockPath())), 'a wrapper started with a redirected TEMP must find the shared lock');
        assert.notEqual(childLockDir, fs.realpathSync.native(buildTemp));
    } finally {
        fs.rmSync(buildTemp, { recursive: true, force: true });
    }
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
        // A hung holder stops rewriting the file too; its last write is its last beat.
        const lastBeat = new Date('2026-09-15T11:45:00.000Z');
        fs.utimesSync(lockPath, lastBeat, lastBeat);
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

// Review finding 16.09.2026: a reader can catch the lock half-written (an older wrapper
// rewrites it in place). Such a file must not count as "dead" while it is fresh.
test('playwright lock: an unreadable but fresh lock file is never stolen', async () => {
    const lockPath = createLockPath('half-written');
    const env = {};
    try {
        fs.writeFileSync(lockPath, ''); // exactly what a truncate-then-write looks like mid-way
        let clock = Date.now();
        await assert.rejects(
            acquirePlaywrightRunLock({
                label: 'fresh run',
                env,
                lockPath,
                waitMs: 20,
                pollMs: 10,
                now: () => clock,
                sleep: async (ms) => { clock += ms; },
                isAlive: () => true,
                log: quietLog,
            }),
            (error) => error.exitCode === 75
        );
        assert.equal(fs.existsSync(lockPath), true, 'the half-written lock survives');
        assert.equal(fs.readFileSync(lockPath, 'utf8'), '', 'and is left untouched');
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: an unreadable lock file older than the heartbeat allowance is taken over', async () => {
    const lockPath = createLockPath('half-written-old');
    const env = {};
    const messages = [];
    try {
        fs.writeFileSync(lockPath, '');
        const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
        fs.utimesSync(lockPath, twentyMinutesAgo, twentyMinutesAgo);
        const lock = await acquirePlaywrightRunLock({
            label: 'fresh run',
            env,
            lockPath,
            waitMs: 50,
            pollMs: 10,
            sleep: noSleep,
            isAlive: () => true,
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

test('playwright lock: a waiter whose ticket vanished re-enters the queue instead of jumping ahead', async () => {
    const lockPath = createLockPath('lost-ticket');
    const queueDir = `${lockPath}.queue`;
    const env = {};
    try {
        fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, label: 'busy run', heartbeat: new Date().toISOString() }));
        // An older waiter is already queued ahead of us.
        fs.mkdirSync(queueDir, { recursive: true });
        fs.writeFileSync(path.join(queueDir, `${'1'.padStart(16, '0')}-${process.pid}.json`), JSON.stringify({ pid: process.pid, label: 'older waiter' }));
        let clock = Date.now();
        let polls = 0;
        await assert.rejects(
            acquirePlaywrightRunLock({
                label: 'late run',
                env,
                lockPath,
                queueDir,
                waitMs: 40,
                pollMs: 10,
                now: () => clock,
                sleep: async (ms) => {
                    clock += ms;
                    polls += 1;
                    // Somebody wipes every ticket of ours between two polls.
                    for (const entry of fs.readdirSync(queueDir)) {
                        if (entry.endsWith(`-${process.pid}.json`) && !entry.startsWith('0000000000000001')) {
                            fs.unlinkSync(path.join(queueDir, entry));
                        }
                    }
                },
                isAlive: () => true,
                log: quietLog,
            }),
            (error) => error.exitCode === 75
        );
        assert.ok(polls >= 2, 'the waiter polled more than once');
        assert.equal(readPlaywrightRunLock(lockPath).label, 'busy run', 'the busy lock was never taken');
    } finally {
        cleanup(lockPath);
        fs.rmSync(queueDir, { recursive: true, force: true });
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

// 28.09.2026: ten stage-2 runs of two minutes each waited up to an hour behind one
// seven-cluster run. A long run now lets the short runs that already wait go first
// between two of its clusters; every run still has the GPU to itself.
test('playwright lock: long runs are recognised by kind and by the labels of older wrappers', () => {
    assert.equal(isLongPlaywrightRun({ kind: 'long', label: 'anything' }), true);
    assert.equal(isLongPlaywrightRun({ label: 'desktop-e2e clusters core-surface,desktop-flows' }), true, 'cluster runner before the kind field');
    assert.equal(isLongPlaywrightRun({ label: 'bot validation' }), true);
    assert.equal(isLongPlaywrightRun({ label: 'desktop-e2e tests/physics-core.spec.js --grep T41:' }), false);
    assert.equal(isLongPlaywrightRun({ kind: 'short', label: 'desktop-e2e clusters editor' }), false, 'an explicit kind wins');
});

// 29.09.2026: six stage-2 runs waited 70 to 85 minutes behind a seven-cluster run, because a second
// cluster run waited at the head of the queue and short runs could only pass the holder, never a
// long waiter. Short runs may now pass a waiting long run too, but each long waiter lets them go
// first for at most thirty minutes in total; after that it is next, so nobody starves.
const NOW = 10_000_000;
const oldShort = (enqueuedAt) => ({ pid: enqueuedAt, enqueuedAt, label: 'desktop-e2e tests/x.spec.js' });
const newShort = (enqueuedAt) => ({ ...oldShort(enqueuedAt), kind: 'short' });
const newLong = (enqueuedAt, overtakenSince) => ({ pid: enqueuedAt, enqueuedAt, label: 'desktop-e2e clusters editor', kind: 'long', overtakenSince });
const pids = (queue) => queue.map((ticket) => ticket.pid);

test('playwright lock: short runs pass a waiting long run until its thirty minutes are used up', () => {
    assert.deepEqual(pids(orderPlaywrightRunLockQueue([newLong(10), newShort(20), newShort(30)], NOW)), [20, 30, 10], 'fresh long waiter: both short runs go first, in their own order');
    assert.deepEqual(pids(orderPlaywrightRunLockQueue([newLong(10, NOW - 29 * 60_000), newShort(20)], NOW)), [20, 10], 'twenty-nine minutes overtaken: one more may pass');
    assert.deepEqual(pids(orderPlaywrightRunLockQueue([newLong(10, NOW - 31 * 60_000), newShort(20)], NOW)), [10, 20], 'thirty minutes used up: the long run is next');
    assert.deepEqual(pids(orderPlaywrightRunLockQueue([newLong(10, NOW - 31 * 60_000), newLong(15), newShort(20)], NOW)), [10, 20, 15], 'a short run never passes a long run whose time is up');
    assert.deepEqual(pids(orderPlaywrightRunLockQueue([newShort(5), newLong(10), newShort(20)], NOW)), [5, 20, 10], 'short runs keep first come, first served among themselves');
});

test('playwright lock: tickets of older wrappers are never overtaken and never overtake', () => {
    // An older wrapper orders by arrival only. If a new short run passed it, each would wait for
    // the other; so only tickets that say kind 'short' pass, and only kind 'long' can be passed.
    const legacyLong = { pid: 10, enqueuedAt: 10, label: 'desktop-e2e clusters editor' };
    assert.deepEqual(pids(orderPlaywrightRunLockQueue([legacyLong, newShort(20)], NOW)), [10, 20]);
    assert.deepEqual(pids(orderPlaywrightRunLockQueue([newLong(10), oldShort(20)], NOW)), [10, 20]);
});

test('playwright lock: the yield stamp lets every short run go first that may pass the long waiters', () => {
    assert.equal(resolveYieldQueueStamp([], NOW), null, 'nobody waits: keep the lock');
    assert.equal(resolveYieldQueueStamp([oldShort(10), oldShort(20)], NOW), 21, 'all waiting short runs go first');
    assert.equal(resolveYieldQueueStamp([newLong(10), newShort(20)], NOW), 9, 'a short run may pass the long waiter, so we yield and queue just before that waiter');
    assert.equal(resolveYieldQueueStamp([newLong(10, NOW - 31 * 60_000), newShort(20)], NOW), null, 'the long waiter is next: keep the lock, it is next anyway');
    assert.equal(resolveYieldQueueStamp([oldShort(10), newLong(15), newShort(20)], NOW), 14, 'we keep our place before the long waiter; the late short run passes both of us');
});

test('playwright lock: a new short run takes the free lock past a fresh long waiter', async () => {
    const lockPath = createLockPath('overtake');
    const queueDir = resolvePlaywrightRunLockQueueDir(lockPath);
    try {
        enqueuePlaywrightRunLockTicket(queueDir, { pid: 6060, label: 'desktop-e2e clusters a,b', kind: 'long', enqueuedAt: Date.now() - 60_000 });
        const lock = await acquirePlaywrightRunLock({ label: 'stage-2 run', env: {}, lockPath, waitMs: 50, pollMs: 5, sleep: noSleep, isAlive: () => true, log: quietLog });
        assert.equal(lock.acquired, true);
        assert.equal(readPlaywrightRunLock(lockPath).pid, process.pid);
        lock.release();
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: a long waiter notes when it is first passed, and a short run waits once its time is up', async () => {
    const lockPath = createLockPath('overtake-budget');
    const queueDir = resolvePlaywrightRunLockQueueDir(lockPath);
    try {
        // A short run arrived after us and takes the lock: we are being passed.
        fs.writeFileSync(lockPath, JSON.stringify({ pid: 7070, label: 'short run', heartbeat: new Date().toISOString() }));
        enqueuePlaywrightRunLockTicket(queueDir, { pid: 7171, label: 'another short run', kind: 'short', enqueuedAt: Date.now() + 60_000 });
        let clock = Date.now();
        let noted = null;
        await assert.rejects(acquirePlaywrightRunLock({
            label: 'waiting cluster run',
            kind: 'long',
            env: {},
            lockPath,
            waitMs: 30,
            pollMs: 10,
            now: () => clock,
            sleep: async (ms) => {
                clock += ms;
                const own = readPlaywrightRunLockQueue(queueDir, { isAlive: () => true }).find((ticket) => ticket.pid === process.pid);
                noted ??= own?.overtakenSince ?? null;
            },
            isAlive: () => true,
            log: quietLog,
        }), (error) => error.exitCode === 75);
        assert.ok(Number.isFinite(noted), 'the long waiter wrote when it was first passed into its ticket');

        // Thirty-one minutes later its time is up: a new short run has to wait behind it.
        enqueuePlaywrightRunLockTicket(queueDir, { pid: 8080, label: 'desktop-e2e clusters a,b', kind: 'long', enqueuedAt: 1_000, overtakenSince: Date.now() - 31 * 60_000 });
        fs.unlinkSync(lockPath);
        await assert.rejects(acquirePlaywrightRunLock({ label: 'late stage-2 run', env: {}, lockPath, waitMs: 30, pollMs: 10, isAlive: () => true, log: quietLog, sleep: async () => {} , now: (() => { let t = Date.now(); return () => (t += 10); })() }), (error) => error.exitCode === 75);
        assert.equal(fs.existsSync(lockPath), false, 'the free lock stays free for the long run whose time is up');
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: yielding hands the lock to a waiting short run and takes it back afterwards', async () => {
    const lockPath = createLockPath('yield');
    const queueDir = resolvePlaywrightRunLockQueueDir(lockPath);
    const env = {};
    const shortPid = 4343;
    const events = [];
    try {
        const lock = await acquirePlaywrightRunLock({ label: 'desktop-e2e clusters a,b', kind: 'long', env, lockPath, log: quietLog });
        enqueuePlaywrightRunLockTicket(queueDir, { pid: shortPid, label: 'desktop-e2e tests/x.spec.js --grep T1:', enqueuedAt: 1_000 });

        let shortRan = false;
        const result = await yieldPlaywrightRunLock(lock, {
            label: 'desktop-e2e clusters a,b',
            kind: 'long',
            env,
            lockPath,
            pollMs: 1,
            isAlive: () => true,
            log: (message) => events.push(message),
            // Stands in for the short run's own wrapper: it sees the free lock, runs and leaves.
            sleep: async () => {
                if (shortRan) return;
                const queue = readPlaywrightRunLockQueue(queueDir, { isAlive: () => true });
                assert.equal(queue[0].pid, shortPid, 'the short run is first in line');
                assert.equal(fs.existsSync(lockPath), false, 'the lock is free while the short run is first');
                fs.writeFileSync(lockPath, JSON.stringify({ pid: shortPid, label: 'short run', heartbeat: new Date().toISOString() }));
                fs.unlinkSync(queue[0].path);
                fs.unlinkSync(lockPath);
                shortRan = true;
            },
        });

        assert.equal(result.yielded, true);
        assert.equal(shortRan, true, 'the short run got its turn');
        assert.equal(readPlaywrightRunLock(lockPath).pid, process.pid, 'the long run holds the lock again');
        assert.equal(readPlaywrightRunLock(lockPath).kind, 'long');
        assert.equal(env[PLAYWRIGHT_RUN_LOCK_HOLDER_ENV], String(process.pid), 'children of the long run inherit again');
        assert.ok(events.some((message) => message.includes('yielding to 1 short run')), `expected a yield line, got ${JSON.stringify(events)}`);
        result.lock.release();
    } finally {
        cleanup(lockPath);
    }
});

test('playwright lock: without short waiters, or for an inherited lock, yielding keeps the lock', async () => {
    const lockPath = createLockPath('yield-none');
    const queueDir = resolvePlaywrightRunLockQueueDir(lockPath);
    const env = {};
    try {
        const lock = await acquirePlaywrightRunLock({ label: 'desktop-e2e clusters a,b', kind: 'long', env, lockPath, log: quietLog });
        const kept = await yieldPlaywrightRunLock(lock, { env, lockPath, isAlive: () => true, log: quietLog });
        assert.equal(kept.yielded, false);
        assert.equal(kept.lock, lock);

        enqueuePlaywrightRunLockTicket(queueDir, { pid: 4444, label: 'short', enqueuedAt: 1_000 });
        const inherited = { acquired: true, inherited: true, disabled: false, release: () => {} };
        const keptInherited = await yieldPlaywrightRunLock(inherited, { env, lockPath, isAlive: () => true, log: quietLog });
        assert.equal(keptInherited.yielded, false, 'only the real holder may give the lock away');
        assert.equal(readPlaywrightRunLock(lockPath).pid, process.pid);
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
