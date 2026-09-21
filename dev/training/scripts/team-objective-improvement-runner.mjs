// Serially runs bounded team-objective search iterations until the search plateaus.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    loadTeamObjectiveState,
    TEAM_OBJECTIVE_STATE_PATH,
} from './team-objective-improvement-loop.mjs';

const DEFAULT_MAX_ITERATIONS = 24;
const DEFAULT_TIMEOUT_MS = 60 * 60 * 1000;
export const TEAM_OBJECTIVE_RUNNER_MAX_TIMEOUT_MS = 3 * 60 * 60 * 1000;

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function classifyTeamObjectiveSearch(state) {
    if (Number(state?.plateauRounds) >= 2) return 'plateau';
    return 'continue';
}

export function runTeamObjectiveSearch({
    executeIteration,
    readState,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = Date.now,
} = {}) {
    if (typeof executeIteration !== 'function' || typeof readState !== 'function') {
        throw new TypeError('executeIteration and readState are required');
    }
    const startedAt = now();
    let state = readState();
    if (classifyTeamObjectiveSearch(state) === 'plateau') {
        return { outcome: 'plateau', iterations: 0, state };
    }

    for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
        const remainingMs = timeoutMs - (now() - startedAt);
        if (remainingMs <= 0) return { outcome: 'timeout', iterations: iteration - 1, state };
        const result = executeIteration(remainingMs);
        state = readState();
        if (result?.timedOut) return { outcome: 'timeout', iterations: iteration, state };
        if (result?.status !== 0) return { outcome: 'error', iterations: iteration, state };
        if (classifyTeamObjectiveSearch(state) === 'plateau') {
            return { outcome: 'plateau', iterations: iteration, state };
        }
    }
    return { outcome: 'iterationLimit', iterations: maxIterations, state };
}

function runCli() {
    const loopPath = fileURLToPath(new URL('./team-objective-improvement-loop.mjs', import.meta.url));
    const maxIterations = parsePositiveInteger(
        process.env.TEAM_OBJECTIVE_RUNNER_MAX_ITERATIONS,
        DEFAULT_MAX_ITERATIONS
    );
    const timeoutMs = Math.min(
        parsePositiveInteger(process.env.TEAM_OBJECTIVE_RUNNER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
        TEAM_OBJECTIVE_RUNNER_MAX_TIMEOUT_MS
    );
    const result = runTeamObjectiveSearch({
        maxIterations,
        timeoutMs,
        readState: () => loadTeamObjectiveState(),
        executeIteration: (remainingMs) => {
            const child = spawnSync(process.execPath, [loopPath], {
                cwd: process.cwd(),
                env: process.env,
                stdio: 'inherit',
                timeout: remainingMs,
                windowsHide: true,
            });
            return {
                status: child.status,
                timedOut: child.error?.code === 'ETIMEDOUT',
            };
        },
    });
    console.log(
        `team-objective-runner outcome=${result.outcome} iterations=${result.iterations}`
        + ` plateauRounds=${Number(result.state?.plateauRounds) || 0}`
        + ` state=${TEAM_OBJECTIVE_STATE_PATH}`
    );
    process.exitCode = result.outcome === 'plateau' || result.outcome === 'iterationLimit' ? 0 : 1;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) runCli();
