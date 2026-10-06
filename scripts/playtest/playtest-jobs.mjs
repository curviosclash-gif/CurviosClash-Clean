// Long-running playtest work (a goal flight, a scenario with ten attempts) runs as a job:
// the caller gets an id at once, can poll progress and cancel. Only one job drives the
// game at a time, because every job shares the same windows and input path. Pure, so a
// contract test can drive it without Electron.

export const JOB_STATES = Object.freeze(['running', 'cancelling', 'done', 'failed', 'cancelled']);
const FINISHED = new Set(['done', 'failed', 'cancelled']);
const LOG_LIMIT = 200;

export class JobBusyError extends Error {
    constructor(activeJob) {
        super(`job ${activeJob.id} (${activeJob.kind}) is still running; cancel it or wait for it to finish`);
        this.code = 'PLAYTEST_JOB_BUSY';
        this.activeJobId = activeJob.id;
    }
}

export function createJobRegistry({ now = () => Date.now(), keepFinished = 20 } = {}) {
    const jobs = new Map();
    let sequence = 0;
    let active = null;

    const snapshot = (job) => (job ? {
        id: job.id,
        kind: job.kind,
        label: job.label,
        state: job.state,
        startedAt: job.startedAt,
        endedAt: job.endedAt,
        elapsedMs: (job.endedAt ?? now()) - job.startedAt,
        progress: job.progress,
        result: FINISHED.has(job.state) ? job.result : undefined,
        error: job.error,
        log: job.log.slice(-20),
    } : null);

    const prune = () => {
        const finished = [...jobs.values()].filter((job) => FINISHED.has(job.state));
        for (const job of finished.slice(0, Math.max(0, finished.length - keepFinished))) jobs.delete(job.id);
    };

    return {
        /**
         * Starts `run({ signal, progress, log })` as a job. `run` should check
         * `signal.aborted` between steps; its return value becomes the job result.
         */
        start(kind, run, { label = kind } = {}) {
            if (active && !FINISHED.has(active.state)) throw new JobBusyError(active);
            const controller = new AbortController();
            const job = {
                id: `job-${++sequence}`, kind, label, state: 'running', startedAt: now(), endedAt: null,
                progress: null, result: null, error: null, log: [], controller, done: null,
            };
            const context = {
                signal: controller.signal,
                progress: (update) => { job.progress = { ...(job.progress || {}), ...update }; },
                log: (entry) => {
                    job.log.push({ t: now() - job.startedAt, ...(typeof entry === 'string' ? { message: entry } : entry) });
                    if (job.log.length > LOG_LIMIT) job.log.shift();
                },
            };
            jobs.set(job.id, job);
            active = job;
            job.done = Promise.resolve()
                .then(() => run(context))
                .then((result) => {
                    job.result = result ?? null;
                    job.state = controller.signal.aborted ? 'cancelled' : 'done';
                }, (error) => {
                    job.error = String(error?.message || error);
                    job.state = controller.signal.aborted ? 'cancelled' : 'failed';
                })
                .finally(() => {
                    job.endedAt = now();
                    if (active === job) active = null;
                    prune();
                });
            return snapshot(job);
        },
        get(id) {
            return snapshot(jobs.get(id));
        },
        /** Asks the job to stop; it ends as 'cancelled' once its run function returns. */
        cancel(id, reason = 'cancelled by request') {
            const job = jobs.get(id);
            if (!job) return null;
            if (!FINISHED.has(job.state)) {
                job.state = 'cancelling';
                job.log.push({ t: now() - job.startedAt, message: reason });
                job.controller.abort(new Error(reason));
            }
            return snapshot(job);
        },
        /** Waits until the job has finished (or ms elapsed) and returns its snapshot. */
        async wait(id, ms = 0) {
            const job = jobs.get(id);
            if (!job) return null;
            if (ms > 0) {
                let timer = null;
                await Promise.race([job.done, new Promise((resolve) => { timer = setTimeout(resolve, ms); })]);
                clearTimeout(timer);
            } else {
                await job.done;
            }
            return snapshot(job);
        },
        active() {
            return active && !FINISHED.has(active.state) ? snapshot(active) : null;
        },
        list() {
            return [...jobs.values()].map(snapshot);
        },
        /** Cancels the running job and waits for it to settle (used on close and disconnect). */
        async cancelAll(reason = 'session closing', maxWaitMs = 0) {
            if (!active) return;
            const { id } = active;
            this.cancel(id, reason);
            const done = jobs.get(id)?.done;
            if (!maxWaitMs) { await done; return; }
            let timer = null;
            await Promise.race([done, new Promise((resolve) => { timer = setTimeout(resolve, maxWaitMs); })]);
            clearTimeout(timer);
        },
    };
}

/** Throws the abort reason when the job was cancelled; call between steps of a job. */
export function throwIfCancelled(signal) {
    if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('cancelled');
}

/** Sleeps ms, but wakes up at once when the job is cancelled. */
export function cancellableSleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason instanceof Error ? signal.reason : new Error('cancelled'));
            return;
        }
        const timer = setTimeout(() => { signal?.removeEventListener?.('abort', onAbort); resolve(); }, ms);
        const onAbort = () => { clearTimeout(timer); reject(signal.reason instanceof Error ? signal.reason : new Error('cancelled')); };
        signal?.addEventListener?.('abort', onAbort, { once: true });
    });
}
