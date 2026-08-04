import { execFile as execFileCallback } from 'node:child_process';
import process from 'node:process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

import {
    extractCandidateManifest,
    extractResearchManifest,
    loadCouncilAgentRoutes,
    resolveOpenCodeExecutable,
    runCouncilAgentCli,
} from './council-hardening-runner.mjs';

const execFile = promisify(execFileCallback);
const READINESS_FIXTURE = 'tests/council-test-loop/errors-v2-easy.mjs';
const READINESS_SYMBOL = 'normalizeSampleWindow';
const LIVE_SMOKE_PROMPT = `Read only the exact repository file ${READINESS_FIXTURE}; do not use glob or search, inspect other files, edit, use bash, or delegate. Review only normalizeSampleWindow against this public contract: it returns a normalized copy without mutating the caller-owned samples array, and numeric minimum/maximum values including zero are valid. Report exactly one strongest reachable contract defect with concrete cause and effect. Emit no status, planning, or introductory text. The first visible text line must be exactly VERDICT: ISSUES_FOUND or VERDICT: NEEDS_DATA. End with exactly one fenced JSON object {"findings":[{"file":"...","symbol":"...","category":"kebab-case","claim":"...","evidence":"...","confidence":"HIGH|MEDIUM|LOW","impact":"HIGH|MEDIUM|LOW"}]} and no text after it.`;

function isReadinessTarget(entry) {
    const file = String(entry?.file || '').replaceAll('\\', '/');
    return file.endsWith('errors-v2-easy.mjs') && entry?.symbol === READINESS_SYMBOL;
}

function representativeFindings(result) {
    if (!result?.validation?.valid || result.validation.verdict !== 'ISSUES_FOUND') return [];
    try {
        return extractResearchManifest(result.validation.report).findings.filter(isReadinessTarget);
    } catch {
        return [];
    }
}

function buildLeadReadinessPrompt(reports) {
    return [
        'Representative readiness consolidation only. Do not use tools, inspect files, edit, or delegate.',
        `The supplied independent reports all target ${READINESS_FIXTURE}:${READINESS_SYMBOL}.`,
        'Require at least four supplied valid reports. Consolidate their strongest shared defect into exactly one candidate; with fewer than four reports return NEEDS_DATA and an empty candidates array.',
        'The first visible text line must be exactly VERDICT: ISSUES_FOUND or VERDICT: NEEDS_DATA.',
        'End with exactly one fenced JSON object {"candidates":[{"id":"...","file":"...","symbol":"...","claim":"...","evidence":"...","potentialImpact":"HIGH|MEDIUM"}]} and no text after it.',
        JSON.stringify(reports),
    ].join('\n');
}

async function defaultListModels() {
    return execFile(resolveOpenCodeExecutable(), ['models'], { encoding: 'utf8', timeout: 15_000, windowsHide: true });
}

export async function runCouncilLiveSmoke({
    repositoryRoot = process.cwd(),
    timeoutMs = 300_000,
    run,
    listModels,
    onProgress = () => {},
} = {}) {
    const startedAt = Date.now();
    const { routes } = await loadCouncilAgentRoutes(repositoryRoot);
    const registeredExecution = listModels
        ? await listModels()
        : run
            ? { stdout: [...new Set(routes.values())].join('\n') }
            : await defaultListModels();
    const registered = new Set(String(registeredExecution?.stdout ?? registeredExecution ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean));
    const agents = ['council-review', 'council-review-fb', 'council-review-fb2', 'council-review-fb3', 'council-review-fb4'];
    const completed = new Set();
    const progress = setInterval(() => {
        onProgress({ scope: 'representative-review', completed: completed.size, total: agents.length + 1, elapsedMs: Date.now() - startedAt });
    }, 30_000);
    let scopeResults;
    let lead;
    let readinessReports = [];
    try {
        scopeResults = await Promise.all(agents.map(async (agent) => {
            const model = routes.get(agent);
            if (!registered.has(model)) {
                completed.add(agent);
                return { agent, model, validation: { valid: false, verdict: '', reasons: ['model-not-registered'], report: '' }, attempts: [], exitReason: 'INFRASTRUCTURE_ERROR' };
            }
            try {
                return await runCouncilAgentCli({ repositoryRoot, agent, prompt: LIVE_SMOKE_PROMPT, timeoutMs, ...(run ? { run } : {}) });
            } finally {
                completed.add(agent);
            }
        }));
        readinessReports = scopeResults.flatMap((result) => {
            const findings = representativeFindings(result);
            return findings.length > 0 ? [{ agent: result.agent, findings }] : [];
        });
        const leadModel = routes.get('council-lead');
        lead = registered.has(leadModel)
            ? await runCouncilAgentCli({
                repositoryRoot,
                agent: 'council-lead',
                prompt: buildLeadReadinessPrompt(readinessReports),
                timeoutMs,
                ...(run ? { run } : {}),
            })
            : { agent: 'council-lead', model: leadModel, valid: false, reasons: ['model-not-registered'], attempts: [], exitReason: 'INFRASTRUCTURE_ERROR' };
        completed.add('council-lead');
    } finally {
        clearInterval(progress);
    }
    const results = scopeResults.map((result) => {
        const findings = representativeFindings(result);
        const representative = findings.length > 0;
        return {
            agent: result.agent,
            model: result.model,
            valid: result.validation.valid && representative,
            verdict: result.validation.verdict,
            reasons: representative ? result.validation.reasons : [...result.validation.reasons, 'missing-representative-finding'],
            attempts: result.attempts.length,
            timedOut: result.timedOut,
            durationMs: result.attempts.reduce((sum, attempt) => sum + Number(attempt.durationMs || 0), 0),
            exitReason: result.exitReason,
            modelStarted: result.validation.runtime?.modelStarted ?? false,
            fallbackDetected: result.validation.reasons.includes('runtime-fallback') || result.validation.reasons.includes('model-route-mismatch'),
        };
    });
    const validRuns = results.filter(({ valid }) => valid).length;
    let representativeCandidate = false;
    if (lead.valid) {
        try {
            representativeCandidate = extractCandidateManifest(lead.report).candidates.some(isReadinessTarget);
        } catch {
            representativeCandidate = false;
        }
    }
    const leadHealthy = lead.valid === true && representativeCandidate;
    const leadReasons = representativeCandidate ? lead.reasons : [...(lead.reasons || []), 'missing-representative-candidate'];
    return {
        mode: 'REPRESENTATIVE_REVIEW',
        readinessTarget: { file: READINESS_FIXTURE, symbol: READINESS_SYMBOL },
        passed: validRuns >= 4 && leadHealthy,
        validRuns,
        requiredValidRuns: 4,
        distinctValidRoutes: new Set(results.filter(({ valid }) => valid).map(({ model }) => model)).size,
        leadHealthy,
        lead: {
            agent: lead.agent,
            model: lead.model,
            valid: leadHealthy,
            routeValid: lead.valid === true,
            reasons: leadReasons,
            attempts: lead.attempts.length,
            timedOut: lead.timedOut,
            durationMs: lead.durationMs,
            exitReason: lead.exitReason,
            modelStarted: lead.validation?.runtime?.modelStarted ?? false,
            fallbackDetected: lead.reasons?.includes('runtime-fallback') || lead.reasons?.includes('model-route-mismatch') || false,
        },
        durationMs: Date.now() - startedAt,
        results,
    };
}

async function main() {
    const timeoutMs = Number.parseInt(process.env.COUNCIL_LIVE_SMOKE_TIMEOUT_MS || '300000', 10);
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
