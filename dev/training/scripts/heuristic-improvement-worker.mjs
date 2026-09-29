// Worker thread for the heuristic search: runs one benchmark match per message.
// Each worker has its own Math, Date and performance, so runMatch seeds and restores them per match
// exactly as it does on the main thread.

import { parentPort } from 'node:worker_threads';

import { runMatch } from './heuristic-improvement-match.mjs';

parentPort.on('message', async ({ id, job }) => {
    try {
        parentPort.postMessage({ id, result: await runMatch(job) });
    } catch (error) {
        parentPort.postMessage({ id, error: error?.stack || String(error) });
    }
});
