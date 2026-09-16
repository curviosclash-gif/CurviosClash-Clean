// Serially invokes the bounded heuristic improvement iteration until a terminal outcome.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PROFILES = Object.freeze(['defensive', 'balanced', 'aggressive']);
const TARGET_RATIO = 2;
const SEARCH_STATE_VERSION = 12;
const DEFAULT_MAX_ITERATIONS = 256;
export const MAX_RUNNER_TIMEOUT_MS = 3 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = MAX_RUNNER_TIMEOUT_MS;

export const RUNNER_EXIT_CODES = Object.freeze({
    target: 0,
    error: 1,
    timeout: 2,
    plateau: 3,
    iterationLimit: 4,
});

function parsePositiveInteger(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultStatePath(env) {
    return path.resolve(
        env.HEURISTIC_LOOP_STATE_PATH
            || path.join(os.tmpdir(), 'curviosclash-heuristic-improvement-state.json')
    );
}

function loadState(statePath) {
    try {
        return JSON.parse(fs.readFileSync(statePath, 'utf8'));
    } catch {
        return null;
    }
}

function targetReached(state) {
    const completeProfiles = new Set(state?.completeProfiles || []);
    return PROFILES.every((profile) => {
        const ratios = state?.lastRatios?.[profile];
        return completeProfiles.has(profile)
            && Number(ratios?.survival) >= TARGET_RATIO
            && Number(ratios?.kills) >= TARGET_RATIO;
    });
}

export function classifySearchState(state) {
    if (state?.version !== SEARCH_STATE_VERSION) return 'continue';
    if (targetReached(state)) return 'target';
    if (Number(state?.plateauRounds) >= 3) return 'plateau';
    return 'continue';
}

export function runSearch({
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
    let outcome = classifySearchState(state);
    if (outcome !== 'continue') return { outcome, iterations: 0, state };

    for (let iterations = 1; iterations <= maxIterations; iterations += 1) {
        const remainingMs = timeoutMs - (now() - startedAt);
        if (remainingMs <= 0) return { outcome: 'timeout', iterations: iterations - 1, state };

        const result = executeIteration(remainingMs);
        state = readState();
        outcome = classifySearchState(state);
        if (outcome !== 'continue') return { outcome, iterations, state };
        if (result?.timedOut) return { outcome: 'timeout', iterations, state };
        if (result?.status !== 0) return { outcome: 'error', iterations, state, status: result?.status };
    }

    return { outcome: 'iterationLimit', iterations: maxIterations, state };
}

function formatRatios(state) {
    return PROFILES.map((profile) => {
        const ratios = state?.lastRatios?.[profile];
        const survival = Number(ratios?.survival);
        const kills = Number(ratios?.kills);
        return `${profile}=${Number.isFinite(survival) ? survival.toFixed(3) : 'n/a'}`
            + `/${Number.isFinite(kills) ? kills.toFixed(3) : 'n/a'}`;
    }).join(' ');
}

function runCli() {
    const env = process.env;
    const statePath = defaultStatePath(env);
    const loopPath = fileURLToPath(new URL('./heuristic-improvement-loop.mjs', import.meta.url));
    const maxIterations = parsePositiveInteger(
        env.HEURISTIC_RUNNER_MAX_ITERATIONS,
        DEFAULT_MAX_ITERATIONS
    );
    const timeoutMs = Math.min(
        parsePositiveInteger(env.HEURISTIC_RUNNER_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
        MAX_RUNNER_TIMEOUT_MS
    );

    const result = runSearch({
        maxIterations,
        timeoutMs,
        readState: () => loadState(statePath),
        executeIteration: (remainingMs) => {
            const child = spawnSync(process.execPath, [loopPath], {
                cwd: process.cwd(),
                env,
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
        `heuristic-runner outcome=${result.outcome} iterations=${result.iterations}`
        + ` plateauRounds=${Number(result.state?.plateauRounds) || 0}`
        + ` ratios=${formatRatios(result.state)}`
    );
    process.exitCode = RUNNER_EXIT_CODES[result.outcome] ?? RUNNER_EXIT_CODES.error;
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (entryPath === fileURLToPath(import.meta.url)) runCli();
