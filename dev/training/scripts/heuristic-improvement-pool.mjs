// Spreads independent benchmark matches over worker threads and returns the results in job order,
// so every sum over them is formed in the same order as a serial run.

import os from 'node:os';
import { Worker } from 'node:worker_threads';

import { parsePositiveInteger, runMatch } from './heuristic-improvement-match.mjs';

// The development machine has six cores; four matches at a time leave room for the desktop and
// other sessions. HEURISTIC_LOOP_WORKERS overrides it, 1 runs every match on the main thread.
export const DEFAULT_MAX_MATCH_WORKERS = 4;

export function resolveMatchWorkerCount(env = process.env) {
    const cores = typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length;
    const fallback = Math.max(1, Math.min(DEFAULT_MAX_MATCH_WORKERS, cores - 2));
    return Math.min(parsePositiveInteger(env.HEURISTIC_LOOP_WORKERS, fallback), cores);
}

function createMatchWorker() {
    const worker = new Worker(new URL('./heuristic-improvement-worker.mjs', import.meta.url));
    const pending = new Map();
    let nextId = 0;
    const failAll = (error) => {
        for (const { reject } of pending.values()) reject(error);
        pending.clear();
    };
    worker.on('message', ({ id, result, error }) => {
        const entry = pending.get(id);
        if (!entry) return;
        pending.delete(id);
        if (error) entry.reject(new Error(`benchmark worker failed:\n${error}`));
        else entry.resolve(result);
    });
    worker.on('error', failAll);
    worker.on('exit', (code) => failAll(new Error(`benchmark worker exited with code ${code}`)));
    return {
        run(job) {
            return new Promise((resolve, reject) => {
                const id = nextId;
                nextId += 1;
                pending.set(id, { resolve, reject });
                worker.postMessage({ id, job });
            });
        },
        terminate: () => worker.terminate(),
    };
}

export function createMatchPool({ workerCount = resolveMatchWorkerCount() } = {}) {
    const workers = [];
    return {
        workerCount,
        async runMatches(jobs) {
            const results = new Array(jobs.length);
            if (workerCount <= 1) {
                for (const [index, job] of jobs.entries()) results[index] = await runMatch(job);
                return results;
            }
            while (workers.length < Math.min(workerCount, jobs.length)) workers.push(createMatchWorker());
            let nextJob = 0;
            await Promise.all(workers.map(async (worker) => {
                while (nextJob < jobs.length) {
                    const index = nextJob;
                    nextJob += 1;
                    results[index] = await worker.run(jobs[index]);
                }
            }));
            return results;
        },
        async close() {
            await Promise.all(workers.splice(0).map((worker) => worker.terminate()));
        },
    };
}
