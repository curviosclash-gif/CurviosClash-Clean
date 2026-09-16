// ============================================
// playwright-run-lock.mjs - one Playwright run per machine
// ============================================
//
// Desktop specs drive the real Electron window on the one GPU this machine has. Two runs at
// the same time slow each other down and make both results unreliable. Every wrapper therefore
// takes this file lock before it starts Playwright and waits while another run holds it.
//
// Waiting is a queue, not a race: every waiter drops a ticket into `<lock>.queue/` and only the
// oldest living ticket may take the lock. Tickets of dead processes are skipped and removed.
// The holder refreshes a `heartbeat` timestamp inside the lock file, so a hung or orphaned run
// releases the machine after ten silent minutes even though its pid still exists.
//
// - CURVIOS_PLAYWRIGHT_LOCK=0 switches the lock off (CI runners are isolated anyway).
// - CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS caps the wait (default 120 minutes).
// - CURVIOS_PLAYWRIGHT_LOCK_PATH moves the lock file (default: the OS temp folder).
// - CURVIOS_PLAYWRIGHT_LOCK_HOLDER is set for child processes so a cluster runner and the
//   spec runners it spawns share one lock instead of waiting for each other.
//
// A wait that runs out of time is not a test failure. It logs a single machine-readable line
// `[playwright:lock] LOCK_TIMEOUT holder=… pid=… waited=…s` and rejects with `exitCode = 75`
// (EX_TEMPFAIL), which the wrappers hand back to the shell unchanged.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export const PLAYWRIGHT_RUN_LOCK_ENV = 'CURVIOS_PLAYWRIGHT_LOCK';
export const PLAYWRIGHT_RUN_LOCK_HOLDER_ENV = 'CURVIOS_PLAYWRIGHT_LOCK_HOLDER';
export const PLAYWRIGHT_RUN_LOCK_WAIT_MS_ENV = 'CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS';
export const PLAYWRIGHT_RUN_LOCK_PATH_ENV = 'CURVIOS_PLAYWRIGHT_LOCK_PATH';

/** EX_TEMPFAIL: the machine was busy, nothing is broken. */
export const PLAYWRIGHT_RUN_LOCK_TIMEOUT_EXIT_CODE = 75;
export const PLAYWRIGHT_RUN_LOCK_DEFAULT_WAIT_MS = 120 * 60 * 1000;
export const PLAYWRIGHT_RUN_LOCK_HEARTBEAT_MS = 30 * 1000;
export const PLAYWRIGHT_RUN_LOCK_HEARTBEAT_STALE_MS = 10 * 60 * 1000;

const DEFAULT_POLL_MS = 5000;
const REPORT_EVERY_MS = 30 * 1000;
const LOCK_FILE_NAME = 'curviosclash-playwright-run.lock';
const TICKET_NAME_PATTERN = /^(\d{1,16})-(\d+)\.json$/;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultLog = (message) => console.log(message);
const noop = () => {};

export function resolvePlaywrightRunLockPath(env = process.env) {
    const explicit = String(env?.[PLAYWRIGHT_RUN_LOCK_PATH_ENV] || '').trim();
    return explicit || path.join(os.tmpdir(), LOCK_FILE_NAME);
}

export function resolvePlaywrightRunLockQueueDir(lockPath) {
    return `${lockPath}.queue`;
}

export function isProcessAlive(pid) {
    const numeric = Number(pid);
    if (!Number.isInteger(numeric) || numeric <= 0) return false;
    try {
        process.kill(numeric, 0);
        return true;
    } catch (error) {
        return error?.code === 'EPERM';
    }
}

export function readPlaywrightRunLock(lockPath) {
    try {
        const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
}

function removeFileQuietly(filePath) {
    try {
        fs.unlinkSync(filePath);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
}

function describeHolder(holder) {
    if (!holder) return 'unknown run';
    const since = holder.startedAt ? ` since ${String(holder.startedAt).replace('T', ' ').slice(0, 19)}` : '';
    return `${holder.label || 'playwright run'} (pid ${holder.pid}${since}${holder.cwd ? `, ${holder.cwd}` : ''})`;
}

// ---------- queue ----------

/** Writes one waiting ticket and returns its path. Sortable by name: `<enqueuedAt>-<pid>.json`. */
export function enqueuePlaywrightRunLockTicket(queueDir, { pid, label = 'playwright run', enqueuedAt = Date.now(), cwd = '' } = {}) {
    fs.mkdirSync(queueDir, { recursive: true });
    const stamp = String(Math.max(0, Math.trunc(Number(enqueuedAt) || 0))).padStart(16, '0');
    const ticketPath = path.join(queueDir, `${stamp}-${pid}.json`);
    fs.writeFileSync(ticketPath, `${JSON.stringify({ pid, label, cwd, enqueuedAt }, null, 2)}\n`, 'utf8');
    return ticketPath;
}

/** Lists the living waiters in order, dropping (and deleting) tickets of dead processes. */
export function readPlaywrightRunLockQueue(queueDir, { isAlive = isProcessAlive, removeDead = true } = {}) {
    let entries = [];
    try {
        entries = fs.readdirSync(queueDir);
    } catch {
        return [];
    }

    const tickets = [];
    for (const entry of entries) {
        const match = TICKET_NAME_PATTERN.exec(entry);
        if (!match) continue;
        const ticketPath = path.join(queueDir, entry);
        const pid = Number(match[2]);
        if (!isAlive(pid)) {
            if (removeDead) removeFileQuietly(ticketPath);
            continue;
        }
        let label = 'playwright run';
        try {
            label = String(JSON.parse(fs.readFileSync(ticketPath, 'utf8'))?.label || label);
        } catch { /* a ticket being written right now still counts by its name */ }
        tickets.push({ pid, enqueuedAt: Number(match[1]), label, path: ticketPath });
    }

    tickets.sort((left, right) => left.enqueuedAt - right.enqueuedAt || left.pid - right.pid);
    return tickets;
}

function ticketAsHolder(ticket) {
    if (!ticket) return null;
    return {
        pid: ticket.pid,
        label: ticket.label,
        startedAt: new Date(ticket.enqueuedAt).toISOString(),
    };
}

// The queue folder is never removed: a newcomer's mkdir + write would otherwise race a
// finisher's rmdir and fail with ENOENT (exit 1, looking like a test failure). An empty
// folder in the temp directory costs nothing.

// ---------- lock file ----------

function tryCreateLock(lockPath, payload) {
    let handle = null;
    try {
        handle = fs.openSync(lockPath, 'wx');
        fs.writeFileSync(handle, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
        return true;
    } catch (error) {
        if (error?.code === 'EEXIST') return false;
        throw error;
    } finally {
        if (handle !== null) fs.closeSync(handle);
    }
}

/**
 * A lock is dead when its process is gone, or when it carries a heartbeat that stopped more
 * than ten minutes ago. Locks written by an older wrapper have no heartbeat at all; those are
 * judged by their pid alone so a running neighbour is never stolen from.
 */
export function isPlaywrightRunLockStale(holder, nowMs, { isAlive = isProcessAlive, staleMs = PLAYWRIGHT_RUN_LOCK_HEARTBEAT_STALE_MS } = {}) {
    if (!holder) return true;
    if (!isAlive(holder.pid)) return true;
    const beatAt = Date.parse(String(holder.heartbeat || ''));
    if (!Number.isFinite(beatAt)) return false;
    return nowMs - beatAt > staleMs;
}

/**
 * An unreadable lock file is not proof of a dead run: an older wrapper rewrites the file in
 * place, so a reader can catch it half-written. Such a file is only stale when its
 * modification time is older than the heartbeat allowance.
 */
export function isUnreadableLockStale(lockPath, nowMs, { staleMs = PLAYWRIGHT_RUN_LOCK_HEARTBEAT_STALE_MS, stat = fs.statSync } = {}) {
    try {
        return nowMs - stat(lockPath).mtimeMs > staleMs;
    } catch {
        return false; // gone already; the next tryCreateLock will simply succeed
    }
}

function removeStaleLock(lockPath, holder, nowMs, isAlive) {
    const stale = holder
        ? isPlaywrightRunLockStale(holder, nowMs, { isAlive })
        : isUnreadableLockStale(lockPath, nowMs);
    if (!stale) return false;
    removeFileQuietly(lockPath);
    return true;
}

/** Replaces the lock file in one step so no reader ever sees it half-written. */
function writeLockAtomically(lockPath, payload, pid) {
    const tempPath = `${lockPath}.${pid}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    try {
        fs.renameSync(tempPath, lockPath);
    } catch (error) {
        removeFileQuietly(tempPath);
        throw error;
    }
}

function startHeartbeat(lockPath, pid, intervalMs, now) {
    const writeBeat = () => {
        const current = readPlaywrightRunLock(lockPath);
        if (!current || Number(current.pid) !== pid) return;
        try {
            writeLockAtomically(lockPath, { ...current, heartbeat: new Date(now()).toISOString() }, pid);
        } catch { /* the lock may vanish between read and write; the next beat retries */ }
    };
    const timer = setInterval(writeBeat, Math.max(1, intervalMs));
    // The heartbeat must never keep the wrapper process alive on its own.
    if (typeof timer.unref === 'function') timer.unref();
    return () => clearInterval(timer);
}

function createRelease(lockPath, env, pid, stopHeartbeat) {
    let released = false;
    return () => {
        if (released) return;
        released = true;
        stopHeartbeat();
        delete env[PLAYWRIGHT_RUN_LOCK_HOLDER_ENV];
        const holder = readPlaywrightRunLock(lockPath);
        if (holder && Number(holder.pid) !== pid) return;
        removeFileQuietly(lockPath);
    };
}

function createLockTimeoutError(blockedBy, lockPath, waitedSeconds) {
    const error = new Error(
        `[playwright:lock] gave up after ${waitedSeconds} s: ` +
        `${describeHolder(blockedBy)} still holds ${lockPath}. ` +
        `Wait for it, stop it, or set ${PLAYWRIGHT_RUN_LOCK_ENV}=0 to run anyway.`
    );
    error.exitCode = PLAYWRIGHT_RUN_LOCK_TIMEOUT_EXIT_CODE;
    error.code = 'PLAYWRIGHT_LOCK_TIMEOUT';
    return error;
}

/**
 * Waits until this process owns the machine-wide Playwright lock.
 * Resolves to { acquired, inherited, disabled, release }; rejects with exitCode 75 after waitMs.
 */
export async function acquirePlaywrightRunLock({
    label = 'playwright run',
    env = process.env,
    lockPath = resolvePlaywrightRunLockPath(env),
    queueDir = resolvePlaywrightRunLockQueueDir(lockPath),
    pid = process.pid,
    cwd = process.cwd(),
    waitMs = Number(env?.[PLAYWRIGHT_RUN_LOCK_WAIT_MS_ENV]) || PLAYWRIGHT_RUN_LOCK_DEFAULT_WAIT_MS,
    pollMs = DEFAULT_POLL_MS,
    heartbeatMs = PLAYWRIGHT_RUN_LOCK_HEARTBEAT_MS,
    sleep = defaultSleep,
    log = defaultLog,
    now = () => Date.now(),
    isAlive = isProcessAlive,
} = {}) {
    if (String(env?.[PLAYWRIGHT_RUN_LOCK_ENV] || '').trim() === '0') {
        return { acquired: true, inherited: false, disabled: true, release: noop };
    }

    const holderPid = Number(env?.[PLAYWRIGHT_RUN_LOCK_HOLDER_ENV]);
    if (Number.isInteger(holderPid) && holderPid > 0 && isAlive(holderPid)) {
        return { acquired: true, inherited: true, disabled: false, release: noop };
    }

    const startedAtMs = now();
    const payload = { pid, label, cwd, startedAt: new Date(startedAtMs).toISOString(), heartbeat: new Date(startedAtMs).toISOString() };
    const takeLock = () => {
        env[PLAYWRIGHT_RUN_LOCK_HOLDER_ENV] = String(pid);
        const stopHeartbeat = startHeartbeat(lockPath, pid, heartbeatMs, now);
        return { acquired: true, inherited: false, disabled: false, release: createRelease(lockPath, env, pid, stopHeartbeat) };
    };

    // Fast path: nobody is queued and the lock is free.
    if (readPlaywrightRunLockQueue(queueDir, { isAlive }).length === 0 && tryCreateLock(lockPath, payload)) {
        return takeLock();
    }

    const enqueue = () => enqueuePlaywrightRunLockTicket(queueDir, { pid, label, cwd, enqueuedAt: startedAtMs });
    const ticketPath = enqueue();
    const deadline = startedAtMs + Math.max(0, waitMs);
    let lastReportAt = -Infinity;
    let announced = false;

    try {
        for (;;) {
            let queue = readPlaywrightRunLockQueue(queueDir, { isAlive });
            if (!queue.some((ticket) => ticket.path === ticketPath)) {
                // Somebody removed our ticket (a cleanup, a foreign wrapper): re-enter at the
                // original time instead of silently assuming first place.
                enqueue();
                queue = readPlaywrightRunLockQueue(queueDir, { isAlive });
            }
            const position = Math.max(1, queue.findIndex((ticket) => ticket.path === ticketPath) + 1);
            const isOurTurn = position === 1;

            if (isOurTurn && tryCreateLock(lockPath, payload)) {
                if (announced) log(`[playwright:lock] acquired for ${label}`);
                return takeLock();
            }

            const holder = readPlaywrightRunLock(lockPath);
            const currentTime = now();
            if (isOurTurn && removeStaleLock(lockPath, holder, currentTime, isAlive)) {
                log(`[playwright:lock] removed stale lock of ${describeHolder(holder)}`);
                continue;
            }

            const blockedBy = holder || ticketAsHolder(queue[0]);
            if (currentTime >= deadline) {
                const waitedSeconds = Math.round((currentTime - startedAtMs) / 1000);
                log(
                    `[playwright:lock] LOCK_TIMEOUT holder=${blockedBy?.label || 'unknown'} ` +
                    `pid=${blockedBy?.pid ?? 'unknown'} waited=${waitedSeconds}s`
                );
                throw createLockTimeoutError(blockedBy, lockPath, waitedSeconds);
            }
            if (currentTime - lastReportAt >= REPORT_EVERY_MS) {
                log(
                    `[playwright:lock] waiting for ${describeHolder(blockedBy)} before starting ${label} ` +
                    `(queue position ${position} of ${queue.length})`
                );
                lastReportAt = currentTime;
                announced = true;
            }
            await sleep(Math.min(pollMs, Math.max(1, deadline - currentTime)));
        }
    } finally {
        removeFileQuietly(ticketPath);
    }
}

/**
 * Releases the lock when this process ends, including Ctrl+C.
 */
export function releasePlaywrightRunLockOnExit(release) {
    if (typeof release !== 'function') return;
    process.once('exit', release);
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        process.once(signal, () => {
            release();
            process.exit(signal === 'SIGINT' ? 130 : 143);
        });
    }
}
