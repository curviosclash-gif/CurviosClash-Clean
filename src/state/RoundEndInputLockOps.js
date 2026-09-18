// ============================================
// RoundEndInputLockOps.js - input lock for the round-end and match-end boards
// ============================================
//
// The boards continue on any key, so the steering or firing key of the last
// second must not dismiss them right away. Entering a board therefore drops the
// pending "continue" intent and starts a short lock that is counted down from dt
// (deterministic, no wall clock). A press during the lock is swallowed for good:
// it is read every frame and thrown away, so it cannot act once the lock ends.
//
// The result board (P7c) reads `remaining` and `total` to draw its progress bar.

export const ROUND_END_INPUT_LOCK_SECONDS = 0.75;
export const MATCH_END_INPUT_LOCK_SECONDS = 1.5;

export const ROUND_END_INPUT_LOCK_PHASES = Object.freeze({
    ROUND_END: 'round_end',
    MATCH_END: 'match_end',
});

/** Float noise from summed dt steps must not keep the lock alive for another frame. */
const LOCK_EPSILON = 1e-6;

/**
 * @param {string} phase
 * @returns {number} lock duration in seconds for that board
 */
export function resolveRoundEndInputLockSeconds(phase) {
    return phase === ROUND_END_INPUT_LOCK_PHASES.MATCH_END
        ? MATCH_END_INPUT_LOCK_SECONDS
        : ROUND_END_INPUT_LOCK_SECONDS;
}

/**
 * @typedef {{ phase: string, remaining: number, total: number,
 *   pendingClear: boolean, continueLatched: boolean }} RoundEndInputLock
 */

/** @returns {RoundEndInputLock} */
export function createRoundEndInputLock() {
    return { phase: '', remaining: 0, total: 0, pendingClear: false, continueLatched: false };
}

/**
 * Starts the lock for a board that was just opened.
 * @param {RoundEndInputLock} lock
 * @param {string} phase
 */
export function armRoundEndInputLock(lock, phase) {
    const seconds = resolveRoundEndInputLockSeconds(phase);
    lock.phase = phase;
    lock.remaining = seconds;
    lock.total = seconds;
    lock.pendingClear = true;
    lock.continueLatched = false;
    return lock;
}

/** @param {RoundEndInputLock} lock */
export function releaseRoundEndInputLock(lock) {
    lock.phase = '';
    lock.remaining = 0;
    lock.total = 0;
    lock.pendingClear = false;
    lock.continueLatched = false;
    return lock;
}

/**
 * True exactly once after arming: the frame on which the pending intent is dropped.
 * @param {RoundEndInputLock} lock
 */
export function consumeRoundEndInputLockClear(lock) {
    if (!lock.pendingClear) return false;
    lock.pendingClear = false;
    return true;
}

/** @param {number} remaining */
export function isRoundEndInputLocked(remaining) {
    return (Number(remaining) || 0) > LOCK_EPSILON;
}

/**
 * Rising edge of the continue intent. The live InputManager consumes its intent,
 * but the headless adapter reports a held command on every tick - without this
 * latch the kernel would restart the match on every single tick.
 * @param {RoundEndInputLock} lock
 * @param {boolean} pressed
 * @returns {boolean}
 */
export function readLatchedContinuePress(lock, pressed) {
    if (pressed !== true) {
        lock.continueLatched = false;
        return false;
    }
    if (lock.continueLatched) return false;
    lock.continueLatched = true;
    return true;
}

/**
 * Snapshot for the board: how much lock time is left and how long it was.
 * @param {RoundEndInputLock} lock
 */
export function readRoundEndInputLockState(lock) {
    return {
        phase: lock.phase,
        remaining: lock.remaining,
        total: lock.total,
    };
}
