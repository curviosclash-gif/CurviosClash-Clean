import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
    extractResearchManifest,
    runResearchScope,
} from './council-hardening-runner.mjs';

const LIVE_SMOKE_PROMPT = `Read the exact repository file .opencode/council-models.json directly; do not use glob or search. Verify that readOnlyCouncil.primary contains council-review. Do not inspect any other file, edit, use bash, or delegate. If the exact file and property are readable, return CLEAN; otherwise return NEEDS_DATA. Emit no status, planning, or introductory text. The first visible text line must be exactly VERDICT: CLEAN or VERDICT: NEEDS_DATA. End with exactly one fenced JSON block {"findings":[]} and no text after it.`;

export async function runCouncilLiveSmoke({
    repositoryRoot = process.cwd(),
    timeoutMs = 120_000,
    run,
    onProgress = () => {},
} = {}) {
    const scope = await runResearchScope({
        repositoryRoot,
        scope: 'review',
        prompt: LIVE_SMOKE_PROMPT,
        timeoutMs,
        progressIntervalMs: 30_000,
        onProgress,
        ...(run ? { run } : {}),
    });
    const results = scope.results.map((result) => {
        let structured = false;
        if (result.validation.valid) {
            try {
                structured = extractResearchManifest(result.validation.report).findings.length === 0;
            } catch {
                structured = false;
            }
        }
        return {
            agent: result.agent,
            valid: result.validation.valid && structured && result.validation.verdict === 'CLEAN',
            verdict: result.validation.verdict,
            reasons: structured ? result.validation.reasons : [...result.validation.reasons, 'invalid-findings-manifest'],
            attempts: result.attempts.length,
            timedOut: result.timedOut,
            durationMs: result.attempts.reduce((sum, attempt) => sum + Number(attempt.durationMs || 0), 0),
        };
    });
    const validRuns = results.filter(({ valid }) => valid).length;
    return {
        passed: validRuns >= 4,
        validRuns,
        requiredValidRuns: 4,
        durationMs: scope.durationMs,
        results,
    };
}

async function main() {
    const timeoutMs = Number.parseInt(process.env.COUNCIL_LIVE_SMOKE_TIMEOUT_MS || '120000', 10);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError('COUNCIL_LIVE_SMOKE_TIMEOUT_MS must be a positive integer');
    const result = await runCouncilLiveSmoke({
        timeoutMs,
        onProgress: (progress) => process.stderr.write(`PROGRESS ${JSON.stringify(progress)}\n`),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        process.stderr.write(`${error.message}\n`);
        process.exitCode = 1;
    });
}
