// ============================================
// playwright-run-lock.mjs - one Playwright run per machine
// ============================================
//
// Desktop specs drive the real Electron window on the one GPU this machine has. Two runs at
// the same time slow each other down and make both results unreliable. Every wrapper therefore
// takes this file lock before it starts Playwright and waits while another run holds it.
//
// - CURVIOS_PLAYWRIGHT_LOCK=0 switches the lock off (CI runners are isolated anyway).
// - CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS caps the wait (default 45 minutes).
// - CURVIOS_PLAYWRIGHT_LOCK_PATH moves the lock file (default: the OS temp folder).
// - CURVIOS_PLAYWRIGHT_LOCK_HOLDER is set for child processes so a cluster runner and the
//   spec runners it spawns share one lock instead of waiting for each other.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

export const PLAYWRIGHT_RUN_LOCK_ENV = 'CURVIOS_PLAYWRIGHT_LOCK';
export const PLAYWRIGHT_RUN_LOCK_HOLDER_ENV = 'CURVIOS_PLAYWRIGHT_LOCK_HOLDER';
export const PLAYWRIGHT_RUN_LOCK_WAIT_MS_ENV = 'CURVIOS_PLAYWRIGHT_LOCK_WAIT_MS';
export const PLAYWRIGHT_RUN_LOCK_PATH_ENV = 'CURVIOS_PLAYWRIGHT_LOCK_PATH';

const DEFAULT_WAIT_MS = 45 * 60 * 1000;
const DEFAULT_POLL_MS = 5000;
const REPORT_EVERY_MS = 30 * 1000;
const LOCK_FILE_NAME = 'curviosclash-playwright-run.lock';

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const defaultLog = (message) => console.log(message);
const noop = () => {};

export function resolvePlaywrightRunLockPath(env = process.env) {
    const explicit = String(env?.[PLAYWRIGHT_RUN_LOCK_PATH_ENV] || '').trim();
    return explicit || path.join(os.tmpdir(), LOCK_FILE_NAME);
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

function describeHolder(holder) {
    if (!holder) return 'unknown run';
    const since = holder.startedAt ? ` since ${String(holder.startedAt).replace('T', ' ').slice(0, 19)}` : '';
    return `${holder.label || 'playwright run'} (pid ${holder.pid}${since}${holder.cwd ? `, ${holder.cwd}` : ''})`;
}

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

function removeStaleLock(lockPath, holder) {
    if (holder && isProcessAlive(holder.pid)) return false;
    try {
        fs.unlinkSync(lockPath);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
    return true;
}

function createRelease(lockPath, env, pid) {
    let released = false;
    return () => {
        if (released) return;
        released = true;
        delete env[PLAYWRIGHT_RUN_LOCK_HOLDER_ENV];
        const holder = readPlaywrightRunLock(lockPath);
        if (holder && Number(holder.pid) !== pid) return;
        try {
            fs.unlinkSync(lockPath);
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error;
        }
    };
}

/**
 * Waits until this process owns the machine-wide Playwright lock.
 * Resolves to { acquired, inherited, disabled, release }; rejects after waitMs.
 */
export async function acquirePlaywrightRunLock({
    label = 'playwright run',
    env = process.env,
    lockPath = resolvePlaywrightRunLockPath(env),
    pid = process.pid,
    cwd = process.cwd(),
    waitMs = Number(env?.[PLAYWRIGHT_RUN_LOCK_WAIT_MS_ENV]) || DEFAULT_WAIT_MS,
    pollMs = DEFAULT_POLL_MS,
    sleep = defaultSleep,
    log = defaultLog,
    now = () => Date.now(),
} = {}) {
    if (String(env?.[PLAYWRIGHT_RUN_LOCK_ENV] || '').trim() === '0') {
        return { acquired: true, inherited: false, disabled: true, release: noop };
    }

    const holderPid = Number(env?.[PLAYWRIGHT_RUN_LOCK_HOLDER_ENV]);
    if (Number.isInteger(holderPid) && holderPid > 0 && isProcessAlive(holderPid)) {
        return { acquired: true, inherited: true, disabled: false, release: noop };
    }

    const payload = { pid, label, cwd, startedAt: new Date(now()).toISOString() };
    const deadline = now() + Math.max(0, waitMs);
    let lastReportAt = -Infinity;
    let announced = false;

    for (;;) {
        if (tryCreateLock(lockPath, payload)) {
            env[PLAYWRIGHT_RUN_LOCK_HOLDER_ENV] = String(pid);
            if (announced) log(`[playwright:lock] acquired for ${label}`);
            return { acquired: true, inherited: false, disabled: false, release: createRelease(lockPath, env, pid) };
        }

        const holder = readPlaywrightRunLock(lockPath);
        if (removeStaleLock(lockPath, holder)) {
            log(`[playwright:lock] removed stale lock of ${describeHolder(holder)}`);
            continue;
        }

        const currentTime = now();
        if (currentTime >= deadline) {
            throw new Error(
                `[playwright:lock] gave up after ${Math.round(waitMs / 1000)} s: ` +
                `${describeHolder(holder)} still holds ${lockPath}. ` +
                `Wait for it, stop it, or set ${PLAYWRIGHT_RUN_LOCK_ENV}=0 to run anyway.`
            );
        }
        if (currentTime - lastReportAt >= REPORT_EVERY_MS) {
            log(`[playwright:lock] waiting for ${describeHolder(holder)} before starting ${label}`);
            lastReportAt = currentTime;
            announced = true;
        }
        await sleep(Math.min(pollMs, Math.max(1, deadline - currentTime)));
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
