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
// Long runs (a cluster list) yield between two clusters: the short runs already waiting ahead
// of the first long waiter go first, then the long run takes the lock back. Each run still has
// the GPU to itself; only the order changes, so a two-minute stage-2 run no longer waits an hour.
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
// Wrappers older than the `kind` field still sit in other worktrees; their long runs are
// recognised by label so a yielding run never lets them jump the queue.
const LEGACY_LONG_RUN_LABEL_PREFIXES = Object.freeze(['desktop-e2e clusters', 'bot validation', 'bot self-trail']);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultLog = (message) => console.log(message);
const noop = () => {};

/**
 * The machine-wide lock must be the same file for every wrapper. On Windows it therefore sits in
 * the user's own temp folder, not in whatever TEMP/TMP point to: sessions redirect those into a
 * worktree for builds, and a wrapper started from there used to create a private lock and run
 * next to the real holder without a word.
 */
function resolveSharedTempDir(env) {
    if (process.platform !== 'win32') return os.tmpdir();
    const localAppData = String(env?.LOCALAPPDATA || '').trim() || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, 'Temp');
}

export function resolvePlaywrightRunLockPath(env = process.env) {
    const explicit = String(env?.[PLAYWRIGHT_RUN_LOCK_PATH_ENV] || '').trim();
    return explicit || path.join(resolveSharedTempDir(env), LOCK_FILE_NAME);
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
export function enqueuePlaywrightRunLockTicket(queueDir, { pid, label = 'playwright run', kind = 'short', enqueuedAt = Date.now(), cwd = '', overtakenSince = null } = {}) {
    fs.mkdirSync(queueDir, { recursive: true });
    const stamp = String(Math.max(0, Math.trunc(Number(enqueuedAt) || 0))).padStart(16, '0');
    const ticketPath = path.join(queueDir, `${stamp}-${pid}.json`);
    const ticket = {
        pid, label, kind, cwd, enqueuedAt,
        // Marks a long waiter that notes when it is first passed; see mayBePassed.
        ...(kind === 'long' ? { countsOvertaking: true } : {}),
        ...(Number.isFinite(overtakenSince) ? { overtakenSince } : {}),
    };
    fs.writeFileSync(ticketPath, `${JSON.stringify(ticket, null, 2)}\n`, 'utf8');
    return ticketPath;
}

/**
 * A waiting long run lets short runs go first for this long in total, counted from the first time
 * one passed it. Short runs are stage-2 checks somebody waits for; the cap keeps a steady stream of
 * them from starving a cluster run.
 */
export const PLAYWRIGHT_RUN_LOCK_OVERTAKE_BUDGET_MS = 30 * 60 * 1000;

// Wrappers between 73e4f90f and the overtaking rule write kind 'long' but never note when they are
// passed, so their thirty minutes would never start; only tickets that count can be passed.
function mayBePassed(ticket, nowMs, budgetMs) {
    if (ticket?.kind !== 'long' || ticket.countsOvertaking !== true) return false;
    const since = Number(ticket.overtakenSince);
    return !Number.isFinite(since) || nowMs - since < budgetMs;
}

/**
 * The order in which waiters get the lock: arrival order, except that a short run moves ahead of
 * the long runs directly before it that may still be passed. Only tickets that name their kind
 * take part; tickets of older wrappers keep their place and are never passed, because an older
 * wrapper orders by arrival alone and would otherwise wait for the run waiting for it.
 */
export function orderPlaywrightRunLockQueue(queue, nowMs = Date.now(), budgetMs = PLAYWRIGHT_RUN_LOCK_OVERTAKE_BUDGET_MS) {
    const ordered = [];
    for (const ticket of queue) {
        let index = ordered.length;
        if (ticket?.kind === 'short') {
            while (index > 0 && mayBePassed(ordered[index - 1], nowMs, budgetMs)) index -= 1;
        }
        ordered.splice(index, 0, ticket);
    }
    return ordered;
}

/** A ticket or lock of a cluster list or bot validation; an explicit `kind` wins over the label. */
export function isLongPlaywrightRun(entry) {
    if (entry?.kind === 'long') return true;
    if (entry?.kind === 'short') return false;
    const label = String(entry?.label || '');
    return LEGACY_LONG_RUN_LABEL_PREFIXES.some((prefix) => label.startsWith(prefix));
}

/**
 * Where a yielding long run re-enters the queue. It yields only when a short run would be next;
 * it then queues just before the first long waiter, so the short runs that may pass that waiter
 * pass it too, and it still goes before the waiter afterwards. Without a long waiter it queues
 * behind the last short run. Returns null when nobody short would be next, so the lock is kept.
 */
export function resolveYieldQueueStamp(queue, nowMs = Date.now(), budgetMs = PLAYWRIGHT_RUN_LOCK_OVERTAKE_BUDGET_MS) {
    const next = orderPlaywrightRunLockQueue(queue, nowMs, budgetMs)[0];
    if (!next || isLongPlaywrightRun(next)) return null;
    const firstLong = queue.find((ticket) => isLongPlaywrightRun(ticket));
    if (firstLong) return firstLong.enqueuedAt - 1;
    return queue[queue.length - 1].enqueuedAt + 1;
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
        let kind;
        let overtakenSince;
        let countsOvertaking;
        try {
            const parsed = JSON.parse(fs.readFileSync(ticketPath, 'utf8'));
            label = String(parsed?.label || label);
            kind = parsed?.kind;
            overtakenSince = Number.isFinite(parsed?.overtakenSince) ? parsed.overtakenSince : undefined;
            countsOvertaking = parsed?.countsOvertaking === true ? true : undefined;
        } catch { /* a ticket being written right now still counts by its name */ }
        tickets.push({ pid, enqueuedAt: Number(match[1]), label, kind, countsOvertaking, overtakenSince, path: ticketPath });
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
 *
 * `lastWriteMs` is the lock file's modification time. Every holder rewrites the file when it takes
 * the lock and with each beat, old wrappers included, so a recent write counts as a sign of life
 * even when the stamp inside is old: wrappers before 71f6b4b6 wrote their wait start as heartbeat.
 */
export function isPlaywrightRunLockStale(holder, nowMs, { isAlive = isProcessAlive, staleMs = PLAYWRIGHT_RUN_LOCK_HEARTBEAT_STALE_MS, lastWriteMs = NaN } = {}) {
    if (!holder) return true;
    if (!isAlive(holder.pid)) return true;
    const beatAt = Date.parse(String(holder.heartbeat || ''));
    if (!Number.isFinite(beatAt)) return false;
    const lastSignOfLife = Number.isFinite(lastWriteMs) ? Math.max(beatAt, lastWriteMs) : beatAt;
    return nowMs - lastSignOfLife > staleMs;
}

function readLockWriteTime(lockPath) {
    try {
        return fs.statSync(lockPath).mtimeMs;
    } catch {
        return NaN;
    }
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
        ? isPlaywrightRunLockStale(holder, nowMs, { isAlive, lastWriteMs: readLockWriteTime(lockPath) })
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

function startHeartbeat(lockPath, pid, intervalMs, now, label = 'playwright run', log = defaultLog) {
    let lostReported = false;
    const writeBeat = () => {
        const current = readPlaywrightRunLock(lockPath);
        if (current && Number(current.pid) !== pid && !lostReported) {
            // Another run removed or replaced our lock. The tests keep running, so the overlap
            // must at least show up in this run's output.
            lostReported = true;
            log(`[playwright:lock] LOST the lock of ${label} to ${describeHolder(current)}; results of this run are not reliable`);
        }
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
    kind = 'short',
    // Queue position as a timestamp; only a yielding long run sets it (see yieldPlaywrightRunLock).
    queueAt = null,
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
    // Both bypass branches log a line: a run that skips the queue must be visible in its output.
    if (String(env?.[PLAYWRIGHT_RUN_LOCK_ENV] || '').trim() === '0') {
        log(`[playwright:lock] DISABLED by ${PLAYWRIGHT_RUN_LOCK_ENV}=0 for ${label}`);
        return { acquired: true, inherited: false, disabled: true, release: noop };
    }

    // Inherit only from the pid the lock file names. Windows reuses pids, so a leftover holder
    // variable pointing at any living process would otherwise skip the queue unseen.
    const holderPid = Number(env?.[PLAYWRIGHT_RUN_LOCK_HOLDER_ENV]);
    if (Number.isInteger(holderPid) && holderPid > 0) {
        const lockHolder = readPlaywrightRunLock(lockPath);
        if (Number(lockHolder?.pid) === holderPid && isAlive(holderPid)) {
            log(`[playwright:lock] inherited from pid ${holderPid} for ${label}`);
            return { acquired: true, inherited: true, disabled: false, release: noop };
        }
        log(
            `[playwright:lock] ignoring ${PLAYWRIGHT_RUN_LOCK_HOLDER_ENV}=${holderPid}: ` +
            `the lock names ${lockHolder ? `pid ${lockHolder.pid}` : 'no holder'}`
        );
        delete env[PLAYWRIGHT_RUN_LOCK_HOLDER_ENV];
    }

    const startedAtMs = now();
    // Stamped at the moment of taking, never at the start of the wait: a run that waited longer
    // than the stale window would otherwise look hung at once and be removed by the next waiter.
    const tryTakeLock = () => {
        const takenAt = new Date(now()).toISOString();
        return tryCreateLock(lockPath, { pid, label, kind, cwd, startedAt: takenAt, heartbeat: takenAt });
    };
    const takeLock = () => {
        env[PLAYWRIGHT_RUN_LOCK_HOLDER_ENV] = String(pid);
        const stopHeartbeat = startHeartbeat(lockPath, pid, heartbeatMs, now, label, log);
        return { acquired: true, inherited: false, disabled: false, release: createRelease(lockPath, env, pid, stopHeartbeat) };
    };

    // Fast path: nobody is queued and the lock is free.
    if (readPlaywrightRunLockQueue(queueDir, { isAlive }).length === 0 && tryTakeLock()) {
        return takeLock();
    }

    const ticketStamp = queueAt === null ? startedAtMs : Number(queueAt);
    let overtakenSince = null;
    const enqueue = () => enqueuePlaywrightRunLockTicket(queueDir, { pid, label, kind, cwd, enqueuedAt: ticketStamp, overtakenSince });
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
            queue = orderPlaywrightRunLockQueue(queue, now());
            const ownIndex = queue.findIndex((ticket) => ticket.path === ticketPath);
            const position = Math.max(1, ownIndex + 1);
            const isOurTurn = position === 1;
            // A long waiter notes the first time a later short run stands before it; from then on
            // its thirty minutes of letting short runs go first are counting down.
            if (kind === 'long' && overtakenSince === null
                && queue.slice(0, Math.max(0, ownIndex)).some((ticket) => ticket.kind === 'short' && ticket.enqueuedAt > ticketStamp)) {
                overtakenSince = now();
                enqueue();
            }

            if (isOurTurn && tryTakeLock()) {
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
 * Called by a long run between two of its parts. When short runs wait ahead of the first long
 * waiter, the lock is released and re-queued right behind them; otherwise it is kept untouched.
 * Resolves to { yielded, lock } — always continue with the returned lock.
 */
export async function yieldPlaywrightRunLock(lock, options = {}) {
    if (!lock || lock.disabled || lock.inherited || typeof lock.release !== 'function') {
        return { yielded: false, lock };
    }
    const env = options.env || process.env;
    const lockPath = options.lockPath || resolvePlaywrightRunLockPath(env);
    const queueDir = options.queueDir || resolvePlaywrightRunLockQueueDir(lockPath);
    const isAlive = options.isAlive || isProcessAlive;
    const log = options.log || defaultLog;
    const queue = readPlaywrightRunLockQueue(queueDir, { isAlive });
    const nowMs = (options.now || Date.now)();
    const queueAt = resolveYieldQueueStamp(queue, nowMs);
    if (queueAt === null) return { yielded: false, lock };

    const ordered = orderPlaywrightRunLockQueue(queue, nowMs);
    const firstLongIndex = ordered.findIndex((ticket) => isLongPlaywrightRun(ticket));
    const shortAhead = firstLongIndex === -1 ? ordered.length : firstLongIndex;
    log(`[playwright:lock] yielding to ${shortAhead} short run(s) before continuing ${options.label || 'the long run'}`);
    // release and re-enqueue run in the same tick, so no newcomer can take the free lock first.
    lock.release();
    const nextLock = await acquirePlaywrightRunLock({ ...options, kind: options.kind || 'long', env, lockPath, queueDir, isAlive, log, queueAt });
    return { yielded: true, lock: nextLock };
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
